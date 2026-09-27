import { describe, expect, it } from 'vitest';
import { sentenceAround, wordAt } from '@/features/reader/pageSentence';
import { matchingWordIndices, termsFromSnippet } from '@/features/reader/pageFind';
import { buildTocRows, isTocRowVisible } from '@/features/reader/tocTree';
import type { ChapterOut, PageWordOut } from '@/types/api';

/** Lays words out left to right on one line, 50 units apart. */
function page(text: string): PageWordOut[] {
  return text.split(' ').map((t, i) => ({ t, x: i * 50, y: 100, w: 40, h: 12, ln: 0 }));
}

describe('pageSentence — the sentence around a word in a PDF', () => {
  const words = page('It rained all day. The harbour was quiet. We went home early.');

  it('returns only the sentence the word is in', () => {
    const index = words.findIndex((w) => w.t === 'harbour');
    expect(sentenceAround(words, index)).toBe('The harbour was quiet.');
  });

  it('does not treat an initial or "Fig." as the end of a sentence', () => {
    const w = page('The study by J. Smith is shown in Fig. 3 below. Next sentence.');
    const index = w.findIndex((x) => x.t === 'shown');
    expect(sentenceAround(w, index)).toBe('The study by J. Smith is shown in Fig. 3 below.');
  });

  it('returns nothing for an index off the page', () => {
    expect(sentenceAround(words, -1)).toBe('');
    expect(sentenceAround(words, words.length)).toBe('');
  });

  it('finds which word a click landed on', () => {
    expect(wordAt(words, 55, 105)).toBe(1);
    expect(wordAt(words, 55, 500)).toBe(-1);
  });
});

describe('pageFind — highlighting search hits on a page', () => {
  it('takes the matched terms from a search snippet, lower-cased and de-duplicated', () => {
    const terms = termsFromSnippet([
      { text: 'the ', matched: false },
      { text: 'Harbour', matched: true },
      { text: ' and the ', matched: false },
      { text: 'harbour', matched: true },
    ]);
    expect(terms).toEqual(['harbour']);
  });

  it('highlights whole-word matches only', () => {
    const words = page('Because the harbour, harbours and us.');
    expect(matchingWordIndices(words, ['us', 'harbour'])).toEqual([2, 5]);
  });

  it('highlights nothing when there are no terms', () => {
    expect(matchingWordIndices(page('anything'), [])).toEqual([]);
  });
});

describe('tocTree — the book contents panel', () => {
  const chapter = (id: string, depth: number): ChapterOut => ({
    id,
    depth,
    order_index: 0,
    label: id,
    start_block: 0,
    page: 1,
  });
  const toc = [chapter('part1', 0), chapter('ch1', 1), chapter('sec1', 2), chapter('ch2', 1), chapter('part2', 0)];

  it('knows which entries open to show more', () => {
    expect(buildTocRows(toc).map((r) => r.hasChildren)).toEqual([true, true, false, false, false]);
  });

  it('hides a section until every chapter above it is open', () => {
    const sec1 = buildTocRows(toc)[2];
    expect(sec1.ancestors.sort()).toEqual(['ch1', 'part1']);
    expect(isTocRowVisible(sec1, new Set(['part1']))).toBe(false);
    expect(isTocRowVisible(sec1, new Set(['part1', 'ch1']))).toBe(true);
  });

  it('keeps an entry reachable even when a scanned book skips a level', () => {
    const rows = buildTocRows([chapter('a', 0), chapter('deep', 3)]);
    expect(rows[1].ancestors).toEqual(['a']);
  });
});
