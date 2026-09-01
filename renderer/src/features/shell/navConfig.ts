// Ported from claude-ui-mockup-files/FluencyOS.html's nav() and titles().
export type ScreenKey =
  | 'dashboard'
  | 'library'
  | 'player'
  | 'bookshelf'
  | 'reader'
  | 'vocab'
  | 'word'
  | 'review'
  | 'graph'
  | 'conv'
  | 'convlive'
  | 'report'
  | 'challenge'
  | 'forest'
  | 'settings';

export interface NavItem {
  key: ScreenKey;
  label: string;
  badge?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Learn',
    items: [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'library', label: 'Learn by watching' },
      { key: 'bookshelf', label: 'Learn by reading' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { key: 'vocab', label: 'Vocabulary' },
      { key: 'review', label: 'Review', badge: '47' },
      { key: 'graph', label: 'Knowledge Graph' },
    ],
  },
  {
    label: 'Practise',
    items: [
      { key: 'conv', label: 'Conversation' },
      { key: 'challenge', label: 'Scene Challenge' },
    ],
  },
  { label: 'Grow', items: [{ key: 'forest', label: 'Forest' }] },
  { label: 'System', items: [{ key: 'settings', label: 'Settings' }] },
];

export const SCREEN_TITLES: Record<ScreenKey, [string, string]> = {
  dashboard: ['Dashboard', 'What is due, how you are trending, what to do next'],
  library: ['Learn by watching', 'Your content library · nothing is uploaded, everything stays on this machine'],
  player: ['Learn by watching', 'dual subtitles · clip context engine armed'],
  bookshelf: ['Learn by reading', 'Your bookshelf · adaptive text leveling · reading counts toward your daily goal'],
  reader: ['Learn by reading', 'adaptive text leveling · B1 target'],
  vocab: ['Vocabulary', 'Every word you have captured, with its contexts and cards'],
  word: ['Vocabulary entry', 'notes, contexts, pronunciation and tags'],
  review: ['Review', 'FSRS v4 · target retention 0.90 · interleaved queue'],
  graph: ['Knowledge Graph', 'Same layout as the forest · semantic clustering'],
  conv: ['Conversation', 'Guided AI practice with target words injected'],
  convlive: ['Conversation', 'Guided AI practice with target words injected'],
  report: ['Session Report', 'Contextual accuracy, fluency proxies, and a focus for next time'],
  challenge: ['Scene Description Challenge', 'Timed production against your own clips'],
  forest: ['Forest', 'Every vocabulary entry, growing'],
  settings: ['Settings', 'Local-first by default · nothing leaves the machine'],
};
