// Part-of-speech display labels — the one piece of the old mock module still
// used now that Vocabulary reads from the real backend (see
// store/vocabularyStore.ts and routers/vocabulary.py). Kept here rather than
// duplicated inline since VocabularyEntry.tsx is the only consumer.
export const POS_FULL: Record<string, string> = {
  adj: 'adjective',
  verb: 'verb',
  adv: 'adverb',
  noun: 'noun',
  phrase: 'phrase',
};
