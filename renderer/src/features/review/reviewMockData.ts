// Ported from claude-ui-mockup-files/FluencyOS.html's review section — no
// FSRS scheduler backend exists yet (spec §5.5, Rafsan's ownership per §12).

export type CardType = 'cloze' | 'recognition' | 'production' | 'listening';

export interface ReviewCard {
  cardType: CardType;
  // Cloze fronts render as before/blank/after; other types just use `front`.
  before?: string;
  after?: string;
  front?: string;
  word: string;
  ipa: string;
  pos: string;
  cefr: string;
  definition: string;
  translation: string;
  clipSource: string;
  clipStamp: string;
  stability: string;
  nextStability: string;
  difficulty: string;
  reps: number;
  lapses: number;
  spontaneousUses: number;
  mastery: number;
}

export const REVIEW_QUEUE: ReviewCard[] = [
  {
    cardType: 'cloze',
    before: 'She was',
    after: 'about the findings, even with her own team.',
    word: 'reticent',
    ipa: '/ˈretɪsnt/',
    pos: 'adj',
    cefr: 'C1',
    definition: 'Unwilling to say much about something — holding back rather than being shy. Here it marks deliberate professional caution, not timidity.',
    translation: 'তিনি চুপচাপ ছিলেন',
    clipSource: 'Arrival · 01:14:22',
    clipStamp: 'loop ⟲',
    stability: '21.4 d',
    nextStability: '47.9 d if Good',
    difficulty: '5.2',
    reps: 6,
    lapses: 1,
    spontaneousUses: 2,
    mastery: 3,
  },
  {
    cardType: 'recognition',
    front: 'stark',
    word: 'stark',
    ipa: '/stɑːk/',
    pos: 'adj',
    cefr: 'B2',
    definition: 'Severe and unadorned, or sharply obvious — used for contrasts and bare landscapes.',
    translation: 'সুস্পষ্ট, একেবারে খালি',
    clipSource: 'Arrival · 00:48:10',
    clipStamp: 'loop ⟲',
    stability: '14.2 d',
    nextStability: '31.0 d if Good',
    difficulty: '4.6',
    reps: 4,
    lapses: 0,
    spontaneousUses: 1,
    mastery: 2,
  },
  {
    cardType: 'production',
    front: 'To make something bad less severe — you ___ a risk or an effect, not a person.',
    word: 'mitigate',
    ipa: '/ˈmɪtɪɡeɪt/',
    pos: 'verb',
    cefr: 'B2',
    definition: 'Make less severe, serious, or painful.',
    translation: 'প্রশমিত করা',
    clipSource: 'conversation · 24 Aug',
    clipStamp: 'replay ▶',
    stability: '61.0 d',
    nextStability: '118 d if Good',
    difficulty: '3.1',
    reps: 9,
    lapses: 0,
    spontaneousUses: 4,
    mastery: 4,
  },
  {
    cardType: 'listening',
    front: '▶ audio only',
    word: 'ostensibly',
    ipa: '/ɒˈstensɪbli/',
    pos: 'adv',
    cefr: 'C1',
    definition: 'Introduces the stated reason while hinting the real one is different — carries quiet doubt.',
    translation: 'আপাতদৃষ্টিতে',
    clipSource: 'The Overstory · p.112',
    clipStamp: 'open passage ¶',
    stability: '3.8 d',
    nextStability: '9.2 d if Good',
    difficulty: '6.4',
    reps: 2,
    lapses: 1,
    spontaneousUses: 0,
    mastery: 1,
  },
];

export const RATINGS: Array<{ label: string; interval: string; note: string }> = [
  { label: 'Again', interval: '<10 m', note: 'relearning' },
  { label: 'Hard', interval: '6 d', note: 'shortened' },
  { label: 'Good', interval: '48 d', note: 'normal' },
  { label: 'Easy', interval: '92 d', note: 'stability +' },
];
