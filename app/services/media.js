import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { fail } from '../middleware/errors.js';
import { availableEncoders, ffmpeg, ffprobe, posterProfile, run, streamingProfile } from './encoders.js';

const mediaDir = join(config.dataDir, 'media');
export const staging = join(config.dataDir, 'incoming');
const rendition = {
  guest: { height: 360, width: 640, crf: 25, bitrate: '800k' },
  hd: { height: 1080, width: 1920, crf: 22, bitrate: '3600k' },
  high: { height: 2160, width: 3840, crf: 20, bitrate: '9500k' }
};
const lease = 40 * 60000;

export async function prepareMedia() {
  await Promise.all([mkdir(staging, { recursive: true, mode: 0o700 }), mkdir(mediaDir, { recursive: true, mode: 0o700 })]);
}

export function sourcePath(id) {
  return join(staging, `${id}.source`);
}

function streamFolder(id, streamId) {
  return join(mediaDir, id, 'streams', streamId);
}

export function streamAsset(id, streamId, quality, asset) {
  return join(streamFolder(id, streamId), quality, asset === 'key' ? 'key.bin' : asset);
}

export function allowedQualities(viewer) {
  if (viewer.auth.role === 'admin' || (viewer.paid && viewer.auth.tier === 'premium')) return ['guest', 'hd', 'high'];
  return viewer.auth.canWatch ? ['guest', 'hd'] : ['guest'];
}

const inputFlags = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm', '-max_alloc', '268435456'];

async function probe(path, signal) {
  const { stdout } = await run(ffprobe, [
    '-v', 'error', ...inputFlags,
    '-show_entries', 'format=duration:stream=codec_type,width,height:stream_disposition=attached_pic', '-of', 'json', path
  ], { signal, timeout: 15000, maxBuffer: 128 * 1024 });
  const info = JSON.parse(stdout);
  const video = info.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const duration = Number(info.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || duration > 3600 ||
    !video.width || !video.height || video.width * video.height > 40000000) {
    throw new Error('Use an MP4, MOV, or WebM video under one hour and 40 megapixels per frame.');
  }
  return { duration: Math.ceil(duration), hasAudio: info.streams.some(stream => stream.codec_type === 'audio') };
}

