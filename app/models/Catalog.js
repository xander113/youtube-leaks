import { fail } from '../middleware/errors.js';

const clipFields = 'c.id, c.title, c.description, c.category, c.guest, c.series_id, c.published_at, c.duration, c.source_url, c.demo';
const seriesFields = 's.id, s.title, s.description, s.category, s.random_order, s.created_at';

function clipCard(row, viewer) {
  return {
    ...row, kind: 'clip', guest: Boolean(row.guest),
    locked: !row.guest && !viewer.auth.canWatch,
    poster: `/api/posters/${row.id}`
  };
}

function seriesCard(row, viewer) {
  return {
    ...row, kind: 'series', random_order: Boolean(row.random_order),
    locked: !row.has_guest && !viewer.auth.canWatch,
    poster: `/api/posters/${row.poster_id}`
  };
}

async function browseSeries(db) {
  return db.all(`SELECT ${seriesFields},
    (SELECT c.id FROM clips c WHERE c.series_id = s.id AND c.status = 'ready'
      ORDER BY c.guest DESC, c.published_at DESC, c.id LIMIT 1) AS poster_id,
    EXISTS (SELECT 1 FROM clips c WHERE c.series_id = s.id AND c.status = 'ready' AND c.guest = 1) AS has_guest
    FROM series s WHERE EXISTS (SELECT 1 FROM clips c WHERE c.series_id = s.id AND c.status = 'ready')
    ORDER BY s.created_at DESC, s.id LIMIT 24`);
}

async function loadBrowse(db, viewer) {
  const [recent, publicClips, shows, genres] = await Promise.all([
    db.all(`SELECT ${clipFields} FROM clips c WHERE c.status = 'ready'
      ORDER BY c.published_at DESC, c.id LIMIT 16`),
    db.all(`SELECT ${clipFields} FROM clips c WHERE c.status = 'ready' AND c.guest = 1
      ORDER BY c.published_at DESC, c.id LIMIT 16`),
    browseSeries(db),
    db.all(`SELECT category FROM clips WHERE status = 'ready'
      GROUP BY category ORDER BY MAX(published_at) DESC, category LIMIT 12`)
  ]);
  const genresWithClips = genres.length ? await db.all(`SELECT * FROM (
    SELECT ${clipFields}, ROW_NUMBER() OVER(PARTITION BY c.category ORDER BY c.published_at DESC, c.id) AS position
    FROM clips c WHERE c.status = 'ready' AND c.category IN (${genres.map(() => '?').join(',')})
    ) ranked WHERE position <= 12 ORDER BY position`, genres.map(row => row.category)) : [];
  return {
    featured: (viewer.auth.canWatch ? recent[0] : publicClips[0]) ?
      clipCard(viewer.auth.canWatch ? recent[0] : publicClips[0], viewer) : null,
    rows: [
      { id: 'new', name: 'New clips', items: recent.map(row => clipCard(row, viewer)) },
      { id: 'guests', name: 'Watch for free', items: publicClips.map(row => clipCard(row, viewer)) },
      { id: 'series', name: 'Series', items: shows.map(row => seriesCard(row, viewer)) },
      ...genres.map(({ category }) => ({
        id: `category:${category}`, name: category,
        items: genresWithClips.filter(row => row.category === category).map(({ position, ...row }) => clipCard(row, viewer))
      }))
    ].filter(row => row.items.length)
  };
}

const browseCache = new WeakMap();

export function invalidateBrowse(db) {
  browseCache.delete(db);
}

export function browse(db, viewer) {
  let audiences = browseCache.get(db);
  if (!audiences) browseCache.set(db, audiences = new Map());
  const audience = viewer.auth.canWatch;
  const now = Date.now();
  const cached = audiences.get(audience);
  if (cached && cached.until > now) return cached.result;
  const entry = { until: now + 5000 };
  entry.result = loadBrowse(db, viewer).catch(error => {
    if (audiences.get(audience) === entry) audiences.delete(audience);
    throw error;
  });
  audiences.set(audience, entry);
  return entry.result;
}

export async function details(db, viewer, type, id) {
  if (type === 'clip') {
    const row = await db.one(`SELECT ${clipFields} FROM clips c WHERE c.id = ? AND c.status = 'ready'`, [id]);
    if (!row) fail(404, 'Clip not found.');
    return clipCard(row, viewer);
  }
  const show = await db.one(`SELECT ${seriesFields} FROM series s WHERE s.id = ?`, [id]);
  if (!show) fail(404, 'Series not found.');
  const [clips, cover, accessible] = await Promise.all([
    db.all(`SELECT ${clipFields} FROM clips c WHERE c.series_id = ? AND c.status = 'ready'
      ORDER BY ${show.random_order ? 'c.created_at' : 'c.published_at'}, c.id LIMIT 240`, [id]),
    db.one(`SELECT id FROM clips WHERE series_id = ? AND status = 'ready'
      ORDER BY guest DESC, published_at DESC, id LIMIT 1`, [id]),
    db.one("SELECT id FROM clips WHERE series_id = ? AND status = 'ready' AND guest = 1 LIMIT 1", [id])
  ]);
  if (!cover && viewer.auth.role !== 'admin') fail(404, 'Series not found.');
  return {
    ...show, kind: 'series', random_order: Boolean(show.random_order), locked: !accessible && !viewer.auth.canWatch,
    poster: cover ? `/api/posters/${cover.id}` : null,
    items: clips.map(row => clipCard(row, viewer))
  };
}

export async function find(db, viewer, query) {
  const pattern = '%' + query.toLowerCase().replace(/[!%_]/g, '!$&') + '%';
  const [clips, shows] = await Promise.all([
    db.all(`SELECT ${clipFields} FROM clips c WHERE c.status = 'ready'
      AND (LOWER(c.title) LIKE ? ESCAPE '!' OR LOWER(c.category) LIKE ? ESCAPE '!')
      ORDER BY c.published_at DESC, c.id LIMIT 36`, [pattern, pattern]),
    db.all(`SELECT ${seriesFields},
      (SELECT id FROM clips WHERE series_id = s.id AND status = 'ready'
        ORDER BY guest DESC, published_at DESC, id LIMIT 1) AS poster_id,
      EXISTS (SELECT 1 FROM clips WHERE series_id = s.id AND status = 'ready' AND guest = 1) AS has_guest
      FROM series s WHERE EXISTS (SELECT 1 FROM clips WHERE series_id = s.id AND status = 'ready')
      AND (LOWER(s.title) LIKE ? ESCAPE '!' OR LOWER(s.category) LIKE ? ESCAPE '!')
      ORDER BY s.created_at DESC, s.id LIMIT 24`, [pattern, pattern])
  ]);
  return [...clips.map(row => clipCard(row, viewer)), ...shows.map(row => seriesCard(row, viewer))];
}
