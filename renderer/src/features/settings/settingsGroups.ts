/** What the settings page is divided into, and why those divisions.
 *
 * This replaces a file of mock data. Every group there described a feature
 * as it was imagined during the mockup — "Input device: MacBook Mic", "Data
 * folder: 18.4 GB used" — and none of those values had anything behind them.
 * Displaying a setting that cannot be read is worse than omitting it: it
 * tells someone their microphone is one thing when it is another.
 *
 * The groups now follow the app's own shape. One per thing the learner
 * actually does — talk, watch, read, practise — plus the four that cut across
 * all of them: who they are, what the AI is, how it looks, what leaves the
 * machine.
 */

export const SETTINGS_GROUP_ORDER = [
  'Account',
  'Study',
  'AI',
  'Conversation',
  'Watching',
  'Reading',
  'Challenge',
  'Appearance',
  'Privacy',
] as const;

export type SettingsGroupName = (typeof SETTINGS_GROUP_ORDER)[number];

export interface SettingsGroupDef {
  /** The one line under the heading. */
  sub: string;
  /** Extra words the search box should match on, for people who know what
   * they want to change but not what this app decided to call it. */
  keywords: string[];
}

export const SETTINGS_GROUPS: Record<SettingsGroupName, SettingsGroupDef> = {
  Account: {
    sub: 'Who you are, and where your data sits',
    keywords: ['name', 'language', 'native', 'cefr', 'level', 'profile', 'folder', 'storage'],
  },
  Study: {
    sub: 'How much comes back, and how often',
    keywords: ['review', 'srs', 'fsrs', 'retention', 'new cards', 'queue', 'goal', 'pages', 'reminders', 'notifications', 'quiet hours'],
  },
  AI: {
    sub: 'The model behind conversation, explanations and scoring',
    keywords: ['model', 'llm', 'local', 'openrouter', 'api key', 'download', 'gguf', 'whisper', 'voice'],
  },
  Conversation: {
    sub: 'Hands-free listening, and the voice that answers',
    keywords: ['microphone', 'mic', 'vad', 'sensitivity', 'interrupt', 'barge', 'pause', 'turn', 'voice', 'tts', 'speech'],
  },
  Watching: {
    sub: 'Subtitle defaults, playback aids and the clip engine',
    keywords: ['video', 'subtitles', 'subs', 'dual', 'blur', 'loop', 'auto-pause', 'clip', 'ffmpeg', 'resolution', 'disk'],
  },
  Reading: {
    sub: 'How a book is laid out and marked up',
    keywords: ['book', 'pdf', 'epub', 'font', 'size', 'theme', 'sepia', 'difficulty', 'heat', 'page view'],
  },
  Challenge: {
    sub: 'The Scene Description Challenge, and what it contacts',
    keywords: ['scene', 'vatex', 'youtube', 'embed', 'describe', 'clip'],
  },
  Appearance: {
    sub: 'Theme and interface size',
    keywords: ['dark', 'light', 'theme', 'text size', 'scale', 'accessibility', 'contrast'],
  },
  Privacy: {
    sub: 'What stays on this machine, and what you can delete',
    keywords: ['telemetry', 'network', 'offline', 'dictionary cache', 'clear', 'backup', 'tracking'],
  },
};

/** Groups whose name or keywords match, in the page's own order. An empty
 * query matches everything. */
export function matchingGroups(query: string): SettingsGroupName[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...SETTINGS_GROUP_ORDER];
  return SETTINGS_GROUP_ORDER.filter((name) => {
    const def = SETTINGS_GROUPS[name];
    return (
      name.toLowerCase().includes(q) ||
      def.sub.toLowerCase().includes(q) ||
      def.keywords.some((k) => k.includes(q))
    );
  });
}
