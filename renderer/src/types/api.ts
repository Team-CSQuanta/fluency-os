export type LlmMode = 'local' | 'api';
export type ModelTier = 'light' | 'balanced' | 'heavy';
export type CompanionSpecies = 'fox' | 'owl' | 'deer' | 'cat';

export interface HealthResponse {
  status: 'ok';
  schema_version: string;
}

export interface UserCreate {
  display_name: string;
  native_language: string;
  target_language: string;
  data_folder: string;
}

export interface UserOut {
  id: string;
  display_name: string;
  native_language: string;
  target_language: string;
  cefr_level: string | null;
  created_at: string;
  onboarding_completed_at: string | null;
}

export interface PlacementUpdate {
  cefr_level: string;
}

export interface GoalItem {
  enabled: boolean;
  target: number;
}

export interface DailyGoalSpec {
  reviews_cleared: GoalItem;
  conversation_minutes: GoalItem;
  watch_minutes: GoalItem;
  reading_minutes: GoalItem;
  new_words: GoalItem;
}

export interface UserSettingsUpdate {
  llm_mode: LlmMode;
  llm_model_id: string | null;
  api_provider: string | null;
  api_key_ref: string | null;
  daily_goal_spec: DailyGoalSpec;
  notifications_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

export interface CompanionUpdate {
  companion_species: CompanionSpecies;
  starting_biome: string;
}

export interface PlacementQuestion {
  id: string;
  level: string;
  category: 'grammar' | 'vocabulary';
  prompt: string;
  options: [string, string, string, string];
}

export interface PlacementAnswer {
  question_id: string;
  selected_index: number;
}

export interface LevelBreakdown {
  level: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface PlacementResult {
  estimated_cefr: string;
  raw_score: number;
  total_questions: number;
  breakdown: LevelBreakdown[];
}

export interface EngineTierCapability {
  tier: ModelTier;
  capable: boolean;
  min_ram_gb: number;
  min_cores: number;
}

export interface EngineAssessment {
  recommended_tier: ModelTier | null;
  any_local_capable: boolean;
  tiers: EngineTierCapability[];
}
