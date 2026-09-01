// Ported from claude-ui-mockup-files/FluencyOS.html's isConvList / isConvLive
// sections — no LLM + STT + TTS pipeline exists yet (spec §6, §13), so the
// session list, live transcript, and companion sidebar are static mock data.

export interface ConvStat {
  k: string;
  v: string;
  fg: string;
}

export const CONV_STATS: ConvStat[] = [
  { k: 'sessions', v: '28', fg: 'var(--tx)' },
  { k: 'this week', v: '4', fg: 'var(--tx)' },
  { k: 'avg score', v: '82', fg: 'var(--acc)' },
];

export interface ConvScenario {
  n: string;
  k: string;
}

export const CONV_SCENARIOS: ConvScenario[] = [
  { n: 'Free talk', k: '~10 m' },
  { n: 'Order coffee', k: '~3 m' },
  { n: 'Job interview', k: '~8 m' },
  { n: 'Debate a topic', k: '~12 m' },
];

export interface ConvHistoryItem {
  kind: string;
  avBg: string;
  avFg: string;
  title: string;
  meta: string;
  pct: number;
  used: string;
  score: string;
  scoreBg: string;
  scoreFg: string;
  action: string;
}

export const CONV_HISTORY: ConvHistoryItem[] = [
  {
    kind: 'free',
    avBg: 'var(--accSoft)',
    avFg: 'var(--acc)',
    title: 'Free talk',
    meta: '24 Aug · 8 m 12 s · 6 turns',
    pct: 75,
    used: '6/8',
    score: '82',
    scoreBg: 'var(--accSoft)',
    scoreFg: 'var(--acc)',
    action: 'report',
  },
  {
    kind: 'job',
    avBg: 'var(--tile)',
    avFg: 'var(--tx3)',
    title: 'Job interview',
    meta: '21 Aug · 11 m 40 s · 14 turns',
    pct: 50,
    used: '4/8',
    score: '74',
    scoreBg: 'var(--tile)',
    scoreFg: 'var(--tx2)',
    action: 'report',
  },
  {
    kind: 'debate',
    avBg: 'var(--tile)',
    avFg: 'var(--tx3)',
    title: 'Debate a topic',
    meta: '18 Aug · 9 m 03 s · 9 turns',
    pct: 25,
    used: '2/8',
    score: '61',
    scoreBg: 'var(--tile)',
    scoreFg: 'var(--tx2)',
    action: 'report',
  },
  {
    kind: 'coffee',
    avBg: 'var(--tile)',
    avFg: 'var(--tx3)',
    title: 'Order coffee',
    meta: '12 Aug · 3 m 51 s · 7 turns',
    pct: 88,
    used: '7/8',
    score: '90',
    scoreBg: 'var(--accSoft)',
    scoreFg: 'var(--acc)',
    action: 'report',
  },
  {
    kind: 'free',
    avBg: 'var(--tile)',
    avFg: 'var(--tx3)',
    title: 'Free talk',
    meta: '9 Aug · 6 m 20 s · 5 turns',
    pct: 38,
    used: '3/8',
    score: '68',
    scoreBg: 'var(--tile)',
    scoreFg: 'var(--tx2)',
    action: 'report',
  },
];

export interface ConvTurn {
  dir: 'row' | 'row-reverse';
  align: 'flex-start' | 'flex-end';
  av: string;
  avBg: string;
  avFg: string;
  bg: string;
  bd: string;
  fg: string;
  text: string;
  meta: string;
  metaAlign: 'left' | 'right';
}

export const CONV_TURNS: ConvTurn[] = [
  {
    dir: 'row',
    align: 'flex-start',
    av: 'fox',
    avBg: 'var(--accSoft)',
    avFg: 'var(--acc)',
    bg: 'var(--panel)',
    bd: 'var(--line2)',
    fg: 'var(--tx)',
    text: 'So — how has the week been? Anything worth complaining about?',
    meta: 'Juno · 0:04',
    metaAlign: 'left',
  },
  {
    dir: 'row-reverse',
    align: 'flex-end',
    av: 'you',
    avBg: 'var(--tile)',
    avFg: 'var(--tx3)',
    bg: 'var(--accSoft)',
    bd: 'var(--accLine)',
    fg: 'var(--tx)',
    text: 'Honestly, it was fine. A bit slow, nothing dramatic happened.',
    meta: '0:11',
    metaAlign: 'right',
  },
  {
    dir: 'row',
    align: 'flex-start',
    av: 'fox',
    avBg: 'var(--accSoft)',
    avFg: 'var(--acc)',
    bg: 'var(--panel)',
    bd: 'var(--line2)',
    fg: 'var(--tx)',
    text: 'Slow can be good. Was there anything you were quiet about, even with people close to you?',
    meta: 'Juno · 0:18',
    metaAlign: 'left',
  },
  {
    dir: 'row-reverse',
    align: 'flex-end',
    av: 'you',
    avBg: 'var(--tile)',
    avFg: 'var(--tx3)',
    bg: 'var(--accSoft)',
    bd: 'var(--accLine)',
    fg: 'var(--tx)',
    text: 'I would be reticent about promising a date this early.',
    meta: '0:27',
    metaAlign: 'right',
  },
  {
    dir: 'row',
    align: 'flex-start',
    av: 'fox',
    avBg: 'var(--accSoft)',
    avFg: 'var(--acc)',
    bg: 'var(--panel)',
    bd: 'var(--line2)',
    fg: 'var(--tx)',
    text: 'Good instinct — that is exactly the kind of caution people respect. What would help you feel less that way?',
    meta: 'Juno · 0:33',
    metaAlign: 'left',
  },
];

export interface ConvTarget {
  w: string;
  bd: string;
  bg: string;
  fg: string;
  deco: string;
  tag: string;
  tagFg: string;
}

export const CONV_TARGETS: ConvTarget[] = [
  { w: 'reticent', bd: 'var(--accLine)', bg: 'var(--accSoft)', fg: 'var(--acc)', deco: 'line-through', tag: 'used', tagFg: 'var(--acc)' },
  { w: 'stark', bd: 'var(--line2)', bg: 'transparent', fg: 'var(--tx)', deco: 'none', tag: 'due', tagFg: 'var(--tx3)' },
  { w: 'mitigate', bd: 'var(--line2)', bg: 'transparent', fg: 'var(--tx)', deco: 'none', tag: 'due', tagFg: 'var(--tx3)' },
  { w: 'ostensibly', bd: 'var(--line2)', bg: 'transparent', fg: 'var(--tx)', deco: 'none', tag: 'due', tagFg: 'var(--tx3)' },
  { w: 'contingent on', bd: 'var(--line2)', bg: 'transparent', fg: 'var(--tx)', deco: 'none', tag: 'due', tagFg: 'var(--tx3)' },
  { w: 'headway', bd: 'var(--line2)', bg: 'transparent', fg: 'var(--tx)', deco: 'none', tag: 'due', tagFg: 'var(--tx3)' },
  { w: 'throttle', bd: 'var(--line2)', bg: 'transparent', fg: 'var(--tx)', deco: 'none', tag: 'due', tagFg: 'var(--tx3)' },
  { w: 'gauge', bd: 'var(--line2)', bg: 'transparent', fg: 'var(--tx)', deco: 'none', tag: 'due', tagFg: 'var(--tx3)' },
];

export const CONV_WAVE_HEIGHTS = [6, 12, 18, 10, 24, 14, 30, 18, 9, 22, 16, 28, 12, 20, 8, 15, 24, 11];
