-- Which text-to-speech engine answers aloud: 'kokoro' or 'pocket'.
--
-- Kokoro is non-streaming — nothing is audible until a whole chunk has been
-- synthesized, which is why conversation.py splits replies in two and why the
-- floor on first audio is the cost of one full chunk. Pocket TTS is
-- autoregressive and yields audio while it is still generating, so its first
-- sound does not wait on the rest of the sentence.
--
-- Per-user rather than global because the tradeoff is hardware-dependent:
-- Pocket TTS needs ~500MB more RAM and PyTorch, and its advantage narrows on
-- CPUs without AVX-512/VNNI. Defaulting to 'kokoro' keeps every existing
-- install on exactly the engine it already has downloaded and working.

ALTER TABLE user_settings ADD COLUMN tts_engine TEXT NOT NULL DEFAULT 'kokoro';
