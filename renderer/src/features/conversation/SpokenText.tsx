import { useMemo } from 'react';
import { timeWords } from './spokenTiming';

export interface SpeakingState {
  /** Index into `chunks` of the clip currently audible. */
  chunkIndex: number;
  /** How many words of that clip the voice has reached.
   *
   * A word count rather than a 0-1 position, deliberately: the player already
   * has to work out which word is being said, and passing that through means
   * this re-renders once per word instead of once per animation frame. On a
   * four-core machine a 60fps re-render of the whole transcript is a real
   * cost for an effect nobody can see between words. */
  spokenInChunk: number;
}

interface Props {
  text: string;
  /** The exact per-clip split the synthesizer used, from the API. */
  chunks: string[];
  /** Absent when this turn isn't the one being spoken right now. */
  speaking: SpeakingState | null;
}

/** A reply that lights up word by word as the voice reaches each word.
 *
 * Words not yet spoken are dimmed rather than hidden. Hiding them makes the
 * bubble grow line by line, which reflows everything below it on every word
 * and pushes the conversation around while the learner is trying to read —
 * and it takes away the choice to read ahead, which is a real part of
 * following speech in a language you are still learning.
 *
 * Once a turn has finished being spoken it renders as plain text, so old
 * replies in the transcript carry no leftover highlighting. */
export function SpokenText({ text, chunks, speaking }: Props) {
  const timed = useMemo(() => chunks.map((c) => timeWords(c)), [chunks]);

  if (!speaking || chunks.length === 0) {
    return <>{text}</>;
  }

  return (
    <>
      {timed.map((words, chunkIndex) => {
        // Everything before the audible clip has already been said; everything
        // after it has not been started.
        const spoken =
          chunkIndex < speaking.chunkIndex
            ? words.length
            : chunkIndex > speaking.chunkIndex
              ? 0
              : speaking.spokenInChunk;

        return words.map((w, i) => {
          const isSpoken = i < spoken;
          // The word being said right now, rather than merely already said.
          const isCurrent = i === spoken - 1;
          return (
            <span
              key={`${chunkIndex}-${i}`}
              style={{
                color: isSpoken ? 'var(--tx)' : 'var(--tx3)',
                // Only the leading edge is emphasised. Colouring the whole
                // spoken half would turn the bubble into two blocks and lose
                // the one thing this is for: where the voice is right now.
                textShadow: isCurrent ? '0 0 12px var(--accLine)' : undefined,
                transition: 'color 140ms ease-out',
              }}
            >
              {w.text}
            </span>
          );
        });
      })}
    </>
  );
}
