-- Spec section 10.2 — Users and configuration.
-- Scope for this increment: users, user_settings, app_meta only.

CREATE TABLE IF NOT EXISTS users (
  id                      TEXT PRIMARY KEY,
  display_name            TEXT NOT NULL,
  native_language         TEXT NOT NULL,
  target_language         TEXT NOT NULL,
  cefr_level              TEXT,
  created_at              TEXT NOT NULL,
  onboarding_completed_at TEXT
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  llm_mode                TEXT NOT NULL DEFAULT 'local' CHECK (llm_mode IN ('local','api')),
  llm_model_id            TEXT,
  api_provider            TEXT,
  api_key_ref             TEXT,
  stt_model_id            TEXT,
  tts_voice_id            TEXT,
  embedding_model_id      TEXT,
  target_retention        REAL NOT NULL DEFAULT 0.90,
  new_cards_per_day       INTEGER NOT NULL DEFAULT 15,
  daily_goal_spec         TEXT,
  clip_padding_before_ms  INTEGER NOT NULL DEFAULT 1000,
  clip_padding_after_ms   INTEGER NOT NULL DEFAULT 500,
  clip_resolution         TEXT DEFAULT '480p',
  clip_storage_mode       TEXT NOT NULL DEFAULT 'store' CHECK (clip_storage_mode IN ('store','on_demand')),
  theme                   TEXT NOT NULL DEFAULT 'system',
  notifications_enabled   INTEGER NOT NULL DEFAULT 1,
  quiet_hours_start       TEXT DEFAULT '22:00',
  quiet_hours_end         TEXT DEFAULT '08:00'
);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
