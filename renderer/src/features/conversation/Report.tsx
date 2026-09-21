import { useEffect, useRef, useState } from 'react';
import { CONV_SCENARIOS } from '@/features/conversation/conversationScenarios';
import { useConversationStore } from '@/store/conversationStore';
import { useShellStore } from '@/store/shellStore';

const SCENARIO_LABEL: Record<string, string> = Object.fromEntries(CONV_SCENARIOS.map((s) => [s.key, s.n]));

// Must track REPORT_VERSION in backend/app/services/conversation_report.py.
const CURRENT_REPORT_VERSION = 2;

interface Dial {
  n: string;
  v: number | null;
  sub: string;
}

/** Null means the metric was never measured — for a legacy report, or for a
 * session that gave nothing to measure. Showing a zero would read as a real,
 * bad score for something we simply don't know. */
function Metric({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="text-tx3">—</span>;
  return (
    <>
      {value}
      {suffix}
    </>
  );
}

export function Report() {
  const goScreen = useShellStore((s) => s.goScreen);
  const reportOrigin = useShellStore((s) => s.reportOrigin);
  const report = useConversationStore((s) => s.report);
  const reportStatus = useConversationStore((s) => s.reportStatus);
  const reportError = useConversationStore((s) => s.reportError);
  const regenerateReport = useConversationStore((s) => s.regenerateReport);
  const startSession = useConversationStore((s) => s.startSession);
  const goConvLive = useShellStore((s) => s.goConvLive);
  const sessions = useConversationStore((s) => s.sessions);
  const activeSession = useConversationStore((s) => s.activeSession);
  const [regenerating, setRegenerating] = useState(false);
  const [practising, setPractising] = useState(false);
  const attemptedRef = useRef<Set<string>>(new Set());

  const backLabel = reportOrigin === 'convlive' ? 'back to session' : 'back to sessions';

  const handleRegenerate = async () => {
    if (!report) return;
    setRegenerating(true);
    try {
      await regenerateReport(report.session_id);
    } finally {
      setRegenerating(false);
    }
  };

  // Opening a report written by an older version brings it up to date by
  // itself. Attempted once per session: a failure (no AI configured, quota
  // gone) leaves the old report on screen with a retry rather than looping.
  const legacySessionId =
    report && report.report_version < CURRENT_REPORT_VERSION ? report.session_id : null;
  useEffect(() => {
    if (!legacySessionId || attemptedRef.current.has(legacySessionId)) return;
    attemptedRef.current.add(legacySessionId);
    void handleRegenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacySessionId]);

  // Repeat the same scenario with the same words, so whatever went badly is
  // what comes back rather than a fresh unrelated set. The session just ended
  // isn't in the fetched list yet, so prefer the active one — otherwise
  // arriving here straight from "End & analyse" would silently reseed.
  const source =
    (activeSession?.id === report?.session_id ? activeSession : null) ??
    sessions.find((s) => s.id === report?.session_id) ??
    null;

  const handlePractiseAgain = async () => {
    if (!report) return;
    setPractising(true);
    try {
      const seedIds = source?.target_words.map((w) => w.id);
      await startSession(source?.scenario ?? 'free', source?.channel ?? 'voice', seedIds?.length ? seedIds : undefined);
      goConvLive(SCENARIO_LABEL[source?.scenario ?? 'free'] ?? 'Free talk');
    } catch {
      setPractising(false);
    }
  };

  if (reportStatus === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-[var(--pad)] text-center">
        <div className="font-sans text-[13px] font-medium text-tx">Couldn't load this report.</div>
        {reportError && <div className="max-w-[420px] font-mono text-[10.5px] leading-[1.6] text-tx3">{reportError}</div>}
        <button
          onClick={() => goScreen(reportOrigin)}
          className="mt-1 rounded-field border border-line2 px-4 py-[9px] font-mono text-[11px] font-medium text-tx2 hover:border-acc hover:text-acc"
        >
          ‹ {backLabel}
        </button>
      </div>
    );
  }

  if (reportStatus === 'loading' || !report) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[11px] text-tx3">
        {reportStatus === 'loading' ? 'loading…' : 'no report to show yet'}
      </div>
    );
  }

  const isLegacy = report.report_version < CURRENT_REPORT_VERSION;

  const dials: Dial[] = [
    {
      n: 'Contextual accuracy',
      v: report.contextual_accuracy_pct,
      sub: report.contextual_accuracy_pct === null ? 'no target words this session' : 'target words used correctly',
    },
    { n: 'Grammatical precision', v: report.grammatical_precision, sub: 'error density, judged by the model' },
    { n: 'Lexical range', v: report.lexical_range, sub: 'type-token ratio of your own words' },
    {
      n: 'Pronunciation',
      v: report.pronunciation_score,
      sub: report.pronunciation_score === null ? 'no audio in this session' : 'stt_proxy · not a phoneme score',
    },
  ];

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
      {isLegacy && (
        <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-[10px] rounded-panel border border-accLine bg-accSoft px-4 py-3">
          <span className="flex-1 font-mono text-[10.5px] leading-[1.6] text-tx2">
            {regenerating
              ? 'Bringing this report up to date — re-running the analysis over the saved transcript…'
              : 'This report predates the current analysis, so several measurements are missing.'}
          </span>
          {!regenerating && (
            <button
              onClick={() => void handleRegenerate()}
              className="rounded-field bg-acc px-[13px] py-[7px] font-sans text-[11px] font-semibold text-white hover:brightness-110"
            >
              Try again
            </button>
          )}
          {reportError && <span className="w-full font-mono text-[10px] text-[#c0563f]">{reportError}</span>}
        </div>
      )}

      <div className="mx-auto grid w-full max-w-[1120px] grid-cols-4 gap-[14px]">
        {dials.map((d) => (
          <div
            key={d.n}
            className="flex items-center gap-[14px] rounded-panel border border-line2 bg-panel p-4 shadow-panel"
          >
            <div
              className="grid h-[62px] w-[62px] flex-none place-items-center rounded-full"
              style={{ background: `conic-gradient(var(--acc) ${((d.v ?? 0) / 100) * 360}deg, var(--line2) 0)` }}
            >
              <div className="grid h-12 w-12 place-items-center rounded-full bg-panel font-mono text-[14px] font-semibold">
                {d.v === null ? <span className="text-tx3">—</span> : d.v}
              </div>
            </div>
            <div>
              <div className="font-sans text-[11.5px] font-semibold text-tx">{d.n}</div>
              <div className="mt-[3px] font-mono text-[10px] leading-[1.5] text-tx3">
                {d.v === null ? 'not measured in this report' : d.sub}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto w-full max-w-[1120px] rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
        <div className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
          Real usage this conversation logged for your target words
        </div>
        <div className="grid grid-cols-[1.4fr_1fr_1.6fr] gap-[10px] border-b border-line2 pb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-tx3">
          <span>Word</span>
          <span>Usage</span>
          <span>Evidence · turn</span>
        </div>
        {report.routing.length === 0 && (
          <div className="py-3 font-mono text-[10.5px] text-tx3">no target words in this session</div>
        )}
        {report.routing.map((r) => (
          <div key={r.word} className="grid grid-cols-[1.4fr_1fr_1.6fr] items-center gap-[10px] border-b border-line2 py-[10px]">
            <span className="font-sans text-[12.5px] font-semibold text-tx">{r.word}</span>
            <span
              className="justify-self-start rounded-[4px] px-[7px] py-[3px] font-mono text-[9.5px] font-medium"
              style={{
                background: r.outcome === 'spontaneous' || r.outcome === 'prompted' ? 'var(--accSoft)' : 'var(--tile)',
                color: r.outcome === 'spontaneous' || r.outcome === 'prompted' ? 'var(--acc)' : 'var(--tx3)',
              }}
            >
              {r.outcome}
            </span>
            <span className="font-sans text-[11px] text-tx2">
              {r.evidence_turn !== null ? `turn ${r.evidence_turn}` : '—'}
            </span>
          </div>
        ))}
        <div className="mt-[11px] font-mono text-[10px] text-tx3">
          {report.routing.length} row{report.routing.length === 1 ? '' : 's'} written to review_logs with source = 'conversation'
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1120px] grid-cols-[1.2fr_1fr] gap-[14px]">
        <div className="rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
          <div className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Instructive errors
          </div>
          {report.errors.length === 0 ? (
            <div className="font-mono text-[10.5px] text-tx3">no notable errors flagged</div>
          ) : (
            <div className="flex flex-col gap-3">
              {report.errors.map((e, i) => (
                <div key={i} className="border-l-2 border-line pl-3">
                  <div className="font-sans text-[12.5px] leading-[1.6] text-tx3 line-through">{e.bad}</div>
                  <div className="mt-[2px] font-sans text-[12.5px] leading-[1.6] text-tx">{e.good}</div>
                  <div className="mt-1 font-mono text-[10px] text-tx3">{e.why}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-[14px]">
          <div className="rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
            <div className="mb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
              Fluency proxies
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="font-sans text-[22px] font-light tracking-[-0.02em] text-tx">
                  <Metric value={report.words_per_minute} />
                </div>
                <div className="font-mono text-[10px] text-tx3">
                  words / min{report.words_per_minute === null ? ' · no speech timed' : ''}
                </div>
              </div>
              <div>
                <div className="font-sans text-[22px] font-light tracking-[-0.02em] text-tx">
                  <Metric value={report.filler_rate_per_100w} />
                </div>
                <div className="font-mono text-[10px] text-tx3">fillers / 100 words</div>
              </div>
              <div>
                <div className="font-sans text-[22px] font-light tracking-[-0.02em] text-tx">
                  <Metric value={report.avg_response_delay_seconds} suffix="s" />
                </div>
                <div className="font-mono text-[10px] text-tx3">avg reply delay</div>
              </div>
              <div>
                <div className="font-sans text-[22px] font-light tracking-[-0.02em] text-tx">
                  <Metric value={report.longest_run_words} />
                </div>
                <div className="font-mono text-[10px] text-tx3">longest run (words)</div>
              </div>
              <div>
                <div className="font-sans text-[22px] font-light tracking-[-0.02em] text-tx">
                  <Metric value={report.self_corrections} />
                </div>
                <div className="font-mono text-[10px] text-tx3">self-corrections</div>
              </div>
              <div>
                <div className="font-sans text-[22px] font-light tracking-[-0.02em] text-tx">{report.turn_count}</div>
                <div className="font-mono text-[10px] text-tx3">turns</div>
              </div>
            </div>
            {report.above_level_words.length > 0 && (
              <div className="mt-3 border-t border-line2 pt-[10px]">
                <div className="mb-[6px] font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-tx3">
                  Above your level · {report.above_level_words.length}
                </div>
                <div className="flex flex-wrap gap-[5px]">
                  {report.above_level_words.map((w) => (
                    <span
                      key={w}
                      className="rounded-full border border-accLine px-[8px] py-[2px] font-mono text-[10px] text-acc"
                    >
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3 border-t border-line2 pt-[10px] font-mono text-[9.5px] leading-[1.6] text-tx3">
              words/min is measured from your speech only · pronunciation is an stt_proxy, not a phoneme score
            </div>
          </div>
          <div className="rounded-panel border border-accLine bg-accSoft p-[18px]">
            <div className="mb-[9px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-acc">
              Summary
            </div>
            <div className="font-sans text-[13px] leading-[1.7] text-tx">{report.summary}</div>
            <div className="mt-[14px] flex gap-2">
              <button
                onClick={() => void handlePractiseAgain()}
                disabled={practising}
                title="Starts a new conversation in the same scenario with these same target words"
                className="rounded-field bg-acc px-[13px] py-[9px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
              >
                {practising ? 'starting…' : 'Practise this again'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
