import { createHash, randomBytes } from 'node:crypto';
import { parseCookie, stringifySetCookie } from 'cookie';
import { config } from '../config.js';
import { fail } from '../middleware/errors.js';

const life = 7 * 24 * 60 * 60 * 1000;
const guest = { id: null, role: 'guest', canWatch: false, tier: null };

export function sessionHash(header) {
  const token = parseCookie(header || '')[config.cookieName];
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
    ? createHash('sha256').update(token).digest('hex')
    : null;
}

export function cookie(token, maxAge) {
  return stringifySetCookie({ name: config.cookieName, value: token,
    path: '/', httpOnly: true, secure: config.production,
    sameSite: config.production && process.env.CROSS_SITE_COOKIES === '1' ? 'none' : 'lax',
    maxAge
  });
}

export async function newSession(db, accountId) {
  const token = randomBytes(32).toString('base64url');
  const hashed = createHash('sha256').update(token).digest('hex');
  const session = await db.one(`INSERT INTO sessions (token_hash, user_id, expires_at)
    SELECT ?, id, ? FROM users WHERE id = ? AND banned_at IS NULL RETURNING user_id`, [hashed, Date.now() + life, accountId]);
  if (!session) fail(403, 'This account is blocked.');
  return cookie(token, life / 1000);
}

export async function authState(db, tokenHash) {
  const current = Date.now();
  const row = await db.one(`SELECT s.paid, u.id, u.email, u.name, u.role, u.banned_at, u.plan, u.paid_until,
    u.stripe_customer_id
    FROM settings s LEFT JOIN sessions n ON n.token_hash = ? AND n.expires_at > ?
    LEFT JOIN users u ON u.id = n.user_id WHERE s.id = 1`, [tokenHash, current]);
  if (!row) throw new Error('The settings row is missing. Run database seeding.');
  const paid = Boolean(row.paid);
  const billingAvailable = Boolean(config.stripeKey);
  if (!row.id || row.banned_at) return { auth: guest, paid, billingAvailable };
  const tier = row.plan && row.paid_until > current ? row.plan : null;
  const admin = row.role === 'admin';
  return {
    auth: {
      id: row.id, email: row.email, name: row.name, role: row.role, isHead: row.id === 1,
      canWatch: admin || !paid || Boolean(tier), tier, hasBilling: Boolean(row.stripe_customer_id)
    },
    paid, billingAvailable
  };
}
