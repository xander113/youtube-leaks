BEGIN;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'watcher',
  banned_at BIGINT,
  stripe_customer_id TEXT UNIQUE,
  plan TEXT CHECK (plan IN ('basic', 'premium')),
  paid_until BIGINT,
  billing_revision BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  CHECK ((id = 1 AND role = 'admin' AND banned_at IS NULL) OR (id > 1 AND role IN ('admin','watcher')))
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paid INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0,1))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  random_order INTEGER NOT NULL DEFAULT 0 CHECK (random_order IN (0,1)),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS series_newest ON series(created_at DESC, id);

CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  series_id TEXT REFERENCES series(id),
  guest INTEGER NOT NULL DEFAULT 0 CHECK (guest IN (0,1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  due_at BIGINT NOT NULL,
  started_at BIGINT,
  last_run BIGINT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS feeds_due ON feeds(enabled, due_at);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  guest INTEGER NOT NULL DEFAULT 0 CHECK (guest IN (0,1)),
  series_id TEXT REFERENCES series(id),
  source_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','ready','failed')),
  job_error TEXT,
  started_at BIGINT,
  created_at BIGINT NOT NULL,
  published_at BIGINT NOT NULL,
  duration INTEGER,
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1))
);
CREATE INDEX IF NOT EXISTS clips_recent ON clips(status, published_at DESC, id);
CREATE INDEX IF NOT EXISTS clips_public ON clips(status, guest, published_at DESC, id);
CREATE INDEX IF NOT EXISTS clips_series ON clips(series_id, status, published_at, id);
CREATE INDEX IF NOT EXISTS clips_queue ON clips(status, created_at);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('clip','series')),
  target_id TEXT NOT NULL,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_target ON comments(target_type, target_id, parent_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS comments_parent ON comments(parent_id);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS playlists_user ON playlists(user_id, created_at);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('clip','series')),
  target_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (playlist_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority IN (0,1)),
  created_at BIGINT NOT NULL,
  answer TEXT,
  answered_at BIGINT
);
CREATE INDEX IF NOT EXISTS support_user ON support_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_queue ON support_requests(answered_at, priority DESC, created_at);
INSERT INTO settings (id, paid) VALUES (1, 0) ON CONFLICT DO NOTHING;
INSERT INTO users (id, name, role, created_at) VALUES (1, 'Head Admin', 'admin', 0) ON CONFLICT DO NOTHING;
INSERT INTO series (id, title, description, category, random_order, created_at) VALUES
  ('studio-notes', 'Studio Notes', 'A short series about life behind the camera.', 'Behind the scenes', 0, 1741000000000),
  ('open-folder', 'Open Folder', 'Small moments from the cutting room.', 'Creator stories', 1, 1741200000000)
ON CONFLICT DO NOTHING;

INSERT INTO clips (id, title, description, category, guest, series_id, status, created_at, published_at, duration, demo) VALUES
  ('first-cut', 'The First Cut', 'See how a rough idea becomes a short film.', 'Behind the scenes', 1, 'studio-notes', 'ready', 1741000000000, 1741000000000, 12, 1),
  ('late-edit', 'The Late Edit', 'A quiet look at the last changes before release.', 'Behind the scenes', 0, 'studio-notes', 'ready', 1741100000000, 1741100000000, 12, 1),
  ('outtakes', 'Outtakes', 'A few moments that stayed out of the final cut.', 'Creator stories', 1, 'open-folder', 'ready', 1741200000000, 1741200000000, 12, 1),
  ('setting-up', 'Setting Up', 'A look around the studio before the shoot.', 'Creator stories', 0, 'open-folder', 'ready', 1741300000000, 1741300000000, 12, 1),
  ('frame-by-frame', 'Frame by Frame', 'A short breakdown of an edit, one change at a time.', 'Commentary', 1, NULL, 'ready', 1741400000000, 1741400000000, 12, 1),
  ('studio-walk', 'Studio Walk', 'A quick tour of a small working studio.', 'Creator stories', 0, NULL, 'ready', 1741500000000, 1741500000000, 12, 1)
ON CONFLICT DO NOTHING;
COMMIT;
