import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const env = process.env;
const production = env.NODE_ENV === 'production';
const preview = production ? {} : parseArgs({
  options: { port: { type: 'string' }, host: { type: 'string' } },
  strict: false, allowPositionals: true
}).values;

function number(name, fallback, min, max, argument) {
  const value = Number(argument ?? env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function origin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
    throw new Error('Set origins as full URLs with no trailing slash or path.');
  }
  return url.origin;
}

const port = number('PORT', 3000, 1, 65535, preview.port);
const appOrigin = origin(env.APP_ORIGIN || `http://localhost:${port}`);
const dataDir = resolve(env.DATA_DIR || 'storage');
const prices = {
  basic: { monthly: env.STRIPE_BASIC_MONTHLY, yearly: env.STRIPE_BASIC_YEARLY },
  premium: { monthly: env.STRIPE_PREMIUM_MONTHLY, yearly: env.STRIPE_PREMIUM_YEARLY }
};
const stripeValues = [env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET, ...Object.values(prices).flatMap(Object.values)];
if (stripeValues.some(Boolean) && (!stripeValues.every(Boolean) || new Set(stripeValues.slice(2)).size !== 4)) {
  throw new Error('Stripe needs a secret key, a webhook secret, and four distinct price IDs.');
}

export const config = {
  production, port, appOrigin, dataDir, prices,
  stripeKey: env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
  host: preview.host || env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
  origins: new Set([appOrigin, ...(env.CORS_ORIGINS || '').split(',').filter(Boolean).map(s => origin(s.trim()))]),
  trustProxy: env.TRUST_PROXY || false,
  redisUrl: env.REDIS_URL || (production ? '' : 'redis://127.0.0.1:6379'),
  databaseUrl: env.DATABASE_URL,
  poolMax: number('PG_POOL_MAX', 15, 1, 100),
  maxUpload: number('MAX_UPLOAD_MB', 250, 1, 2048) * 1024 * 1024,
  feedHosts: new Set((env.RSS_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)),
  adminEmail: env.HEAD_ADMIN_EMAIL,
  adminPassword: env.HEAD_ADMIN_PASSWORD,
  cookieName: production ? '__Host-ytl' : 'ytl'
};

if (production && (!config.databaseUrl || !config.redisUrl || !appOrigin.startsWith('https://'))) {
  throw new Error('Production needs DATABASE_URL, REDIS_URL, and an HTTPS APP_ORIGIN.');
}

export function allowedOrigin(value) {
  if (!value) return true;
  if (config.origins.has(value)) return true;
  return !production && [`http://127.0.0.1:${port}`, `http://[::1]:${port}`].includes(value);
}
