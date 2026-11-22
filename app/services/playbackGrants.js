import { createHash, randomBytes } from 'node:crypto';
import { parseCookie, stringifySetCookie } from 'cookie';
import { config } from '../config.js';
import { fail } from '../middleware/errors.js';
import { sessionHash } from '../models/Account.js';

const lifetimeSeconds = 300;
const localLimit = 2000;
const browserCookie = config.production ? '__Host-ytl-playback' : 'ytl-playback';
const randomToken = () => randomBytes(32).toString('base64url');
export const ticketPattern = /^[A-Za-z0-9_-]{43}$/;

const useGrant = `
local value = redis.call('GET', KEYS[1])
if not value then return nil end
if cjson.decode(value).identity ~= ARGV[1] then return '' end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return value
`;

function identity(req, res) {
  if (req.viewer.auth.id) {
    const hash = sessionHash(req.headers.cookie);
    return hash ? 'account:' + hash : null;
  }
  let guest = parseCookie(req.headers.cookie || '')[browserCookie];
  if (!ticketPattern.test(guest || '')) {
    if (!res) return null;
    guest = randomToken();
    res.append('Set-Cookie', stringifySetCookie({
      name: browserCookie, value: guest, httpOnly: true, secure: config.production,
      sameSite: 'strict', path: '/', maxAge: 24 * 60 * 60
    }));
  }
  return 'guest:' + createHash('sha256').update(guest).digest('hex');
}

export function playbackGrants(redis) {
  const local = new Map();

  async function storage(command, fallback) {
    if (redis?.status === 'ready') {
      try { return await command(); }
      catch (error) {
        if (config.production) fail(503, 'Playback is temporarily unavailable.');
        console.warn('Local playback grant storage', error.message);
      }
    }
    if (config.production) fail(503, 'Playback is temporarily unavailable.');
    return fallback();
  }

  return {
    async issue(req, res, fields) {
      const browser = identity(req, res);
      if (!browser) fail(403, 'A playback session is required.');
      const token = randomToken();
      const data = { ...fields, identity: browser };
      await storage(() => redis.set('ytl:play:' + token, JSON.stringify(data), 'EX', lifetimeSeconds), () => {
        const now = Date.now();
        if (local.size >= localLimit) {
          for (const [key, entry] of local) if (entry.until <= now) local.delete(key);
          if (local.size >= localLimit) fail(503, 'Playback is busy. Try again in a moment.');
        }
        local.set(token, { data, until: now + lifetimeSeconds * 1000 });
      });
      return token;
    },
    async read(req, token) {
      const browser = identity(req);
      if (!browser) fail(403, 'This stream belongs to another playback session.');
      const value = await storage(() => redis.eval(useGrant, 1, 'ytl:play:' + token, browser, lifetimeSeconds), () => {
        const entry = local.get(token);
        const now = Date.now();
        if (!entry || entry.until <= now) { local.delete(token); return null; }
        if (entry.data.identity !== browser) return '';
        entry.until = now + lifetimeSeconds * 1000;
        return JSON.stringify(entry.data);
      });
      if (value === '') fail(403, 'This stream belongs to another playback session.');
      if (!value) fail(410, 'This playback session expired.');
      return JSON.parse(value);
    }
  };
}
