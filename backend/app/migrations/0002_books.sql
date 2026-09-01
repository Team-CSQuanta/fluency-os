-- Spec §4.3/§4.4 — Learn by reading. Local file import only.
-- Phase 1 of the reading feature only writes to books/book_chapters/
-- book_blocks/book_blocks_fts; the remaining tables here are shipped now so
-- later phases (position sync, highlights, bookmarks, sessions, leveling)
-- don't need a second migration.

CREATE TABLE IF NOT EXISTS books (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  author            TEXT,
  language          TEXT NOT NULL DEFAULT 'en',
  format            TEXT NOT NULL CHECK (format IN ('epub','pdf','mobi','azw3','txt')),
  source_type       TEXT NOT NULL DEFAULT 'import' CHECK (source_type IN ('import')),
  source_path       TEXT,
  stored_path       TEXT NOT NULL,
  file_hash         TEXT NOT NULL,
  file_bytes        INTEGER NOT NULL,
  cover_path        TEXT,
  total_blocks      INTEGER NOT NULL DEFAULT 0,
  total_words       INTEGER NOT NULL DEFAULT 0,
  page_estimate     INTEGER NOT NULL DEFAULT 0,
  ingest_status     TEXT NOT NULL DEFAULT 'queued'
                    CHECK (ingest_status IN ('queued','parsing','ready','failed')),
  ingest_error      TEXT,
  count_toward_goal INTEGER NOT NULL DEFAULT 1,
  heat_overlay      INTEGER NOT NULL DEFAULT 1,
  imported_at       TEXT NOT NULL,
  finished_at       TEXT,
  UNIQUE (user_id, file_hash)
);

CREATE TABLE IF NOT EXISTS book_chapters (
  id            TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  order_index   INTEGER NOT NULL,
  label         TEXT NOT NULL,
  depth         INTEGER NOT NULL DEFAULT 0,
  start_block   INTEGER NOT NULL,
  word_offset   INTEGER NOT NULL,
  UNIQUE (book_id, order_index)
);

CREATE TABLE IF NOT EXISTS book_blocks (
  book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL,
  chapter_id  TEXT REFERENCES book_chapters(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'p'
              CHECK (kind IN ('p','h1','h2','h3','quote','list','caption','code')),
  text        TEXT NOT NULL,
  word_count  INTEGER NOT NULL,
  text_hash   TEXT NOT NULL,
  PRIMARY KEY (book_id, block_index)
);
CREATE INDEX IF NOT EXISTS idx_blocks_hash ON book_blocks(text_hash);

CREATE VIRTUAL TABLE IF NOT EXISTS book_blocks_fts USING fts5(
  text, book_id UNINDEXED, block_index UNINDEXED,
  content='book_blocks', content_rowid='rowid', tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS reading_positions (
  book_id        TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  block_index    INTEGER NOT NULL DEFAULT 0,
  char_offset    INTEGER NOT NULL DEFAULT 0,
  max_block_seen INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (book_id, user_id)
);

CREATE TABLE IF NOT EXISTS book_highlights (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL,
  start_char  INTEGER NOT NULL,
  end_char    INTEGER NOT NULL,
  colour      TEXT NOT NULL CHECK (colour IN ('yellow','green','blue','pink')),
  quoted_text TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  CHECK (end_char > start_char)
);
CREATE INDEX IF NOT EXISTS idx_hl_book ON book_highlights(book_id, block_index);

CREATE TABLE IF NOT EXISTS book_bookmarks (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL,
  label       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_sessions (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date  TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  words_read  INTEGER NOT NULL DEFAULT 0,
  seconds     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_day ON reading_sessions(user_id, local_date);

CREATE TABLE IF NOT EXISTS leveled_blocks (
  text_hash    TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('inline','lexical','contextual','semantic')),
  target_cefr  TEXT NOT NULL,
  engine       TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (text_hash, mode, target_cefr, engine)
);
