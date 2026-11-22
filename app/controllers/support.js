import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { administrator, signedIn } from '../middleware/access.js';
import { text, read } from '../middleware/validation.js';
import { fail } from '../middleware/errors.js';

export function support(db, io) {
  return {
    async list(viewer) {
      signedIn(viewer);
      if (viewer.auth.role === 'admin') {
        return db.all(`SELECT s.id, s.body, s.priority, s.created_at, s.answer, u.name
          FROM support_requests s JOIN users u ON u.id = s.user_id
          ORDER BY CASE WHEN s.answered_at IS NULL THEN 0 ELSE 1 END, s.priority DESC, s.created_at LIMIT 100`);
      }
      return db.all(`SELECT id, body, priority, created_at, answer FROM support_requests
        WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`, [viewer.auth.id]);
    },
    async send(viewer, body) {
      signedIn(viewer);
      const { message } = read(z.object({ message: text(2000) }), body);
      const id = randomUUID();
      await db.all('INSERT INTO support_requests (id, user_id, body, priority, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, viewer.auth.id, message, Number(viewer.paid && viewer.auth.tier === 'premium'), Date.now()]);
      io.to(['admins', `account:${viewer.auth.id}`]).emit('support:changed');
      return { id };
    },
    async answer(viewer, id, body) {
      administrator(viewer);
      const { message } = read(z.object({ message: text(2000) }), body);
      const row = await db.one('UPDATE support_requests SET answer = ?, answered_at = ? WHERE id = ? RETURNING user_id',
        [message, Date.now(), id]);
      if (!row) fail(404, 'Message not found.');
      io.to(['admins', `account:${row.user_id}`]).emit('support:changed');
      return { ok: true };
    }
  };
}
