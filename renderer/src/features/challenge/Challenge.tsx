import { useEffect, useState } from 'react';
import {
  CHALLENGE_OVERALL_SCORE,
  CHALLENGE_PERSONAL_BESTS,
  CHALLENGE_PROMPTS,
  CHALLENGE_SCORES,
  CHALLENGE_TARGETS,
  CHALLENGE_TYPES,
  type ChallengePhase,
  type ChallengeType,
} from '@/features/challenge/challengeMockData';

const RECORDING_CAP_SECONDS = 60;

// The footer strip sits on the clip player's permanently-dark chrome (#08090a,
// unrelated to the app theme), so its button needs fixed light-on-dark colors
// rather than theme vars — those go near-invisible against black in light mode.
const BTN_STYLE: Record<ChallengePhase, { bg: string; fg: string; bd: string }> = {
  idle: { bg: 'var(--acc)', fg: '#fff', bd: 'var(--acc)' },
  recording: { bg: 'transparent', fg: '#e0806a', bd: '#c0563f' },
  scored: { bg: 'transparent', fg: 'rgba(255,255,255,.75)', bd: 'rgba(255,255,255,.22)' },
};

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function Challenge() {
  const [chType, setChType] = useState<ChallengeType>('Describe');
  const [chPhase, setChPhase] = useState<ChallengePhase>('idle');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (chPhase !== 'recording') return;
    const id = setInterval(() => {
      setElapsed((s) => Math.min(s + 1, RECORDING_CAP_SECONDS));
    }, 1000);
    return () => clearInterval(id);
  }, [chPhase]);

  const btnLabel = chPhase === 'idle' ? 'Start recording' : chPhase === 'recording' ? `Stop · ${fmtClock(elapsed)}` : 'Try again';
  const btnStyle = BTN_STYLE[chPhase];
  const ringDeg = Math.round((elapsed / RECORDING_CAP_SECONDS) * 360);

  const handleAdvance = () => {
    if (chPhase === 'idle') {
      setElapsed(0);
      setChPhase('recording');
    } else if (chPhase === 'recording') {
      setChPhase('scored');
    } else {
      setElapsed(0);
      setChPhase('idle');
    }
  };

  return (
    <div className="flex w-full items-start gap-4 p-[var(--pad)]">
      <div className="flex min-w-0 flex-1 flex-col gap-[14px]">
        <div className="flex flex-wrap gap-[6px]">
          {CHALLENGE_TYPES.map((t) => {
            const on = t === chType;
            return (
              <button
                key={t}
                onClick={() => setChType(t)}
                className="rounded-full border px-3 py-[7px] font-sans text-[11.5px] font-medium"
                style={{
                  borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                  background: on ? 'var(--accSoft)' : 'transparent',
                  color: on ? 'var(--acc)' : 'var(--tx2)',
                }}
              >
                {t}
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-panel border border-line2 bg-[#08090a]">
          <div
            className="relative grid h-[330px] place-items-center"
            style={{
              background: 'repeating-linear-gradient(135deg,rgba(255,255,255,.035) 0 8px,rgba(255,255,255,.012) 8px 16px)',
            }}
          >
            <div className="font-mono text-[10px] font-medium text-white/30">
              {chPhase === 'recording' ? 'recording your response · no subtitles' : 'clip playing · no subtitles · 8.2 s'}
            </div>
            <div className="absolute left-[14px] top-3 rounded-[4px] bg-black/50 px-2 py-1 font-mono text-[9.5px] font-medium text-white/45">
              from your library · Arrival · 01:14:22
            </div>
            {chPhase === 'recording' && (
              <div className="absolute right-[14px] top-3 flex items-center gap-2">
                <div
                  className="grid h-[38px] w-[38px] place-items-center rounded-full"
                  style={{ background: `conic-gradient(var(--acc) ${ringDeg}deg, rgba(255,255,255,.14) 0)` }}
                >
                  <div className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[#08090a] font-mono text-[10px] font-semibold text-white">
                    {elapsed}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-[14px] border-t border-white/[.07] px-4 py-[14px]">
            <button
              onClick={handleAdvance}
              className="rounded-field border px-[18px] py-[11px] font-sans text-[12.5px] font-semibold"
              style={{ background: btnStyle.bg, color: btnStyle.fg, borderColor: btnStyle.bd }}
            >
              {btnLabel}
            </button>
            <div className="font-mono text-[11px] leading-[1.6] text-white/45">{CHALLENGE_PROMPTS[chPhase]}</div>
          </div>
        </div>

        {chPhase === 'scored' && (
          <div className="rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
            <div className="mb-[14px] flex items-baseline justify-between">
              <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                Score · {chType.toLowerCase()}
              </div>
              <div className="font-mono text-[10.5px] text-acc">
                personal best {CHALLENGE_PERSONAL_BESTS[chType]} · +40 XP, +12 bonus
              </div>
            </div>
            <div className="flex items-end gap-[22px]">
              <div className="font-sans text-[52px] font-light leading-none tracking-[-0.035em] text-tx">
                {CHALLENGE_OVERALL_SCORE}
              </div>
              <div className="flex flex-1 flex-col gap-[9px]">
                {CHALLENGE_SCORES.map((s) => (
                  <div key={s.n}>
                    <div className="mb-1 flex justify-between font-mono text-[10.5px] text-tx2">
                      <span>{s.n}</span>
                      <span className="text-tx3">{s.v}</span>
                    </div>
                    <div className="h-1 rounded-field bg-line2">
                      <div className="h-1 rounded-field bg-acc" style={{ width: `${s.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-[14px] border-t border-line2 pt-3 font-sans text-[11.5px] leading-[1.7] text-tx2">
              Your transcript covered 3 of 4 target words. <b>reticent</b> was used spontaneously → routed as Easy.
            </div>
          </div>
        )}
      </div>

      <aside className="flex w-[280px] flex-none flex-col gap-[14px]">
        <div className="rounded-panel border border-line2 bg-panel p-4 shadow-panel">
          <div className="mb-[11px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Target words in this clip
          </div>
          <div className="flex flex-col gap-[6px]">
            {CHALLENGE_TARGETS.map((t) => {
              const good = t.tag === 'spontaneous';
              const scored = chPhase === 'scored';
              const bd = good && scored ? 'var(--accLine)' : 'var(--line2)';
              const bg = good && scored ? 'var(--accSoft)' : 'transparent';
              const tagFg = !scored ? 'var(--tx3)' : good ? 'var(--acc)' : t.tag === 'avoided' ? '#c08a3f' : 'var(--tx2)';
              return (
                <div
                  key={t.w}
                  className="flex items-center justify-between rounded-field border px-[10px] py-[7px]"
                  style={{ borderColor: bd, background: bg }}
                >
                  <span className="font-sans text-[12px] font-medium text-tx">{t.w}</span>
                  <span className="font-mono text-[9px] font-medium" style={{ color: tagFg }}>
                    {scored ? t.tag : 'due'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-panel border border-line2 bg-panel p-4 shadow-panel">
          <div className="mb-[11px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Daily challenge
          </div>
          <div className="font-sans text-[12px] leading-[1.65] text-tx2">
            Everyone gets the same clip today. Share a score code to compare with classmates — opt-in only.
          </div>
          <div className="mt-[9px] font-mono text-[10px] text-tx3">
            personal bests · describe {CHALLENGE_PERSONAL_BESTS.Describe} · predict {CHALLENGE_PERSONAL_BESTS.Predict} · reword{' '}
            {CHALLENGE_PERSONAL_BESTS.Reword}
          </div>
        </div>
      </aside>
    </div>
  );
}
