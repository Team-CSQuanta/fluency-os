-- Scenes from VATEX, played as YouTube embeds.
--
-- VATEX distributes annotations, not video: each scene is a YouTube id and a
-- start/end second, and ten independent human descriptions of what happens in
-- it. Those ten are the thing this is for — they are real ground truth, which
-- a clip from the learner's own library can never have.
--
-- Embedding means the player reaches youtube-nocookie.com, which is the one
-- place in this app where anything leaves the machine. It is opt-in, off by
-- default, and said plainly in Settings.

ALTER TABLE challenge_rounds ADD COLUMN source TEXT NOT NULL DEFAULT 'library';
ALTER TABLE challenge_rounds ADD COLUMN video_id TEXT;
ALTER TABLE challenge_rounds ADD COLUMN start_s INTEGER;
ALTER TABLE challenge_rounds ADD COLUMN end_s INTEGER;
-- The ten human descriptions, frozen onto the round: the scene file may be
-- re-cut in a later version and a past score has to stay explainable.
-- Not named "references" — REFERENCES is a SQL keyword.
ALTER TABLE challenge_rounds ADD COLUMN reference_captions TEXT;
-- How much of what the describers mentioned the learner covered. Only
-- meaningful when there is something to compare against.
ALTER TABLE challenge_rounds ADD COLUMN detail_score INTEGER;

-- Kinetics-era YouTube links rot: a fair share of these videos are now
-- deleted or private. Recorded globally rather than per learner, because a
-- video that has gone has gone for everyone, and nobody should be served it
-- twice.
CREATE TABLE IF NOT EXISTS vatex_unavailable (
  video_id    TEXT PRIMARY KEY,
  reported_at TEXT NOT NULL
);

-- Opt-in, and off until asked for: this is the only feature that talks to a
-- third party, and a local-first app does not get to enable that quietly.
ALTER TABLE user_settings ADD COLUMN scene_embeds_enabled INTEGER NOT NULL DEFAULT 0;
