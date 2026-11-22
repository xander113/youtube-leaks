ALTER TABLE clips ADD COLUMN stream_id TEXT;
ALTER TABLE clips ADD COLUMN stream_started_at BIGINT;
CREATE INDEX clips_stream_queue ON clips(status, guest, published_at DESC)
  WHERE stream_id IS NULL AND job_error IS NULL;
