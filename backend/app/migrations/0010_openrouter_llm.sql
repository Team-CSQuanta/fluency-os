-- Cloud LLM option via OpenRouter, switchable per-user against the existing
-- local llama.cpp path. Reuses the columns the original schema already set
-- aside for exactly this (llm_mode 'local'|'api', api_provider) rather than
-- adding new ones for those. `llm_model_id` stays LOCAL-catalog-key-only
-- (Conversation's selected_llm_option() branches on llm_mode before ever
-- reading it) — a separate openrouter_model column avoids any chance of an
-- OpenRouter model string ("openai/gpt-4o-mini") being misread as a local
-- catalog key.
--
-- api_key_ref (0001_init.sql) is explicitly documented as "never a raw key,
-- OS-keychain reference only" — this app has no real keychain integration
-- built, so rather than quietly violate that documented contract, the real
-- OpenRouter key goes in its own honestly-named column: openrouter_api_key,
-- plaintext in the user's own local SQLite file (same trust boundary as
-- everything else this app already stores locally), never synced anywhere.

ALTER TABLE user_settings ADD COLUMN openrouter_api_key TEXT;
ALTER TABLE user_settings ADD COLUMN openrouter_model TEXT;
