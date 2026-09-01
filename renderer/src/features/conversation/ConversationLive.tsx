import { useState } from 'react';
import { CONV_TARGETS, CONV_TURNS, CONV_WAVE_HEIGHTS } from '@/features/conversation/conversationMockData';
import { useShellStore } from '@/store/shellStore';

type MicState = 'idle' | 'listening' | 'thinking' | 'speaking';

const MIC_META: Record<MicState, { label: string; sub: string; bg: string; bd: string; fg: string; icon: string }> = {
  idle: { label: 'Ready', sub: 'tap to talk', bg: 'var(--panel)', bd: 'var(--line2)', fg: 'var(--tx2)', icon: '●' },
  listening: { label: 'Listening…', sub: 'speak naturally', bg: 'var(--accSoft)', bd: 'var(--acc)', fg: 'var(--acc)', icon: '●' },
  thinking: { label: 'Thinking…', sub: 'first audio ~1.2 s', bg: 'var(--panel)', bd: 'var(--line2)', fg: 'var(--tx2)', icon: '…' },
  speaking: { label: 'Juno is speaking', sub: 'tap to interrupt', bg: 'var(--tile)', bd: 'var(--line2)', fg: 'var(--tx)', icon: '▮▮' },
};

const NEXT_STATE: Record<MicState, MicState> = {
  idle: 'listening',
  listening: 'thinking',
  thinking: 'speaking',
  speaking: 'idle',
};

