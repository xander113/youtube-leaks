import { config } from '../config.js';
import { key, read } from '../middleware/validation.js';
import { fail } from '../middleware/errors.js';
import { allowedQualities, mediaPath } from '../services/media.js';
import { z } from 'zod';

export function media(db) {
  async function clip(id) {
    const row = await db.one("SELECT id, guest, demo, media_format FROM clips WHERE id = ? AND status = 'ready'", [id]);
    if (!row) fail(404, 'Clip not found.');
    return row;
  }

  return {
    async poster(req, res) {
      const id = read(key, req.params.id);
      const row = await clip(id);
      res.sendFile(await mediaPath(id, ['poster.webp', 'poster.jpg', 'poster.png'], row.demo && !config.production),
        { maxAge: 300000, headers: { 'Cross-Origin-Resource-Policy': 'cross-origin' } });
    },
    async play(req, res) {
      const { id, quality } = read(z.object({ id: key, quality: z.enum(['guest', 'hd', 'high']) }), req.params);
      const row = await clip(id);
      if ((!row.guest && !req.viewer.auth.canWatch) || !allowedQualities(req.viewer).includes(quality)) {
        fail(403, 'This video quality needs a Watcher plan.');
      }
      if (req.headers.range && !/^bytes=(?:\d{1,16}-\d{0,16}|-\d{1,16})$/.test(req.headers.range)) {
        fail(416, 'Ask for one valid range.');
      }
      res.sendFile(await mediaPath(id, `${quality}.${row.media_format}`, row.demo && !config.production), {
        cacheControl: false, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Origin' }
      });
    }
  };
}
