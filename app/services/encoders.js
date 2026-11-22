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

export function streamingProfile(encoders, hasAudio) {
  if (hasAudio && !encoders.has('aac')) return null;
  if (encoders.has('libx264')) {
    return { video: 'libx264', options: crf => ['-preset', 'veryfast', '-crf', String(crf)] };
  }
  if (encoders.has('libopenh264')) {
    return { video: 'libopenh264', options: (_crf, bitrate) => ['-b:v', bitrate] };
  }
  return null;
}

export function posterProfile(encoders) {
  if (encoders.has('mjpeg')) return { video: 'mjpeg', format: 'jpg', options: ['-q:v', '4'] };
  if (encoders.has('png')) return { video: 'png', format: 'png', options: [] };
  if (encoders.has('libwebp')) return { video: 'libwebp', format: 'webp', options: [] };
  return null;
}
