-- The mistakes the partner fixed in a learner's turn (Settings →
-- Conversation → Corrections: point them out), as a JSON list of
-- {"wrong", "right", "kind", "why"}, most important first. The first few
-- were stored as a single bare {"wrong", "right"} object; readers accept both.
--
-- The fix used to be a bracketed note at the end of the AI's reply, which
-- the voice then read out as if the partner had said it. It now belongs to
-- the learner's own turn, where it is shown on their message. NULL when
-- nothing was fixed.
ALTER TABLE conversation_turns ADD COLUMN correction TEXT;
