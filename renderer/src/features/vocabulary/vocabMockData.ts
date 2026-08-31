// Ported from claude-ui-mockup-files/FluencyOS.html's vocab section — no
// vocabulary-database backend exists yet (spec §5.1, Rafsan's ownership per §12).

export type VocabStatus = 'active' | 'leech';

export interface VocabRow {
  word: string;
  ipa: string;
  pos: string;
  src: string;
  ctx: number;
  mastery: number;
  due: string;
  status: VocabStatus;
}

export const VOCAB_ROWS: VocabRow[] = [
  { word: 'reticent', ipa: '/ˈretɪsnt/', pos: 'adj', src: 'video', ctx: 3, mastery: 3, due: 'in 12 d', status: 'active' },
  { word: 'stark', ipa: '/stɑːk/', pos: 'adj', src: 'book', ctx: 2, mastery: 2, due: 'in 4 d', status: 'active' },
  { word: 'mitigate', ipa: '/ˈmɪtɪɡeɪt/', pos: 'verb', src: 'conversation', ctx: 4, mastery: 4, due: 'in 47 d', status: 'active' },
  { word: 'ostensibly', ipa: '/ɒˈstensɪbli/', pos: 'adv', src: 'book', ctx: 1, mastery: 1, due: 'today', status: 'active' },
  { word: 'throttle', ipa: '/ˈθrɒtl/', pos: 'noun', src: 'video', ctx: 2, mastery: 2, due: 'in 9 d', status: 'active' },
  { word: 'brackish', ipa: '/ˈbrækɪʃ/', pos: 'adj', src: 'video', ctx: 1, mastery: 0, due: 'today', status: 'active' },
  { word: 'make headway', ipa: '—', pos: 'phrase', src: 'list · IELTS', ctx: 2, mastery: 2, due: 'in 6 d', status: 'active' },
  { word: 'contingent on', ipa: '—', pos: 'phrase', src: 'conversation', ctx: 3, mastery: 3, due: 'in 21 d', status: 'active' },
  { word: 'obfuscate', ipa: '/ˈɒbfəskeɪt/', pos: 'verb', src: 'book', ctx: 5, mastery: 1, due: 'suspended', status: 'leech' },
];

export const MASTERY_COLORS = ['#c0563f', '#c0563f', '#c08a3f', '#c08a3f', 'var(--acc)', 'var(--acc)'];

export const VOCAB_FILTERS = ['All', 'Due today', 'From video', 'From books', 'Phrases', 'Leeches'] as const;

export function matchesVocabFilter(row: VocabRow, filter: string): boolean {
  switch (filter) {
    case 'All':
      return true;
    case 'Due today':
      return row.due === 'today';
    case 'From video':
      return row.src === 'video';
    case 'From books':
      return row.src === 'book';
    case 'Phrases':
      return row.pos === 'phrase';
    case 'Leeches':
      return row.status === 'leech';
    default:
      return true;
  }
}

export const POS_FULL: Record<string, string> = { adj: 'adjective', verb: 'verb', adv: 'adverb', noun: 'noun', phrase: 'phrase' };

export type ContextKind = 'clip' | 'page' | 'turn';

export interface WordDetail {
  cefr: string;
  rank: string;
  entryNo: string;
  retention: string;
  def1: string;
  def2: string;
  contexts: Array<{ kind: ContextKind; snippet: string; src: string }>;
  colls: Array<{ p: string; n: number }>;
  notes: Array<{ text: string; meta: string }>;
  tags: string[];
}

