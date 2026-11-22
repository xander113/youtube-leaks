import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { XMLParser } from 'fast-xml-parser';
import ipaddr from 'ipaddr.js';
import { config } from '../config.js';
import { fail } from '../middleware/errors.js';
import { sourcePath } from './media.js';

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, processEntities: false, parseTagValue: false });
const refresh = 15 * 60000;
const many = value => Array.isArray(value) ? value : value == null ? [] : [value];
const content = (value, max) => String(typeof value === 'object' ? value?.['#text'] ?? '' : value ?? '')
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function safeUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail(400, 'Enter an HTTPS feed or video URL.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !config.feedHosts.has(url.hostname)) {
    fail(400, 'The HTTPS host must be on the RSS allowlist.');
  }
  url.hash = '';
  return url;
}

async function remote(value, max, maxTime, stop) {
  const url = safeUrl(value);
  const signal = AbortSignal.any([AbortSignal.timeout(maxTime), stop]);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => ipaddr.process(address).range() !== 'unicast')) {
    throw new Error('Feed or video host must resolve to public IP addresses.');
  }
  signal.throwIfAborted();
  const pinned = addresses.find(address => address.family === 4) || addresses[0];
  const response = await new Promise((resolve, reject) => {
    const req = request(url, {
      signal, agent: false, headers: { 'User-Agent': 'YoutubeLeaksFeedReader/1.0', 'Accept-Encoding': 'identity' },
      lookup: (_host, options, done) => {
        if (options.all) done(null, [pinned]);
        else done(null, pinned.address, pinned.family);
      }
    }, resolve);
    req.once('error', reject);
    req.end();
  });
  if (response.statusCode !== 200 || Number(response.headers['content-length']) > max ||
      ![undefined, 'identity'].includes(response.headers['content-encoding'])) {
    response.destroy();
    throw new Error(`The remote server sent HTTP ${response.statusCode}, a compressed file, or a file over the size limit. Redirects are disabled.`);
  }
  let bytes = 0;
  const capped = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      done(bytes > max ? new Error('The remote file is too large.') : null, chunk);
    }
  });
  return { response, capped, signal };
}

async function readFeed(feed, signal) {
  const { response, capped, signal: deadline } = await remote(feed.url, 1024 * 1024, 20000, signal);
  const chunks = [];
  capped.on('data', chunk => chunks.push(chunk));
  await pipeline(response, capped, { signal: deadline });
  const xml = Buffer.concat(chunks).toString('utf8');
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) throw new Error('RSS documents may not include entity definitions.');
  const parsed = parser.parse(xml);
  const entries = parsed.rss?.channel?.item ?? parsed.feed?.entry ?? parsed.RDF?.item;
  if (!parsed.rss?.channel && !parsed.feed && !parsed.RDF) throw new Error('The URL did not return an RSS or Atom feed.');
  return many(entries).slice(0, 50);
}

async function ingest(db, feed, item, stop) {
  const alternate = many(item.alternateEnclosure).flatMap(enclosure =>
    many(enclosure?.source).map(source => ({ '@_url': source?.['@_uri'], '@_type': enclosure['@_type'] })));
  const attachments = [...many(item.enclosure), ...many(item.content), ...many(item.group?.content), ...alternate,
    ...many(item.link).filter(link => link?.['@_rel'] === 'enclosure')].filter(Boolean);
  const file = attachments.find(node => {
    const url = node?.['@_url'] || node?.['@_href'];
    return typeof url === 'string' && (/^video\/(mp4|x-m4v|webm|quicktime)$/i.test(node['@_type'] || '') || /\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(url));
  });
  if (!file) return false;
  const url = safeUrl(new URL(file['@_url'] || file['@_href'], feed.url).href).href;
  const sourceId = createHash('sha256').update(feed.id + ':' + (content(item.guid || item.id, 2000) || url)).digest('hex');
  if (await db.one('SELECT id FROM clips WHERE source_id = ?', [sourceId])) return false;

  const id = randomUUID();
  const path = sourcePath(id);
  let saved = false;
  try {
    const { response, capped, signal } = await remote(url, config.maxUpload, 60000, stop);
    await pipeline(response, capped, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal });
    const now = Date.now();
    const published = Date.parse(content(item.pubDate || item.published || item.updated, 100));
    saved = Boolean(await db.one(`INSERT INTO clips (id, title, description, category, guest, series_id, source_id, created_at, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (source_id) DO NOTHING RETURNING id`,
    [id, content(item.title, 120) || 'New clip', content(item.description || item.summary, 1600) || 'Added from a feed.',
      feed.category, feed.guest, feed.series_id, sourceId, now, Number.isFinite(published) ? published : now]));
  } finally {
    if (!saved) await rm(path, { force: true }).catch(error => console.error('RSS staging cleanup', error));
  }
  return saved;
}

export async function processFeed(db, io, signal) {
  const now = Date.now();
  const lease = now - 10 * 60000;
  const feed = await db.one(`UPDATE feeds SET started_at = ?
    WHERE id = (SELECT id FROM feeds WHERE enabled = 1 AND due_at <= ? AND (started_at IS NULL OR started_at < ?)
      ORDER BY due_at, id LIMIT 1)
    AND enabled = 1 AND due_at <= ? AND (started_at IS NULL OR started_at < ?) RETURNING *`, [now, now, lease, now, lease]);
  if (!feed) return;
  let lastError = null;
  try {
    const items = await readFeed(feed, signal);
    let downloaded = 0;
    let failed = 0;
    for (const item of items) {
      if (signal.aborted) break;
      if (!item || typeof item !== 'object') continue;
      if (downloaded + failed >= 4) break;
      try {
        if (await ingest(db, feed, item, signal)) downloaded++;
      } catch (error) {
        failed++;
        lastError = error.message;
      }
    }
  } catch (error) {
    lastError = error.message;
  }
  if (signal.aborted) {
    await db.all('UPDATE feeds SET started_at = NULL WHERE id = ? AND started_at = ?', [feed.id, now]);
    return;
  }
  if (lastError) console.error('RSS import', feed.id, lastError);
  const finished = Date.now();
  await db.all(`UPDATE feeds SET started_at = NULL, last_run = ?, last_error = ?,
    due_at = CASE WHEN due_at > ? THEN due_at ELSE ? END WHERE id = ? AND started_at = ?`,
  [finished, lastError?.slice(0, 400) || null, now, finished + refresh, feed.id, now]);
  io.to('admins').emit('admin:changed');
}
