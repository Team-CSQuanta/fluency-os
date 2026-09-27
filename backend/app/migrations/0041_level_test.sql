-- The level test: what a learner has to pass to move UP a CEFR level.
-- (Moving down needs no test.) Each attempt keeps the exact questions it
-- served, answers included, so marking happens here and the answers never
-- reach the client — and so recently seen questions can be avoided next time.
CREATE TABLE IF NOT EXISTS level_test_attempts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level         TEXT NOT NULL,          -- the level being tested for
  from_level    TEXT,                   -- the learner's level when it started
  questions     TEXT NOT NULL,          -- JSON: [{id, level, skill, passage, prompt, options, answer}]
  started_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  submitted_at  TEXT,
  correct       INTEGER,
  total         INTEGER,
  passed        INTEGER                 -- 0/1 once submitted
);
CREATE INDEX IF NOT EXISTS idx_level_test_user ON level_test_attempts(user_id, started_at);
