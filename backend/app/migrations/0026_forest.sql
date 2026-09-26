-- Spec §8 — the Forest.
--
-- Every tree is one vocabulary word. Nothing about a tree is stored: its
-- species, its size, its health and the ground it stands on are all read from
-- what the learner has actually done with that word. A tree is a VIEW of an
-- FSRS card, which is why there is no `trees` table here and never should be —
-- two records of the same fact drift apart, and the forest would start showing
-- a thriving oak for a word the scheduler knows was forgotten last week.
--
-- What genuinely cannot be derived is what the learner has SPENT. Sunlight
-- earned is a projection of review_logs; sunlight spent is a decision they
-- made, and decisions have to be recorded.

CREATE TABLE IF NOT EXISTS forest_spends (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What it went on. 'streak_freeze' holds a streak through a missed day;
  -- 'revive' brings a dormant tree back without a full relearn.
  kind       TEXT NOT NULL CHECK (kind IN ('streak_freeze', 'revive')),
  cost       INTEGER NOT NULL CHECK (cost > 0),
  -- For a revive: which tree. Null for anything that is not about one word.
  vocab_word_id TEXT REFERENCES vocab_words(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forest_spends_user ON forest_spends(user_id, created_at);

-- A focus session: the learner asked for a quiet block and either finished it
-- or did not. Recorded rather than derived because "I sat down for 25 minutes"
-- is not visible anywhere else in the app.
CREATE TABLE IF NOT EXISTS forest_focus_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  minutes      INTEGER NOT NULL CHECK (minutes > 0),
  started_at   TEXT NOT NULL,
  -- Null until it ends. A session abandoned halfway earns nothing: the point
  -- is the unbroken block, and paying out for a broken one teaches nothing.
  completed_at TEXT,
  sunlight     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_forest_focus_user ON forest_focus_sessions(user_id, started_at);
