import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from '../middleware/errors.js';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const dummy = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

let pending = 0;
async function derivePassword(password, salt) {
  if (pending >= 12) fail(503, 'Sign-in is busy. Try again in a moment.');
  pending++;
  try {
    return await derive(password, salt, 64, options);
  } finally {
    pending--;
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const result = await derivePassword(password, salt);
  return `${salt}:${result.toString('hex')}`;
}

export async function checkPassword(password, hash) {
  const [salt, expected] = (hash || dummy).split(':');
  const actual = await derivePassword(password, salt);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex')) && Boolean(hash);
}
