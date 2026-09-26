-- Let the Scene Description Challenge write to the review log.
--
-- review_logs.source was constrained to conversation and flashcard (0015), so
-- a challenge result could not be recorded at all — spec §6.4 says results
-- feed Dynamic SRS Routing, and without this they silently could not.
--
-- SQLite cannot widen a CHECK constraint in place, so the table is rebuilt.
-- Same shape and same dance as 0015; every existing row is carried across.
ALTER TABLE review_logs RENAME TO review_logs_old;

CREATE TABLE review_logs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocab_word_id TEXT NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
  session_id    TEXT REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  source        TEXT NOT NULL CHECK (source IN ('conversation', 'flashcard', 'challenge')),
  outcome       TEXT NOT NULL CHECK (outcome IN (
                  'spontaneous', 'prompted', 'incorrect', 'avoided',
                  'again', 'hard', 'good', 'easy')),
  rating        INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 4),
  stability     REAL,
  difficulty    REAL,
  elapsed_days  REAL,
  created_at    TEXT NOT NULL
);

INSERT INTO review_logs (id, user_id, vocab_word_id, session_id, source, outcome,
                         rating, stability, difficulty, elapsed_days, created_at)
SELECT id, user_id, vocab_word_id, session_id, source, outcome,
       rating, stability, difficulty, elapsed_days, created_at FROM review_logs_old;
DROP TABLE review_logs_old;

CREATE INDEX IF NOT EXISTS idx_review_logs_word ON review_logs(vocab_word_id, created_at);
CREATE INDEX IF NOT EXISTS idx_review_logs_user ON review_logs(user_id, created_at);
