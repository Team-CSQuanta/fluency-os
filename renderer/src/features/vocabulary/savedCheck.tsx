import { useEffect, useState } from 'react';
import { useVocabularyStore } from '@/store/vocabularyStore';
import type { VocabCheckOut } from '@/types/api';

/** Whether a word being looked up is already saved, and which of the
 * meanings on screen it already has.
 *
 * Every "save this word" panel asks this before the learner saves, so the
 * button can say what saving will actually do — before, the only way to find
 * out was to press it and read the message afterwards. `refresh` is bumped
 * after a save, so the answer follows the entry it just changed.
 */
export function useSavedCheck(
  word: string | null | undefined,
  definitions: string[],
  refresh = 0,
): VocabCheckOut | null {
  const checkSaved = useVocabularyStore((s) => s.checkSaved);
  const [out, setOut] = useState<VocabCheckOut | null>(null);
  // By value: callers build the list fresh on every render.
  const key = JSON.stringify(definitions);

  useEffect(() => {
    const term = word?.trim();
    if (!term) {
      setOut(null);
      return;
    }
    let live = true;
    setOut(null);
    checkSaved(term, JSON.parse(key) as string[])
      .then((r) => live && setOut(r))
      // Only a hint: a panel that cannot ask still saves exactly as before.
      .catch(() => live && setOut(null));
    return () => {
      live = false;
    };
  }, [word, key, refresh, checkSaved]);

  return out;
}

/** What saving would do with the meaning at `index`.
 *
 *   new-word    — not saved yet
 *   same        — saved with this meaning: reading or watching adds the
 *                 sentence or clip to it; adding by hand has nothing to add
 *   new-meaning — saved, but not with this meaning: it is added to the entry
 */
export type SaveIntent = 'new-word' | 'same' | 'new-meaning';

export function saveIntent(check: VocabCheckOut | null, index: number): SaveIntent {
  if (!check?.saved) return 'new-word';
  return check.known[index] ? 'same' : 'new-meaning';
}

/** "In your vocabulary · 2 meanings · 5 sentences & clips", under the word. */
export function SavedStatus({ check }: { check: VocabCheckOut | null }) {
  if (!check?.saved) return null;
  const meanings = `${check.sense_count} meaning${check.sense_count === 1 ? '' : 's'}`;
  const contexts = `${check.context_count} sentence${check.context_count === 1 ? '' : 's'} & clips`;
  return (
    <div
      className="mt-[5px] inline-flex items-center gap-[6px] rounded-full border border-accLine bg-accSoft px-[8px] py-[2px] font-mono text-[9.5px] text-acc"
      title="Already saved — saving again adds to this entry rather than making a second one"
    >
      ✓ in your vocabulary · {meanings} · {contexts}
    </div>
  );
}

/** The small mark beside a meaning the saved entry already has. */
export function KnownMark() {
  return (
    <span
      className="ml-[6px] whitespace-nowrap rounded-full bg-accSoft px-[6px] py-[1px] font-mono text-[9px] text-acc"
      title="This meaning is already saved"
    >
      ✓ saved
    </span>
  );
}
