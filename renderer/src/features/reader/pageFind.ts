import type { PageWordOut, SnippetSegmentOut } from '@/types/api';

/* Words, as both the search index and the page's text layer understand them:
 * runs of letters or digits. Splitting this way is what lets a match inside
 * "state_us_abbreviation" light up, and what stops "us" from lighting up
 * every "because" on the page. */
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

function tokens(text: string): string[] {
  return [...text.toLowerCase().matchAll(TOKEN_RE)].map((m) => m[0]);
}

/**
 * What a search hit actually matched, taken from the hit itself rather than
 * from the box the reader typed in.
 *
 * The two are not the same: the index stems, so a search for "using" comes
 * back matching "us" in one hit and "using" in another. Highlighting the
 * typed word would leave half the hits looking like misses.
 */
export function termsFromSnippet(snippet: readonly SnippetSegmentOut[]): string[] {
  const terms = new Set<string>();
  for (const segment of snippet) {
    if (!segment.matched) continue;
    for (const token of tokens(segment.text)) terms.add(token);
  }
  return [...terms];
}

/** Which of a page's boxes contain one of the terms, in reading order. */
export function matchingWordIndices(
  words: readonly PageWordOut[],
  terms: readonly string[],
): number[] {
  if (terms.length === 0) return [];
  // Lowered here rather than trusted from the caller: the page's tokens are
  // lowered to compare them, so a term that is not would never match.
  const wanted = new Set(terms.map((t) => t.toLowerCase()));
  const out: number[] = [];
  words.forEach((word, index) => {
    if (tokens(word.t).some((token) => wanted.has(token))) out.push(index);
  });
  return out;
}
