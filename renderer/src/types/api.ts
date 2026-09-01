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

export type BookFormat = 'epub' | 'pdf' | 'mobi' | 'azw3' | 'txt';
export type BookIngestStatus = 'queued' | 'parsing' | 'ready' | 'failed';

export interface BookImportRequest {
  user_id: string;
  paths: string[];
  count_toward_goal: boolean;
  heat_overlay: boolean;
}

export interface BookOut {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  language: string;
  format: BookFormat;
  cover_path: string | null;
  total_blocks: number;
  total_words: number;
  page_estimate: number;
  ingest_status: BookIngestStatus;
  ingest_error: string | null;
  count_toward_goal: boolean;
  heat_overlay: boolean;
  imported_at: string;
  finished_at: string | null;
  /** Null until the book has been opened once — that is what "Not started" means. */
  last_read_at: string | null;
  percent: number;
}

export interface GoalDayOut {
  date: string;
  label: string;
  pages: number;
  /** 0-100, already clamped against the goal — drives the week bar heights. */
  percent: number;
}

export interface ReadingStatsOut {
  goal_pages: number;
  pages_today: number;
  books_today: number;
  streak_days: number;
  goal_met: boolean;
  week: GoalDayOut[];
}

export type LevelMode = 'inline' | 'lexical' | 'contextual' | 'semantic';

export type PageTheme = 'auto' | 'light' | 'sepia' | 'dark';
export type PanelTab = 'toc' | 'search' | 'marks' | 'text' | 'ai' | 'level';

export interface ReaderPrefsOut {
  font_size: number;
  page_theme: PageTheme;
  heat_on: boolean;
  panel_open: boolean;
  panel_tab: PanelTab;
}

export interface LeveledSegmentOut {
  text: string;
  /** Null for untouched prose; the replaced wording otherwise. */
  original: string | null;
}

export interface SubstitutionOut {
  from_text: string;
  to_text: string;
}

export interface LeveledTextOut {
  mode: LevelMode;
  /** What actually ran — differs from `mode` when a generative mode degraded. */
  served_mode: LevelMode;
  target_cefr: string;
  engine: string;
  original: string;
  segments: LeveledSegmentOut[];
  substitutions: SubstitutionOut[];
  /** False when the mode needs a model and none is configured. */
  available: boolean;
  note: string | null;
  cached: boolean;
}

export interface SessionOut {
  id: string;
  book_id: string;
  local_date: string;
  words_read: number;
  seconds: number;
}

export interface BookCountsOut {
  all: number;
  reading: number;
  not_started: number;
  finished: number;
}

export interface BookUpdate {
  title?: string;
  author?: string;
  language?: string;
  count_toward_goal?: boolean;
  heat_overlay?: boolean;
}

export interface ChapterOut {
  id: string;
  order_index: number;
  label: string;
  depth: number;
  start_block: number;
  page: number;
}

export type BlockKind = 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'list' | 'caption' | 'code';

export interface BlockOut {
  block_index: number;
  chapter_id: string | null;
  kind: BlockKind;
  text: string;
  word_count: number;
}

export interface PositionOut {
  block_index: number;
  char_offset: number;
  max_block_seen: number;
  page: number;
  total_pages: number;
  percent: number;
}

export interface PositionUpdate {
  user_id: string;
  block_index: number;
  char_offset?: number;
}

export interface PageOut {
  page: number;
  total_pages: number;
  blocks: BlockOut[];
  has_prev: boolean;
  has_next: boolean;
  first_block_index: number;
}

export type HighlightColour = 'yellow' | 'green' | 'blue' | 'pink';

export interface HighlightCreate {
  user_id: string;
  block_index: number;
  start_char: number;
  end_char: number;
  colour: HighlightColour;
  quoted_text: string;
  note?: string | null;
}

export interface HighlightUpdate {
  colour?: HighlightColour;
  note?: string | null;
}

export interface HighlightOut {
  id: string;
  book_id: string;
  user_id: string;
  block_index: number;
  start_char: number;
  end_char: number;
  colour: HighlightColour;
  quoted_text: string;
  note: string | null;
  created_at: string;
  page: number;
}

export interface BookmarkCreate {
  user_id: string;
  block_index: number;
  label: string;
}

export interface BookmarkOut {
  id: string;
  book_id: string;
  user_id: string;
  block_index: number;
  label: string;
  created_at: string;
  page: number;
}

export interface SnippetSegmentOut {
  text: string;
  matched: boolean;
}

export interface SearchHitOut {
  block_index: number;
  page: number;
  chapter_label: string | null;
  snippet: SnippetSegmentOut[];
}

export interface HeatSpanOut {
  start_char: number;
  end_char: number;
  word: string;
  cefr: string;
  simpler: string | null;
}

export interface BlockHeatOut {
  block_index: number;
  spans: HeatSpanOut[];
}

export interface HeatOut {
  target_cefr: string;
  /** False when the book's own heat_overlay flag is off. */
  enabled: boolean;
  blocks: BlockHeatOut[];
  total_above_level: number;
}

export interface WordSenseOut {
  definition: string;
  example: string | null;
}

export interface WordLookupOut {
  word: string;
  lemma: string | null;
  pos: string | null;
  cefr: string | null;
  ipa: string | null;
  senses: WordSenseOut[];
  synonyms: string[];
  simpler: string | null;
  /** False when the word isn't in the offline lexicon at all. */
  found: boolean;
  /** Explaining the word in its sentence needs a model — Phase 7. */
  context_available: boolean;
  context_note: string | null;
}
