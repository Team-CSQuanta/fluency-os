-- Spec §4.1/§4.2 — Learn by watching. The library, the subtitle engine and
-- the clip context engine, which until now existed only as renderer mock
-- data (libraryMockData.ts / playerMockData.ts).
--
-- Unlike books (0002), the source file is NOT copied into the app directory.
-- A film is 2-20 GB; duplicating it to gain nothing but a stable path would
-- make the library unusable on a laptop. media_items therefore references the
-- file where the user already keeps it, and the cost of that decision is
-- handled explicitly: source_missing records that the path stopped resolving,
-- so the player can offer a relink instead of failing with a dead <video>.
-- This is also what spec §4.2's "Fallback" paragraph asks for.

CREATE TABLE IF NOT EXISTS media_items (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'local' CHECK (kind IN ('local', 'link')),
  -- Where the user keeps it. Authoritative for 'local'; NULL for 'link'.
  source_path     TEXT,
  url             TEXT,
  container       TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  width           INTEGER,
  height          INTEGER,
  video_codec     TEXT,
  audio_codec     TEXT,
  -- Hash of the first and last 1 MiB plus the size, not the whole file:
  -- see media/probe.py. Full-file hashing a 20 GB MKV to detect a duplicate
  -- import would take longer than the import itself.
  file_hash       TEXT NOT NULL,
  file_bytes      INTEGER NOT NULL DEFAULT 0,
  thumbnail_path  TEXT,
  ingest_status   TEXT NOT NULL DEFAULT 'queued'
                  CHECK (ingest_status IN ('queued', 'probing', 'ready', 'failed')),
  ingest_error    TEXT,
  source_missing  INTEGER NOT NULL DEFAULT 0,
  added_at        TEXT NOT NULL,
  UNIQUE (user_id, file_hash)
);
CREATE INDEX IF NOT EXISTS idx_media_items_user ON media_items(user_id, added_at);

-- Subtitle and audio tracks. Audio tracks are listed (spec §4.1.1 asks for
-- audio-track selection on multi-language files) but carry no cues.
CREATE TABLE IF NOT EXISTS media_tracks (
  id            TEXT PRIMARY KEY,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('subtitle', 'audio')),
  -- 'generated' is kept distinct from 'embedded'/'sidecar' for the reason
  -- spec §4.1.2 gives: a machine transcript must never be mistaken for an
  -- official track, because its errors are a different kind of wrong.
  origin        TEXT NOT NULL CHECK (origin IN ('embedded', 'sidecar', 'generated')),
  language      TEXT,
  label         TEXT NOT NULL,
  stream_index  INTEGER,
  source_path   TEXT,
  -- Which half of the dual-subtitle display this track feeds.
  role          TEXT NOT NULL DEFAULT 'target' CHECK (role IN ('target', 'native')),
  cue_count     INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ready'
                CHECK (status IN ('queued', 'extracting', 'transcribing', 'ready', 'failed')),
  progress      REAL NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_tracks_item ON media_tracks(media_item_id, kind);

CREATE TABLE IF NOT EXISTS media_cues (
  id          TEXT PRIMARY KEY,
  track_id    TEXT NOT NULL REFERENCES media_tracks(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  start_ms    INTEGER NOT NULL,
  end_ms      INTEGER NOT NULL,
  text        TEXT NOT NULL,
  UNIQUE (track_id, order_index)
);
-- The player's hot path is "which cue covers time T", run on every timeupdate.
CREATE INDEX IF NOT EXISTS idx_media_cues_time ON media_cues(track_id, start_ms, end_ms);

-- Spec §11: media_progress. percent_complete is stored rather than derived so
-- the library list doesn't need duration to be present on every row (a failed
-- probe leaves duration_ms = 0, and 0/0 is not 100%).
CREATE TABLE IF NOT EXISTS media_progress (
  media_item_id   TEXT PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_ms     INTEGER NOT NULL DEFAULT 0,
  percent_complete REAL NOT NULL DEFAULT 0,
  total_watch_ms  INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_progress_recent ON media_progress(user_id, updated_at);

-- Per-item playback settings the learner tuned and should not have to retune:
-- subtitle delay in particular is a property of the file, not of the session.
CREATE TABLE IF NOT EXISTS media_item_prefs (
  media_item_id    TEXT PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
  target_track_id  TEXT REFERENCES media_tracks(id) ON DELETE SET NULL,
  native_track_id  TEXT REFERENCES media_tracks(id) ON DELETE SET NULL,
  audio_track_index INTEGER,
  subtitle_delay_ms INTEGER NOT NULL DEFAULT 0,
  playback_rate    REAL NOT NULL DEFAULT 1.0,
  updated_at       TEXT NOT NULL
);

-- The clip context engine (spec §4.2). One row per saved word per moment.
-- 'virtual' is a real terminal state, not a pending one: it is what the
-- storage-policy option "store only the timecodes" produces, and such a row
-- is complete — the clip is reconstructed from the source on demand.
CREATE TABLE IF NOT EXISTS media_clips (
  id               TEXT PRIMARY KEY,
  media_item_id    TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  vocab_word_id    TEXT REFERENCES vocab_words(id) ON DELETE CASCADE,
  vocab_context_id TEXT REFERENCES vocab_contexts(id) ON DELETE SET NULL,
  cue_text         TEXT NOT NULL,
  start_ms         INTEGER NOT NULL,
  end_ms           INTEGER NOT NULL,
  clip_path        TEXT,
  thumb_path       TEXT,
  clip_bytes       INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'extracting', 'ready', 'failed', 'virtual')),
  error            TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_clips_word ON media_clips(vocab_word_id);
CREATE INDEX IF NOT EXISTS idx_media_clips_item ON media_clips(media_item_id, created_at);

-- vocab_contexts already allows kind = 'clip' (0006) but had nowhere to put
-- the timecode, so a clip context could not actually be replayed.
ALTER TABLE vocab_contexts ADD COLUMN media_item_id TEXT REFERENCES media_items(id) ON DELETE SET NULL;
ALTER TABLE vocab_contexts ADD COLUMN start_ms INTEGER;
ALTER TABLE vocab_contexts ADD COLUMN end_ms INTEGER;

-- Player preferences that belong to the learner rather than to one file.
-- Defaults mirror spec §4.2 (1000 ms / 500 ms padding, 10 s cap, 480p) and
-- the toggles the mock player shipped switched on.
ALTER TABLE user_settings ADD COLUMN player_dual_subs INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_settings ADD COLUMN player_blur_subs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN player_auto_pause INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN player_loop_cue INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN player_sub_size REAL NOT NULL DEFAULT 25.0;
ALTER TABLE user_settings ADD COLUMN player_sub_opacity REAL NOT NULL DEFAULT 0.55;
ALTER TABLE user_settings ADD COLUMN player_sub_offset REAL NOT NULL DEFAULT 26.0;
-- Clip padding, resolution and the store/on_demand policy already exist:
-- 0001_init.sql shipped clip_padding_before_ms, clip_padding_after_ms,
-- clip_resolution and clip_storage_mode for exactly this engine, two years of
-- migrations before it was built. Only the one value that table has no column
-- for is added here — spec §4.2 step 3's hard cap on total clip length.
ALTER TABLE user_settings ADD COLUMN clip_max_ms INTEGER NOT NULL DEFAULT 10000;
