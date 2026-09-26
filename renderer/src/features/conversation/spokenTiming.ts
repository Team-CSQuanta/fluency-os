/** Deciding which word the voice is on, given where the audio is.
 *
 * Neither TTS engine reports word timings, and forcing an alignment would
 * cost more than the feature is worth. What we have instead is exact: the
 * clip's real duration and its exact text. Distributing the words across that
 * duration by their spoken weight is an estimate, but it is anchored at both
 * ends and re-read from `audio.currentTime` every frame — so it cannot drift,
 * and a stall or a slow chunk moves the highlight with the sound rather than
 * away from it.
 */

/** Roughly how long a word takes to say, relative to other words.
 *
 * Length dominates, but not from zero: even a one-letter word takes time to
 * articulate, so there is a floor. Trailing punctuation buys extra weight
 * because the pause after a comma or a full stop is real time during which no
 * new word is being said — without it every sentence-final word lights up
 * early and the highlight runs ahead of the voice for the rest of the clip. */
export function wordWeight(word: string): number {
  const letters = word.replace(/[^\p{L}\p{N}']/gu, '').length;
  let weight = 1 + letters;
  if (/[,;:]$/.test(word)) weight += 1.5;
  if (/[.!?…]$/.test(word)) weight += 2.5;
  if (/[—–-]$/.test(word)) weight += 1;
  return weight;
}

export interface TimedWord {
  text: string;
  /** Fraction of the clip (0-1) at which this word starts being spoken. */
  start: number;
  /** Fraction of the clip (0-1) at which the next word takes over. */
  end: number;
}

/** Splits a chunk into words, each with the slice of the clip it occupies.
 * Whitespace is kept on the word it follows so re-joining reproduces the
 * original text exactly. */
export function timeWords(chunk: string): TimedWord[] {
  const tokens = chunk.match(/\S+\s*/g) ?? [];
  const weights = tokens.map((t) => wordWeight(t.trim()));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];

  let acc = 0;
  return tokens.map((text, i) => {
    const start = acc / total;
    acc += weights[i];
    return { text, start, end: acc / total };
  });
}

/** How many words of `timed` have been reached at `fraction` through the clip.
 *
 * A word counts as spoken once the voice has *started* it, not once it has
 * finished — highlighting on completion always reads as lagging, because the
 * listener has already heard the word by then. */
export function spokenCount(timed: TimedWord[], fraction: number): number {
  if (fraction <= 0) return 0;
  if (fraction >= 1) return timed.length;
  let n = 0;
  for (const w of timed) {
    if (fraction >= w.start) n += 1;
    else break;
  }
  return n;
}
