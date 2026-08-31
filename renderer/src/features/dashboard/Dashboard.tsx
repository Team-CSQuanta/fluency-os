import type { ReactNode } from 'react';
import {
  DAILY_GOAL_DEG,
  FORECAST,
  GOAL_WEEK,
  HEAT,
  READING_GOAL,
  RECENT,
  RESUME,
  SPARK,
} from '@/features/dashboard/dashboardMockData';
import { useShellStore } from '@/store/shellStore';

const HEAT_LEVEL_BG = [
  'var(--line2)',
  'rgba(62,124,90,.22)',
  'rgba(62,124,90,.42)',
  'rgba(62,124,90,.68)',
  'var(--acc)',
];

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-panel border border-line2 bg-panel p-[18px] shadow-panel ${className}`}>{children}</div>
  );
}

function CardLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">{children}</div>
  );
}

export function Dashboard() {
  const goScreen = useShellStore((s) => s.goScreen);
  const goPlayer = useShellStore((s) => s.goPlayer);
  const heatTip = useShellStore((s) => s.heatTip);
  const setHeatTip = useShellStore((s) => s.setHeatTip);

  return (
    <div className="flex w-full flex-col gap-[14px] p-[var(--pad)]">
      <div className="grid grid-cols-[1.35fr_1fr_1fr] gap-[14px]">
        <Card className="flex flex-col gap-[14px]">
          <CardLabel>Due now</CardLabel>
          <div className="flex items-end gap-3">
            <div className="font-sans text-[54px] font-light leading-[0.85] tracking-[-0.035em] text-tx">47</div>
            <div className="pb-[5px] font-sans text-[11.5px] leading-[1.5] text-tx2">
              cards · ≈12 min
              <br />
              18 recognition · 14 cloze · 9 production · 6 listening
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => goScreen('review')}
              className="flex-1 rounded-field bg-acc py-[10px] font-sans text-[12.5px] font-semibold text-white hover:brightness-110"
            >
              Start review session
            </button>
            <button
              onClick={() => goScreen('conv')}
              className="rounded-field border border-line px-[14px] py-[10px] font-sans text-[12.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
            >
              Converse instead
            </button>
          </div>
        </Card>

        <Card>
          <CardLabel>Daily goal</CardLabel>
          <div className="mt-[14px] flex items-center gap-4">
            <div
              className="grid h-[76px] w-[76px] flex-none place-items-center rounded-full"
              style={{ background: `conic-gradient(var(--acc) ${DAILY_GOAL_DEG}deg, var(--line2) 0)` }}
            >
              <div className="grid h-[60px] w-[60px] place-items-center rounded-full bg-panel font-mono text-[15px] font-semibold text-tx">
                68%
              </div>
            </div>
            <div className="font-sans text-[11.5px] leading-[1.7] text-tx2">
              <div>✓ 20 reviews cleared</div>
              <div>✓ 15 min of media</div>
              <div className="text-tx3">— 3-min conversation</div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardLabel>Fluency index</CardLabel>
          <div className="mt-2 flex items-baseline gap-2">
            <div className="font-sans text-[38px] font-light leading-[1] tracking-[-0.03em] text-tx">612</div>
            <div className="font-mono text-[11px] font-medium text-acc">+28 / 30d</div>
          </div>
          <div className="mt-[14px] flex h-[52px] flex-1 items-end gap-[2px]">
            {SPARK.map((b, i) => (
              <div
                key={i}
                className="min-h-[2px] flex-1 rounded-t-[1px]"
                style={{ height: `${b.h}%`, background: b.accent ? 'var(--acc)' : 'var(--line)' }}
              />
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="mb-[14px] flex items-baseline justify-between">
          <CardLabel>Consistency · last 365 days</CardLabel>
          <div className="font-mono text-[10.5px] text-tx3">{heatTip}</div>
        </div>
        <div className="grid grid-flow-col gap-[3px] overflow-hidden" style={{ gridTemplateRows: 'repeat(7, 10px)' }}>
          {HEAT.map((c, i) => (
            <div
              key={i}
              onMouseEnter={() => setHeatTip(c.tip)}
              className="h-[10px] w-[10px] cursor-pointer rounded-[2px] hover:outline hover:outline-1 hover:outline-tx2"
              style={{ background: HEAT_LEVEL_BG[c.level] }}
            />
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-[1.05fr_1.05fr_0.78fr] gap-[14px]">
        <Card>
          <div className="mb-[14px]">
            <CardLabel>Upcoming load · 30 days</CardLabel>
          </div>
          <div className="flex h-[96px] items-end gap-[3px]">
            {FORECAST.map((b, i) => (
              <div
                key={i}
                title={b.label}
                className="min-h-[3px] flex-1 rounded-t-[2px] hover:bg-acc"
                style={{ height: `${b.h}%`, background: b.today ? 'var(--acc)' : 'var(--line)' }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[9.5px] text-tx3">
            <span>today</span>
            <span>+15d</span>
            <span>+30d</span>
          </div>
        </Card>

        <Card>
          <div className="mb-[14px]">
            <CardLabel>Continue</CardLabel>
          </div>
          <div className="flex flex-col gap-[9px]">
            {RESUME.map((r) => (
              <button
                key={r.title}
                onClick={() => (r.target === 'player' ? goPlayer(r.title) : goScreen(r.target))}
                className="flex items-center gap-3 rounded-panel border border-line2 p-2 text-left hover:border-acc"
              >
                <div
                  className="grid h-11 w-[72px] flex-none place-items-center rounded-[5px] font-mono text-[7.5px] text-tx3"
                  style={{ background: 'repeating-linear-gradient(135deg,var(--tile) 0 5px,var(--tileB) 5px 10px)' }}
                >
                  {r.kind}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-sans text-[12.5px] font-semibold text-tx">{r.title}</div>
                  <div className="my-[3px] font-mono text-[10.5px] text-tx3">{r.meta}</div>
                  <div className="h-[3px] rounded-field bg-line2">
                    <div className="h-[3px] rounded-field bg-acc" style={{ width: `${r.pct}%` }} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <button
          onClick={() => goScreen('bookshelf')}
          className="flex flex-col rounded-panel border border-line2 bg-panel p-[18px] text-left shadow-panel hover:border-acc"
        >
          <div className="mb-[14px] flex w-full items-baseline justify-between">
            <CardLabel>Reading goal</CardLabel>
            <span className="font-mono text-[9.5px] text-tx3">11-day</span>
          </div>
          <div className="flex w-full items-center gap-[13px]">
            <div
              className="grid h-[52px] w-[52px] flex-none place-items-center rounded-full"
              style={{
                background: `conic-gradient(var(--acc) ${Math.round(
                  Math.min(1, READING_GOAL.done / READING_GOAL.target) * 360,
                )}deg, var(--line2) 0)`,
              }}
            >
              <div className="grid h-10 w-10 place-items-center rounded-full bg-panel font-mono text-[11px] font-semibold text-tx">
                {READING_GOAL.done}
              </div>
            </div>
            <div className="min-w-0">
              <div className="font-sans text-[11.5px] leading-[1.5] text-tx2">of {READING_GOAL.target} pages today</div>
              <div className="mt-[3px] font-mono text-[9.5px] text-tx3">6 of 7 days this week</div>
            </div>
          </div>
          <div className="mt-4 grid w-full grid-cols-7 gap-1">
            {GOAL_WEEK.map((d, i) => (
              <div key={i}>
                <div className="flex h-[26px] items-end overflow-hidden rounded-[4px] bg-line2">
                  <div
                    className="w-full"
                    style={{ height: `${d.h}%`, background: d.h >= 100 ? 'var(--acc)' : d.h === 0 ? 'var(--line2)' : 'rgba(62,124,90,.4)' }}
                  />
                </div>
                <div className="mt-[3px] text-center font-mono text-[8.5px] text-tx3">{d.n}</div>
              </div>
            ))}
          </div>
        </button>
      </div>

      <Card>
        <div className="mb-[14px]">
          <CardLabel>Recent acquisitions</CardLabel>
        </div>
        <div className="flex flex-wrap gap-[10px]">
          {RECENT.map((w) => (
            <button
              key={w.word}
              onClick={() => goScreen('vocab')}
              className="w-[150px] overflow-hidden rounded-panel border border-line2 text-left hover:border-acc"
            >
              <div
                className="grid h-[76px] place-items-center font-mono text-[7.5px] text-tx3"
                style={{ background: 'repeating-linear-gradient(135deg,var(--tile) 0 5px,var(--tileB) 5px 10px)' }}
              >
                clip thumbnail
              </div>
              <div className="px-[9px] py-2">
                <div className="font-sans text-[12.5px] font-semibold text-tx">{w.word}</div>
                <div className="mt-[2px] truncate font-mono text-[9.5px] text-tx3">{w.src}</div>
              </div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
