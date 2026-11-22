import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { fail } from '../middleware/errors.js';
import { availableEncoders, ffmpeg, ffprobe, posterProfile, run, videoProfile } from './encoders.js';

const mediaDir = join(config.dataDir, 'media');
export const staging = join(config.dataDir, 'incoming');
const rendition = {
  guest: { height: 360, width: 640, crf: 25, bitrate: '800k' },
  hd: { height: 1080, width: 1920, crf: 22, bitrate: '3600k' },
  high: { height: 2160, width: 3840, crf: 20, bitrate: '9500k' }
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

async function encode(id, signal) {
  const path = sourcePath(id);
  const [{ duration, hasAudio }, encoders] = await Promise.all([probe(path, signal), availableEncoders()]);
  const video = videoProfile(encoders, hasAudio);
  const poster = posterProfile(encoders);
  if (!video || !poster) {
    throw new Error('This FFmpeg build is missing video, audio, or image encoders. Install a full FFmpeg build with H.264 and AAC or VP8/VP9 and Opus, plus JPEG or PNG. Then retry the clip.');
  }
  const folder = join(mediaDir, id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const flags = ['-nostdin', '-hide_banner', '-v', 'error', '-y', ...inputFlags, '-threads', '2', '-i', path];
  for (const [quality, { height, width, crf, bitrate }] of Object.entries(rendition)) {
    const filter = `scale=w='min(iw,${width})':h='min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    const output = join(folder, `${quality}.tmp.${video.format}`);
    const audioFlags = hasAudio ? ['-map', '0:a:0', '-c:a', video.audio, '-b:a', '128k'] : [];
    await run(ffmpeg, [
      ...flags, '-filter_threads', '2', '-map', '0:V:0', ...audioFlags, '-map_metadata', '-1',
      '-vf', filter, '-c:v', video.video, '-threads', '2', '-pix_fmt', 'yuv420p', ...video.options(crf, bitrate), output
    ], { signal, timeout: 10 * 60000, maxBuffer: 128 * 1024 });
    await rename(output, join(folder, `${quality}.${video.format}`));
  }
  const posterPath = join(folder, `poster.tmp.${poster.format}`);
  await run(ffmpeg, [
    ...flags, '-filter_threads', '2', '-ss', String(Math.min(1, duration / 2)), '-map', '0:V:0',
    '-frames:v', '1', '-vf', "scale=w='min(iw,1600)':h=-2", '-c:v', poster.video, '-threads', '2',
    ...poster.options, '-update', '1', posterPath
  ], { signal, timeout: 20000, maxBuffer: 128 * 1024 });
  await rename(posterPath, join(folder, `poster.${poster.format}`));
  return { duration, format: video.format };
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
  let result;
  try {
    result = await encode(job.id, signal);
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
  const completed = await db.one("UPDATE clips SET status = 'ready', duration = ?, media_format = ? WHERE id = ? AND started_at = ? RETURNING id", [result.duration, result.format, job.id, now]);
  if (!completed) return;
  catalogChanged();
  await rm(sourcePath(job.id), { force: true }).catch(error => console.error('Could not remove clip source', job.id, error));
}

export async function mediaPath(id, filenames, demo) {
  for (const filename of Array.isArray(filenames) ? filenames : [filenames]) {
    const path = demo ? fileURLToPath(new URL(`../../database/demo/${id}/${filename}`, import.meta.url)) : join(mediaDir, id, filename);
    try {
      if ((await stat(path)).isFile()) return path;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  fail(404, 'File not found.');
}
