-- AI enrichment, stored in its own right rather than folded into the
-- dictionary's fields.
--
-- The add-word flow generates a learner-level definition, example sentences,
-- a memory hook and a register note. Until now only the mnemonic had a home
-- (ai_mnemonic, added in 0009); the rest was either discarded on save or
-- flattened into a free-text note, and the AI definition OVERWROTE the
-- dictionary's. That loses the thing that makes having both worthwhile: the
-- dictionary is authoritative about what a word means, and the model is
-- better at saying it in words a learner already has. Keeping them apart
-- means neither has to win.
--
-- ai_examples is a JSON array, the same convention vocab_words.synonyms and
-- user_settings.daily_goal_spec already use.

ALTER TABLE vocab_words ADD COLUMN ai_definition TEXT;
ALTER TABLE vocab_words ADD COLUMN ai_examples TEXT NOT NULL DEFAULT '[]';
ALTER TABLE vocab_words ADD COLUMN ai_usage_note TEXT;
-- Which dictionary sense the enrichment was generated against. An entry for
-- "our" has ten senses; enrichment of sense 2 says nothing about sense 7, and
-- without this the page cannot tell the learner which one it described.
ALTER TABLE vocab_words ADD COLUMN ai_sense_definition TEXT;
