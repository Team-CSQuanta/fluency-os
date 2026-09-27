-- Conversation settings a learner would want to change about how the partner
-- talks to them, alongside the two listening settings from 0030.
--
--   reply_length   how much the partner says per turn
--   corrections    recast mistakes in its own reply (as before), or also
--                  point the main one out in a short bracketed note
--   voice_speed    playback rate of the spoken reply, 0.75-1.25
--   hide_text      listening practice: a reply's text stays hidden until it
--                  has been heard
--   hands_free     whether a new conversation starts listening on its own
ALTER TABLE user_settings ADD COLUMN conversation_reply_length TEXT NOT NULL DEFAULT 'normal'
  CHECK (conversation_reply_length IN ('short', 'normal', 'long'));
ALTER TABLE user_settings ADD COLUMN conversation_corrections TEXT NOT NULL DEFAULT 'recast'
  CHECK (conversation_corrections IN ('recast', 'explicit'));
ALTER TABLE user_settings ADD COLUMN conversation_voice_speed REAL NOT NULL DEFAULT 1.0;
ALTER TABLE user_settings ADD COLUMN conversation_hide_text INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN conversation_hands_free INTEGER NOT NULL DEFAULT 1;
