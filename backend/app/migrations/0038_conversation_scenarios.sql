-- Conversation scenarios grew from four one-line briefs to a catalog of
-- scenes (services/scenarios.py), plus scenes the learner writes.
--
-- A session running a learner-written scene keeps its own copy of the
-- description: the scene can be edited or deleted later, and a transcript
-- must still be resumable in the scene it was held in. Catalog scenes need
-- nothing stored — `scenario` names them.
ALTER TABLE conversation_sessions ADD COLUMN scenario_detail TEXT;

CREATE TABLE IF NOT EXISTS conversation_custom_scenarios (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  ai_name       TEXT,
  ai_role       TEXT NOT NULL,
  personality   TEXT,
  setting       TEXT NOT NULL,
  learner_role  TEXT,
  goal          TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custom_scenarios_user ON conversation_custom_scenarios(user_id, created_at);
