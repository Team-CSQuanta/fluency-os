-- Vocabulary increment — a real per-user saved-word table.
--
-- Dictionary fields (pos/cefr/definition/example/simpler/synonyms) are
-- snapshotted from cefr_lexicon at save time rather than re-looked-up on
-- read: the lexicon is static bundled data, so freezing it here keeps every
-- read a plain single-table query, the same choice book_highlights already
-- makes by freezing quoted_text instead of re-deriving it from book_blocks.
--
-- No mastery/due/retention/leech columns: there is no real spaced-repetition
-- scheduler yet, and fabricating scheduling data would be worse than simply
-- not having it. That lands in a later increment.

CREATE TABLE IF NOT EXISTS vocab_words (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word        TEXT NOT NULL,          -- surface form as first looked up (display)
  lemma       TEXT NOT NULL,          -- cefr_lexicon's normalised lemma; the de-dup key
  pos         TEXT,
  cefr        TEXT,
  definition  TEXT,
  example     TEXT,
  simpler     TEXT,
  synonyms    TEXT NOT NULL DEFAULT '[]',   -- JSON array, same convention as user_settings.daily_goal_spec
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, lemma)
);
CREATE INDEX IF NOT EXISTS idx_vocab_words_user ON vocab_words(user_id, created_at);

-- Only kind='page' is ever written by real code today (from the Reader's
-- word lookup). 'clip'/'turn' are reserved for the video/conversation
-- increments, which don't have a real dictionary/save flow yet.
CREATE TABLE IF NOT EXISTS vocab_contexts (
  id            TEXT PRIMARY KEY,
  vocab_word_id TEXT NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('clip', 'page', 'turn')),
  snippet       TEXT NOT NULL,
  source_label  TEXT NOT NULL,        -- frozen display label, e.g. "The Overstory · p.204"
  book_id       TEXT REFERENCES books(id) ON DELETE SET NULL,
  block_index   INTEGER,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vocab_contexts_word ON vocab_contexts(vocab_word_id, created_at);

CREATE TABLE IF NOT EXISTS vocab_notes (
  id            TEXT PRIMARY KEY,
  vocab_word_id TEXT NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vocab_notes_word ON vocab_notes(vocab_word_id, created_at);

-- Freeform per-user tags — no global tag dictionary, since nothing today
-- needs tags to be shared/looked up across users.
CREATE TABLE IF NOT EXISTS vocab_tags (
  vocab_word_id TEXT NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
  tag           TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (vocab_word_id, tag)
);
