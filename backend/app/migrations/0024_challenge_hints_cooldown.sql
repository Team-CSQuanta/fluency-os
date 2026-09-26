-- Graded hints, a repeat cooldown, and the index that makes the cooldown cheap.
--
-- Three things this fixes, all of them observed rather than theorised:
--
-- 1. Hints cost nothing. hints_used has been counted since 0020 and has never
--    affected a score or been shown, so "ask for help" was strictly free. A
--    hint drawn from the ten reference descriptions is a real part of the
--    answer, so taking one has to cost something and the learner has to be
--    told what before they take it.
--
-- 2. A scene, once served, was excluded forever — except in the last-resort
--    branch of the picker, which dropped the filter entirely and could serve
--    the same scene twice running. Neither is right: a scene is worth seeing
--    again eventually, just not soon.
--
-- 3. The cooldown asks "did this learner see this scene in the last 60 days",
--    which without an index is a scan of every round they have ever played.

ALTER TABLE challenge_rounds ADD COLUMN hint_level INTEGER NOT NULL DEFAULT 0;
-- Points already forfeited. Stored rather than derived from hint_level so the
-- tariff can change without silently rescoring rounds played under the old one
-- — the same reason 0020 stores scores instead of recomputing them.
ALTER TABLE challenge_rounds ADD COLUMN hint_penalty INTEGER NOT NULL DEFAULT 0;
-- The score before hints were deducted, so a learner can see what the
-- description itself was worth and what the help cost them.
ALTER TABLE challenge_rounds ADD COLUMN raw_overall INTEGER;

CREATE INDEX IF NOT EXISTS idx_challenge_rounds_cooldown
  ON challenge_rounds(user_id, video_id, started_at);

-- A scene whose video would not play. Distinct from vatex_unavailable, which
-- is the learner's own report: this is what the player itself said, recorded
-- automatically the moment the embed raises an error, so the next learner is
-- never served it and nobody has to press a button to make that happen.
CREATE TABLE IF NOT EXISTS vatex_playback_errors (
  video_id    TEXT PRIMARY KEY,
  reason      TEXT NOT NULL DEFAULT '',
  reported_at TEXT NOT NULL
);
