-- Manual "add word" flow, backed by a real dictionaryapi.dev search rather
-- than only capturing words encountered while reading.
--
-- ipa/audio_url are new because dictionaryapi.dev returns real pronunciation
-- data our own offline lexicon (cefr_lexicon.py) doesn't have. Both stay
-- NULL for reader-originated saves — nothing is fabricated to fill them.

ALTER TABLE vocab_words ADD COLUMN ipa TEXT;
ALTER TABLE vocab_words ADD COLUMN audio_url TEXT;
