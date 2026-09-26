-- AI-generated memory aid for a saved word. Persisted (unlike AI example
-- sentences and practice questions, which are cheap to regenerate live and
-- deliberately not stored) because a mnemonic's whole point is to stay
-- fixed once learned — regenerating a different one on every page view
-- would undermine the memory hook rather than help it. NULL until the
-- learner asks for one; overwritten only when they explicitly regenerate.

ALTER TABLE vocab_words ADD COLUMN ai_mnemonic TEXT;
