-- Where a word was saved from, when there is no block to point at: a lookup
-- on a printed page has no block_index, only a page.
ALTER TABLE vocab_contexts ADD COLUMN page INTEGER;
