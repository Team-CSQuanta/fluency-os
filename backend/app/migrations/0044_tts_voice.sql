-- Which voice each text-to-speech engine speaks in. One column per engine so
-- that switching engines and back keeps the voice picked for each. Values
-- are keys from app/services/voice/voices.py; the defaults are the voices
-- each engine spoke in before this could be chosen.
ALTER TABLE user_settings ADD COLUMN tts_kokoro_voice TEXT NOT NULL DEFAULT 'af_heart';
ALTER TABLE user_settings ADD COLUMN tts_pocket_voice TEXT NOT NULL DEFAULT 'alba';
