import { useEffect, useState } from 'react';
import { reviewEmptyState } from '@/features/review/emptyState';
import { useAppStore } from '@/store/appStore';
import { useReviewStore } from '@/store/reviewStore';
import { useShellStore } from '@/store/shellStore';
import type { ReviewCardOut, ReviewRating } from '@/types/api';

// Again is the only rating coloured as a warning; the rest are deliberately
// quiet. Making "Easy" look rewarding biases the answer, and a scheduler fed
// flattering answers schedules badly.
const RATING_STYLE = [
  { fg: '#c0563f', bd: 'var(--line)', bg: 'transparent' },
  { fg: 'var(--tx)', bd: 'var(--line)', bg: 'transparent' },
  { fg: 'var(--acc)', bd: 'var(--accLine)', bg: 'var(--accSoft)' },
  { fg: 'var(--tx)', bd: 'var(--line)', bg: 'transparent' },
];

const RATINGS: Array<{ label: string; key: string; note: string }> = [
  { label: 'Again', key: 'again', note: 'forgotten' },
  { label: 'Hard', key: 'hard', note: 'shortened' },
  { label: 'Good', key: 'good', note: 'normal' },
  { label: 'Easy', key: 'easy', note: 'stability +' },
];

const CARD_TYPE_LABEL: Record<string, string> = {
  cloze: 'Front · cloze',
  recognition: 'Front · recognition',
  production: 'Front · production',
  listening: 'Front · listening',
};

/** What the learner is asked, which is the whole difference between the four
 * card types — the back is identical. */
function CardFront({ card }: { card: ReviewCardOut }) {
  if (card.card_type === 'cloze') {
    return (
      <div className="font-sans text-[24px] leading-[1.55] tracking-[-0.01em] text-tx">
        {card.cloze_before}{' '}
        <span className="inline-block min-w-[132px] border-b-2 border-acc text-acc">?</span>{' '}
        {card.cloze_after}
      </div>
    );
  }
  if (card.card_type === 'production') {
    return (
      <div className="font-sans text-[19px] leading-[1.6] tracking-[-0.01em] text-tx">
        {card.definition}
        <div className="mt-3 font-mono text-[11px] text-tx3">which word?</div>
      </div>
    );
  }
  if (card.card_type === 'listening') {
    return (
      <div className="font-sans text-[24px] leading-[1.55] text-tx">
        <button
          onClick={() => card.audio_url && void new Audio(card.audio_url).play().catch(() => {})}
          className="rounded-field border border-line px-4 py-2 font-mono text-[13px] text-tx2 hover:border-acc hover:text-acc"
        >
          ▶ play audio
        </button>
        <div className="mt-3 font-mono text-[11px] text-tx3">which word is this?</div>
      </div>
    );
  }
  return (
    <div className="font-sans text-[28px] font-semibold leading-[1.4] tracking-[-0.02em] text-tx">
      {card.word}
    </div>
  );
}

