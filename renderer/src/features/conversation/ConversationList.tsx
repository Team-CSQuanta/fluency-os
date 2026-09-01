import { CONV_HISTORY, CONV_SCENARIOS, CONV_STATS } from '@/features/conversation/conversationMockData';
import { useShellStore } from '@/store/shellStore';

export function ConversationList() {
  const goConvLive = useShellStore((s) => s.goConvLive);
  const goReport = useShellStore((s) => s.goReport);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1000px] px-[var(--pad)] pb-11 pt-[18px]">
        <div className="flex flex-wrap items-end gap-[18px] border-b border-line2 pb-[18px]">
          <div className="min-w-[260px] flex-1">
            <div className="font-sans text-[22px] font-semibold tracking-[-0.02em] text-tx">Conversations</div>
            <div className="mt-[6px] font-sans text-[11.5px] leading-[1.6] text-tx2">
              Pick up where you left off, or start a new session with your due words injected.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {CONV_STATS.map((s) => (
              <div key={s.k} className="min-w-[104px] rounded-field border border-line2 bg-panel px-3 py-[10px]">
                <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">{s.k}</div>
                <div className="mt-[5px] font-sans text-[15px] font-semibold" style={{ color: s.fg }}>
                  {s.v}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-panel border border-accLine bg-accSoft p-4">
          <div className="flex flex-wrap items-center gap-[14px]">
            <div className="min-w-[220px] flex-1">
              <div className="font-sans text-[13.5px] font-semibold text-tx">Start a new conversation</div>
              <div className="mt-1 font-sans text-[11px] leading-[1.6] text-tx2">
                12 words due for conversational review · Juno is ready
              </div>
            </div>
            <button
              onClick={() => goConvLive('Free talk')}
              className="flex items-center gap-2 rounded-field bg-acc px-[18px] py-[11px] font-sans text-[12px] font-semibold text-white hover:brightness-110"
            >
              <svg viewBox="0 0 16 16" className="h-[13px] w-[13px]" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3.5v9 M3.5 8h9" />
              </svg>
              New conversation
            </button>
          </div>
          <div className="mt-[14px] flex flex-wrap gap-[6px] border-t border-accLine pt-[13px]">
            {CONV_SCENARIOS.map((c) => (
              <button
                key={c.n}
                onClick={() => goConvLive(c.n)}
                className="flex items-center gap-[7px] rounded-full border border-line2 bg-panel px-3 py-[7px] font-sans text-[11px] font-medium text-tx2 hover:border-acc"
              >
                {c.n}
                <span className="font-mono text-[9.5px] text-tx3">{c.k}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-[10px] mt-6 flex items-center justify-between gap-[10px]">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Previous sessions · {CONV_HISTORY.length}
          </span>
          <span className="font-mono text-[9.5px] text-tx3">transcripts kept locally</span>
        </div>
        <div className="flex flex-col gap-[9px]">
          {CONV_HISTORY.map((c, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-[14px] rounded-field border border-line2 bg-panel px-[15px] py-[13px]"
            >
              <span
                className="grid h-[34px] w-[34px] flex-none place-items-center rounded-field font-mono text-[9px]"
                style={{ background: c.avBg, color: c.avFg }}
              >
                {c.kind}
              </span>
              <span className="min-w-[180px] flex-1">
                <span className="block font-sans text-[13px] font-semibold text-tx">{c.title}</span>
                <span className="mt-1 block font-mono text-[10px] text-tx3">{c.meta}</span>
              </span>
              <span className="min-w-[96px] flex-none">
                <span className="block font-mono text-[9px] uppercase tracking-[0.1em] text-tx3">words used</span>
                <span className="mt-[5px] flex items-center gap-[7px]">
                  <span className="h-1 max-w-[64px] flex-1 rounded-field bg-line2">
                    <span className="block h-1 rounded-field bg-acc" style={{ width: `${c.pct}%` }} />
                  </span>
                  <span className="font-mono text-[10px] font-medium text-tx2">{c.used}</span>
                </span>
              </span>
              <span
                className="flex-none rounded-full px-[9px] py-1 font-mono text-[10px] font-medium"
                style={{ background: c.scoreBg, color: c.scoreFg }}
              >
                {c.score}
              </span>
              <span className="flex flex-none gap-[6px]">
                <button
                  onClick={goReport}
                  className="rounded-field border border-line px-[11px] py-[7px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
                >
                  {c.action}
                </button>
                <button
                  onClick={() => goConvLive(c.title)}
                  className="rounded-field border border-accLine bg-accSoft px-3 py-[7px] font-mono text-[10.5px] font-medium text-acc"
                >
                  resume
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
