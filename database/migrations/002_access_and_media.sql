ALTER TABLE users ADD COLUMN paid_override TEXT CHECK (paid_override IN ('unpaid', 'basic', 'premium'));
ALTER TABLE clips ADD COLUMN source_url TEXT;
ALTER TABLE clips ADD COLUMN media_format TEXT NOT NULL DEFAULT 'mp4' CHECK (media_format IN ('mp4', 'webm'));

CREATE TABLE comment_likes (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);