export function Review() {
  const goScreen = useShellStore((s) => s.goScreen);
  const currentUser = useAppStore((s) => s.currentUser);
  const { queue, queueStatus, queueError, stats, index, answered, lastResult } = useReviewStore();
  const fetchStats = useReviewStore((s) => s.fetchStats);
  const startSession = useReviewStore((s) => s.startSession);
  const rate = useReviewStore((s) => s.rate);
  const suspendCurrent = useReviewStore((s) => s.suspendCurrent);

  const [revealed, setRevealed] = useState(false);
  const card = queue[index];
  const done = queue.length > 0 && index >= queue.length;

  useEffect(() => {
    if (currentUser) void fetchStats();
  }, [currentUser, fetchStats]);

  // A new card means a new question — anything else would show the answer
  // before it was asked.
  useEffect(() => setRevealed(false), [index]);

  useEffect(() => {
    if (done) void fetchStats();
  }, [done, fetchStats]);

  // Spec §5.3: "answered with a four-button FSRS rating or keyboard 1-4".
  // Reviewing is repetitive by design, and reaching for the mouse on every
  // card is what makes a long queue feel long.
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        void rate(Number(e.key) as ReviewRating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, rate]);

  // --- nothing to do -------------------------------------------------------

  if (queueStatus === 'loading') {
    return <div className="grid h-full place-items-center font-mono text-[11px] text-tx3">building queue…</div>;
  }

  if (queue.length === 0 || done) {
    const upcoming = stats?.forecast.slice(0, 7) ?? [];
    const peak = Math.max(1, ...upcoming.map((d) => d.count));
    // Work still waiting after a finished session is real: the queue is
    // capped per sitting (spec §5.5 load smoothing), so clearing 20 of 40 due
    // cards is progress, not completion.
    const copy = reviewEmptyState(stats, { done, answered });

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-[var(--pad)]">
        <div className="w-full max-w-[460px] rounded-panel border border-line2 bg-panel px-7 py-8 text-center">
          <div className="font-sans text-[18px] font-semibold text-tx">{copy.heading}</div>
          <div className="mt-2 font-sans text-[12.5px] leading-[1.7] text-tx2">{copy.body}</div>

          {stats && (
            <div className="mt-5 grid grid-cols-3 gap-2 font-mono text-[10px] text-tx3">
              {[
                ['due now', stats.due_now],
                ['new', stats.new_available],
                ['cards', stats.total_cards],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-field border border-line2 px-2 py-[9px]">
                  <div className="font-sans text-[16px] font-semibold text-tx">{value}</div>
                  <div className="mt-[2px] uppercase tracking-[0.1em]">{label}</div>
                </div>
              ))}
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="mt-5 text-left">
              {/* Spec §7: backlogs should be visible before they arrive. */}
              <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                next 7 days
              </div>
              <div className="mt-2 flex h-[46px] items-end gap-[3px]">
                {upcoming.map((d) => (
                  <div key={d.date} className="flex-1" title={`${d.date}: ${d.count} due`}>
                    <div
                      className="w-full rounded-[2px] bg-accSoft"
                      style={{ height: `${Math.max(2, (d.count / peak) * 46)}px` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-center gap-2">
            {copy.canStart && (
              <button
                onClick={() => void startSession()}
                className="rounded-field bg-accSolid px-4 py-[9px] font-sans text-[12px] font-semibold text-white hover:brightness-110"
              >
                {copy.startLabel}
              </button>
            )}
            <button
              onClick={() => goScreen('dashboard')}
              className="rounded-field border border-line px-4 py-[9px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
            >
              back to dashboard
            </button>
          </div>
          {queueError && (
            <div className="mt-3 font-mono text-[10px] text-[#c0563f]">{queueError}</div>
          )}
        </div>
      </div>
    );
  }

  const total = queue.length;
  const pct = Math.round((index / total) * 100);

  return (
    <div className="flex h-full flex-col items-center gap-4 p-[20px_var(--pad)_24px]">
      <div className="flex w-full max-w-[760px] items-center gap-3">
        <div className="h-[3px] flex-1 rounded-field bg-line2">
          <div className="h-[3px] rounded-field bg-acc transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono text-[10.5px] font-medium text-tx3">
          {index + 1} / {total}
        </span>
        <span className="rounded-full bg-accSoft px-2 py-[3px] font-mono text-[9.5px] font-medium text-acc">
          {card.card_type}
        </span>
        {card.is_leech && (
          <span className="rounded-full border border-[#c0563f] px-2 py-[3px] font-mono text-[9.5px] text-[#c0563f]">
            leech
          </span>
        )}
      </div>

      <div className="flex min-h-0 w-full max-w-[760px] flex-1 flex-col overflow-hidden rounded-panel border border-line2 bg-panel shadow-panel">
        <div className="border-b border-line2 px-[34px] pb-6 pt-[34px] text-center">
          <div className="mb-4 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            {CARD_TYPE_LABEL[card.card_type]}
          </div>
          <CardFront card={card} />
        </div>

        {revealed && (
          <div className="grid min-h-0 flex-1 grid-cols-[1.1fr_0.9fr] gap-6 overflow-y-auto px-[34px] py-6">
            <div>
              <div className="font-sans text-[30px] font-semibold tracking-[-0.02em] text-tx">{card.word}</div>
              <div className="my-[5px] font-mono text-[11px] text-tx3">
                {[card.ipa, card.pos, card.cefr].filter(Boolean).join(' · ')}
              </div>
              {card.definition && (
                <div className="font-sans text-[13.5px] leading-[1.7] text-tx2">{card.definition}</div>
              )}
              {card.simpler && (
                <div className="mt-[10px] font-sans text-[12.5px] leading-[1.65] text-tx3">{card.simpler}</div>
              )}
              {card.context_snippet && (
                <div className="mt-[14px] rounded-field border border-line2 px-3 py-[10px]">
                  <div className="font-sans text-[12.5px] italic leading-[1.65] text-tx2">
                    “{card.context_snippet}”
                  </div>
                  {card.context_source && (
                    <div className="mt-[6px] font-mono text-[10px] text-tx3">{card.context_source}</div>
                  )}
                </div>
              )}
              {card.mnemonic && (
                <div className="mt-3 font-sans text-[12.5px] leading-[1.65] text-tx3">💡 {card.mnemonic}</div>
              )}
            </div>

            <div>
              <div className="rounded-field border border-line2 px-3 py-[10px]">
                <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  mastery
                </div>
                <div className="mt-[5px] font-sans text-[14px] font-semibold text-tx">
                  L{card.mastery_level} · {card.mastery_label}
                </div>
                <div className="mt-[3px] font-mono text-[10px] leading-[1.6] text-tx3">
                  {card.mastery_reason}
                </div>
                {/* The project's whole claim, said plainly where it applies. */}
                {card.mastery_level <= 2 && (
                  <div className="mt-2 border-t border-line2 pt-2 font-mono text-[9.5px] leading-[1.6] text-tx3">
                    flashcards alone stop at L2 — this word only goes further by being
                    used unprompted in conversation
                  </div>
                )}
              </div>
              <div className="mt-3 font-mono text-[10.5px] leading-[1.75] text-tx3">
                stability {card.stability_days} d · difficulty {card.difficulty}
                <br />
                reps {card.reps} · lapses {card.lapses}
                <br />
                {card.spontaneous_sessions} spontaneous conversation
                {card.spontaneous_sessions === 1 ? '' : 's'}
              </div>
              <button
                onClick={() => void suspendCurrent()}
                className="mt-3 font-mono text-[10px] text-tx3 hover:text-[#c0563f]"
              >
                suspend this card
              </button>
            </div>
          </div>
        )}

        <div className="flex-none border-t border-line2 px-[34px] pb-5 pt-4">
          {!revealed ? (
            <button
              onClick={() => setRevealed(true)}
              className="w-full rounded-field bg-accSolid py-[13px] font-sans text-[13px] font-semibold text-white hover:brightness-110"
            >
              Show answer <span className="font-mono text-[11px] font-normal opacity-75">space</span>
            </button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {RATINGS.map((r, i) => (
                <button
                  key={r.label}
                  onClick={() => void rate((i + 1) as ReviewRating)}
                  className="rounded-field border px-[6px] py-[11px] text-center hover:border-acc"
                  style={{ borderColor: RATING_STYLE[i].bd, background: RATING_STYLE[i].bg }}
                >
                  <div className="font-sans text-[12.5px] font-semibold" style={{ color: RATING_STYLE[i].fg }}>
                    {r.label} <span className="font-mono text-[10px] font-normal text-tx3">{i + 1}</span>
                  </div>
                  {/* Real intervals from the scheduler, not labels. A rating
                      whose consequence is invisible is one nobody calibrates. */}
                  <div className="mt-[3px] font-mono text-[10px] text-tx3">
                    {card.intervals[r.key] ?? '—'} · {r.note}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex w-full max-w-[760px] items-center justify-center gap-2 font-mono text-[10.5px] text-tx3">
        {lastResult ? (
          <span>
            last card → back in <span className="text-acc">{lastResult.interval_label}</span>
          </span>
        ) : (
          <span>this card can also be answered by using the word in conversation</span>
        )}
        <button onClick={() => goScreen('conv')} className="text-acc hover:underline">
          open a session →
        </button>
      </div>
    </div>
  );
}
