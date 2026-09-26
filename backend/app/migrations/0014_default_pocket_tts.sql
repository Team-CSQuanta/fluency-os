-- Pocket TTS becomes the voice this app speaks with.
--
-- Measured on the reference machine (Ryzen 3 3200G, 4 cores, AVX2, no VNNI),
-- both engines in one run over the same replies — mean time to the first
-- audible chunk, which is what a learner actually waits for:
--
--     Kokoro       2.22s   RTF 1.01x - 1.25x
--     Pocket TTS   1.03s   RTF 0.52x - 0.55x
--
-- The RTF is the part that decided it. Kokoro drifts above real time, so it
-- produces speech more slowly than it plays and long replies develop gaps.
-- Pocket TTS stayed at roughly half real time on every reply.
--
-- Existing rows are switched too, not just the default for new ones: leaving
-- current users on Kokoro would mean the app speaks differently depending on
-- when the account was made. Anyone whose Pocket TTS model isn't downloaded
-- yet gets a clear "not downloaded" gate in Settings rather than a silent
-- failure, and Kokoro stays selectable for them in the meantime.

ALTER TABLE user_settings RENAME COLUMN tts_engine TO tts_engine_old;
ALTER TABLE user_settings ADD COLUMN tts_engine TEXT NOT NULL DEFAULT 'pocket';
UPDATE user_settings SET tts_engine = 'pocket';
ALTER TABLE user_settings DROP COLUMN tts_engine_old;
