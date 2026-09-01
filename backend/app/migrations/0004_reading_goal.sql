-- Phase 7 — a real reading goal, streak and "continue reading" shelf.
--
-- 0002 already shipped reading_sessions with a local_date/words_read shape,
-- but nothing wrote to it. Position updates now accumulate one row per
-- (user, book, local day), which is what the goal ring, the week bars and the
-- streak all read from — hence the uniqueness constraint that upsert needs.
--
-- The goal itself is per-user and editable from the shelf, so it gets a real
-- column rather than reusing the free-text daily_goal_spec.

ALTER TABLE user_settings ADD COLUMN daily_page_goal INTEGER NOT NULL DEFAULT 20;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_book_day
  ON reading_sessions(user_id, book_id, local_date);

-- "Continue reading" orders by when a book was last open, not when it was
-- imported, so the ordering column needs its own index.
CREATE INDEX IF NOT EXISTS idx_positions_recent
  ON reading_positions(user_id, updated_at);
