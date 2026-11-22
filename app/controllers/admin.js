import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { config } from '../config.js';
import { headAdmin } from '../middleware/access.js';
import { fail } from '../middleware/errors.js';
import { flag, id as userId, key, read, settingsSchema, text } from '../middleware/validation.js';
import { sourcePath } from '../services/media.js';
import { safeUrl } from '../services/rss.js';
import { tierExpression } from '../models/Account.js';

const clipSchema = z.object({
  title: text(120), description: text(1600), category: text(60), guest: flag,
  seriesId: key.nullish(), date: z.iso.date().optional()
});

export function admins(db, io, billingConfigured, catalogChanged) {
  const adminChanged = () => io.to('admins').emit('admin:changed');

  async function verifySeries(seriesId) {
    if (seriesId && !await db.one('SELECT id FROM series WHERE id = ?', [seriesId])) {
      fail(404, 'Series not found.');
    }
  }

  return {
    async state(query = {}) {
      const before = query.before ? read(userId, query.before) : 2147483647;
      const [users, clips, series, feeds] = await Promise.all([
        db.all(`SELECT u.id, u.name, u.email, u.role, u.paid_override, u.banned_at, ${tierExpression} AS plan
          FROM users u WHERE u.id > 1 AND u.id < ? ORDER BY u.id DESC LIMIT 51`, [Date.now(), before]),
        db.all(`SELECT id, title, description, category, series_id, guest, status, published_at,
          job_error, demo FROM clips ORDER BY created_at DESC, id LIMIT 100`),
        db.all('SELECT id, title, random_order FROM series ORDER BY created_at DESC, id LIMIT 300'),
        db.all('SELECT id, url, category, series_id, guest, enabled, last_run, last_error, started_at FROM feeds ORDER BY url LIMIT 100')
      ]);
      return {
        users: users.slice(0, 50), nextUser: users.length > 50 ? users[49].id : null,
        clips: clips.map(row => ({ ...row, job_error: config.production && row.job_error ? 'Video processing failed. Check the server log.' : row.job_error })),
        series, feeds
      };
    },
    async series(input) {
      const value = read(z.object({ title: text(120), description: text(1600), category: text(60), random: flag }), input);
      const id = randomUUID();
      await db.all('INSERT INTO series (id, title, description, category, random_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, value.title, value.description, value.category, Number(value.random), Date.now()]);
      catalogChanged();
      return { id };
    },
    async upload(req) {
      if (!req.file) fail(400, 'Choose a video file.');
      const clip = read(clipSchema, {
        ...req.body, seriesId: req.body.seriesId || null, date: req.body.date || undefined, guest: req.body.guest === 'true'
      });
      await verifySeries(clip.seriesId);
      const now = Date.now();
      const id = req.file.filename.slice(0, -7);
      await db.all(`INSERT INTO clips (id, title, description, category, guest, series_id, created_at, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, clip.title, clip.description, clip.category, Number(clip.guest),
        clip.seriesId || null, now, clip.date ? Date.parse(clip.date) : now]);
      adminChanged();
      return { id };
    },
    async editClip(id, input) {
      const clip = read(clipSchema, input);
      await verifySeries(clip.seriesId);
      const row = await db.one(`UPDATE clips SET title = ?, description = ?, category = ?, guest = ?, series_id = ?,
        published_at = COALESCE(?, published_at) WHERE id = ? RETURNING id`,
      [clip.title, clip.description, clip.category, Number(clip.guest), clip.seriesId || null, clip.date ? Date.parse(clip.date) : null, id]);
      if (!row) fail(404, 'Clip not found.');
      catalogChanged();
      return row;
    },
    async retry(id) {
      const row = await db.one("UPDATE clips SET status = 'queued', job_error = NULL WHERE id = ? AND status = 'failed' RETURNING id", [id]);
      if (!row) fail(409, 'Only failed videos can be retried.');
      adminChanged();
      return row;
    },
    async discard(id) {
      const row = await db.one("DELETE FROM clips WHERE id = ? AND status = 'failed' RETURNING id", [id]);
      if (!row) fail(409, 'Only failed videos can be removed here.');
      await Promise.allSettled([rm(sourcePath(id), { force: true }), rm(`${config.dataDir}/media/${id}`, { force: true, recursive: true })]);
      adminChanged();
      return row;
    },
    async mode(viewer, input) {
      headAdmin(viewer);
      const { paid } = read(settingsSchema, input);
      if (paid && !billingConfigured) fail(409, 'Set up Stripe before turning on paid mode.');
      await db.all('UPDATE settings SET paid = ? WHERE id = 1', [Number(paid)]);
      io.emit('access:changed');
      return { paid };
    },
    async payment(id, input) {
      const { access } = read(z.object({ access: z.enum(['automatic', 'unpaid', 'basic', 'premium']) }), input);
      const row = await db.one("UPDATE users SET paid_override = ? WHERE id = ? AND role = 'watcher' RETURNING id",
        [access === 'automatic' ? null : access, id]);
      if (!row) fail(404, 'Watcher not found.');
      io.to(`account:${id}`).emit('access:changed');
      io.emit('comments:changed');
      adminChanged();
      return { ok: true };
    },
    async ban(id, input) {
      const { banned } = read(z.object({ banned: z.boolean() }), input);
      const row = await db.one("UPDATE users SET banned_at = ? WHERE id = ? AND role = 'watcher' RETURNING id",
        [banned ? Date.now() : null, id]);
      if (!row) fail(404, 'Watcher not found.');
      if (banned) {
        await db.all('DELETE FROM sessions WHERE user_id = ?', [id]);
        io.in(`account:${id}`).disconnectSockets(true);
      }
      io.emit('comments:changed');
      adminChanged();
      return { ok: true };
    },
    async addFeed(input) {
      const value = read(z.object({ url: z.url().max(2000), category: text(60), seriesId: key.nullish(), guest: flag }), input);
      const url = safeUrl(value.url);
      await verifySeries(value.seriesId);
      const row = await db.one(`INSERT INTO feeds (id, url, category, series_id, guest, due_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (url) DO NOTHING RETURNING id`, [randomUUID(), url.href, value.category, value.seriesId || null, Number(value.guest), Date.now()]);
      if (!row) fail(409, 'This feed is already added.');
      adminChanged();
      return row;
    },
    async changeFeed(id, input) {
      const value = read(z.object({ enabled: z.boolean().optional(), run: z.boolean().optional() }), input);
      const row = await db.one(`UPDATE feeds SET enabled = COALESCE(?, enabled), due_at = COALESCE(?, due_at)
        WHERE id = ? RETURNING id`, [value.enabled === undefined ? null : Number(value.enabled), value.run ? Date.now() : null, id]);
      if (!row) fail(404, 'Feed not found.');
      adminChanged();
      return row;
    }
  };
}
