import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config, allowedOrigin } from '../app/config.js';
import { authState, sessionHash } from '../app/models/Account.js';
import { errorResponse, fail } from '../app/middleware/errors.js';
import { take } from '../app/middleware/limits.js';
import { administrator } from '../app/middleware/access.js';
import { key, read, text } from '../app/middleware/validation.js';
import * as catalog from '../app/models/Catalog.js';
import { commentRoom, targetSchema, viewTarget } from '../app/controllers/community.js';

export function liveRoutes(io, app, services) {
  const { db, redis, community, admin, playlists, support } = services;
  const trust = app.get('trust proxy fn');
  const actions = {
    'viewer:get': viewer => viewer,
    'catalog:list': viewer => catalog.browse(db, viewer),
    'catalog:search': (viewer, q) => catalog.find(db, viewer, read(text(80), q)),
    'catalog:details': (viewer, payload) => {
      const { type, id } = read(targetSchema, payload);
      return catalog.details(db, viewer, type, id);
    },
    'comments:list': async (viewer, payload, socket) => {
      const target = read(targetSchema, payload);
      const items = await community.list(viewer, target);
      const room = commentRoom(target);
      if (socket.data.commentRoom && socket.data.commentRoom !== room) await socket.leave(socket.data.commentRoom);
      await socket.join(room);
      socket.data.commentRoom = room;
      return items;
    },
    'comments:leave': async (_viewer, _payload, socket) => {
      if (socket.data.commentRoom) await socket.leave(socket.data.commentRoom);
      socket.data.commentRoom = null;
      return { ok: true };
    },
    'comments:post': async (viewer, payload, _socket, ip) => {
      if (!await take(redis, 'comment', viewer.auth.id || ip, 8, 60)) fail(429, 'Wait a moment before posting again.');
      return community.post(viewer, payload);
    },
    'playlists:list': (viewer, payload) => playlists.list(viewer, read(z.boolean(), payload)),
    'support:list': viewer => support.list(viewer),
    'admin:get': (viewer, payload) => { administrator(viewer); return admin.state(read(z.object({ before: z.coerce.number().optional() }), payload)); }
  };

  io.use(async (socket, next) => {
    const requestId = randomUUID();
    try {
      const ip = socket.request.socket.remoteAddress ? services.ip(socket.request, trust) : 'unknown';
      socket.data.ip = ip;
      if (!allowedOrigin(socket.handshake.headers.origin)) fail(403, 'This origin is blocked.');
      if (!await take(redis, 'socket-connect', ip, 90, 60)) fail(429, 'Too many live connections.');
      const token = sessionHash(socket.handshake.headers.cookie);
      const viewer = await authState(db, token);
      socket.data.token = token;
      if (viewer.auth.id) {
        await socket.join([`session:${token}`, `account:${viewer.auth.id}`]);
        if (viewer.auth.role === 'admin') await socket.join('admins');
      }
      next();
    } catch (error) {
      const { status, body } = errorResponse(error, 'Socket.IO handshake', requestId);
      const rejected = new Error(body.error);
      rejected.data = { ...body, status };
      next(rejected);
    }
  });

  io.on('connection', socket => {
    // A socket remains open across mode, plan, and ban changes. Look up access for each action.
    for (const [event, action] of Object.entries(actions)) {
      socket.on(event, async (payload, reply) => {
        if (typeof reply !== 'function') return;
        const requestId = randomUUID();
        try {
          const ip = socket.data.ip;
          if (!await take(redis, 'socket-action', ip, 1000, 60)) fail(429, 'Too many live requests.');
          const viewer = await authState(db, socket.data.token);
          reply({ ok: true, data: await action(viewer, payload, socket, ip) });
        } catch (error) {
          const { status, body } = errorResponse(error, `Socket.IO ${event}`, requestId);
          reply({ ok: false, status, ...body });
        }
      });
    }
  });
}
