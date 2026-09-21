import { useEffect, useMemo, type ReactNode } from 'react';
import { CALENDAR_DAYS, useDashboardStore } from '@/store/dashboardStore';
import { posterUrl, useMediaStore } from '@/store/mediaStore';
import { useShellStore } from '@/store/shellStore';
import type { DayActivityOut } from '@/types/api';

/** h:mm:ss, or m:ss below an hour. */
function timecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

const HEAT_LEVEL_BG = [
  'var(--line2)',
  'rgba(var(--accRGB),.22)',
  'rgba(var(--accRGB),.42)',
  'rgba(var(--accRGB),.68)',
  'var(--acc)',
];

/* A day's shade. Pages and cards are different units, so they are weighted
 * into one "did something happen here" score rather than compared: the
 * calendar answers whether the reader showed up, not what they did. */
function heatLevel(day: DayActivityOut): number {
  const score = day.pages + day.reviews / 3 + day.minutes / 10;
  if (score <= 0) return 0;
  if (score < 3) return 1;
  if (score < 8) return 2;
  if (score < 16) return 3;
  return 4;
}

function dayTip(day: DayActivityOut): string {
  if (!day.pages && !day.reviews && !day.minutes) return `${day.date} · nothing`;
  const parts = [
    day.pages ? `${day.pages} page${day.pages === 1 ? '' : 's'}` : null,
    day.reviews ? `${day.reviews} review${day.reviews === 1 ? '' : 's'}` : null,
    day.minutes ? `${day.minutes} min` : null,
  ].filter(Boolean);
  return `${day.date} · ${parts.join(' · ')}`;
}

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

/** Shown in place of a number that has not arrived, so a card never prints a
 * confident zero it has not earned. */
function Pending() {
  return <span className="text-tx3">—</span>;
}

