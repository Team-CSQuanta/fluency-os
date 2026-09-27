-- A saved word can mean more than one thing. "Student" met in a novel is a
-- learner; met in a SQL book it is a row in a table. Until now a word held a
-- single definition, so saving it the second time either did nothing or
-- quietly filed the SQL sentence under the novel's meaning.
--
-- Each meaning is its own row, and each context says which meaning it
-- illustrates. vocab_words.definition stays as the entry's first meaning,
-- so everything that reads one definition (review cards, the list, search)
-- keeps working unchanged.

CREATE TABLE IF NOT EXISTS vocab_senses (
  id            TEXT PRIMARY KEY,
  vocab_word_id TEXT NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
  pos           TEXT,
  definition    TEXT NOT NULL,
  example       TEXT,
  -- What makes two meanings the same one: the definition, lowercased and
  -- without surrounding spaces and closing punctuation. Must match
  -- vocabulary.sense_key() exactly.
  sense_key     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (vocab_word_id, sense_key)
);
CREATE INDEX IF NOT EXISTS idx_vocab_senses_word ON vocab_senses(vocab_word_id, created_at);

ALTER TABLE vocab_contexts ADD COLUMN sense_id TEXT REFERENCES vocab_senses(id) ON DELETE SET NULL;

-- Every existing word's one definition becomes its first meaning, dated
-- with the word so it stays first.
INSERT OR IGNORE INTO vocab_senses (id, vocab_word_id, pos, definition, example, sense_key, created_at)
SELECT id || ':s1', id, pos, definition, example, LOWER(TRIM(definition, ' .;:')), created_at
FROM vocab_words
WHERE definition IS NOT NULL AND TRIM(definition) != ''
  -- The stand-ins saved when nothing could define a word are not meanings.
  AND definition NOT LIKE '(no definition yet%'
  AND definition NOT LIKE '(saved from %';

-- And every context recorded so far was recorded against that meaning.
UPDATE vocab_contexts
SET sense_id = (SELECT s.id FROM vocab_senses s WHERE s.vocab_word_id = vocab_contexts.vocab_word_id)
WHERE sense_id IS NULL;
