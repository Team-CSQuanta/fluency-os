-- A local dictionary that grows.
--
-- Every lookup used to go straight to the network and wait on it, so meeting
-- the same word twice cost the same two or three seconds both times. The
-- bundled lexicon answers instantly but knows only a few hundred words with
-- definitions, which is a rounding error against a novel.
--
-- This is the middle layer: whatever the online dictionaries return is kept,
-- so a word is slow exactly once and instant forever after. Nothing here is
-- authored by us and nothing is irreplaceable — it can be deleted at any time
-- and simply refills.
--
-- Only words that were FOUND are stored. Caching a miss would freeze a
-- dictionary's gap in place, and a word that genuinely is not there is rare
-- enough that paying for it again costs nothing.
CREATE TABLE IF NOT EXISTS dictionary_entries (
  word       TEXT PRIMARY KEY,   -- lowercased, trimmed: the form we looked up
  display    TEXT NOT NULL,      -- the spelling the source itself returned
  ipa        TEXT,
  audio_url  TEXT,
  senses     TEXT NOT NULL,      -- JSON [{pos, definition, example}]
  synonyms   TEXT NOT NULL,      -- JSON [str]
  source     TEXT NOT NULL,      -- which dictionary answered
  cached_at  TEXT NOT NULL
);
