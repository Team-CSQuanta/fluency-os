// Step copy ported from claude-ui-mockup-files/FluencyOS.html (obDefs, ~line 2566)
export const ONBOARDING_STEPS = [
  { n: 1, name: 'Profile', title: 'Who is learning', body: 'Tell us your name and native language.' },
  {
    n: 2,
    name: 'Placement',
    title: 'Where you are now',
    body: 'Your level is set by the same level test used in Settings: take it at the level you think you are at. Beginners can start at A1 without one.',
  },
  {
    n: 3,
    name: 'Engine',
    title: 'How the AI runs',
    body: 'The AI runs on this computer. Here is the model that suits it best — or use a cloud model with your own key.',
  },
  {
    n: 4,
    name: 'Habit',
    title: 'Your daily rhythm',
    body: 'Two numbers shape a day: how many new words join your reviews, and how many pages count toward your reading streak. Change either any time in Settings → Study.',
  },

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
// Provider-abstracted per spec §3.3 ("user-supplied API key, provider-abstracted").
/** The cloud providers the app can actually call (see Settings → AI). */
export const CLOUD_PROVIDERS = [
  {
    key: 'openrouter',
    label: 'OpenRouter',
    hint: 'one key for many models, free ones included',
    placeholder: 'sk-or-…',
  },
  { key: 'gemini', label: 'Google Gemini', hint: 'a free key from Google AI Studio', placeholder: 'AIza…' },
] as const;

export type CloudProvider = (typeof CLOUD_PROVIDERS)[number]['key'];
