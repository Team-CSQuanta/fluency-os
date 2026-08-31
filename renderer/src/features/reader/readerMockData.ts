// Ported from claude-ui-mockup-files/FluencyOS.html's reader section — no
// local LLM/leveling backend exists yet (spec §4.4 Adaptive Text Leveling).

export const PARAGRAPHS: string[] = [
  'The house had been in the family four generations, and every one of them had left something behind in it — a scar in the banister, a name pencilled inside a cupboard door.',
  'What the survey could not measure was the way the light fell across the yard in October, or why nobody had ever cut down the tree that split the drive in two.',
  'She was reticent about the findings, and the team, ostensibly unaware of the discrepancy, continued as before.',
  'By spring the arguments had ossified into procedure, which is how most disagreements in that family were eventually resolved.',
];

export interface WordAi {
  w: string;
  ipa: string;
  pos: string;
  cefr: string;
  senses: Array<{ def: string; ex: string }>;
  ctx: string;
  syns: string[];
}

// Indexed to match PARAGRAPHS — the word each paragraph's "AI" tab explains.
export const PARAGRAPH_AI: WordAi[] = [
  {
    w: 'banister',
    ipa: '/ˈbanɪstə/',
    pos: 'noun',
    cefr: 'B2',
    senses: [{ def: 'the handrail on the side of a staircase', ex: 'She ran her hand along the banister.' }],
    ctx: 'Here it stands for the physical traces four generations left in the house — a scratched handrail as family memory.',
    syns: ['handrail', 'railing', 'balustrade'],
  },
  {
    w: 'survey',
    ipa: '/ˈsɜːveɪ/',
    pos: 'noun',
    cefr: 'B1',
    senses: [
      { def: 'an official inspection or measurement of land or a building', ex: 'The survey found damp in the walls.' },
      { def: 'a set of questions asked of many people', ex: 'We ran a survey of readers.' },
    ],
    ctx: 'The first sense: a professional inspection of the property — which records measurements but not atmosphere.',
    syns: ['inspection', 'assessment', 'appraisal'],
  },
  {
    w: 'reticent',
    ipa: '/ˈretɪsnt/',
    pos: 'adjective',
    cefr: 'C1',
    senses: [
      { def: 'unwilling to speak freely about something', ex: 'He was reticent about his early life.' },
      { def: 'reserved in manner', ex: 'A reticent, watchful guest.' },
    ],
    ctx: 'She had results she would not discuss — deliberately silent rather than merely shy.',
    syns: ['reserved', 'guarded', 'tight-lipped', 'withdrawn'],
  },
  {
    w: 'ossified',
    ipa: '/ˈɒsɪfaɪd/',
    pos: 'verb · past',
    cefr: 'C2',
    senses: [
      { def: 'turned into bone', ex: 'The cartilage had ossified.' },
      { def: 'became rigid and unable to change', ex: 'The rules had ossified over decades.' },
    ],
    ctx: 'Figurative second sense: the arguments hardened into fixed routine instead of being resolved.',
    syns: ['hardened', 'set', 'fossilised', 'rigidified'],
  },
];

export type LevelMode = 'inline' | 'lexical' | 'contextual' | 'semantic';

export interface LeveledText {
  // Rendered as: before + [sub1 underlined] + mid + [sub2 underlined] + after
  before: string;
  sub1: string;
  mid: string;
  sub2: string;
  after: string;
  origSub1?: string;
  origSub2?: string;
}