async function fileExists(path) {
  try { return (await stat(path)).isFile(); }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function storedMedia(id, filename, demo) {
  return demo ? fileURLToPath(new URL(`../../database/demo/${id}/${filename}`, import.meta.url)) : join(mediaDir, id, filename);
}

async function archiveSource(job) {
  for (const quality of ['high', 'hd', 'guest']) {
    const path = storedMedia(job.id, `${quality}.${job.media_format}`, false);
    if (await fileExists(path)) return path;
  }
  throw new Error('The original video for this clip is missing.');
}

async function encode(job, streamId, signal, archive) {
  const demo = archive && Boolean(job.demo);
  const path = demo ? storedMedia(job.id, 'poster.webp', true) : archive ? await archiveSource(job) : sourcePath(job.id);
  const [source, encoders] = await Promise.all([
    demo ? { duration: job.duration || 12, hasAudio: false } : probe(path, signal), availableEncoders()
  ]);
  const { duration, hasAudio } = source;
  const video = streamingProfile(encoders, hasAudio);
  const poster = archive ? null : posterProfile(encoders);
  if (!video || (!archive && !poster)) {
    throw new Error('Protected playback needs FFmpeg with H.264, AAC, and an image encoder. Install a full FFmpeg build and retry.');
  }
  const flags = ['-nostdin', '-hide_banner', '-v', 'error', '-y',
    ...(demo ? ['-protocol_whitelist', 'file', '-f', 'image2', '-framerate', '24'] : inputFlags),
    '-threads', '2', '-i', path];
  for (const [quality, { height, width, crf, bitrate }] of Object.entries(rendition)) {
    const folder = join(streamFolder(job.id, streamId), quality);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const keyPath = join(folder, 'key.bin');
    const keyInfo = join(folder, 'key-info');
    await writeFile(keyPath, randomBytes(16), { mode: 0o600 });
    await writeFile(keyInfo, `key\n${keyPath}\n${randomBytes(16).toString('hex')}\n`, { mode: 0o600 });
    const scale = `scale=w='min(iw,${width})':h='min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    const size = quality === 'guest' ? '640x360' : quality === 'hd' ? '960x540' : '1280x720';
    const filter = demo
      ? `zoompan=z='1+on*0.00017':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${duration * 24}:s=${size}:fps=24`
      : scale;
    const audioFlags = hasAudio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : [];
    await run(ffmpeg, [
      ...flags, '-filter_threads', '2', '-map', '0:V:0', ...audioFlags, '-map_metadata', '-1',
      '-vf', filter, '-c:v', video.video, '-threads', '2', '-pix_fmt', 'yuv420p', ...video.options(crf, bitrate),
      '-force_key_frames', 'expr:gte(t,n_forced*3)', '-f', 'hls', '-hls_time', '3',
      '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments', '-hls_key_info_file', keyInfo,
      '-hls_segment_filename', join(folder, 'part-%06d.ts'), join(folder, 'index.m3u8')
    ], { signal, timeout: 10 * 60000, maxBuffer: 128 * 1024 });
    await rm(keyInfo);
  }
  if (poster) {
    const folder = join(mediaDir, job.id);
    const temporary = join(folder, `poster-${streamId}.${poster.format}`);
    await run(ffmpeg, [
      ...flags, '-filter_threads', '2', '-ss', String(Math.min(1, duration / 2)), '-map', '0:V:0',
      '-frames:v', '1', '-vf', "scale=w='min(iw,1600)':h=-2", '-c:v', poster.video, '-threads', '2',
      ...poster.options, '-update', '1', temporary
    ], { signal, timeout: 20000, maxBuffer: 128 * 1024 });
    await rename(temporary, join(folder, `poster.${poster.format}`));
  }
  return duration;
}

async function claimArchive(db, now) {
  const eligible = "status = 'ready' AND stream_id IS NULL AND job_error IS NULL AND (stream_started_at IS NULL OR stream_started_at < ?) AND (? = 1 OR demo = 0)";
  return db.one(`UPDATE clips SET stream_started_at = ?
    WHERE id = (SELECT id FROM clips WHERE ${eligible} ORDER BY guest DESC, published_at DESC, id LIMIT 1)
    AND ${eligible} RETURNING id, demo, media_format, duration`,
  [now, now - lease, Number(!config.production), now - lease, Number(!config.production)]);
}

export async function processVideo(db, io, signal, catalogChanged) {
  const now = Date.now();
  const upload = await db.one(`UPDATE clips SET status = 'processing', started_at = ?, job_error = NULL
    WHERE id = (SELECT id FROM clips WHERE status = 'queued' OR (status = 'processing' AND started_at < ?)
      ORDER BY created_at, id LIMIT 1)
    AND (status = 'queued' OR (status = 'processing' AND started_at < ?)) RETURNING id`,
  [now, now - lease, now - lease]);
  const job = upload || await claimArchive(db, now);
  if (!job) return;
  io.to('admins').emit('admin:changed');

  const streamId = randomUUID();
  let duration;
  try {
    duration = await encode(job, streamId, signal, !upload);
  } catch (error) {
    await rm(streamFolder(job.id, streamId), { recursive: true, force: true });
    const message = signal.aborted ? null : String(error.stderr || error.message).slice(0, 1000);
    if (message) console.error('Clip processing failed', job.id, error);
    if (upload) {
      await db.all("UPDATE clips SET status = ?, started_at = NULL, job_error = ? WHERE id = ? AND started_at = ?",
        [signal.aborted ? 'queued' : 'failed', message, job.id, now]);
    } else {
      await db.all('UPDATE clips SET stream_started_at = NULL, job_error = ? WHERE id = ? AND stream_started_at = ?',
        [message, job.id, now]);
    }
    io.to('admins').emit('admin:changed');
    return;
  }

  const completed = upload
    ? await db.one("UPDATE clips SET status = 'ready', duration = ?, stream_id = ? WHERE id = ? AND started_at = ? RETURNING id",
      [duration, streamId, job.id, now])
    : await db.one('UPDATE clips SET stream_id = ?, stream_started_at = NULL WHERE id = ? AND stream_started_at = ? RETURNING id',
      [streamId, job.id, now]);
  if (!completed) {
    await rm(streamFolder(job.id, streamId), { recursive: true, force: true });
    return;
  }
  catalogChanged();
  if (upload) await rm(sourcePath(job.id), { force: true }).catch(error => console.error('Could not remove clip source', job.id, error));
}

export async function mediaPath(id, filenames, demo) {
  for (const filename of filenames) {
    const path = storedMedia(id, filename, demo);
    if (await fileExists(path)) return path;
  }
  fail(404, 'File not found.');
}
