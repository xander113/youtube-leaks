import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { io } from 'socket.io-client';

test('guest, Watcher, and admin access agrees on HTTP and Socket.IO', { timeout: 30000 }, async t => {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));

  const dataDir = await mkdtemp(join(tmpdir(), 'youtube-leaks-test-'));
  const base = 'http://127.0.0.1:' + port;
  const password = 'test-password-long';
  const server = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1',
      APP_ORIGIN: base, HEAD_ADMIN_EMAIL: 'admin@example.test', HEAD_ADMIN_PASSWORD: password,
      DATA_DIR: dataDir, CORS_ORIGINS: 'https://example.test', REDIS_URL: 'redis://127.0.0.1:1',
      STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', STRIPE_BASIC_MONTHLY: '',
      STRIPE_BASIC_YEARLY: '', STRIPE_PREMIUM_MONTHLY: '', STRIPE_PREMIUM_YEARLY: ''
    }
  });
  let log = '';
  server.stderr.on('data', chunk => { log += chunk.toString(); });
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill();
      await once(server, 'exit');
    }
    await rm(dataDir, { recursive: true, force: true });
  });
  const get = (path, headers = {}) => fetch(base + '/api' + path, { headers });
  const post = (path, body, cookie) => fetch(base + '/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'YoutubeLeaks', ...(cookie && { cookie }) },
    body: JSON.stringify(body)
  });
  let ready = false;
  for (let attempt = 0; attempt < 50 && server.exitCode === null; attempt++) {
    if (await get('/health/ready').then(res => res.ok).catch(() => false)) { ready = true; break; }
    await sleep(100);
  }
  assert.equal(ready, true, log);

  const guestRange = await get('/media/first-cut/guest', { Range: 'bytes=0-31' });
  assert.equal(guestRange.status, 206);
  assert.equal((await guestRange.arrayBuffer()).byteLength, 32);
  assert.equal((await get('/media/late-edit/guest')).status, 403);
  assert.equal((await get('/media/first-cut/hd')).status, 403);
  assert.equal((await post('/comments/clip/first-cut', { body: 'Guest post' })).status, 401);
  const cors = await fetch(base + '/api/auth/register', {
    method: 'OPTIONS', headers: { Origin: 'https://example.test', 'Access-Control-Request-Method': 'POST' }
  });
  assert.equal(cors.headers.get('access-control-allow-origin'), 'https://example.test');
  assert.equal(cors.headers.get('access-control-allow-credentials'), 'true');
  assert.equal((await get('/viewer', { Origin: 'https://blocked.test' })).headers.get('access-control-allow-origin'), null);

  const register = await post('/auth/register', { name: 'Watcher', email: 'watcher@example.test', password });
  assert.equal(register.status, 201, await register.text());
  const watcherCookie = register.headers.get('set-cookie').split(';')[0];
  const watcher = (await (await get('/viewer', { cookie: watcherCookie })).json()).auth;
  assert.equal(watcher.role, 'watcher');
  assert.equal((await get('/media/late-edit/hd', { cookie: watcherCookie, Range: 'bytes=0-31' })).status, 206);
  assert.equal((await get('/media/late-edit/high', { cookie: watcherCookie })).status, 403);
  assert.equal((await post('/admin/mode', { paid: true }, watcherCookie)).status, 403);

  const socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: watcherCookie } });
  t.after(() => socket.close());
  await once(socket, 'connect');
  const target = { type: 'series', id: 'studio-notes' };
  assert.equal((await socket.timeout(2000).emitWithAck('comments:list', target)).ok, true);
  const update = once(socket, 'comments:changed');
  assert.equal((await post('/comments/series/studio-notes', { body: 'A first comment.' }, watcherCookie)).status, 201);
  await update;
  const thread = await socket.timeout(2000).emitWithAck('comments:list', target);
  assert.equal(thread.data[0].body, 'A first comment.');

  const adminLogin = await post('/auth/login', { email: 'admin@example.test', password });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await get('/viewer', { cookie: adminCookie })).json()).auth.isHead, true);
  assert.equal((await post('/admin/watchers/1/ban', { banned: true }, adminCookie)).status, 404);
  const kicked = once(socket, 'disconnect');
  assert.equal((await post('/admin/watchers/' + watcher.id + '/ban', { banned: true }, adminCookie)).status, 200);
  await kicked;
  assert.equal((await get('/media/late-edit/hd', { cookie: watcherCookie })).status, 403);
});
