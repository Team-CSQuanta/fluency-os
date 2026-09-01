import { REPORT_DIALS, REPORT_ERRORS, REPORT_PROXIES, REPORT_ROUTING, REPORT_SUMMARY } from '@/features/conversation/reportMockData';
import { useShellStore } from '@/store/shellStore';

export function Report() {
  const goScreen = useShellStore((s) => s.goScreen);
  const reportOrigin = useShellStore((s) => s.reportOrigin);

  const backLabel = reportOrigin === 'convlive' ? 'back to session' : 'back to sessions';

  return (
    <div className="flex h-full flex-col gap-[14px] overflow-y-auto p-[var(--pad)]">
      <div className="mx-auto w-full max-w-[1120px]">
        <button
          onClick={() => goScreen(reportOrigin)}
          className="flex items-center gap-[6px] rounded-field border border-line2 px-[9px] py-[5px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
        >
          <svg viewBox="0 0 16 16" className="h-[10px] w-[10px]" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.5 3.5L5 8l4.5 4.5" />
          </svg>
          {backLabel}
        </button>
      </div>
      <div className="mx-auto grid w-full max-w-[1120px] grid-cols-4 gap-[14px]">
        {REPORT_DIALS.map((d) => (
          <div
            key={d.n}
            className="flex items-center gap-[14px] rounded-panel border border-line2 bg-panel p-4 shadow-panel"
          >
            <div
              className="grid h-[62px] w-[62px] flex-none place-items-center rounded-full"
              style={{ background: `conic-gradient(${d.color} ${d.deg}deg, var(--line2) 0)` }}
            >
              <div className="grid h-12 w-12 place-items-center rounded-full bg-panel font-mono text-[14px] font-semibold">
                {d.v}
              </div>
            </div>
            <div>
              <div className="font-sans text-[11.5px] font-semibold text-tx">{d.n}</div>
              <div className="mt-[3px] font-mono text-[10px] leading-[1.5] text-tx3">{d.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto w-full max-w-[1120px] rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
        <div className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
          Dynamic SRS routing · what this conversation did to your queue
        </div>
        <div className="grid grid-cols-[1.2fr_0.8fr_0.7fr_1fr_1.4fr] gap-[10px] border-b border-line2 pb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-tx3">
          <span>Word</span>
          <span>Usage</span>
          <span>Rating</span>
          <span>Interval</span>
          <span>Evidence · turn</span>
        </div>
        {REPORT_ROUTING.map((r) => (
          <div
            key={r.w}
            className="grid grid-cols-[1.2fr_0.8fr_0.7fr_1fr_1.4fr] items-center gap-[10px] border-b border-line2 py-[10px]"
          >
            <span className="font-sans text-[12.5px] font-semibold text-tx">{r.w}</span>
            <span
              className="justify-self-start rounded-[4px] px-[7px] py-[3px] font-mono text-[9.5px] font-medium"
              style={{ background: r.uBg, color: r.uFg }}
            >
              {r.u}
            </span>
            <span className="font-mono text-[11px] font-medium" style={{ color: r.uFg }}>
              {r.rating}
            </span>
            <span className="font-mono text-[10.5px] text-tx2">{r.iv}</span>
            <a href="#" className="font-sans text-[11px] text-tx2 hover:text-acc">
              {r.ev}
            </a>
          </div>
        ))}
        <div className="mt-[11px] font-mono text-[10px] text-tx3">
          6 rows written to review_logs with source = 'conversation' · 2 plants advanced a growth stage
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1120px] grid-cols-[1.2fr_1fr] gap-[14px]">
        <div className="rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
          <div className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Three most instructive errors
          </div>
          <div className="flex flex-col gap-3">
            {REPORT_ERRORS.map((e, i) => (
              <div key={i} className="border-l-2 border-line pl-3">
                <div className="font-sans text-[12.5px] leading-[1.6] text-tx3 line-through">{e.bad}</div>
                <div className="mt-[2px] font-sans text-[12.5px] leading-[1.6] text-tx">{e.good}</div>
                <div className="mt-1 font-mono text-[10px] text-tx3">{e.why}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-[14px]">
          <div className="rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
            <div className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
              Fluency proxies
            </div>
            <div className="grid grid-cols-2 gap-3">
              {REPORT_PROXIES.map((p) => (
                <div key={p.n}>
                  <div className="font-sans text-[22px] font-light tracking-[-0.02em] text-tx">{p.v}</div>
                  <div className="font-mono text-[10px] text-tx3">{p.n}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 border-t border-line2 pt-[10px] font-mono text-[9.5px] leading-[1.6] text-tx3">
              pronunciation: stt_proxy — labelled as a proxy, not a true phoneme score
            </div>
          </div>
          <div className="rounded-panel border border-accLine bg-accSoft p-[18px]">
            <div className="mb-[9px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-acc">
              Summary
            </div>
            <div
              className="font-sans text-[13px] leading-[1.7] text-tx"
              dangerouslySetInnerHTML={{ __html: REPORT_SUMMARY }}
            />
            <div className="mt-[14px] flex gap-2">
              <button
                onClick={() => goScreen('conv')}
                className="rounded-field bg-acc px-[13px] py-[9px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
              >
                Practise this again
              </button>
              <button
                onClick={() => goScreen('forest')}
                className="rounded-field border border-accLine px-[13px] py-[9px] font-sans text-[11.5px] font-medium text-acc"
              >
                See the forest
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
