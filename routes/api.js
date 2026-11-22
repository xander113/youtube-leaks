import express from 'express';
import multer from 'multer';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config } from '../app/config.js';
import { accounts } from '../app/controllers/accounts.js';
import { targetSchema } from '../app/controllers/community.js';
import { media } from '../app/controllers/media.js';
import { authState, sessionHash } from '../app/models/Account.js';
import * as catalog from '../app/models/Catalog.js';
import { administrator } from '../app/middleware/access.js';
import { browserWrite, concurrent, rate } from '../app/middleware/limits.js';
import { errorResponse, fail } from '../app/middleware/errors.js';
import { key, id, read, text } from '../app/middleware/validation.js';
import { staging } from '../app/services/media.js';

export function apiRoutes({ db, io, redis, admin, billing, community, playlists, support, isDraining }) {
  const api = express.Router();
  const account = accounts(db, io);
  const video = media(db, redis);
  const upload = multer({
    storage: multer.diskStorage({ destination: staging, filename: (_req, _file, cb) => cb(null, randomUUID() + '.source') }),
    limits: { fileSize: config.maxUpload, files: 1, fields: 6, fieldSize: 4096, parts: 8 }
  }).single('video');
  const send = (fn, status = 200) => async (req, res) => res.status(status).json(await fn(req));
  const requireAdmin = (req, _res, next) => { administrator(req.viewer); next(); };
  const target = req => read(targetSchema, req.params);
  const item = req => read(key, req.params.id);
  const authLimit = rate(redis, 'auth', 18, 60);
  const uploadSlots = concurrent(8);
  const commentLimit = rate(redis, 'comment', 8, 60, req => req.viewer.auth.id || req.ip);

  api.get('/health/live', (_req, res) => res.json({ ok: true }));
  api.get('/health/ready', async (_req, res) => {
    if (isDraining() || (config.production && redis?.status !== 'ready')) fail(503, 'Service is getting ready.');
    await db.one('SELECT 1');
    res.json({ ok: true });
  });

  api.use(rate(redis, 'api', 900, 60));
  api.post('/stripe/webhook', express.raw({ type: 'application/json', limit: '128kb' }), billing.webhook);
  api.use(browserWrite);
  api.use(express.json({ limit: '24kb' }));
  api.get('/posters/:id', video.poster);

  api.use(async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.vary('Cookie');
    req.viewer = await authState(db, sessionHash(req.headers.cookie));
    next();
  });

  api.get('/viewer', send(req => req.viewer));
  api.post('/auth/register', authLimit, account.register);
  api.post('/auth/login', authLimit, account.login);
  api.post('/auth/logout', account.logout);

  api.get('/catalog', send(req => catalog.browse(db, req.viewer)));
  api.get('/search', send(req => catalog.find(db, req.viewer, read(text(80), req.query.q))));
  api.get('/details/:type/:id', send(req => {
    const { type, id } = target(req);
    return catalog.details(db, req.viewer, type, id);
  }));
  api.post('/playback/:id/:quality', rate(redis, 'playback-start', 120, 60), video.start);
  api.get('/playback/:token/:asset', video.stream);

  api.get('/comments/:type/:id', send(req => community.list(req.viewer, target(req))));
  api.post('/comments/:type/:id', commentLimit, send(req => community.post(req.viewer, { ...req.body, ...target(req) }), 201));
  api.patch('/comments/:id/like', rate(redis, 'likes', 60, 60, req => req.viewer.auth.id || req.ip),
    send(req => community.like(req.viewer, item(req), req.body)));
  api.delete('/comments/:id', send(req => community.remove(req.viewer, item(req))));
  api.get('/playlists', send(req => playlists.list(req.viewer, req.query.items !== '0')));
  api.post('/playlists', send(req => playlists.create(req.viewer, req.body), 201));
  api.delete('/playlists/:id', send(req => playlists.remove(req.viewer, item(req))));
  api.post('/playlists/:id/items', send(req => playlists.add(req.viewer, item(req), req.body)));
  api.delete('/playlists/:id/items/:type/:targetId', send(req => playlists.removeItem(req.viewer, item(req),
    read(targetSchema, { type: req.params.type, id: req.params.targetId }))));

  api.get('/support', send(req => support.list(req.viewer)));
  api.post('/support', rate(redis, 'support', 8, 60, req => req.viewer.auth.id || req.ip), send(req => support.send(req.viewer, req.body), 201));
  api.post('/billing/checkout', rate(redis, 'billing', 12, 60), send(req => billing.checkout(req.viewer, req.body, redis)));
  api.post('/billing/portal', rate(redis, 'billing', 12, 60), send(req => billing.portal(req.viewer)));

  if (!config.production) {
    api.get('/billing/local', send(req => billing.localPlan(req.viewer)));
    api.post('/billing/local', rate(redis, 'billing', 12, 60), send(req => billing.localPayment(req.viewer, req.body)));
  }

  api.use('/admin', requireAdmin);
  api.get('/admin', send(req => admin.state(req.query)));
  api.post('/admin/mode', send(async req => {
    if (req.viewer.auth.isHead && req.body?.paid === true && billing.configured) await billing.verifyPrices();
    return admin.mode(req.viewer, req.body);
  }));
  api.post('/admin/series', send(req => admin.series(req.body), 201));
  api.post('/admin/clips', rate(redis, 'upload', 12, 60, req => req.viewer.auth.id), uploadSlots, upload, async (req, res) => {
    let created;
    try {
      created = await admin.upload(req);
    } catch (error) {
      if (req.file) await rm(req.file.path, { force: true }).catch(cleanup => console.error('Upload cleanup', cleanup));
      throw error;
    }
    res.status(202).json(created);
  });
  api.patch('/admin/clips/:id', send(req => admin.editClip(item(req), req.body)));
  api.post('/admin/clips/:id/retry', send(req => admin.retry(item(req))));
  api.delete('/admin/clips/:id', send(req => admin.discard(item(req))));
  api.patch('/admin/watchers/:id/payment', send(req => admin.payment(read(id, req.params.id), req.body)));
  api.post('/admin/watchers/:id/ban', send(req => admin.ban(read(id, req.params.id), req.body)));
  api.post('/admin/feeds', send(req => admin.addFeed(req.body), 201));
  api.patch('/admin/feeds/:id', send(req => admin.changeFeed(item(req), req.body)));
  api.post('/admin/support/:id', send(req => support.answer(req.viewer, item(req), req.body)));

  api.use((_req, _res) => fail(404, 'API route not found.'));
  api.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const { status, body } = errorResponse(error, `${req.method} ${req.path}`, req.id);
    res.status(status).json(body);
  });
  return api;
}
