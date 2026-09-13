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

export type VocabContextKind = 'clip' | 'page' | 'turn';

export interface VocabWordCreate {
  user_id: string;
  word: string;
  sentence?: string | null;
  book_id?: string | null;
  block_index?: number | null;
}

export interface VocabNoteOut {
  id: string;
  text: string;
  created_at: string;
}

export interface VocabContextOut {
  id: string;
  kind: VocabContextKind;
  snippet: string;
  source_label: string;
  book_id: string | null;
  block_index: number | null;
  created_at: string;
}

export interface VocabWordOut {
  id: string;
  user_id: string;
  word: string;
  lemma: string;
  pos: string | null;
  cefr: string | null;
  definition: string | null;
  example: string | null;
  simpler: string | null;
  ipa: string | null;
  audio_url: string | null;
  synonyms: string[];
  tags: string[];
  context_count: number;
  ai_mnemonic: string | null;
  created_at: string;
}

export interface VocabWordDetailOut extends VocabWordOut {
  contexts: VocabContextOut[];
  notes: VocabNoteOut[];
  conversation_usage: Record<string, number>;
}

export interface VocabWordSaveOut {
  word: VocabWordOut;
  already_saved: boolean;
}

export interface DictionarySenseOut {
  pos: string;
  definition: string;
  example: string | null;
}

export interface DictionarySearchOut {
  word: string;
  found: boolean;
  ipa: string | null;
  audio_url: string | null;
  senses: DictionarySenseOut[];
  synonyms: string[];
  /** From our own offline lexicon, when it also happens to know the word. */
  cefr: string | null;
  simpler: string | null;
}

export interface AiExplainOut {
  word: string;
  pos: string;
  definition: string;
  example: string;
  synonyms: string[];
}

export interface AiExamplesOut {
  examples: string[];
}

export interface AiMnemonicOut {
  mnemonic: string;
}

export interface AiPracticeOut {
  question: string;
}

export type ScenarioKey = 'free' | 'coffee' | 'job' | 'debate';
export type ConversationChannel = 'voice' | 'text';
export type ConversationSpeaker = 'user' | 'ai';
export type UsageOutcome = 'spontaneous' | 'prompted' | 'incorrect' | 'avoided';

export interface ConversationSessionCreate {
  user_id: string;
  scenario: ScenarioKey;
  channel: ConversationChannel;
  /** "Practise this again" — reuse a previous session's target words. */
  seed_word_ids?: string[];
}

export interface ConversationTurnOut {
  id: string;
  turn_index: number;
  speaker: ConversationSpeaker;
  text: string;
  audio_url: string | null;
  /** Sentence-sized audio pieces, fetched one at a time so the first can play
   * while the rest are still being synthesized. */
  audio_chunk_count: number;
  stt_confidence: number | null;
  created_at: string;
}

export interface TargetWordOut {
  id: string;
  word: string;
  used_outcome: UsageOutcome | null;
}

export interface ConversationSessionOut {
  id: string;
  user_id: string;
  scenario: ScenarioKey;
  channel: ConversationChannel;
  target_words: TargetWordOut[];
  started_at: string;
  ended_at: string | null;
  has_report: boolean;
  /** Pinned when the session started — not necessarily what Settings says now. */
  engine_provider: LlmProvider;
  engine_label: string;
}

export interface ConversationSessionDetailOut extends ConversationSessionOut {
  turns: ConversationTurnOut[];
}

export interface TurnSubmitOut {
  user_turn: ConversationTurnOut;
  ai_turn: ConversationTurnOut;
}

export interface ReportErrorOut {
  bad: string;
  good: string;
  why: string;
}

export interface ReportRoutingRowOut {
  word: string;
  outcome: UsageOutcome;
  evidence_turn: number | null;
}

export interface ConversationReportOut {
  session_id: string;
  /** 1 = written before the current analysis existed; fields below may be null. */
  report_version: number;
  summary: string;
  turn_count: number;
  routing: ReportRoutingRowOut[];
  errors: ReportErrorOut[];

  /** Dials, 0-100. Null means not measured, which is not the same as zero. */
  contextual_accuracy_pct: number | null;
  grammatical_precision: number | null;
  lexical_range: number | null;
  pronunciation_score: number | null;

  /** Fluency proxies. */
  words_per_minute: number | null;
  filler_rate_per_100w: number | null;
  avg_response_delay_seconds: number | null;
  longest_run_words: number | null;
  type_token_ratio: number | null;
  above_level_words: string[];
  self_corrections: number | null;
}

export interface EngineStatusOut {
  llm: string;
  stt: string;
  tts: string;
}

export interface DownloadStatusOut {
  status: 'idle' | 'downloading' | 'ready' | 'error';
  downloaded_bytes: number;
  total_bytes: number;
  error: string | null;
}

export interface LlmOptionOut {
  key: string;
  label: string;
  note: string;
  approx_size_mb: number;
  downloaded: boolean;
  selected: boolean;
  download: DownloadStatusOut;
}

export interface SingleModelOut {
  label: string;
  downloaded: boolean;
  download: DownloadStatusOut;
}

export type TtsEngine = 'kokoro' | 'pocket';

export interface TtsOptionOut extends SingleModelOut {
  key: TtsEngine;
  note: string;
  approx_size_mb: number;
  selected: boolean;
  /** Whether this engine's runtime is present. Pocket TTS is an optional
   * extra, so it can be listed and downloadable without being runnable. */
  installed: boolean;
}

export interface ModelsCatalogOut {
  llm: LlmOptionOut[];
  stt: SingleModelOut;
  /** Mirrors whichever entry of `tts_options` is selected. */
  tts: SingleModelOut;
  tts_options: TtsOptionOut[];
  models_dir: string;
  disk_usage_bytes: number;
}

export interface ReadinessOut {
  ready: boolean;
  llm: boolean;
  stt: boolean;
  tts: boolean;
  llm_model_label: string;
}

export type LlmProvider = 'local' | 'openrouter' | 'gemini';

export interface LlmProviderOut {
  provider: LlmProvider;
  openrouter_model: string;
  has_openrouter_key: boolean;
  openrouter_key_preview: string | null;
  gemini_model: string;
  has_gemini_key: boolean;
  gemini_key_preview: string | null;
}

export interface VocabWordManualCreate {
  user_id: string;
  word: string;
  pos: string;
  definition: string;
  example?: string | null;
  synonyms?: string[];
  ipa?: string | null;
  audio_url?: string | null;
  note?: string | null;
}
