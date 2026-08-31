// Ported from claude-ui-mockup-files/FluencyOS.html's lookups() — no local
// LLM/dictionary backend exists yet (spec §4.5 Contextual AI Extraction).

export interface WordLookup {
  word: string;
  ipa: string;
  pos: string;
  cefr: string;
  dict: string;
  ai: string;
  para: string;
  tags: string[];
  ex1: string;
  ex2: string;
  colls: string[];
}

export const LOOKUPS: Record<string, WordLookup> = {
  reticent: {
    word: 'reticent',
    ipa: '/ˈretɪsnt/',
    pos: 'adj',
    cefr: 'C1',
    dict: 'Not revealing one’s thoughts or feelings readily; reserved.',
    ai: 'Here it does not mean shy. Louise is deliberately withholding technical findings from colleagues she does not yet trust — professional caution, close to "guarded".',
    para: 'She kept her results to herself, even from her own team.',
    tags: ['neutral register', 'literal', 'C1', 'about + noun'],
    ex1: 'He was reticent about why he had left the company.',
    ex2: 'She gave a reticent nod and said nothing more.',
    colls: ['reticent about', 'notably reticent', 'remain reticent'],
  },
  findings: {
    word: 'findings',
    ipa: '/ˈfaɪndɪŋz/',
    pos: 'noun pl',
    cefr: 'B2',
    dict: 'The results of an investigation or inquiry.',
    ai: 'In this scene it means her research results specifically — the plural is fixed in academic and scientific English; "finding" singular would be wrong here.',
    para: 'She kept her results to herself, even from her own team.',
    tags: ['technical', 'literal', 'B2', 'plural only'],
    ex1: 'The findings were published last month.',
    ex2: 'Our findings contradict the earlier study.',
    colls: ['publish findings', 'preliminary findings', 'the findings suggest'],
  },
  even: {
    word: 'even with',
    ipa: '/ˈiːvən wɪð/',
    pos: 'phrase',
    cefr: 'B1',
    dict: 'Used to stress that something is surprising or unexpected.',
    ai: 'A concessive marker: it signals that her own team was the least expected group to be excluded. Selected as a multi-word phrase, so it is stored as a phrase entry, not two words.',
    para: 'She kept her results to herself, even from her own team.',
    tags: ['neutral', 'figurative', 'B1', 'concessive'],
    ex1: 'Even with the map, we got lost.',
    ex2: 'She stayed calm, even with everyone shouting.',
    colls: ['even with', 'even so', 'even then'],
  },
};

export function lookupFor(word: string): WordLookup {
  return (
    LOOKUPS[word] ?? {
      word,
      ipa: '/…/',
      pos: '—',
      cefr: '—',
      dict: 'No dictionary entry cached for this token — WordNet lookup queued.',
      ai: `Contextual explanation for "${word}" as used in this cue would render here, generated locally in ≈2 s.`,
      para: '',
      tags: [],
      ex1: '',
      ex2: '',
      colls: [],
    }
  );
}

export const CUE_TEXT = 'She was reticent about the findings, even with her own team.';
export const CUE_TRANSLATION = 'তিনি তার আবিষ্কার নিয়ে চুপচাপ ছিলেন, নিজের দলের সাথেও।';

export function cleanToken(raw: string): string {
  return raw.replace(/[^a-zA-Z']/g, '').toLowerCase();
}
