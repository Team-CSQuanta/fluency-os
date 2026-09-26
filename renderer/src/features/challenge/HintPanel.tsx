import { useState } from 'react';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type { AgreedWordOut, DictionarySearchOut, HintsOut, SceneWordOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

/** Hints, and what they cost.
 *
 * The two sources have completely different help available. A **library** clip
 * has the learner's own due words in it, and those are named outright — they
 * are the point of the round, and a learner who cannot remember them learns
 * nothing from being made to struggle silently.
 *
 * A **VATEX** scene has ten people's descriptions of exactly what is on screen,
 * which is the answer. So it is released in tiers at a stated price: the words
 * most describers reached for, then the details a few noticed, then one whole
 * description. The price is shown on the button BEFORE it is pressed — a hint
 * you are charged for after the fact is a trap, not a hint.
 */
export function HintPanel({
  hints,
  vatex,
  onAsk,
}: {
  hints: HintsOut | null;
  vatex: boolean;
  onAsk: (level?: number) => void;
}) {
  if (!hints) {
    return (
      <button
        onClick={() => onAsk(vatex ? 1 : undefined)}
        className="w-full rounded-field border border-line px-[13px] py-[10px] font-sans text-[12px] font-medium text-tx2 transition-colors hover:border-acc hover:text-acc"
      >
        {vatex ? 'Stuck? Reveal a hint · costs 4 points' : 'Stuck? Show me some words'}
      </button>
    );
  }

  if (vatex) return <CaptionHints hints={hints} onAsk={onAsk} />;

  return (
    <div className="flex flex-col gap-[12px]">
      {hints.target_words.length > 0 && (
        <div>
          <Label>words to reach for</Label>
          <div className="mt-[6px] flex flex-wrap gap-[5px]">
            {hints.target_words.map((word) => (
              <span
                key={word}
                className="rounded-full border border-accLine bg-accSoft px-[10px] py-[4px] font-sans text-[11.5px] font-medium text-acc"
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <Label>useful for describing a scene</Label>
        <p className="mt-[4px] font-mono text-[9.5px] leading-[1.6] text-tx3">
          from 30,000 human descriptions of video clips · tap a new word for its meaning
        </p>
        <div className="mt-[7px] flex flex-wrap gap-[5px]">
          {hints.scene_words.map((word) => (
            <SceneWordChip key={word.word} entry={word} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The graded reveal for a VATEX scene, built from the ten descriptions. */
function CaptionHints({ hints, onAsk }: { hints: HintsOut; onAsk: (level: number) => void }) {
  const spent = hints.penalty;
  return (
    <div className="flex flex-col gap-[13px]">
      <div className="flex items-baseline justify-between">
        <Label>
          hint {hints.level} of {hints.max_level}
        </Label>
        <span className="font-mono text-[9.5px] text-[#e0a86c]">−{spent} points so far</span>
      </div>

      {hints.consensus_words.length > 0 && (
        <div>
          <Label>what most describers mentioned</Label>
          <p className="mt-[4px] font-mono text-[9.5px] leading-[1.6] text-tx3">
            the words, not the scene — you still have to say what happened
          </p>
          <div className="mt-[7px] flex flex-wrap gap-[5px]">
            {hints.consensus_words.map((w) => (
              <AgreedChip key={w.word} entry={w} total={hints.describer_count} />
            ))}
          </div>
        </div>
      )}

      {hints.detail_words.length > 0 && (
        <div>
          <Label>details a few of them noticed</Label>
          <div className="mt-[7px] flex flex-wrap gap-[5px]">
            {hints.detail_words.map((w) => (
              <AgreedChip key={w.word} entry={w} total={hints.describer_count} muted />
            ))}
          </div>
        </div>
      )}

      {hints.example_caption && (
        <div>
          <Label>one of the ten, in full</Label>
          <p className="mt-[6px] rounded-field border border-line2 bg-panel2 p-[11px] font-sans text-[12.5px] leading-[1.6] text-tx">
            “{hints.example_caption}”
          </p>
          <p className="mt-[5px] font-mono text-[9.5px] text-tx3">
            the most typical of the ten — the one sharing most vocabulary with the rest
          </p>
        </div>
      )}

      {hints.next_penalty !== null && (
        <button
          onClick={() => onAsk(hints.level + 1)}
          className="w-full rounded-field border border-line px-[13px] py-[9px] font-sans text-[11.5px] font-medium text-tx2 transition-colors hover:border-acc hover:text-acc"
        >
          {hints.level === 1 ? 'Show the smaller details' : 'Show me one whole description'}
          <span className="ml-[6px] font-mono text-[10px] text-[#e0a86c]">
            −{hints.next_penalty} total
          </span>
        </button>
      )}
    </div>
  );
}

/** A reference word with how many of the ten describers used it. The count is
 * the interesting part: a word nine people used is the spine of the scene, one
 * two people used is a detail worth adding. */
function AgreedChip({
  entry,
  total,
  muted = false,
}: {
  entry: AgreedWordOut;
  total: number;
  muted?: boolean;
}) {
  return (
    <span
      title={`${entry.describers} of ${total} people who watched this used this word`}
      className="flex items-center gap-[6px] rounded-full border px-[10px] py-[4px] font-sans text-[11.5px]"
      style={{
        borderColor: muted ? 'var(--line2)' : 'var(--accLine)',
        background: muted ? 'transparent' : 'var(--accSoft)',
        color: muted ? 'var(--tx2)' : 'var(--acc)',
      }}
    >
      {entry.word}
      <span className="font-mono text-[9px] opacity-70">{entry.describers}/{total}</span>
    </span>
  );
}

function SceneWordChip({ entry }: { entry: SceneWordOut }) {
  const userId = useAppStore((s) => s.currentUserId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DictionarySearchOut | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expand = async () => {
    if (entry.known) return;
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (result) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.get<DictionarySearchOut>(`/vocabulary/dictionary-search?w=${encodeURIComponent(entry.word)}`));
    } catch (err) {
      setError(friendlyMessage(err, 'Looking that up'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!userId || !result) return;
    setBusy(true);
    try {
      await api.post('/vocabulary/manual', {
        user_id: userId,
        word: result.word,
        pos: result.senses[0]?.pos ?? '',
        definition: result.senses[0]?.definition ?? '',
        example: result.senses[0]?.example ?? null,
        synonyms: result.synonyms.slice(0, 6),
        ipa: result.ipa,
        audio_url: result.audio_url,
      });
      setSaved(true);
    } catch (err) {
      setError(friendlyMessage(err, 'Saving this word'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col">
      <button
        onClick={() => void expand()}
        title={entry.known ? 'already in your vocabulary' : 'tap for its meaning'}
        className="flex items-center gap-[5px] rounded-full border px-[10px] py-[4px] font-sans text-[11.5px]"
        style={{
          borderColor: entry.known ? 'var(--line2)' : 'var(--line)',
          background: entry.known ? 'transparent' : 'var(--panel2)',
          color: entry.known ? 'var(--tx3)' : 'var(--tx)',
          cursor: entry.known ? 'default' : 'pointer',
        }}
      >
        {entry.word}
        <span className="font-mono text-[9px] opacity-60">{entry.cefr}</span>
        {!entry.known && <span className="font-mono text-[9px] text-acc">new</span>}
      </button>

      {open && (
        <span className="mt-[5px] max-w-[260px] rounded-field border border-line2 bg-panel p-[9px]">
          {busy && <span className="block font-mono text-[10px] text-tx3">looking it up…</span>}
          {error && <span className="block font-sans text-[11px] text-[#e06c6c]">{error}</span>}
          {result && (
            <>
              {result.ipa && <span className="block font-mono text-[9.5px] text-tx3">{result.ipa}</span>}
              <span className="mt-[3px] block font-sans text-[11.5px] leading-[1.5] text-tx">
                {result.senses[0]?.definition ?? 'No dictionary entry — it can still be saved.'}
              </span>
              <button
                onClick={() => void save()}
                disabled={busy || saved}
                className="mt-[7px] rounded-field bg-accSolid px-[10px] py-[4px] font-sans text-[10.5px] font-semibold text-white disabled:opacity-60"
              >
                {saved ? 'added ✓' : 'add to my vocabulary'}
              </button>
            </>
          )}
        </span>
      )}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">{children}</div>
  );
}
