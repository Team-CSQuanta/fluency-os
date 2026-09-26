import type { PageWordOut, SnippetSegmentOut } from '@/types/api';

/* Runs of letters or digits: enough to match inside
 * "state_us_abbreviation" without lighting up every "because". */
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

function tokens(text: string): string[] {
  return [...text.toLowerCase().matchAll(TOKEN_RE)].map((m) => m[0]);
}

/**
 * What a hit actually matched, which is not what was typed: the index stems,
 * so "using" comes back matching "us" in one hit and "using" in another.
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
