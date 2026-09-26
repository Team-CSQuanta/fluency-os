-- Two additions to the Scene Description Challenge.
--
-- 1. CONTENT RECALL, a deterministic anchor for the score.
--
--    A VATEX round is marked 75/100 by a single model call — relevance,
--    detail and grammar all arrive in one JSON object — leaving duration as
--    the only part that can be checked. "How much of what the describers
--    noticed did the learner notice" is not, in fact, a question that needs a
--    model: the ten descriptions can be reduced to content words ranked by how
--    many people used each, and how many of those the learner reached is
--    arithmetic. Stored alongside the judged `detail_score` rather than
--    replacing it, so the two can be compared on real rounds before either is
--    trusted further.
--
-- 2. THE ENRICHED DESCRIPTION.
--
--    After a round is scored, the learner can ask for a model-written
--    description that synthesises the ten and, where they genuinely fit,
--    works in words from their own vocabulary. It is stored because it costs
--    a real model call and a learner reopening a past round should see what
--    they saw before, not pay for it again and get something different.

ALTER TABLE challenge_rounds ADD COLUMN content_recall REAL;

ALTER TABLE challenge_rounds ADD COLUMN enriched_text TEXT;
-- Which of the learner's own words the enrichment actually used, as a JSON
-- array of {word, vocab_word_id, why}. Verified against the text before being
-- stored — a model asked which words it used will happily name one it did not.
ALTER TABLE challenge_rounds ADD COLUMN enriched_words TEXT;
ALTER TABLE challenge_rounds ADD COLUMN enriched_at TEXT;