// Indexed to match PARAGRAPHS, one entry per LevelMode.
export const PARAGRAPH_LEVELS: Record<LevelMode, LeveledText>[] = [
  {
    inline: { before: 'The house had been in the family four ', sub1: 'lifetimes', mid: ', and every one of them had left something behind in it — a ', sub2: 'mark', after: ' in the banister, a name pencilled inside a cupboard door.', origSub1: 'generations', origSub2: 'scar' },
    lexical: { before: 'Four ', sub1: 'families in a row', mid: ' had lived in the house, and each left a trace — a ', sub2: 'dent', after: ' in the stair rail, a name written inside a cupboard door.', origSub1: 'generations', origSub2: 'scar' },
    contextual: { before: 'The house had belonged to the family for four generations. Every one of them left something behind: a ', sub1: 'mark', mid: ' on the stair rail, a name written inside a cupboard door.', sub2: '', after: '', origSub1: 'scar' },
    semantic: { before: 'Plain meaning: four generations of the family lived in this house, and each left small physical traces of themselves.', sub1: '', mid: '', sub2: '', after: '' },
  },
  {
    inline: { before: 'What the survey could not ', sub1: 'record', mid: ' was the way the light fell across the yard in October, or why nobody had ever cut down the tree that ', sub2: 'divided', after: ' the drive in two.', origSub1: 'measure', origSub2: 'split' },
    lexical: { before: 'The survey ', sub1: 'missed things', mid: ': how the light fell across the yard in October, and why nobody had ever cut down the tree ', sub2: 'standing in the middle of', after: ' the drive.', origSub1: 'could not measure', origSub2: 'that split' },
    contextual: { before: 'The survey could not record everything. It missed the October light on the yard, and it never explained why nobody cut down the tree in the middle of the drive.', sub1: '', mid: '', sub2: '', after: '' },
    semantic: { before: 'Plain meaning: official measurements leave out the things people actually notice and care about.', sub1: '', mid: '', sub2: '', after: '' },
  },
  {
    inline: { before: 'She was ', sub1: 'quiet', mid: ' about the findings, and the team, ', sub2: 'apparently', after: ' unaware of the difference, continued as before.', origSub1: 'reticent', origSub2: 'ostensibly' },
    lexical: { before: 'She said ', sub1: 'very little', mid: ' about the results, and the team, ', sub2: 'seemingly', after: ' in the dark about the difference, kept going as before.', origSub1: 'reticent', origSub2: 'ostensibly' },
    contextual: { before: 'She would not talk about the results. The team, ', sub1: 'who seemed not to know about the difference', mid: ', kept working as before.', sub2: '', after: '', origSub1: 'reticent' },
    semantic: { before: 'Plain meaning: she hid her results, and her colleagues did not realise anything was wrong.', sub1: '', mid: '', sub2: '', after: '' },
  },
  {
    inline: { before: 'By spring the arguments had ', sub1: 'hardened', mid: ' into procedure, which is how most ', sub2: 'disputes', after: ' in that family were eventually settled.', origSub1: 'ossified', origSub2: 'disagreements' },
    lexical: { before: 'By spring the arguments had ', sub1: 'turned into fixed rules', mid: ', which is how most ', sub2: 'quarrels', after: ' in that family ended.', origSub1: 'ossified into procedure', origSub2: 'disagreements' },
    contextual: { before: 'By spring the arguments had become fixed rules. That was how most ', sub1: 'family quarrels', mid: ' were settled in the end.', sub2: '', after: '', origSub1: 'disagreements' },
    semantic: { before: 'Plain meaning: instead of resolving arguments, the family turned them into rules and moved on.', sub1: '', mid: '', sub2: '', after: '' },
  },
];

export const MODE_HEADLINES: Record<LevelMode, string> = {
  inline: 'Inline simplification · 2 words replaced',
  lexical: 'Lexical substitution · idiom replaced',
  contextual: 'Contextual rewrite · B1 · sentence split',
  semantic: 'Semantic filter · gloss beside original',
};

export const LEVEL_MODES: Array<{ key: LevelMode; label: string; tag: string }> = [
  { key: 'inline', label: 'Inline simplification', tag: 'light' },
  { key: 'lexical', label: 'Lexical substitution', tag: 'idioms' },
  { key: 'contextual', label: 'Contextual rewrite', tag: 'B1' },
  { key: 'semantic', label: 'Semantic filter', tag: 'gloss' },
];

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#E3C14A',
  green: '#7FA86B',
  blue: '#6E93C4',
  pink: '#C97BA0',
};

export const TOC: Array<{ label: string; page: string }> = [
  { label: '1 · Roots', page: '3' },
  { label: '2 · The Seed Vault', page: '41' },
  { label: '3 · What the Rings Say', page: '78' },
  { label: '4 · The Weight of Small Words', page: '112' },
  { label: '5 · Crown Shyness', page: '160' },
  { label: '6 · Trunk', page: '198' },
  { label: '7 · Understory', page: '241' },
  { label: '8 · Canopy', page: '286' },
  { label: '9 · Seeds', page: '318' },
];

export const SEARCH_HITS: Array<{ snippet: string; loc: string }> = [
  { snippet: 'She was …reticent… about the findings, even with her own team.', loc: 'p.112 · chapter 4' },
  { snippet: 'a …reticent… man by nature, he wrote instead', loc: 'p.147 · chapter 4' },
  { snippet: 'their …reticence… hardened into policy', loc: 'p.203 · chapter 6' },
  { snippet: 'no longer …reticent…, she published everything', loc: 'p.259 · chapter 7' },
  { snippet: '…reticent… only about the one thing that mattered', loc: 'p.301 · chapter 8' },
];

export const BOOKMARKS: Array<{ label: string; loc: string }> = [
  { label: '"the arguments had ossified into procedure"', loc: 'p.118 · added Tue' },
  { label: 'Start of chapter 5', loc: 'p.160 · added Sun' },
  { label: '"crown shyness" — look up later', loc: 'p.166 · added Sun' },
  { label: 'Passage to re-read aloud', loc: 'p.203 · added 12 Aug' },
];

export const EXISTING_HIGHLIGHTS: Array<{ text: string; color: string; note: string; loc: string }> = [
  { text: 'She was reticent about the findings', color: HIGHLIGHT_COLORS.yellow, note: 'saved → vocabulary: reticent', loc: 'p.112' },
  { text: 'ostensibly unaware of the discrepancy', color: HIGHLIGHT_COLORS.blue, note: 'leveled → "seemingly did not know"', loc: 'p.112' },
  { text: 'the arguments had ossified into procedure', color: HIGHLIGHT_COLORS.green, note: '', loc: 'p.118' },
  { text: 'crown shyness', color: HIGHLIGHT_COLORS.pink, note: 'trees avoid touching — good metaphor', loc: 'p.166' },
];
