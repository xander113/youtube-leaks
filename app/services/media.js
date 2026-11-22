import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { fail } from '../middleware/errors.js';

const run = promisify(execFile);
const mediaDir = join(config.dataDir, 'media');
export const staging = join(config.dataDir, 'incoming');
const rendition = {
  guest: { height: 360, width: 640, crf: 25 },
  hd: { height: 1080, width: 1920, crf: 22 },
  high: { height: 2160, width: 3840, crf: 20 }
};

export async function prepareMedia() {
  await Promise.all([mkdir(staging, { recursive: true, mode: 0o700 }), mkdir(mediaDir, { recursive: true, mode: 0o700 })]);
}

export function sourcePath(id) {
  return join(staging, `${id}.source`);
}

export function allowedQualities(viewer) {
  if (viewer.auth.role === 'admin' || (viewer.paid && viewer.auth.tier === 'premium')) return ['guest', 'hd', 'high'];
  return viewer.auth.canWatch ? ['guest', 'hd'] : ['guest'];
}

const inputFlags = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm', '-max_alloc', '268435456'];

async function probe(path, signal) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', ...inputFlags, '-select_streams', 'V:0',
    '-show_entries', 'format=duration:stream=width,height', '-of', 'json', path
  ], { signal, timeout: 15000, maxBuffer: 128 * 1024 });
  const info = JSON.parse(stdout);
  const video = info.streams?.[0];
  const duration = Number(info.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0 || duration > 3600 ||
    !video.width || !video.height || video.width * video.height > 40000000) {
    throw new Error('Use an MP4, MOV, or WebM video under one hour and 40 megapixels per frame.');
  }
  return Math.ceil(duration);
}

async function encode(id, signal) {
  const path = sourcePath(id);
  const duration = await probe(path, signal);
  const folder = join(mediaDir, id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const flags = ['-nostdin', '-hide_banner', '-v', 'error', '-y', ...inputFlags, '-threads', '2', '-i', path];
  for (const [quality, { height, width, crf }] of Object.entries(rendition)) {
    const filter = `scale=w='min(iw,${width})':h='min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    const output = join(folder, `${quality}.tmp.mp4`);
    await run('ffmpeg', [
      ...flags, '-filter_threads', '2', '-map', '0:V:0', '-map', '0:a:0?', '-map_metadata', '-1',
      '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2', '-pix_fmt', 'yuv420p',
      '-crf', String(crf), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output
    ], { signal, timeout: 10 * 60000, maxBuffer: 128 * 1024 });
    await rename(output, join(folder, `${quality}.mp4`));
  }
  await run('ffmpeg', [
    ...flags, '-filter_threads', '2', '-ss', String(Math.min(1, duration / 2)), '-map', '0:V:0',
    '-frames:v', '1', '-vf', "scale=w='min(iw,960)':h=-2", '-c:v', 'libwebp', '-threads', '2',
    join(folder, 'poster.tmp.webp')
  ], { signal, timeout: 20000, maxBuffer: 128 * 1024 });
  await rename(join(folder, 'poster.tmp.webp'), join(folder, 'poster.webp'));
  return duration;
}

export async function processVideo(db, io, signal, catalogChanged) {
  const now = Date.now();
  const job = await db.one(`UPDATE clips SET status = 'processing', started_at = ?, job_error = NULL
    WHERE id = (SELECT id FROM clips WHERE status = 'queued' OR (status = 'processing' AND started_at < ?)
      ORDER BY created_at, id LIMIT 1)
    AND (status = 'queued' OR (status = 'processing' AND started_at < ?)) RETURNING id`,
  [now, now - 40 * 60000, now - 40 * 60000]);
  if (!job) return;
  io.to('admins').emit('admin:changed');
  let duration;
  try {
    duration = await encode(job.id, signal);
  } catch (error) {
    if (signal.aborted) {
      await db.all("UPDATE clips SET status = 'queued', started_at = NULL WHERE id = ? AND started_at = ?", [job.id, now]);
      return;
    }
    console.error('Clip processing failed', job.id, error);
    await db.all("UPDATE clips SET status = 'failed', job_error = ? WHERE id = ? AND started_at = ?",
      [String(error.stderr || error.message).slice(0, 1000), job.id, now]);
    io.to('admins').emit('admin:changed');
    return;
  }
  const completed = await db.one("UPDATE clips SET status = 'ready', duration = ? WHERE id = ? AND started_at = ? RETURNING id", [duration, job.id, now]);
  if (!completed) return;
  catalogChanged();
  await rm(sourcePath(job.id), { force: true }).catch(error => console.error('Could not remove clip source', job.id, error));
}

export async function mediaPath(id, filename, demo) {
  const path = demo ? new URL(`../../database/demo/${id}/${filename}`, import.meta.url) : join(mediaDir, id, filename);
  const filenameOnDisk = demo ? fileURLToPath(path) : path;
  try {
    if (!(await stat(filenameOnDisk)).isFile()) fail(404, 'File not found.');
  } catch (error) {
    if (error.code === 'ENOENT') fail(404, 'File not found.');
    throw error;
  }
  return filenameOnDisk;
}
