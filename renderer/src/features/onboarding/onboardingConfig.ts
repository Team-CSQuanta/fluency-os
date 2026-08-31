import type { ModelTier } from '@/types/api';

// Step copy ported from claude-ui-mockup-files/FluencyOS.html (obDefs, ~line 2566)
export const ONBOARDING_STEPS = [
  { n: 1, name: 'Profile', title: 'Who is learning', body: 'Tell us your name and native language.' },
  {
    n: 2,
    name: 'Placement',
    title: 'Where you are now',
    body: 'A 20-item check calibrates your CEFR estimate — it takes about four minutes and you can redo it later.',
  },
  {
    n: 3,
    name: 'Engine',
    title: 'How the AI runs',
    body: 'We profiled your machine. Pick a model tier, or bring your own API key if you would rather not run inference locally.',
  },
  {
    n: 4,
    name: 'Habit',
    title: 'What counts as a day',
    body: 'Your daily goal is any two of these. Notifications are opt-in and silent between 22:00 and 08:00.',
  },
  {
    n: 5,
    name: 'Companion',
    title: 'Who keeps you company',
    body: 'Your companion is also the avatar of your conversation partner. No feeding, no hunger meter — it is an anchor, not another obligation.',
  },
] as const;

// Ported from obTiers, ~line 2580. "recommended" is no longer static config —
// it's derived per-machine from the backend's /engine/assess-hardware result
// (see onboardingStore.ts's assessHardware()).
export const MODEL_TIERS: Array<{
  key: ModelTier;
  name: string;
  size: string;
  meta: string;
  desc: string;
}> = [
  {
    key: 'light',
    name: 'Light',
    size: '1.5 GB',
    meta: 'qwen2.5-1.5b · Q4_K_M',
    desc: 'Runs anywhere. Explanations in ~1.5 s, occasionally shallow.',
  },
  {
    key: 'balanced',
    name: 'Balanced',
    size: '2.5 GB',
    meta: 'gemma-3-4b-it · Q4_K_M',
    desc: 'Meets the 3 s explanation target on a 4-core / 8GB machine.',
  },
  {
    key: 'heavy',
    name: 'Heavy',
    size: '4.8 GB',
    meta: 'qwen2.5-7b · Q4_K_M',
    desc: 'Best explanations, but 6–9 s per lookup without a GPU.',
  },
];

// Ported from obCompanions, ~line 2589
export const COMPANIONS = [
  { key: 'fox', label: 'Fox' },
  { key: 'owl', label: 'Owl' },
  { key: 'deer', label: 'Deer' },
  { key: 'cat', label: 'Cat' },
] as const;

export const BIOMES = [
  { key: 'meadow', label: 'Meadow', desc: 'Default region for manually added words' },
  { key: 'cinema_clearing', label: 'Cinema Clearing', desc: 'Words captured from video' },
  { key: 'library_grove', label: 'Library Grove', desc: 'Words captured from books' },
] as const;

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

// Predefined native-language options (glosses, dual subtitles, translations).
export const SUPPORTED_NATIVE_LANGUAGES = [
  'Bengali',
  'Hindi',
  'Urdu',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Russian',
  'Arabic',
  'Chinese (Mandarin)',
  'Japanese',
  'Korean',
  'Vietnamese',
  'Thai',
  'Indonesian',
  'Turkish',
  'Persian (Farsi)',
  'Tamil',
  'English',
] as const;

// FluencyOS teaches English in this increment; kept as a predefined (not free-text)
// select for consistency, with room to grow once the schema's language-agnostic
// design (spec §9.1) is actually exercised by a second target language.
export const SUPPORTED_TARGET_LANGUAGES = ['English'] as const;

// Daily-goal components a learner can enable/tune on Step 4 (spec §8.8's
// "any two of these", extended here with reading and vocabulary goals).
export const DAILY_GOAL_ITEMS: Array<{
  key: 'reviews_cleared' | 'conversation_minutes' | 'watch_minutes' | 'reading_minutes' | 'new_words';
  title: string;
  sub: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'reviews_cleared', title: 'Due reviews cleared', sub: 'flashcards', unit: 'cards', min: 5, max: 100, step: 5 },
  {
    key: 'conversation_minutes',
    title: 'Conversation practice',
    sub: 'live voice or text session',
    unit: 'min',
    min: 1,
    max: 30,
    step: 1,
  },
  {
    key: 'watch_minutes',
    title: 'Video / media watched',
    sub: 'films, shows, YouTube',
    unit: 'min',
    min: 5,
    max: 120,
    step: 5,
  },
  { key: 'reading_minutes', title: 'Reading', sub: 'books and articles', unit: 'min', min: 5, max: 120, step: 5 },
  {
    key: 'new_words',
    title: 'New words saved',
    sub: 'captured from any source',
    unit: 'words',
    min: 1,
    max: 50,
    step: 1,
  },
];

// Provider-abstracted per spec §3.3 ("user-supplied API key, provider-abstracted").
export const API_PROVIDERS = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'anthropic', label: 'Anthropic' },
  { key: 'google', label: 'Google (Gemini)' },
] as const;
