// Deterministic mock data ported from claude-ui-mockup-files/FluencyOS.html's
// renderVals() dashboard section — no dashboard-data backend exists yet
// (analytics/gamification per spec §7/§8 are future increments).

function rnd(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return (x >>> 8) / 8388608;
  };
}

export interface SparkBar {
  h: number;
  accent: boolean;
}

export const SPARK: SparkBar[] = (() => {
  const r1 = rnd(91);
  return Array.from({ length: 42 }, (_, i) => ({
    h: Math.round(24 + i * 1.35 + r1() * 16),
    accent: i > 36,
  }));
})();

export interface HeatCell {
  level: 0 | 1 | 2 | 3 | 4;
  tip: string;
}

export const HEAT: HeatCell[] = (() => {
  const r2 = rnd(1337);
  return Array.from({ length: 371 }, (_, i) => {
    const v = r2();
    const level = (
      i > 340 ? (v < 0.12 ? 1 : v < 0.4 ? 2 : v < 0.72 ? 3 : 4) : v < 0.3 ? 0 : v < 0.52 ? 1 : v < 0.74 ? 2 : v < 0.92 ? 3 : 4
    ) as HeatCell['level'];
    const tip = `${12 + Math.round(v * 40)} reviews · ${Math.round(v * 6)} new words · ${Math.round(8 + v * 40)} min`;
    return { level, tip };
  });
})();

export interface ForecastBar {
  h: number;
  today: boolean;
  label: string;
}

export const FORECAST: ForecastBar[] = (() => {
  const r3 = rnd(55);
  return Array.from({ length: 30 }, (_, i) => {
    const v = Math.round(18 + r3() * 70);
    return { h: v, today: i === 0, label: `+${i}d · ${Math.round(v * 0.9)} cards` };
  });
})();

export interface ResumeItem {
  kind: string;
  title: string;
  meta: string;
  pct: number;
  target: 'player' | 'bookshelf';
}

export const RESUME: ResumeItem[] = [
  { kind: 'video 480p', title: 'Arrival (2016)', meta: '01:14:22 / 02:01:38 · 34 saves', pct: 61, target: 'player' },
  { kind: 'epub', title: 'The Overstory — R. Powers', meta: 'page 118 / 342 · 51 saves', pct: 34, target: 'bookshelf' },
  { kind: 'video url', title: 'Kurzgesagt — Immune System', meta: '04:02 / 09:41 · 7 saves', pct: 42, target: 'player' },
];

export interface RecentWord {
  word: string;
  src: string;
}

export const RECENT: RecentWord[] = [
  { word: 'reticent', src: 'Arrival · 01:14:22' },
  { word: 'stark', src: 'The Overstory · p.114' },
  { word: 'mitigate', src: 'conversation · Tue' },
  { word: 'ostensibly', src: 'The Economist · p.31' },
  { word: 'throttle', src: 'Kurzgesagt · 04:02' },
  { word: 'brackish', src: 'Arrival · 00:52:10' },
];

export const GOAL_WEEK: Array<{ n: string; h: number }> = [
  { n: 'M', h: 100 },
  { n: 'T', h: 80 },
  { n: 'W', h: 45 },
  { n: 'T', h: 100 },
  { n: 'F', h: 0 },
  { n: 'S', h: 100 },
  { n: 'S', h: 70 },
];

export const READING_GOAL = { done: 14, target: 20 };
export const DAILY_GOAL_DEG = 245; // out of 360, matches mockup's hardcoded ring fill
