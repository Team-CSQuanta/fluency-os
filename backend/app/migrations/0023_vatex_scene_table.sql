-- The VATEX corpus, imported into the database rather than held in memory.
--
-- At 3,000 scenes a Python list was fine. At 34,991 — every VATEX clip with
-- public English captions — it is roughly 30 MB of strings resident for the
-- whole session to serve one scene at a time, and the two questions that
-- actually decide which scene to serve ("has this learner seen it", "has
-- anyone reported it gone") are joins, not list comprehensions.
--
-- Populated once from app/data/vatex_scenes.jsonl.gz on first launch; see
-- services/vatex_scenes.ensure_imported.

CREATE TABLE IF NOT EXISTS vatex_scenes (
  video_id  TEXT NOT NULL,
  start_s   INTEGER NOT NULL,
  end_s     INTEGER NOT NULL,
  cefr      TEXT NOT NULL,
  -- The ten human descriptions, as a JSON array. This is the ground truth the
  -- whole feature exists for.
  captions  TEXT NOT NULL,
  -- A single YouTube video can supply more than one clip, at different
  -- timestamps, so the window is part of the identity.
  PRIMARY KEY (video_id, start_s, end_s)
);
CREATE INDEX IF NOT EXISTS idx_vatex_scenes_cefr ON vatex_scenes(cefr);
