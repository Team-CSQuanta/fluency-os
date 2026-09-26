-- Spec §6.4 — Scene Description Challenge.
--
-- One row per attempt. Scores are stored rather than recomputed because the
-- rubric will change and a personal best has to keep meaning what it meant
-- when it was set; recomputing old attempts under a new rubric would silently
-- rewrite the learner's history.
--
-- The deterministic parts of the score (target coverage, speaking duration)
-- are kept apart from the judged parts (grammar, scene relevance) for the same
-- reason conversation_report separates them: one is arithmetic over the
-- transcript and the other is a model's opinion, and a learner disputing a
-- score deserves to know which is which.

CREATE TABLE IF NOT EXISTS challenge_rounds (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL
                   CHECK (kind IN ('describe', 'predict', 'roleplay', 'interrogate', 'reword')),
  -- The clip being described. SET NULL rather than CASCADE: an attempt is a
  -- thing the learner did, and losing the film should not delete their score.
  media_item_id    TEXT REFERENCES media_items(id) ON DELETE SET NULL,
  clip_id          TEXT REFERENCES media_clips(id) ON DELETE SET NULL,
  media_title      TEXT NOT NULL DEFAULT '',
  start_ms         INTEGER NOT NULL DEFAULT 0,
  end_ms           INTEGER NOT NULL DEFAULT 0,
  -- What was said in the clip, kept so a scored round can be reviewed after
  -- the source is gone. Never shown before the attempt — the point is to
  -- describe the scene without being handed its words.
  cue_text         TEXT NOT NULL DEFAULT '',
  target_words     TEXT NOT NULL DEFAULT '[]',   -- JSON array of lemmas
  prompt           TEXT NOT NULL DEFAULT '',

  transcript       TEXT,
  speech_seconds   REAL,
  stt_confidence   REAL,

  -- Deterministic, from the transcript alone.
  target_coverage  REAL,                          -- 0-1
  duration_score   REAL,                          -- 0-1
  -- Judged by the model.
  grammar_score    INTEGER,                       -- 0-100
  relevance_score  INTEGER,                       -- 0-100
  overall          INTEGER,                       -- 0-100
  feedback         TEXT,                          -- JSON: notes, corrections
  hints_used       INTEGER NOT NULL DEFAULT 0,

  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'scored', 'abandoned')),
  error            TEXT,
  started_at       TEXT NOT NULL,
  scored_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_challenge_rounds_user ON challenge_rounds(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_challenge_rounds_best ON challenge_rounds(user_id, kind, overall);
