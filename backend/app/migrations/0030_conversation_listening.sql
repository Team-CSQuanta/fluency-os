-- How hands-free listening behaves, as two settings rather than two constants.
--
-- Both of these arrived as bug reports about the same feature. The microphone
-- gate was cutting the AI off mid-sentence on a cough or a fan, and the
-- end-of-turn timer was sending a half-finished sentence the moment its author
-- paused for breath. Both were fixed by choosing better numbers — but the
-- right number depends on the room and on the person, which is precisely the
-- kind of thing a constant cannot know.
--
-- A quiet room with a headset wants a sensitive microphone; a shared room with
-- a laptop mic wants a deaf one. A confident speaker wants their turn sent the
-- moment they stop; someone assembling a sentence in a new language wants to
-- be allowed to think. Neither preference is wrong, and neither can be
-- detected from the audio.
--
-- Three named steps each, not a number: "how many times the noise floor" is
-- not a question anyone can answer about their own kitchen.

-- How much louder than the room a sound must be before it counts as speech,
-- and before it is allowed to interrupt the reply.
--   sensitive  — a quiet room, or a headset; picks up a soft voice
--   balanced   — the default the gate was tuned to
--   robust     — a noisy or shared room; needs a clear, close voice
ALTER TABLE user_settings ADD COLUMN conversation_mic_sensitivity TEXT NOT NULL
  DEFAULT 'balanced'
  CHECK (conversation_mic_sensitivity IN ('sensitive', 'balanced', 'robust'));

-- How long a pause has to last before the turn is treated as finished.
--   quick    — replies come back fast; pause and you are cut off
--   natural  — the tuned default: a second, longer if you have barely started
--   patient  — room to think mid-sentence, at the cost of a slower reply
ALTER TABLE user_settings ADD COLUMN conversation_turn_pace TEXT NOT NULL
  DEFAULT 'natural'
  CHECK (conversation_turn_pace IN ('quick', 'natural', 'patient'));
