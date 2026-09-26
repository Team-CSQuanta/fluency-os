-- Let a captured moment find its film again after the film leaves the library.
--
-- Removing a library item sets vocab_contexts.media_item_id to NULL (0017) so
-- the learner keeps the word, the line and the timecode. But a re-import gets
-- a fresh id, so nothing ever reattached them: the moment stayed orphaned even
-- with the film sitting back in the library and the timecode still correct.
--
-- The hash is the durable identity — media_items.file_hash survives the
-- round trip because it is computed from the file, not from the row. Kept on
-- the context rather than looked up, precisely because the item it points at
-- is the thing that may not exist.
ALTER TABLE vocab_contexts ADD COLUMN media_file_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_vocab_contexts_relink
  ON vocab_contexts(media_file_hash) WHERE media_item_id IS NULL;
