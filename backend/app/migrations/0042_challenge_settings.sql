-- Two Scene Challenge settings that change how a round plays.
--
-- challenge_difficulty shifts which scenes are picked relative to the
-- learner's level: -1 easier, 0 at their level, +1 harder. Scenes are rated
-- by CEFR band, and the picker takes the learner's band and one either side;
-- this moves that window.
--
-- challenge_hints_enabled turns the hint ladder off, for a learner who wants
-- the whole score on their own.
ALTER TABLE user_settings ADD COLUMN challenge_difficulty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN challenge_hints_enabled INTEGER NOT NULL DEFAULT 1;
