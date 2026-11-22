import { config, allowedOrigin } from '../config.js';
import { fail } from './errors.js';

const countScript = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return value
`;
const local = new Map();
const maxLocalKeys = 20000;

export async function take(redis, name, id, amount, seconds) {
  const now = Date.now();
  const period = Math.floor(now / (seconds * 1000));
  const key = `ytl:limit:${name}:${id}:${period}`;
  if (redis?.status === 'ready') {
    try { return (await redis.eval(countScript, 1, key, seconds + 1)) <= amount; }
    catch (error) {
      if (!config.production) console.warn('Redis rate limit fallback', error.message);
    }
  }
  if (local.size >= maxLocalKeys) {
    for (const [item, entry] of local) {
      if (entry.until <= now) local.delete(item);
    }
    if (!local.has(key) && local.size >= maxLocalKeys) return false;
  }
  const current = local.get(key) || { count: 0, until: (period + 1) * seconds * 1000 };
  current.count++;
  local.set(key, current);
  return current.count <= amount;
}

export const rate = (redis, name, count, seconds, identifier = req => req.ip) => async (req, res, next) => {
  if (!await take(redis, name, identifier(req), count, seconds)) {
    res.set('Retry-After', String(seconds));
    fail(429, 'Too many requests. Try again in a moment.');
  }
  next();
};

export function browserWrite(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!allowedOrigin(req.get('Origin')) || req.get('X-Requested-With') !== 'YoutubeLeaks') {
    fail(403, 'This request did not come from an allowed app.');
  }
  next();
}

export function concurrent(max) {
  let active = 0;
  return (_req, res, next) => {
    if (active >= max) {
      res.set('Retry-After', '5');
      fail(503, 'The site is busy. Try again in a moment.');
    }
    active++;
    res.once('close', () => { active--; });
    next();
  };
}
