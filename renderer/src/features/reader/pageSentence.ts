import type { PageWordOut } from '@/types/api';

/** How far either side of a word to look before giving up on a sentence. */
const MAX_WORDS = 60;

/** A box that closes a sentence: the punctuation is attached to the word. */
function endsSentence(text: string): boolean {
  return /[.!?][")'\]]*$/.test(text) && !/\b([A-Z]|[Ff]ig|[Ee]tc|[Ee]\.g|[Ii]\.e|[Nn]o|[Vv]ol)\.$/.test(text);
}

/**
 * The sentence a word sits in, read off the printed page.
 *
 * The page has no sentences — it has boxes, one per whitespace-separated
 * token — so the sentence is walked out from the word until something ends
 * one. Worth the trouble twice over: it is what the AI is given to explain
 * the word *in context*, and it is what gets stored with the word in the
 * vocabulary, where a bare word with no sentence is a flashcard with no
 * memory attached.
 *
 * An initial is not a full stop: "J. Smith" and "Fig. 3" would otherwise cut
 * the sentence in half and hand over a fragment.
 */
export function sentenceAround(words: readonly PageWordOut[], index: number): string {
  if (index < 0 || index >= words.length) return '';

  let start = index;
  while (start > 0 && index - start < MAX_WORDS && !endsSentence(words[start - 1].t)) start -= 1;

  let end = index;
  while (end < words.length - 1 && end - index < MAX_WORDS && !endsSentence(words[end].t)) end += 1;

  return words
    .slice(start, end + 1)
    .map((w) => w.t)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Which box a point on the page falls in, in the layer's own coordinates. */
export function wordAt(words: readonly PageWordOut[], x: number, y: number): number {
  return words.findIndex(
    (w) => x >= w.x - 2 && x <= w.x + w.w + 2 && y >= w.y - 2 && y <= w.y + w.h + 2,
  );
}