export const WORD_DETAILS: Record<string, WordDetail> = {
  reticent: {
    cefr: 'C1', rank: '18,402', entryNo: '#412', retention: '0.91',
    def1: 'Deliberately withholding information — guarded rather than shy. Neutral to formal register.',
    def2: 'Not revealing one’s thoughts or feelings readily; reserved.',
    contexts: [
      { kind: 'clip', snippet: 'She was reticent about the findings, even with her own team.', src: 'Arrival · 01:14:22' },
      { kind: 'page', snippet: 'The witness remained reticent under cross-examination.', src: 'The Overstory · p.204' },
      { kind: 'turn', snippet: '…I would be reticent about promising a date this early.', src: 'conversation · 12 Aug' },
    ],
    colls: [{ p: 'reticent about', n: 4 }, { p: 'remain reticent', n: 2 }, { p: 'notably reticent', n: 1 }, { p: 'reticent to say', n: 1 }],
    notes: [
      { text: 'Not the same as shy — it is a choice to hold something back. Use for people protecting information.', meta: 'added 14 Aug · from reader highlight' },
      { text: 'Opposite in my writing: "forthcoming". Pairs well with "about".', meta: 'added 22 Aug' },
    ],
    tags: ['IELTS', 'from books', 'formal register'],
  },
  stark: {
    cefr: 'B2', rank: '9,140', entryNo: '#268', retention: '0.88',
    def1: 'Severe and unadorned, or sharply obvious — used for contrasts and bare landscapes.',
    def2: 'Complete; sheer; harsh or desolate in appearance.',
    contexts: [
      { kind: 'clip', snippet: 'The difference between the two readings was stark.', src: 'Arrival · 00:48:10' },
      { kind: 'page', snippet: 'A stark hillside, stripped by the fire.', src: 'The Overstory · p.61' },
      { kind: 'turn', snippet: 'There was a stark gap between what we promised and what shipped.', src: 'conversation · 27 Aug' },
    ],
    colls: [{ p: 'stark contrast', n: 6 }, { p: 'stark difference', n: 3 }, { p: 'stark reminder', n: 2 }, { p: 'stark landscape', n: 1 }],
    notes: [{ text: 'Almost always "stark contrast" in my writing — keep the collocation.', meta: 'added 19 Aug' }],
    tags: ['from video', 'writing'],
  },
  mitigate: {
    cefr: 'B2', rank: '7,806', entryNo: '#331', retention: '0.94',
    def1: 'To make something bad less severe — you mitigate a risk or an effect, not a person.',
    def2: 'Make less severe, serious, or painful.',
    contexts: [
      { kind: 'turn', snippet: 'We added a cache to mitigate the load during launch.', src: 'conversation · 24 Aug' },
      { kind: 'page', snippet: 'Nothing could mitigate the loss of the older trees.', src: 'The Overstory · p.147' },
      { kind: 'clip', snippet: 'Steps taken to mitigate the damage came too late.', src: 'Kurzgesagt · 03:12' },
    ],
    colls: [{ p: 'mitigate the risk', n: 5 }, { p: 'mitigate the impact', n: 4 }, { p: 'mitigate against', n: 1 }],
    notes: [{ text: '"mitigate against" is disputed — I avoid it in exams.', meta: 'added 12 Aug' }],
    tags: ['workplace', 'IELTS'],
  },
  ostensibly: {
    cefr: 'C1', rank: '21,559', entryNo: '#508', retention: '0.72',
    def1: 'Introduces the stated reason while hinting the real one is different — carries quiet doubt.',
    def2: 'Apparently, but perhaps not actually.',
    contexts: [
      { kind: 'page', snippet: 'The team, ostensibly unaware of the discrepancy, continued as before.', src: 'The Overstory · p.112' },
      { kind: 'clip', snippet: 'He was ostensibly there to observe.', src: 'Arrival · 00:22:41' },
    ],
    colls: [{ p: 'ostensibly because', n: 2 }, { p: 'ostensibly neutral', n: 1 }],
    notes: [{ text: 'Due today — I keep reaching for "apparently", which loses the scepticism.', meta: 'added 30 Aug' }],
    tags: ['from books', 'leech watch'],
  },
  throttle: {
    cefr: 'B2', rank: '14,203', entryNo: '#377', retention: '0.85',
    def1: 'The control that limits flow — and by extension any deliberate cap on rate.',
    def2: 'A device controlling the flow of fuel or power; to control or choke.',
    contexts: [
      { kind: 'clip', snippet: 'She eased the throttle forward and the noise dropped.', src: 'Arrival · 01:31:08' },
      { kind: 'turn', snippet: 'We throttle requests at a hundred a minute.', src: 'conversation · 21 Aug' },
    ],
    colls: [{ p: 'at full throttle', n: 3 }, { p: 'throttle requests', n: 2 }],
    notes: [{ text: 'Two lives: engine part and rate limit. My contexts are mostly the second.', meta: 'added 21 Aug' }],
    tags: ['from video', 'workplace'],
  },
  brackish: {
    cefr: 'C1', rank: '27,880', entryNo: '#544', retention: '0.64',
    def1: 'Water that is neither fresh nor properly salt — the estuary in between.',
    def2: 'Slightly salty, as in a river mouth or marsh.',
    contexts: [{ kind: 'clip', snippet: 'Brackish water spread over the lower fields.', src: 'Kurzgesagt · 06:44' }],
    colls: [{ p: 'brackish water', n: 4 }, { p: 'brackish marsh', n: 1 }],
    notes: [{ text: 'New today — one context only, needs a second before it sticks.', meta: 'added 31 Aug' }],
    tags: ['needs audio', 'from video'],
  },
  'make headway': {
    cefr: 'B2', rank: '—', entryNo: '#463', retention: '0.79',
    def1: 'To make visible progress against resistance — slow forward movement, not a finish.',
    def2: 'To advance or progress, especially with difficulty.',
    contexts: [
      { kind: 'turn', snippet: 'We finally started to make headway on the backlog.', src: 'conversation · 18 Aug' },
      { kind: 'page', snippet: 'The expedition made little headway before dark.', src: 'The Overstory · p.288' },
    ],
    colls: [{ p: 'make headway on', n: 3 }, { p: 'little headway', n: 2 }],
    notes: [{ text: 'From my IELTS list, not from reading — find a real context.', meta: 'added 16 Aug' }],
    tags: ['IELTS', 'phrase'],
  },
  'contingent on': {
    cefr: 'C1', rank: '—', entryNo: '#489', retention: '0.58',
    def1: 'Conditional upon something else happening first — the preposition is always "on".',
    def2: 'Dependent on; subject to a condition.',
    contexts: [
      { kind: 'turn', snippet: 'The date is contingent on the budget approval.', src: 'conversation · 29 Aug' },
      { kind: 'page', snippet: 'Their claim was contingent on a survey nobody had ordered.', src: 'The Overstory · p.231' },
    ],
    colls: [{ p: 'contingent on approval', n: 3 }, { p: 'contingent on funding', n: 2 }],
    notes: [{ text: 'I said "contingent to" in the last session — flagged in the report.', meta: 'added 29 Aug · from session report' }],
    tags: ['workplace', 'leech watch', 'phrase'],
  },
  obfuscate: {
    cefr: 'C2', rank: '31,674', entryNo: '#561', retention: '0.41',
    def1: 'To make something deliberately unclear — obscuring on purpose, usually to protect yourself.',
    def2: 'Render obscure, unclear, or unintelligible.',
    contexts: [{ kind: 'page', snippet: 'The report obfuscated more than it explained.', src: 'The Economist · p.44' }],
    colls: [{ p: 'obfuscate the issue', n: 2 }],
    notes: [{ text: 'Suspended as a leech — five lapses. Revisit after "reticent" is solid.', meta: 'added 08 Aug' }],
    tags: ['leech watch', 'formal register'],
  },
};

export const CONTEXT_META: Record<ContextKind, { icon: string; action: string }> = {
  clip: { icon: '▶', action: 'play clip' },
  page: { icon: '¶', action: 'open passage' },
  turn: { icon: '❝', action: 'replay turn' },
};

export const TAG_SUGGESTIONS = ['C1 exam', 'workplace', 'needs audio', 'leech watch', 'phrase'];

export function dueLabelsFor(row: VocabRow): Array<{ n: string; due: string }> {
  return [
    { n: 'recog', due: row.due },
    { n: 'cloze', due: row.due === 'today' ? 'today' : 'in 9 d' },
    { n: 'prod', due: row.status === 'leech' ? 'suspended' : 'in 3 d' },
    { n: 'listen', due: 'new' },
  ];
}
