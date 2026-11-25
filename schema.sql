-- Thrive call dashboard database (Cloudflare D1). Safe to run more than once.
CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('policies', 'calls')),
  name        TEXT NOT NULL,
  rows        INTEGER NOT NULL DEFAULT 0,
  from_day    TEXT,
  to_day      TEXT,
  uploaded_at TEXT NOT NULL,
  bytes       INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT            -- set when someone presses Remove; the data itself is kept
);
CREATE TABLE IF NOT EXISTS upload_chunks (
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  seq       INTEGER NOT NULL,
  data      TEXT NOT NULL,
  PRIMARY KEY (upload_id, seq)
);
CREATE INDEX IF NOT EXISTS uploads_live ON uploads (deleted_at, uploaded_at);
