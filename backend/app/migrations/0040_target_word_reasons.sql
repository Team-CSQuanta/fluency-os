-- Why each target word was chosen for a session ("due · fits scene",
-- "retry", "new"), as JSON keyed by vocab word id. Shown beside the word in
-- the conversation, where every word used to read "due" whether it was due
-- or not. NULL for sessions from before words were chosen this way.
ALTER TABLE conversation_sessions ADD COLUMN target_reasons TEXT;
