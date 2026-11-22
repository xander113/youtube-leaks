import { z } from 'zod';
import { allowedOrigin, config } from '../config.js';
import { key, read } from '../middleware/validation.js';
import { fail } from '../middleware/errors.js';
import { allowedQualities, mediaPath, streamAsset } from '../services/media.js';
import { playbackGrants, ticketPattern } from '../services/playbackGrants.js';

const qualities = z.enum(['guest', 'hd', 'high']);
const mediaRequest = z.object({ id: key, quality: qualities });
const streamRequest = z.object({
  token: z.string().regex(ticketPattern),
  asset: z.string().regex(/^(?:index\.m3u8|key|part-\d{6}\.ts)$/)
});
const streamHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Disposition': 'inline'
};

function requirePlayerOrigin(req) {
  const site = req.get('Sec-Fetch-Site');
  const origin = req.get('Origin');
  if (req.get('Sec-Fetch-Mode') === 'navigate' || (site && site !== 'same-origin') || (origin && (
    !allowedOrigin(origin) || (config.production && origin !== config.appOrigin)
  ))) fail(403, 'Open the clip in its player.');
}

function requireAccess(viewer, clip, quality) {
  if ((!clip.guest && !viewer.auth.canWatch) || !allowedQualities(viewer).includes(quality)) {
    fail(403, 'This video quality needs a Watcher plan.');
  }
}

export function media(db, redis) {
  const grants = playbackGrants(redis);
  async function clip(id) {
    const row = await db.one("SELECT id, guest, demo, stream_id, job_error FROM clips WHERE id = ? AND status = 'ready'", [id]);
    if (!row || (config.production && row.demo)) fail(404, 'Clip not found.');
    return row;
  }

  return {
    async poster(req, res) {
      const id = read(key, req.params.id);
      const row = await clip(id);
      res.sendFile(await mediaPath(id, ['poster.webp', 'poster.jpg', 'poster.png'], Boolean(row.demo)),
        { maxAge: 300000, headers: { 'Cross-Origin-Resource-Policy': 'cross-origin' } });
    },
    async start(req, res) {
      requirePlayerOrigin(req);
      const { id, quality } = read(mediaRequest, req.params);
      const row = await clip(id);
      requireAccess(req.viewer, row, quality);
      if (!row.stream_id) {
        if (row.job_error) fail(503, 'Video preparation failed. Contact support if this continues.');
        fail(409, 'This clip is being prepared for playback.');
      }

      const token = await grants.issue(req, res, { id, quality, streamId: row.stream_id });
      res.set(streamHeaders).json({ manifest: `/api/playback/${token}/index.m3u8` });
    },
    async stream(req, res) {
      requirePlayerOrigin(req);
      const { token, asset } = read(streamRequest, req.params);
      const { id, quality, streamId } = await grants.read(req, token);
      const row = await clip(id);
      requireAccess(req.viewer, row, quality);
      if (row.stream_id !== streamId) fail(410, 'This playback session expired.');

      const type = asset === 'index.m3u8' ? 'application/vnd.apple.mpegurl'
        : asset === 'key' ? 'application/octet-stream' : 'video/mp2t';
      res.type(type).sendFile(streamAsset(id, streamId, quality, asset), {
        acceptRanges: false, cacheControl: false, etag: false, lastModified: false, headers: streamHeaders
      });
    }
  };
}
