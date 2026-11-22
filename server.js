import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import proxyAddr from 'proxy-addr';
import { Server } from 'socket.io';
import { config, allowedOrigin } from './app/config.js';
import { errorResponse, fail } from './app/middleware/errors.js';
import { openDatabase } from './database/connection.js';
import { migrate, seed } from './database/bootstrap.js';
import { admins } from './app/controllers/admin.js';
import { community } from './app/controllers/community.js';
import { playlists } from './app/controllers/playlists.js';
import { support } from './app/controllers/support.js';
import { attachRedis } from './app/services/redis.js';
import { prepareMedia, processVideo } from './app/services/media.js';
import { processFeed } from './app/services/rss.js';
import { billing } from './app/services/billing.js';
import { apiRoutes } from './routes/api.js';
import { liveRoutes } from './routes/socket.js';
import { webRoutes } from './routes/web.js';
import { take } from './app/middleware/limits.js';
import { invalidateBrowse } from './app/models/Catalog.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use((req, res, next) => {
  req.id = randomUUID();
  res.set('X-Request-Id', req.id);
  next();
});

const corsOptions = {
  origin: (origin, cb) => cb(null, origin && allowedOrigin(origin) ? origin : false),
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With', 'Range'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'X-Request-Id'],
  maxAge: 600
};

app.use(helmet({
  contentSecurityPolicy: config.production ? {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      fontSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
      mediaSrc: ["'self'", "blob:"], workerSrc: ["'self'", "blob:"], connectSrc: ["'self'", config.appOrigin.replace(/^https:/, 'wss:')],
      frameAncestors: ["'none'"], objectSrc: ["'none'"], formAction: ["'self'"]
    }
  } : false,
  strictTransportSecurity: config.production,
  crossOriginResourcePolicy: { policy: 'same-site' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  originAgentCluster: config.production
}));
app.use(cors(corsOptions));
app.use(compression({ threshold: 1024 }));

const server = createServer({ requestTimeout: 300000, headersTimeout: 15000, keepAliveTimeout: 5000, maxHeaderSize: 16384 }, app);
server.maxHeadersCount = 100;
server.on('error', error => { console.error('HTTP server', error); shutdown(1); });

let isDraining = false;
const stopping = new AbortController();
function requestIp(req, trust) {
  try { return proxyAddr(req, trust); } catch { return req.socket.remoteAddress || 'unknown'; }
}

let redis;
const io = new Server(server, {
  transports: ['websocket'], cors: corsOptions, maxHttpBufferSize: 12 * 1024,
  perMessageDeflate: false, connectTimeout: 8000,
  allowRequest(req, cb) {
    if (isDraining || !allowedOrigin(req.headers.origin)) return cb('Origin or service unavailable', false);
    const ip = requestIp(req, app.get('trust proxy fn'));
    take(redis?.commands, 'socket-upgrade', ip, 120, 60)
      .then(ok => cb(ok ? null : 'Too many live connections', ok)).catch(() => cb('Service unavailable', false));
  }
});

let db;
let closeWeb = async () => {};
const running = new Set();
const timers = [];
async function shutdown(code = 0) {
  if (isDraining) return;
  isDraining = true;
  stopping.abort();
  timers.forEach(clearInterval);
  const force = setTimeout(() => process.exit(code || 1), 13000);
  force.unref();
  await Promise.allSettled([io.close(), closeWeb(), ...running]);
  redis?.close();
  await db?.close().catch(error => console.error('Database shutdown', error));
  clearTimeout(force);
  process.exit(code);
}

function worker(name, delay, run) {
  let pending;
  timers.push(setInterval(() => {
    if (pending || isDraining) return;
    pending = Promise.resolve().then(run)
      .catch(error => console.error(name, error))
      .finally(() => { running.delete(pending); pending = null; });
    running.add(pending);
  }, delay).unref());
}

process.once('SIGTERM', () => shutdown());
process.once('SIGINT', () => shutdown());
process.on('unhandledRejection', error => console.error('Unhandled async error', error));
process.once('uncaughtException', error => { console.error('Fatal server error', error); shutdown(1); });

try {
  db = await openDatabase();
  if (config.production) {
    if (!await db.one('SELECT id FROM users WHERE id = 1 AND password_hash IS NOT NULL')) {
      throw new Error('Migrate and seed the production database before starting.');
    }
  } else {
    await migrate(db);
    await seed(db);
  }
  await prepareMedia();
  redis = await attachRedis(io);
  const payments = billing(db, io);
  io.on('catalog:invalidate', () => invalidateBrowse(db));
  const catalogChanged = () => {
    invalidateBrowse(db);
    if (redis.commands?.status === 'ready') io.serverSideEmit('catalog:invalidate');
    io.emit('catalog:changed');
    io.to('admins').emit('admin:changed');
  };
  const services = {
    db, io, redis: redis.commands, ip: requestIp, isDraining: () => isDraining,
    billing: payments, community: community(db, io), playlists: playlists(db, io),
    admin: admins(db, io, payments.configured, catalogChanged), support: support(db, io)
  };
  liveRoutes(io, app, services);
  app.use('/api', apiRoutes(services));
  closeWeb = await webRoutes(app, server);
  app.use((_req, _res) => fail(404, 'Page not found.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const { status, body } = errorResponse(error, `${req.method} ${req.path}`, req.id);
    res.status(status).json(body);
  });
  server.listen(config.port, config.host, () => console.info(`Youtube Leaks listening on ${config.host}:${config.port}`));
  if (process.env.RUN_JOBS !== '0') {
    worker('Video queue', 1500, () => processVideo(db, io, stopping.signal, catalogChanged));
    worker('RSS queue', 3500, () => processFeed(db, io, stopping.signal));
    worker('Session cleanup', 3600000, () => db.all('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]));
  }
} catch (error) {
  console.error('Server startup failed', error);
  await shutdown(1);
}
