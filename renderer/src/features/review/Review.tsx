import { useState } from 'react';
import { RATINGS, REVIEW_QUEUE } from '@/features/review/reviewMockData';
import { useShellStore } from '@/store/shellStore';

const RATING_STYLE = [
  { fg: '#c0563f', bd: 'var(--line)', bg: 'transparent' },
  { fg: 'var(--tx)', bd: 'var(--line)', bg: 'transparent' },
  { fg: 'var(--acc)', bd: 'var(--accLine)', bg: 'var(--accSoft)' },
  { fg: 'var(--tx)', bd: 'var(--line)', bg: 'transparent' },
];

const CARD_TYPE_LABEL: Record<string, string> = {
  cloze: 'Front · cloze',
  recognition: 'Front · recognition',
  production: 'Front · production',
  listening: 'Front · listening',
};

export function Review() {
  const goScreen = useShellStore((s) => s.goScreen);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [sessionDone, setSessionDone] = useState(false);

  const total = REVIEW_QUEUE.length;
  const card = REVIEW_QUEUE[index];
  const pct = Math.round((index / total) * 100);

  const handleRate = () => {
    if (index + 1 >= total) {
      setSessionDone(true);
    } else {
      setIndex((i) => i + 1);
      setRevealed(false);
    }
  };

  const restart = () => {
    setIndex(0);
    setRevealed(false);
    setSessionDone(false);
  };

  if (sessionDone) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-[var(--pad)]">
        <div className="max-w-[420px] rounded-panel border border-accLine bg-accSoft px-7 py-8 text-center">
          <div className="font-sans text-[18px] font-semibold text-tx">Queue cleared</div>
          <div className="mt-2 font-sans text-[12.5px] leading-[1.7] text-tx2">
            You reviewed {total} cards this session. Nice work — the next batch will be due as your
            schedule catches up.
          </div>
          <div className="mt-5 flex justify-center gap-2">
            <button
              onClick={restart}
              className="rounded-field border border-line px-4 py-[9px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
            >
              review again
            </button>
            <button
              onClick={() => goScreen('dashboard')}
              className="rounded-field bg-accSolid px-4 py-[9px] font-sans text-[12px] font-semibold text-white hover:brightness-110"
            >
              back to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center gap-4 p-[20px_var(--pad)_24px]">
      <div className="flex w-full max-w-[760px] items-center gap-3">
        <div className="h-[3px] flex-1 rounded-field bg-line2">
          <div className="h-[3px] rounded-field bg-acc" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono text-[10.5px] font-medium text-tx3">
          {index + 1} / {total} · interleaved
        </span>
        <span className="rounded-full bg-accSoft px-2 py-[3px] font-mono text-[9.5px] font-medium text-acc">
          {card.cardType} · {index + 1} of {total}
        </span>
      </div>

      <div className="flex min-h-0 w-full max-w-[760px] flex-1 flex-col overflow-hidden rounded-panel border border-line2 bg-panel shadow-panel">
        <div className="border-b border-line2 px-[34px] pb-6 pt-[34px] text-center">
          <div className="mb-4 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            {CARD_TYPE_LABEL[card.cardType]}
          </div>
          {card.cardType === 'cloze' ? (
            <div className="font-sans text-[24px] leading-[1.55] tracking-[-0.01em] text-tx">
              {card.before}{' '}
              <span className="inline-block min-w-[132px] border-b-2 border-acc text-acc">?</span> {card.after}
            </div>
          ) : (
            <div className="font-sans text-[24px] leading-[1.55] tracking-[-0.01em] text-tx">{card.front}</div>
          )}
        </div>

        {revealed && (
          <div className="grid min-h-0 flex-1 grid-cols-[1.1fr_0.9fr] gap-6 overflow-y-auto px-[34px] py-6">
            <div>
              <div className="font-sans text-[30px] font-semibold tracking-[-0.02em] text-tx">{card.word}</div>
              <div className="my-[5px] font-mono text-[11px] text-tx3">
                {card.ipa} · {card.pos} · {card.cefr}
              </div>
              <div className="font-sans text-[13.5px] leading-[1.7] text-tx2">{card.definition}</div>
              <div className="mt-[14px] font-sans text-[12.5px] italic leading-[1.65] text-tx3">"{card.translation}"</div>
              <div className="mt-4 flex gap-2">
                <button className="rounded-field border border-line px-[11px] py-[7px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc">
                  ▶ word
                </button>
                <button className="rounded-field border border-line px-[11px] py-[7px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc">
                  ▶ sentence
                </button>
              </div>
            </div>
            <div>
              <div className="overflow-hidden rounded-field border border-line2">
                <div
                  className="grid h-[132px] place-items-center font-mono text-[8px] text-tx3"
                  style={{ background: 'repeating-linear-gradient(135deg,var(--tile) 0 6px,var(--tileB) 6px 12px)' }}
                >
                  stored clip · autoplay, muted until hover
                </div>
                <div className="border-t border-line2 px-[10px] py-2 font-mono text-[10px] text-tx3">
                  {card.clipSource} · {card.clipStamp}
                </div>
              </div>
              <div className="mt-3 font-mono text-[10.5px] leading-[1.7] text-tx3">
                stability {card.stability} → {card.nextStability}
                <br />
                difficulty {card.difficulty} · reps {card.reps} · lapses {card.lapses}
                <br />
                {card.spontaneousUses} spontaneous uses · mastery L{card.mastery}
              </div>
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
                  onClick={handleRate}
                  className="rounded-field border px-[6px] py-[11px] text-center hover:border-acc"
                  style={{ borderColor: RATING_STYLE[i].bd, background: RATING_STYLE[i].bg }}
                >
                  <div className="font-sans text-[12.5px] font-semibold" style={{ color: RATING_STYLE[i].fg }}>
                    {r.label}
                  </div>
                  <div className="mt-[3px] font-mono text-[10px] text-tx3">
                    {r.interval} · {r.note}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex w-full max-w-[760px] justify-center gap-2 font-mono text-[10.5px] text-tx3">
        <span>this card can also be answered by using the word in conversation</span>
        <button onClick={() => goScreen('conv')} className="text-acc hover:underline">
          open a session →
        </button>
      </div>
    </div>
  );
}
