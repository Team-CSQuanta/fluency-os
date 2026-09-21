-- Where a word was saved from, when there is no block to point at.
--
-- A word looked up on a printed page has no block_index: the selection is a
-- run of boxes on an image, not a paragraph the extractor recorded. Without
-- somewhere to put the page, every word saved while reading a PDF was stored
-- with no source at all — the vocabulary entry could not say where it came
-- from, and the forest could not place it.
ALTER TABLE vocab_contexts ADD COLUMN page INTEGER;
