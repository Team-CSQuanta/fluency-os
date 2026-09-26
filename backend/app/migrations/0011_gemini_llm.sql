-- A second cloud LLM option, Google AI Studio's Gemini API, alongside the
-- existing OpenRouter one (0010_openrouter_llm.sql). Same reasoning as that
-- migration: `api_provider` (0001_init.sql) was already sitting dormant
-- specifically to distinguish which cloud service `llm_mode = 'api'` means,
-- so it now actually holds 'openrouter' or 'gemini' instead of adding a new
-- column for that. The two cloud providers get their own key/model columns
-- (rather than sharing openrouter_api_key/openrouter_model) so switching
-- between them never clobbers the other's saved credentials — a user can
-- have both configured and flip between them freely.
--
-- Same plaintext-in-local-SQLite trust boundary as openrouter_api_key; see
-- that migration's comment for why this doesn't go in api_key_ref.

ALTER TABLE user_settings ADD COLUMN gemini_api_key TEXT;
ALTER TABLE user_settings ADD COLUMN gemini_model TEXT;
