import { useMemo, useState } from 'react';
import {
  BIOME_DATA,
  DEFAULT_BIOME,
  DEFAULT_FOCUS_DURATION,
  FOCUS_DURATIONS,
  FOREST_LEVEL,
  GROWTH_STAGES,
  STAGE_CANOPY,
  STAGE_COLOR_DAY,
  STAGE_COLOR_NIGHT,
  STAGE_STEM,
  WEEKLY_CHALLENGE,
  buildTiles,
} from '@/features/forest/forestMockData';

export function Forest() {
  const [biome, setBiome] = useState(DEFAULT_BIOME);
  const [night, setNight] = useState(false);
  const [hover, setHover] = useState<{ word: string; meta: string } | null>(null);
  const [focusDuration, setFocusDuration] = useState(DEFAULT_FOCUS_DURATION);
  const [planted, setPlanted] = useState(false);

  const tiles = useMemo(() => buildTiles(biome), [biome]);
  const stageColors = night ? STAGE_COLOR_NIGHT : STAGE_COLOR_DAY;
  const sky = night ? 'var(--bg2)' : 'var(--bg)';
  const xpPct = Math.min(100, Math.round((FOREST_LEVEL.xp / FOREST_LEVEL.nextXp) * 100));
  const challengePct = Math.min(100, Math.round((WEEKLY_CHALLENGE.done / WEEKLY_CHALLENGE.target) * 100));

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden" style={{ background: sky }}>
        <div className="z-[5] flex flex-none flex-wrap items-center gap-[6px] p-[12px_var(--pad)]">
          {BIOME_DATA.map((b) => {
            const on = b.key === biome;
            return (
              <button
                key={b.key}
                onClick={() => setBiome(b.key)}
                className="rounded-full border px-[11px] py-[6px] font-sans text-[11px] font-medium"
                style={{
                  borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                  background: on ? 'var(--accSoft)' : 'transparent',
                  color: on ? 'var(--acc)' : 'var(--tx2)',
                }}
              >
                {b.n} <span className="font-mono text-[9.5px] opacity-60">{b.c}</span>
              </button>
            );
          })}
          <div className="flex-1" />
          <button
            onClick={() => setNight((v) => !v)}
            className="rounded-field border border-line px-[11px] py-[6px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc"
          >
            {night ? '☾ night' : '☀ day'}
          </button>
        </div>

        <div className="grid min-h-0 flex-1 place-items-center" style={{ perspective: 1200 }}>
          <div
            className="relative"
            style={{
              width: 600,
              height: 600,
              transform: 'rotateX(58deg) rotateZ(45deg) scale(.86)',
              transformStyle: 'preserve-3d',
            }}
          >
            {tiles.map((t, i) => {
              const pc = t.dormant ? '#6a6a66' : stageColors[t.stage];
              const sc = t.dormant ? '#57574f' : '#4a5a45';
              const op = t.dormant ? 0.45 : 1;
              return (
                <div
                  key={i}
                  onMouseEnter={() =>
                    setHover({
                      word: t.word + (t.dormant ? ' · dormant' : ''),
                      meta: `stage ${t.stage} · health ${t.health} · stability ${t.stability} d\n${
                        t.stage >= 3 ? `${t.spontaneousUses} spontaneous uses` : 'no conversational use yet'
                      }`,
                    })
                  }
                  className="absolute"
                  style={{
                    left: t.x,
                    top: t.y,
                    width: 60,
                    height: 60,
                    background: t.checker ? 'var(--tile)' : 'var(--tileB)',
                    border: `1px solid ${night ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.03)'}`,
                    transformStyle: 'preserve-3d',
                  }}
                >
                  <div
                    className="pointer-events-none absolute left-1/2 flex flex-col items-center"
                    style={{
                      bottom: 26,
                      transform: 'translateX(-50%) rotateZ(-45deg) rotateX(-58deg)',
                      transformOrigin: 'bottom center',
                    }}
                  >
                    <div
                      className="rounded-full"
                      style={{ width: STAGE_CANOPY[t.stage], height: STAGE_CANOPY[t.stage], background: pc, opacity: op }}
                    />
                    <div style={{ width: 2, height: STAGE_STEM[t.stage], background: sc, opacity: op }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-4 left-[var(--pad)] z-[5] font-mono text-[10px] leading-[1.7] text-tx3">
          positions are the 2D projection of each word's embedding —
          <br />a dense thicket is a mastered semantic field, bare seeds are a gap
        </div>
        {hover && (
          <div className="absolute bottom-4 right-[var(--pad)] z-[6] rounded-field border border-line2 bg-panel px-[13px] py-[11px] shadow-panel">
            <div className="font-sans text-[13px] font-semibold text-tx">{hover.word}</div>
            <div className="mt-1 whitespace-pre-line font-mono text-[10px] leading-[1.6] text-tx3">{hover.meta}</div>
          </div>
        )}
      </div>

      <aside className="flex w-[264px] flex-none flex-col gap-[18px] overflow-y-auto border-l border-line2 bg-panel p-[18px]">
        <div>
          <div className="flex items-baseline gap-2">
            <div className="font-sans text-[30px] font-light tracking-[-0.03em] text-tx">{FOREST_LEVEL.level}</div>
            <div className="font-mono text-[11px] text-tx3">level · {FOREST_LEVEL.xp.toLocaleString()} XP</div>
          </div>
          <div className="mt-2 h-1 rounded-field bg-line2">
            <div className="h-1 rounded-field bg-acc" style={{ width: `${xpPct}%` }} />
          </div>
          <div className="mt-[6px] font-mono text-[10px] text-tx3">
            ☀ {FOREST_LEVEL.sunlight} sunlight · {FOREST_LEVEL.streakFreezes} streak freezes held
          </div>
        </div>

        <div>
          <div className="mb-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Growth stages
          </div>
          <div className="flex flex-col gap-[7px]">
            {GROWTH_STAGES.map((s, i) => (
              <div key={s.n} className="flex items-center gap-[9px]">
                <span
                  className="flex-none rounded-full"
                  style={{ width: s.dot, height: s.dot, background: night ? STAGE_COLOR_NIGHT[i] : STAGE_COLOR_DAY[i] }}
                />
                <span className="flex-1 font-sans text-[11.5px] font-medium text-tx">{s.n}</span>
                <span className="font-mono text-[10px] text-tx3">{s.count}</span>
              </div>
            ))}
          </div>
          <div className="mt-[10px] border-t border-line2 pt-[9px] font-mono text-[10px] leading-[1.6] text-tx3">
            stage 3+ is unreachable by flashcards alone — it requires correct use in conversation
          </div>
        </div>

        <div>
          <div className="mb-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Focus session
          </div>
          <div className="rounded-field border border-line2 p-3">
            <div className="flex gap-[5px]">
              {FOCUS_DURATIONS.map((d) => {
                const on = d === focusDuration;
                return (
                  <button
                    key={d}
                    onClick={() => setFocusDuration(d)}
                    className="flex-1 rounded-field border py-[6px] font-mono text-[10.5px] font-medium"
                    style={{
                      borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                      background: on ? 'var(--accSoft)' : 'transparent',
                      color: on ? 'var(--acc)' : 'var(--tx2)',
                    }}
                  >
                    {d}m
                  </button>
                );
              })}
            </div>
            <div className="mt-[10px] font-mono text-[10px] leading-[1.6] text-tx3">
              success = time in app + engagement (≥3 saves while watching). We do not monitor other apps.
            </div>
            <button
              onClick={() => setPlanted(true)}
              className="mt-[10px] w-full rounded-field bg-acc py-2 font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
            >
              {planted ? `${focusDuration}m session queued ✓` : 'Plant a memorial tree'}
            </button>
          </div>
        </div>

        <div>
          <div className="mb-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Weekly challenge
          </div>
          <div className="font-sans text-[12px] leading-[1.6] text-tx2">{WEEKLY_CHALLENGE.label}</div>
          <div className="mt-2 h-1 rounded-field bg-line2">
            <div className="h-1 rounded-field bg-acc" style={{ width: `${challengePct}%` }} />
          </div>
          <div className="mt-[5px] font-mono text-[10px] text-tx3">
            {WEEKLY_CHALLENGE.done} / {WEEKLY_CHALLENGE.target} · +{WEEKLY_CHALLENGE.xp} XP
          </div>
        </div>
      </aside>
    </div>
  );
}
