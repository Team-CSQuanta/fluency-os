/** Splitting a subtitle cue into selectable tokens.
 *
 * Kept apart from the component because getting this wrong is invisible and
 * expensive: if punctuation travels with a word, every lookup for a word that
 * ends a sentence searches for "findings." and misses.
 */

export interface Token {
  /** Exactly as it appears on screen, punctuation and all. */
  raw: string;
  /** What a dictionary should be asked about. Empty for pure punctuation. */
  clean: string;
  /** Whether this token can be clicked — spacing and stray punctuation cannot. */
  selectable: boolean;
}

// Apostrophes and hyphens are word-internal in English ("don't", "well-read"),
// so they survive; everything else around the edges is stripped.
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export function tokenize(text: string): Token[] {
  return text.split(/(\s+)/).map((raw) => {
    if (/^\s+$/.test(raw) || raw === '') {
      return { raw, clean: '', selectable: false };
    }
    const clean = raw.replace(EDGE_PUNCTUATION, '');
    return { raw, clean, selectable: clean.length > 0 };
  });
}

/** The lookup string for a span of tokens.
 *
 * A dragged phrase keeps its internal punctuation but loses the punctuation at
 * either end, so selecting «reticent about the findings.» searches for
 * "reticent about the findings" — which is what the learner meant and what a
 * dictionary can answer.
 */
export function selectionText(tokens: Token[], from: number, to: number): string {
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return tokens
    .slice(lo, hi + 1)
    .map((t) => t.raw)
    .join('')
    .replace(EDGE_PUNCTUATION, '')
    .trim();
}

/** Whether an index falls inside the current selection, for highlighting. */
export function inSelection(index: number, from: number | null, to: number | null): boolean {
  if (from === null || to === null) return false;
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return index >= lo && index <= hi;
}
