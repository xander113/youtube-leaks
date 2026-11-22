import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { watcher } from '../middleware/access.js';
import { read, text } from '../middleware/validation.js';
import { fail } from '../middleware/errors.js';
import { targetSchema, viewTarget } from './community.js';

export function playlists(db, io) {
  const changed = id => io.to(`account:${id}`).emit('playlists:changed');
  async function list(viewer, withItems = true) {
    watcher(viewer);
    const lists = await db.all('SELECT id, title FROM playlists WHERE user_id = ? ORDER BY created_at DESC, id LIMIT 50', [viewer.auth.id]);
    if (!withItems || !lists.length) return lists;
    const entries = await db.all(`SELECT i.playlist_id, i.target_type AS kind, i.target_id AS id,
      COALESCE(c.title, s.title) AS title
      FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id
      LEFT JOIN clips c ON i.target_type = 'clip' AND i.target_id = c.id AND c.status = 'ready'
      LEFT JOIN series s ON i.target_type = 'series' AND i.target_id = s.id
      WHERE p.user_id = ? AND (c.id IS NOT NULL OR s.id IS NOT NULL)
      ORDER BY i.created_at DESC, i.target_id`, [viewer.auth.id]);
    return lists.map(row => ({ ...row, items: entries.filter(item => item.playlist_id === row.id) }));
  }
  return {
    list,
    async create(viewer, input) {
      watcher(viewer);
      const { title } = read(z.object({ title: text(80) }), input);
      const owner = viewer.auth.id;
      const row = await db.one(`INSERT INTO playlists (id, user_id, title, created_at)
        SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM playlists WHERE user_id = ?) < 50 RETURNING id`,
      [randomUUID(), owner, title, Date.now(), owner]);
      if (!row) fail(409, 'Each account can have up to 50 playlists.');
      changed(owner);
      return row;
    },
    async remove(viewer, listId) {
      watcher(viewer);
      const row = await db.one('DELETE FROM playlists WHERE id = ? AND user_id = ? RETURNING id', [listId, viewer.auth.id]);
      if (!row) fail(404, 'Playlist not found.');
      changed(viewer.auth.id);
      return { ok: true };
    },
    async add(viewer, listId, input) {
      watcher(viewer);
      const target = read(targetSchema, input);
      await viewTarget(db, viewer, target);
      const row = await db.one(`INSERT INTO playlist_items (playlist_id, target_type, target_id, created_at)
        SELECT p.id, ?, ?, ? FROM playlists p WHERE p.id = ? AND p.user_id = ?
          AND (SELECT COUNT(*) FROM playlist_items WHERE playlist_id = p.id) < 200
        ON CONFLICT DO NOTHING RETURNING playlist_id`,
      [target.type, target.id, Date.now(), listId, viewer.auth.id]);
      if (!row) {
        if (!await db.one('SELECT id FROM playlists WHERE id = ? AND user_id = ?', [listId, viewer.auth.id])) {
          fail(404, 'Playlist not found.');
        }
        if (!await db.one('SELECT playlist_id FROM playlist_items WHERE playlist_id = ? AND target_type = ? AND target_id = ?',
          [listId, target.type, target.id])) fail(409, 'This playlist is full.');
      }
      changed(viewer.auth.id);
      return { ok: true };
    },
    async removeItem(viewer, listId, target) {
      watcher(viewer);
      await db.all(`DELETE FROM playlist_items WHERE playlist_id = ? AND target_type = ? AND target_id = ?
        AND EXISTS (SELECT 1 FROM playlists WHERE id = ? AND user_id = ?)`,
      [listId, target.type, target.id, listId, viewer.auth.id]);
      changed(viewer.auth.id);
      return { ok: true };
    }
  };
}
