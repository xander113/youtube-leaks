import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const run = promisify(execFile);
export const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
export const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

let capabilities;
export function availableEncoders() {
  capabilities ??= run(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 10000, maxBuffer: 256 * 1024 })
    .then(({ stdout }) => new Set(Array.from(stdout.matchAll(/^\s*[VAS][A-Z.]{5}\s+([\w-]+)\s+/gm), match => match[1])))
    .catch(error => {
      capabilities = null;
      throw new Error('FFmpeg was not found or cannot list its encoders. Install FFmpeg and check your PATH.', { cause: error });
    });
  return capabilities;
}

export function videoProfile(encoders, hasAudio) {
  if (encoders.has('libx264') && (!hasAudio || encoders.has('aac'))) {
    return { format: 'mp4', video: 'libx264', audio: 'aac',
      options: (crf) => ['-preset', 'veryfast', '-crf', String(crf), '-movflags', '+faststart'] };
  }
  if (encoders.has('libopenh264') && (!hasAudio || encoders.has('aac'))) {
    return { format: 'mp4', video: 'libopenh264', audio: 'aac',
      options: (_crf, bitrate) => ['-b:v', bitrate, '-movflags', '+faststart'] };
  }
  const audio = encoders.has('libopus') ? 'libopus' : encoders.has('libvorbis') ? 'libvorbis' : null;
  if (hasAudio && !audio) return null;
  if (encoders.has('libvpx-vp9')) {
    return { format: 'webm', video: 'libvpx-vp9', audio,
      options: crf => ['-b:v', '0', '-crf', String(crf + 7), '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1'] };
  }
  if (encoders.has('libvpx')) {
    return { format: 'webm', video: 'libvpx', audio,
      options: (crf, bitrate) => ['-b:v', bitrate, '-crf', String(crf + 7), '-deadline', 'good', '-cpu-used', '4'] };
  }
  return null;
}

export function posterProfile(encoders) {
  if (encoders.has('mjpeg')) return { video: 'mjpeg', format: 'jpg', options: ['-q:v', '4'] };
  if (encoders.has('png')) return { video: 'png', format: 'png', options: [] };
  if (encoders.has('libwebp')) return { video: 'libwebp', format: 'webp', options: [] };
  return null;
}
