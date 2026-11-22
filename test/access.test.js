import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { get as httpGet } from 'node:http';
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
      DATA_DIR: dataDir, RUN_JOBS: '0', CORS_ORIGINS: 'https://example.test', REDIS_URL: 'redis://127.0.0.1:1',
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
  const post = (path, body, cookie, method = 'POST') => fetch(base + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'YoutubeLeaks', ...(cookie && { cookie }) },
    body: JSON.stringify(body)
  });
  let ready = false;
  for (let attempt = 0; attempt < 50 && server.exitCode === null; attempt++) {
    if (await get('/health/ready').then(res => res.ok).catch(() => false)) { ready = true; break; }
    await sleep(100);
  }
  assert.equal(ready, true, log);

  async function manifest(response) {
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).manifest.replace(/^\/api/, '');
  }
  const start = (clip, quality, cookie) => post(`/playback/${clip}/${quality}`, {}, cookie);
  const resource = (playlist, name) => playlist.replace(/index\.m3u8$/, name);

  // Small encrypted fixtures keep the access checks independent of installed video codecs.
  const fixtureKey = randomBytes(16);
  const clear = Buffer.from('private playback fixture');
  const cipher = createCipheriv('aes-128-cbc', fixtureKey, Buffer.alloc(16));
  const encrypted = Buffer.concat([cipher.update(clear), cipher.final()]);
  const database = new DatabaseSync(join(dataDir, 'development.sqlite'));
  for (const clip of ['first-cut', 'late-edit']) {
    const streamId = randomUUID();
    for (const quality of ['guest', 'hd', 'high']) {
      const dir = join(dataDir, 'media', clip, 'streams', streamId, quality);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'index.m3u8'), '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:3,\npart-000000.ts\n#EXT-X-ENDLIST\n');
      await writeFile(join(dir, 'part-000000.ts'), encrypted);
      await writeFile(join(dir, 'key.bin'), fixtureKey);
    }
    database.prepare('UPDATE clips SET stream_id = ? WHERE id = ?').run(streamId, clip);
  }
  database.close();

  assert.equal((await get('/media/first-cut/guest', { Range: 'bytes=0-31' })).status, 404);
  assert.equal((await start('late-edit', 'guest')).status, 403);
  assert.equal((await start('first-cut', 'hd')).status, 403);
  const guestStart = await start('first-cut', 'guest');
  const guestCookie = guestStart.headers.get('set-cookie').split(';')[0];
  assert.match(guestStart.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/i);
  const guestManifest = await manifest(guestStart);
  assert.equal((await get(guestManifest)).status, 403);
  const stranger = await start('first-cut', 'guest');
  const strangerCookie = stranger.headers.get('set-cookie').split(';')[0];
  assert.equal((await get(resource(guestManifest, 'key'), { cookie: strangerCookie })).status, 403);
  assert.equal((await get(guestManifest, { cookie: guestCookie, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await get(guestManifest, { cookie: guestCookie, 'Sec-Fetch-Site': 'none' })).status, 403);
  const navigation = await new Promise((resolve, reject) => {
    const req = httpGet(base + '/api' + guestManifest, {
      headers: { cookie: guestCookie, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate' }
    }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject);
  });
  assert.equal(navigation, 403);
  const playlist = await get(guestManifest, { cookie: guestCookie });
  assert.equal(playlist.status, 200);
  assert.match(playlist.headers.get('cache-control'), /no-store/);
  assert.match(await playlist.text(), /AES-128/);
  const segment = await get(resource(guestManifest, 'part-000000.ts'), { cookie: guestCookie, Range: 'bytes=0-15' });
  assert.equal(segment.status, 200);
  assert.deepEqual(Buffer.from(await segment.arrayBuffer()), encrypted);
  assert.notDeepEqual(encrypted, clear);
  const keyResponse = await get(resource(guestManifest, 'key'), { cookie: guestCookie });
  assert.equal(keyResponse.status, 200);
  assert.equal((await keyResponse.arrayBuffer()).byteLength, 16);
  assert.equal((await get(resource(guestManifest, 'key.bin'), { cookie: guestCookie })).status, 400);
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
  assert.equal((await get('/media/late-edit/hd', { cookie: watcherCookie })).status, 404);
  const watcherManifest = await manifest(await start('late-edit', 'hd', watcherCookie));
  assert.equal((await get(watcherManifest, { cookie: watcherCookie })).status, 200);
  assert.equal((await start('late-edit', 'high', watcherCookie)).status, 403);
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

  assert.equal((await post('/admin/mode', { paid: true }, adminCookie)).status, 200);
  const view = async () => (await (await get('/viewer', { cookie: watcherCookie })).json()).auth;
  assert.equal((await view()).canWatch, false);
  assert.equal((await get(watcherManifest, { cookie: watcherCookie })).status, 403);
  assert.equal((await get('/billing/local', { cookie: watcherCookie })).status, 200);
  const checkout = await post('/billing/checkout', { plan: 'basic', cycle: 'monthly' }, watcherCookie);
  assert.equal((await checkout.json()).url, '/payment/checkout?plan=basic&cycle=monthly');
  const confirmation = await post('/billing/local', { action: 'subscribe', plan: 'basic', cycle: 'monthly' }, watcherCookie);
  assert.equal(confirmation.status, 200, await confirmation.text());
  assert.equal((await view()).tier, 'basic');
  const comment = thread.data[0].id;
  const likes = '/comments/' + comment + '/like';
  assert.equal((await post(likes, { liked: true }, watcherCookie, 'PATCH')).status, 200);
  assert.equal((await post(likes, { liked: true }, watcherCookie, 'PATCH')).status, 200);
  const liked = await socket.timeout(2000).emitWithAck('comments:list', target);
  assert.equal(liked.data[0].likes, 1);
  assert.equal(liked.data[0].liked, true);
  assert.equal(liked.data[0].badge, 'basic');
  assert.equal((await post(likes, { liked: false }, watcherCookie, 'PATCH')).status, 200);

  const access = '/admin/watchers/' + watcher.id + '/payment';
  assert.equal((await post(access, { access: 'premium' }, watcherCookie, 'PATCH')).status, 403);
  assert.equal((await post(access, { access: 'unpaid' }, adminCookie, 'PATCH')).status, 200);
  assert.equal((await view()).canWatch, false);
  assert.equal((await post('/billing/checkout', { plan: 'basic', cycle: 'monthly' }, watcherCookie)).status, 403);
  assert.equal((await post(access, { access: 'premium' }, adminCookie, 'PATCH')).status, 200);
  assert.equal((await view()).tier, 'premium');
  const premiumManifest = await manifest(await start('late-edit', 'high', watcherCookie));
  assert.equal((await get(premiumManifest, { cookie: watcherCookie })).status, 200);
  assert.equal((await get('/media/late-edit/high', { cookie: watcherCookie })).status, 404);
  assert.equal((await get('/media/late-edit/high', { cookie: adminCookie })).status, 404);
  assert.equal((await post(access, { access: 'automatic' }, adminCookie, 'PATCH')).status, 200);
  assert.equal((await view()).tier, 'basic');
  assert.equal((await get(resource(premiumManifest, 'part-000000.ts'), { cookie: watcherCookie })).status, 403);
  assert.equal((await post('/billing/local', { action: 'cancel' }, watcherCookie)).status, 200);
  assert.equal((await view()).tier, null);

  const kicked = once(socket, 'disconnect');
  assert.equal((await post('/admin/watchers/' + watcher.id + '/ban', { banned: true }, adminCookie)).status, 200);
  await kicked;
  assert.equal((await get(watcherManifest, { cookie: watcherCookie })).status, 403);
});