export function Dashboard() {
  const goScreen = useShellStore((s) => s.goScreen);
  const goPlayer = useShellStore((s) => s.goPlayer);
  const goReader = useShellStore((s) => s.goReader);
  const goWord = useShellStore((s) => s.goWord);
  const heatTip = useShellStore((s) => s.heatTip);
  const setHeatTip = useShellStore((s) => s.setHeatTip);

  const recentMedia = useMediaStore((s) => s.recent);
  const fetchLibrary = useMediaStore((s) => s.fetchLibrary);

  const review = useDashboardStore((s) => s.review);
  const reading = useDashboardStore((s) => s.reading);
  const activity = useDashboardStore((s) => s.activity);
  const recentWords = useDashboardStore((s) => s.recentWords);
  const continueReading = useDashboardStore((s) => s.continueReading);
  const status = useDashboardStore((s) => s.status);
  const error = useDashboardStore((s) => s.error);
  const load = useDashboardStore((s) => s.load);

  useEffect(() => {
    void fetchLibrary();
    void load();
  }, [fetchLibrary, load]);

  const dueTotal = review ? review.due_now + review.new_available : 0;
  // Roughly fifteen seconds a card, which is what the review screen's own
  // pacing works out at. Stated as an estimate because it is one.
  const dueMinutes = Math.max(1, Math.round((dueTotal * 15) / 60));

  const forecastMax = useMemo(
    () => Math.max(1, ...(review?.forecast ?? []).map((f) => f.count)),
    [review],
  );

  const goalPercent = reading
    ? Math.min(100, Math.round((reading.pages_today / Math.max(1, reading.goal_pages)) * 100))
    : 0;

  const calendar = activity?.days ?? [];

  return (
    <div className="flex w-full flex-col gap-[14px] p-[var(--pad)]">
      {status === 'error' && (
        <div className="rounded-panel border border-line2 bg-panel px-[18px] py-[13px] font-mono text-[11px] text-tx2">
          {error} ·{' '}
          <button onClick={() => void load()} className="text-acc hover:underline">
            try again
          </button>
        </div>
      )}

      <div className="grid grid-cols-[1.35fr_1fr] gap-[14px]">
        <Card className="flex flex-col gap-[14px]">
          <CardLabel>Due now</CardLabel>
          <div className="flex items-end gap-3">
            <div className="font-sans text-[54px] font-light leading-[0.85] tracking-[-0.035em] text-tx">
              {review ? dueTotal : <Pending />}
            </div>
            <div className="pb-[5px] font-sans text-[11.5px] leading-[1.5] text-tx2">
              {review ? (
                <>
                  cards · ≈{dueMinutes} min
                  <br />
                  {review.due_now} due · {review.new_available} new · {review.reviewed_today} done
                  today
                </>
              ) : (
                'loading…'
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => goScreen('review')}
              disabled={review !== null && dueTotal === 0}
              className="flex-1 rounded-field bg-accSolid py-[10px] font-sans text-[12.5px] font-semibold text-white hover:brightness-110 disabled:cursor-default disabled:opacity-40 disabled:hover:brightness-100"
            >
              {review && dueTotal === 0 ? 'Nothing due' : 'Start review session'}
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
              style={{ background: `conic-gradient(var(--acc) ${(goalPercent / 100) * 360}deg, var(--line2) 0)` }}
            >
              <div className="grid h-[60px] w-[60px] place-items-center rounded-full bg-panel font-mono text-[15px] font-semibold text-tx">
                {reading ? `${goalPercent}%` : '—'}
              </div>
            </div>
            <div className="font-sans text-[11.5px] leading-[1.7] text-tx2">
              {reading ? (
                <>
                  <div className={reading.goal_met ? '' : 'text-tx3'}>
                    {reading.goal_met ? '✓' : '—'} {reading.pages_today} of {reading.goal_pages} pages
                  </div>
                  <div className={review && review.reviewed_today > 0 ? '' : 'text-tx3'}>
                    {review && review.reviewed_today > 0 ? '✓' : '—'} {review?.reviewed_today ?? 0}{' '}
                    reviews cleared
                  </div>
                  <div className="text-tx3">
                    {reading.streak_days} day{reading.streak_days === 1 ? '' : 's'} in a row
                  </div>
                </>
              ) : (
                'loading…'
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="mb-[14px] flex items-baseline justify-between">
          <CardLabel>Consistency · last {CALENDAR_DAYS} days</CardLabel>
          <div className="font-mono text-[10.5px] text-tx3">
            {heatTip ||
              (activity
                ? `${activity.active_days} active days · ${activity.total_pages} pages · ${activity.total_reviews} reviews`
                : 'loading…')}
          </div>
        </div>
        <div className="grid grid-flow-col gap-[3px] overflow-hidden" style={{ gridTemplateRows: 'repeat(7, 10px)' }}>
          {calendar.map((d) => (
            <div
              key={d.date}
              title={dayTip(d)}
              onMouseEnter={() => setHeatTip(dayTip(d))}
              onMouseLeave={() => setHeatTip('')}
              className="h-[10px] w-[10px] rounded-[2px] hover:outline hover:outline-1 hover:outline-tx2"
              style={{ background: HEAT_LEVEL_BG[heatLevel(d)] }}
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
            {(review?.forecast ?? []).map((f, i) => (
              <div
                key={f.date}
                title={`${f.date} · ${f.count} card${f.count === 1 ? '' : 's'}`}
                className="min-h-[3px] flex-1 rounded-t-[2px] hover:bg-acc"
                style={{
                  height: `${(f.count / forecastMax) * 100}%`,
                  background: i === 0 ? 'var(--acc)' : 'var(--line)',
                }}
              />
            ))}
            {!review && <div className="font-mono text-[10px] text-tx3">loading…</div>}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[9.5px] text-tx3">
            <span>today</span>
            <span>peak {forecastMax}</span>
            <span>+{Math.max(0, (review?.forecast.length ?? 1) - 1)}d</span>
          </div>
        </Card>

        <Card>
          <div className="mb-[14px]">
            <CardLabel>Continue</CardLabel>
          </div>
          <div className="flex flex-col gap-[9px]">
            {recentMedia.slice(0, 1).map((m) => (
              <button
                key={m.id}
                onClick={() => goPlayer(m.id, m.title)}
                className="flex items-center gap-3 rounded-panel border border-line2 p-2 text-left hover:border-acc"
              >
                <div
                  className="grid h-11 w-[72px] flex-none place-items-center overflow-hidden rounded-[5px] font-mono text-[7.5px] text-tx3"
                  style={{ background: 'repeating-linear-gradient(135deg,var(--tile) 0 5px,var(--tileB) 5px 10px)' }}
                >
                  {m.has_thumbnail ? (
                    <img src={posterUrl(m.id)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    'video'
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-sans text-[12.5px] font-semibold text-tx">{m.title}</div>
                  <div className="my-[3px] font-mono text-[10.5px] text-tx3">
                    {timecode(m.position_ms ?? 0)} / {timecode(m.duration_ms)} · {m.saves} saves
                  </div>
                  <div className="h-[3px] rounded-field bg-line2">
                    <div
                      className="h-[3px] rounded-field bg-acc"
                      style={{ width: `${m.percent_complete ?? 0}%` }}
                    />
                  </div>
                </div>
              </button>
            ))}
            {continueReading.slice(0, 2).map((b) => (
              <button
                key={b.id}
                onClick={() => goReader(b.id, b.title)}
                className="flex items-center gap-3 rounded-panel border border-line2 p-2 text-left hover:border-acc"
              >
                <div
                  className="grid h-11 w-[72px] flex-none place-items-center rounded-[5px] font-mono text-[7.5px] text-tx3"
                  style={{ background: 'repeating-linear-gradient(135deg,var(--tile) 0 5px,var(--tileB) 5px 10px)' }}
                >
                  {b.format}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-sans text-[12.5px] font-semibold text-tx">{b.title}</div>
                  <div className="my-[3px] truncate font-mono text-[10.5px] text-tx3">
                    {Math.round(b.percent)}% · {b.page_estimate} pages
                    {b.author ? ` · ${b.author}` : ''}
                  </div>
                  <div className="h-[3px] rounded-field bg-line2">
                    <div className="h-[3px] rounded-field bg-acc" style={{ width: `${b.percent}%` }} />
                  </div>
                </div>
              </button>
            ))}
            {status === 'ready' && continueReading.length === 0 && recentMedia.length === 0 && (
              <button
                onClick={() => goScreen('bookshelf')}
                className="rounded-panel border border-dashed border-line2 py-[18px] text-center font-mono text-[10.5px] text-tx3 hover:border-acc hover:text-acc"
              >
                nothing open yet · go to the bookshelf
              </button>
            )}
          </div>
        </Card>

        <button
          onClick={() => goScreen('bookshelf')}
          className="flex flex-col rounded-panel border border-line2 bg-panel p-[18px] text-left shadow-panel hover:border-acc"
        >
          <div className="mb-[14px] flex w-full items-baseline justify-between">
            <CardLabel>Reading goal</CardLabel>
            <span className="font-mono text-[9.5px] text-tx3">
              {reading ? `${reading.streak_days}-day` : ''}
            </span>
          </div>
          <div className="flex w-full items-center gap-[13px]">
            <div
              className="grid h-[52px] w-[52px] flex-none place-items-center rounded-full"
              style={{ background: `conic-gradient(var(--acc) ${(goalPercent / 100) * 360}deg, var(--line2) 0)` }}
            >
              <div className="grid h-10 w-10 place-items-center rounded-full bg-panel font-mono text-[11px] font-semibold text-tx">
                {reading?.pages_today ?? '—'}
              </div>
            </div>
            <div className="min-w-0">
              <div className="font-sans text-[11.5px] leading-[1.5] text-tx2">
                of {reading?.goal_pages ?? '—'} pages today
              </div>
              <div className="mt-[3px] font-mono text-[9.5px] text-tx3">
                {reading ? `${reading.week.filter((d) => d.percent >= 100).length} of 7 days this week` : ''}
              </div>
            </div>
          </div>
          <div className="mt-4 grid w-full grid-cols-7 gap-1">
            {(reading?.week ?? []).map((d) => (
              <div key={d.date} title={`${d.date} · ${d.pages} pages`}>
                <div className="flex h-[26px] items-end overflow-hidden rounded-[4px] bg-line2">
                  <div
                    className="w-full"
                    style={{
                      height: `${d.percent}%`,
                      background:
                        d.percent >= 100
                          ? 'var(--acc)'
                          : d.percent === 0
                            ? 'var(--line2)'
                            : 'rgba(var(--accRGB),.4)',
                    }}
                  />
                </div>
                <div className="mt-[3px] text-center font-mono text-[8.5px] text-tx3">{d.label}</div>
              </div>
            ))}
          </div>
        </button>
      </div>

      <Card>
        <div className="mb-[14px] flex items-baseline justify-between">
          <CardLabel>Recently saved words</CardLabel>
          <button
            onClick={() => goScreen('vocab')}
            className="font-mono text-[9.5px] text-acc hover:underline"
          >
            all words
          </button>
        </div>
        <div className="flex flex-wrap gap-[10px]">
          {recentWords.map((w) => (
            <button
              key={w.id}
              onClick={() => goWord(w.word)}
              className="w-[150px] overflow-hidden rounded-panel border border-line2 px-[11px] py-[9px] text-left hover:border-acc"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-sans text-[12.5px] font-semibold text-tx">{w.word}</span>
                {w.cefr && <span className="flex-none font-mono text-[9px] text-tx3">{w.cefr}</span>}
              </div>
              <div className="mt-[3px] line-clamp-2 font-sans text-[10.5px] leading-[1.5] text-tx3">
                {w.definition ?? w.ai_definition ?? 'no definition yet'}
              </div>
            </button>
          ))}
          {status === 'ready' && recentWords.length === 0 && (
            <div className="font-mono text-[10.5px] text-tx3">
              No words saved yet · look one up while reading and it lands here.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