export function ConversationLive() {
  const scenario = useShellStore((s) => s.convScenario);
  const goScreen = useShellStore((s) => s.goScreen);
  const goReport = useShellStore((s) => s.goReport);
  const [micState, setMicState] = useState<MicState>('idle');
  const [hintOn, setHintOn] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(0);

  const usedCount = CONV_TARGETS.filter((t) => t.tag === 'used').length;
  const meta = MIC_META[micState];

  return (
    <div className="flex h-full w-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none flex-wrap items-center gap-[10px] border-b border-line2 px-[var(--pad)] py-3">
          <button
            onClick={() => goScreen('conv')}
            className="flex items-center gap-[6px] rounded-field border border-line2 px-[9px] py-[5px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
          >
            <svg viewBox="0 0 16 16" className="h-[10px] w-[10px]" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 3.5L5 8l4.5 4.5" />
            </svg>
            sessions
          </button>
          <span className="rounded-field bg-panel2 px-[9px] py-1 font-mono text-[10.5px] font-medium text-tx2">{scenario}</span>
          <span className="rounded-field bg-panel2 px-[9px] py-1 font-mono text-[10.5px] font-medium text-tx2">voice</span>
          <span className="font-mono text-[10.5px] text-tx3">04:12 · first audio 1.2 s</span>
          <div className="flex-1" />
          <button
            onClick={goReport}
            className="rounded-field border border-line px-[11px] py-[6px] font-mono text-[11px] font-medium text-tx2 hover:border-acc hover:text-acc"
          >
            End &amp; analyse
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-[14px] overflow-y-auto p-[var(--pad)]">
          {CONV_TURNS.map((t, i) => (
            <div key={i} className="flex max-w-[78%] gap-[11px]" style={{ flexDirection: t.dir, alignSelf: t.align }}>
              <div
                className="grid h-7 w-7 flex-none place-items-center rounded-full font-mono text-[8px] font-semibold"
                style={{ background: t.avBg, color: t.avFg }}
              >
                {t.av}
              </div>
              <div>
                <div
                  className="rounded-field border px-[14px] py-[11px] font-sans text-[13.5px] leading-[1.65]"
                  style={{ background: t.bg, borderColor: t.bd, color: t.fg }}
                >
                  {t.text}
                </div>
                <div className="mt-[5px] font-mono text-[9.5px] text-tx3" style={{ textAlign: t.metaAlign }}>
                  {t.meta}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-none flex-col items-center gap-3 border-t border-line2 px-[var(--pad)] pb-[18px] pt-[14px]">
          <div className="flex items-center gap-[14px]">
            <div className="flex h-[34px] w-[118px] items-end justify-center gap-[3px]">
              {CONV_WAVE_HEIGHTS.map((h, i) => (
                <div
                  key={i}
                  className="w-[3px] rounded-field"
                  style={{
                    height: h,
                    background: micState === 'listening' || micState === 'speaking' ? 'var(--acc)' : 'var(--line2)',
                    transformOrigin: 'bottom',
                  }}
                />
              ))}
            </div>
            <button
              onClick={() => setMicState((s) => NEXT_STATE[s])}
              className="grid h-14 w-14 place-items-center rounded-full border-2 font-mono text-[9px] font-semibold"
              style={{ background: meta.bg, borderColor: meta.bd, color: meta.fg }}
            >
              {meta.icon}
            </button>
            <div className="w-[118px]">
              <div className="font-sans text-[12px] font-semibold" style={{ color: meta.fg }}>
                {meta.label}
              </div>
              <div className="font-mono text-[10px] text-tx3">{meta.sub}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex min-w-[280px] items-center rounded-field border border-line2 px-3 py-2 font-sans text-[11.5px] text-tx3">
              type a word you can't pronounce…
            </div>
            <button
              onClick={() => {
                setHintOn(true);
                setHintsUsed((n) => n + 1);
              }}
              className="rounded-field border px-[13px] py-[9px] font-mono text-[11px] font-medium"
              style={{
                borderColor: hintOn ? 'var(--accLine)' : 'var(--line)',
                background: hintOn ? 'var(--accSoft)' : 'transparent',
                color: hintOn ? 'var(--acc)' : 'var(--tx2)',
              }}
            >
              hint{hintsUsed > 0 ? ` (${hintsUsed})` : ''}
            </button>
            <button className="rounded-field border border-line px-[13px] py-[9px] font-mono text-[11px] font-medium text-tx2 hover:border-acc hover:text-acc">
              translate
            </button>
          </div>
          {hintOn && (
            <div className="rounded-field border border-accLine bg-accSoft px-3 py-2 font-sans text-[11.5px] text-acc">
              Indirect hint: "think of a word for holding back information on purpose…"
            </div>
          )}
        </div>
      </div>

      <aside className="flex w-[270px] flex-none flex-col overflow-y-auto border-l border-line2 bg-panel">
        <div className="flex items-center gap-[11px] border-b border-line2 p-4">
          <div className="grid h-11 w-11 flex-none place-items-center rounded-full border border-accLine bg-accSoft font-mono text-[7.5px] text-acc">
            fox
          </div>
          <div>
            <div className="font-sans text-[12.5px] font-semibold text-tx">Juno</div>
            <div className="font-mono text-[10px] text-tx3">companion L6 · 28 sessions</div>
          </div>
        </div>
        <div className="p-4">
          <div className="mb-[11px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Target words · {usedCount}/{CONV_TARGETS.length} used
          </div>
          <div className="flex flex-col gap-[5px]">
            {CONV_TARGETS.map((t) => (
              <div
                key={t.w}
                className="flex items-center justify-between gap-2 rounded-field border px-[10px] py-2 text-left"
                style={{ borderColor: t.bd, background: t.bg }}
              >
                <span className="font-sans text-[12px] font-medium" style={{ color: t.fg, textDecoration: t.deco }}>
                  {t.w}
                </span>
                <span className="font-mono text-[9px] font-medium" style={{ color: t.tagFg }}>
                  {t.tag}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-[14px] border-t border-line2 pt-3 font-mono text-[10px] leading-[1.7] text-tx3">
            the model never says a target word first · after 3 missed openings it offers an indirect hint
          </div>
        </div>
        <div className="mt-auto px-4 pb-[18px]">
          <div className="mb-[9px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">Grounding</div>
          <div className="rounded-field border border-line2 p-[10px] font-sans text-[11px] leading-[1.6] text-tx2">
            Retrieved 3 of your contexts — <i>Arrival</i> (Tue), <i>The Economist</i> (Sun).
          </div>
        </div>
      </aside>
    </div>
  );
}
