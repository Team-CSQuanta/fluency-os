-- Conversation increment — real sessions/turns backed by a local voice
-- pipeline (see app/services/voice/), plus review_logs: the honest half of
-- "Dynamic SRS Routing" that's actually buildable today.
--
-- No mastery/due/interval/rating columns anywhere here, on purpose: there is
-- no FSRS scheduler in this app yet (vocab_words has none either, see
-- 0006_vocabulary.sql's own comment), so review_logs records what really
-- happened (a target word's real usage outcome in a real conversation)
-- without inventing a fake schedule to route it into.

CREATE TABLE IF NOT EXISTS conversation_sessions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scenario          TEXT NOT NULL,             -- 'free' | 'coffee' | 'job' | 'debate'
  channel           TEXT NOT NULL CHECK (channel IN ('voice', 'text')),
  target_word_ids   TEXT NOT NULL DEFAULT '[]',-- JSON array of vocab_words.id
  model_id          TEXT,                      -- e.g. "qwen2.5-1.5b-instruct-q4_k_m", frozen at session start
  report_json       TEXT,                      -- populated at end_session; NULL until then
  started_at        TEXT NOT NULL,
  ended_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_user ON conversation_sessions(user_id, started_at);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  turn_index      INTEGER NOT NULL,
  speaker         TEXT NOT NULL CHECK (speaker IN ('user', 'ai')),
  text            TEXT NOT NULL,
  audio_path      TEXT,               -- local wav file path, voice channel only
  stt_confidence  REAL,               -- 0-1 proxy from faster-whisper avg_logprob; user turns from audio only
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversation_turns_session ON conversation_turns(session_id, turn_index);

CREATE TABLE IF NOT EXISTS review_logs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocab_word_id TEXT NOT NULL REFERENCES vocab_words(id) ON DELETE CASCADE,
  session_id    TEXT REFERENCES conversation_sessions(id) ON DELETE SET NULL,
  source        TEXT NOT NULL CHECK (source IN ('conversation')),
  outcome       TEXT NOT NULL CHECK (outcome IN ('spontaneous', 'prompted', 'incorrect', 'avoided')),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_logs_word ON review_logs(vocab_word_id, created_at);
