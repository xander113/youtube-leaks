import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { details } from '../models/Catalog.js';
import { tierExpression } from '../models/Account.js';
import { watcher, signedIn } from '../middleware/access.js';
import { read, key, kind, text } from '../middleware/validation.js';
import { fail } from '../middleware/errors.js';

export const targetSchema = z.object({ type: kind, id: key });
export const commentRoom = ({ type, id }) => `comments:${type}:${id}`;

export async function viewTarget(db, viewer, { type, id }) {
  const item = await details(db, viewer, type, id);
  if (item.locked) fail(403, 'This is only for Watchers.');
  return item;
}

export function community(db, io) {
  return {
    async list(viewer, target) {
      await viewTarget(db, viewer, target);
      const roots = await db.all(`SELECT c.id, c.user_id, c.body, c.created_at, u.name, u.role,
        ${tierExpression} AS tier,
        (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id = c.id) AS likes,
        EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = ?) AS liked
        FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.target_type = ? AND c.target_id = ? AND c.parent_id IS NULL AND u.banned_at IS NULL
        ORDER BY c.created_at DESC, c.id LIMIT 20`, [Date.now(), viewer.auth.id, target.type, target.id]);
      const replies = roots.length ? await db.all(`SELECT * FROM (
        SELECT c.id, c.user_id, c.body, c.created_at, c.parent_id, u.name, u.role,
        ${tierExpression} AS tier,
        (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id = c.id) AS likes,
        EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = ?) AS liked,
        ROW_NUMBER() OVER(PARTITION BY c.parent_id ORDER BY c.created_at DESC, c.id) AS position
        FROM comments c JOIN users u ON u.id = c.user_id WHERE u.banned_at IS NULL
        AND c.parent_id IN (${roots.map(() => '?').join(',')})
        ) ranked WHERE position <= 5 ORDER BY created_at, id`, [Date.now(), viewer.auth.id, ...roots.map(row => row.id)]) : [];
      const present = row => ({
        id: row.id, body: row.body, created_at: row.created_at, name: row.name,
        badge: row.role === 'admin' ? (row.user_id === 1 ? 'Head Admin' : 'Admin') : viewer.paid ? row.tier : null,
        likes: row.likes, liked: Boolean(row.liked),
        canDelete: viewer.auth.role === 'admin' || viewer.auth.id === row.user_id
      });
      return roots.map(root => ({ ...present(root), replies: replies.filter(row => row.parent_id === root.id).map(present) }));
    },
    async post(viewer, input) {
      watcher(viewer);
      const target = read(targetSchema.extend({ body: text(500), parent: key.optional() }), input);
      await viewTarget(db, viewer, target);
      if (target.parent) {
        const parent = await db.one(`SELECT c.id FROM comments c JOIN users u ON u.id = c.user_id
          WHERE c.id = ? AND c.target_type = ? AND c.target_id = ? AND c.parent_id IS NULL AND u.banned_at IS NULL`,
        [target.parent, target.type, target.id]);
        if (!parent) fail(404, 'This comment is gone.');
      }
      const id = randomUUID();
      try {
        await db.all(`INSERT INTO comments (id, user_id, target_type, target_id, parent_id, body, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, viewer.auth.id, target.type, target.id, target.parent || null, target.body, Date.now()]);
      } catch (error) {
        if (['23503', 'SQLITE_CONSTRAINT_FOREIGNKEY'].includes(error.code) || error.errcode === 787) fail(409, 'This comment is gone.');
        throw error;
      }
      io.to(commentRoom(target)).emit('comments:changed');
      return { id };
    },
    async like(viewer, comment, input) {
      watcher(viewer);
      const { liked } = read(z.object({ liked: z.boolean() }), input);
      const target = await db.one(`SELECT c.target_type AS type, c.target_id AS id FROM comments c
        JOIN users u ON u.id = c.user_id WHERE c.id = ? AND u.banned_at IS NULL`, [comment]);
      if (!target) fail(404, 'Comment not found.');
      await viewTarget(db, viewer, target);
      if (liked) {
        const updated = await db.one(`INSERT INTO comment_likes (comment_id, user_id)
          SELECT c.id, ? FROM comments c WHERE c.id = ? ON CONFLICT DO NOTHING RETURNING comment_id`, [viewer.auth.id, comment]);
        if (updated) io.to(commentRoom(target)).emit('comments:changed');
      } else {
        const removed = await db.one('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ? RETURNING comment_id',
          [comment, viewer.auth.id]);
        if (removed) io.to(commentRoom(target)).emit('comments:changed');
      }
      return { liked };
    },
    async remove(viewer, comment) {
      signedIn(viewer);
      const removed = await db.one(`DELETE FROM comments WHERE id = ? AND (user_id = ? OR ? = 1)
        RETURNING target_type, target_id`, [comment, viewer.auth.id, Number(viewer.auth.role === 'admin')]);
      if (!removed) fail(404, 'Comment not found.');
      io.to(commentRoom({ type: removed.target_type, id: removed.target_id })).emit('comments:changed');
      return { ok: true };
    }
  };
}
