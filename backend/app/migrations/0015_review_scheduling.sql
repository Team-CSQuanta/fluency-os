-- Real spaced repetition. 0006_vocabulary.sql deliberately shipped without
-- scheduling columns ("fabricating scheduling data would be worse than simply
-- not having it") — this is the increment that earns them.
--
-- One scheduling card per WORD, not per card type. The four presentation
-- types in spec §5.3 (recognition / production / cloze / listening) are ways
-- of asking about the same knowledge, and §5.5's interleaving asks for them
-- to be mixed rather than scheduled apart. Scheduling them separately would
-- also quarter the effect of §6.3: using a word in conversation is one event,
-- and it must move the learner's whole knowledge of that word, not a quarter
-- of it. The type is therefore chosen per review, not stored per card.

CREATE TABLE IF NOT EXISTS review_cards (
  vocab_word_id   TEXT PRIMARY KEY REFERENCES vocab_words(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- FSRS state. stability is in days; difficulty is 1-10.
  stability       REAL NOT NULL DEFAULT 0,
  difficulty      REAL NOT NULL DEFAULT 0,
  state           TEXT NOT NULL DEFAULT 'new'
                    CHECK (state IN ('new', 'learning', 'review', 'relearning')),
  due             TEXT,          -- ISO8601 UTC; NULL only while state = 'new'
  last_review     TEXT,
  reps            INTEGER NOT NULL DEFAULT 0,
  lapses          INTEGER NOT NULL DEFAULT 0,
  -- Set by hand or on leeching (§5.5). A suspended card leaves the queue but
  -- keeps its state, so unsuspending resumes rather than restarts.
  suspended       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_cards_due ON review_cards(user_id, suspended, due);

-- Every word already saved gets a card, so the queue is not empty for anyone
-- who has been using the app. They start as 'new' — which is the truth: none
-- of them has ever been scheduled.
INSERT OR IGNORE INTO review_cards (vocab_word_id, user_id, created_at)
SELECT id, user_id, created_at FROM vocab_words;

-- review_logs gains flashcard reviews alongside conversation ones. Both
-- sources write here, which is what spec §5.5 means by dual-source review
-- and what makes §6.3 work at all.
--
-- SQLite cannot widen a CHECK constraint in place, so the table is rebuilt.
-- Existing conversation rows are preserved exactly.
ALTER TABLE review_logs RENAME TO review_logs_old;

CREATE TABLE review_logs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocab_word_id TEXT NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
  session_id    TEXT REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  source        TEXT NOT NULL CHECK (source IN ('conversation', 'flashcard')),
  -- Conversation outcomes and flashcard ratings share this column because
  -- they are the same kind of fact: how well the word was recalled. The
  -- mapping between them is spec §6.3 and lives in services/review.py.
  outcome       TEXT NOT NULL CHECK (outcome IN (
                  'spontaneous', 'prompted', 'incorrect', 'avoided',
                  'again', 'hard', 'good', 'easy')),
  -- The FSRS rating actually applied (1-4). NULL on rows written before this
  -- migration, which predate the scheduler entirely.
  rating        INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 4),
  -- The card's state immediately after this review, so a history can be
  -- charted without replaying the whole algorithm.
  stability     REAL,
  difficulty    REAL,
  elapsed_days  REAL,
  created_at    TEXT NOT NULL
);

INSERT INTO review_logs (id, user_id, vocab_word_id, session_id, source, outcome, created_at)
SELECT id, user_id, vocab_word_id, session_id, source, outcome, created_at FROM review_logs_old;

DROP TABLE review_logs_old;

CREATE INDEX IF NOT EXISTS idx_review_logs_word ON review_logs(vocab_word_id, created_at);
CREATE INDEX IF NOT EXISTS idx_review_logs_user ON review_logs(user_id, created_at);

-- Target retention is the one FSRS knob worth exposing: it is the learner's
-- own trade between how much they remember and how much they review.
ALTER TABLE user_settings ADD COLUMN target_retention_srs REAL NOT NULL DEFAULT 0.9;
