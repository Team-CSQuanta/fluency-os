-- How long the learner actually spoke for, per turn.
--
-- Without this, words-per-minute divided the learner's word count by whole
-- session wall-clock time — which includes the AI thinking and talking — so it
-- measured the model's latency rather than the learner's speech rate.
--
-- stt_engine already decodes each clip and computes its duration (for the
-- silent-clip guard), so this costs nothing extra to collect. NULL on text
-- turns and on every turn recorded before this migration, which the report
-- reads as "no speech rate measurable" rather than as zero.

ALTER TABLE conversation_turns ADD COLUMN speech_seconds REAL;
