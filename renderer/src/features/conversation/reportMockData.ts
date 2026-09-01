// Ported from claude-ui-mockup-files/FluencyOS.html's isReport section — no
// LLM-based scoring pipeline exists yet (spec §6), so dials, routing, errors,
// and proxies are static mock data for a completed conversation session.

export interface ReportDial {
  n: string;
  v: string;
  sub: string;
  color: string;
  deg: number;
}

export const REPORT_DIALS: ReportDial[] = [
  { n: 'Contextual accuracy', v: '86', sub: 'target words used correctly', color: 'var(--acc)', deg: 310 },
  { n: 'Fluency', v: '78', sub: 'pace, pausing, self-correction', color: 'var(--acc)', deg: 281 },
  { n: 'Vocabulary reach', v: '82', sub: 'range beyond target list', color: 'var(--acc)', deg: 295 },
  { n: 'Pronunciation', v: '71', sub: 'stt_proxy · not a phoneme score', color: '#c0563f', deg: 256 },
];

export interface ReportRoutingRow {
  w: string;
  u: string;
  uBg: string;
  uFg: string;
  rating: string;
  iv: string;
  ev: string;
}

export const REPORT_ROUTING: ReportRoutingRow[] = [
  { w: 'reticent', u: 'spontaneous', uBg: 'var(--accSoft)', uFg: 'var(--acc)', rating: 'Easy', iv: '92 d', ev: 'turn 4' },
  { w: 'stark', u: 'spontaneous', uBg: 'var(--accSoft)', uFg: 'var(--acc)', rating: 'Good', iv: '48 d', ev: 'turn 7' },
  { w: 'mitigate', u: 'prompted', uBg: 'var(--tile)', uFg: 'var(--tx2)', rating: 'Good', iv: '48 d', ev: 'turn 9' },
  { w: 'ostensibly', u: 'not used', uBg: 'var(--tile)', uFg: 'var(--tx3)', rating: '—', iv: 'no change', ev: '—' },
  { w: 'contingent on', u: 'prompted', uBg: 'var(--tile)', uFg: 'var(--tx2)', rating: 'Hard', iv: '6 d', ev: 'turn 11' },
  { w: 'headway', u: 'not used', uBg: 'var(--tile)', uFg: 'var(--tx3)', rating: '—', iv: 'no change', ev: '—' },
];

export interface ReportError {
  bad: string;
  good: string;
  why: string;
}

export const REPORT_ERRORS: ReportError[] = [
  {
    bad: 'If I would have more time, I finish it.',
    good: 'If I had more time, I would finish it.',
    why: 'third conditional — mixed past/present under time pressure',
  },
  {
    bad: 'We are agree on the plan since Tuesday.',
    good: "We have agreed on the plan since Tuesday.",
    why: 'present perfect needed with "since"',
  },
  {
    bad: 'She explain me the reason yesterday.',
    good: 'She explained the reason to me yesterday.',
    why: '"explain" does not take an indirect object directly',
  },
];

export interface ReportProxy {
  v: string;
  n: string;
}

export const REPORT_PROXIES: ReportProxy[] = [
  { v: '118', n: 'words / min' },
  { v: '0.9 s', n: 'avg pause' },
  { v: '3', n: 'self-corrections' },
  { v: '14', n: 'turns' },
];

export const REPORT_SUMMARY =
  'Strong session — you reached for <b>reticent</b> and <b>stark</b> unprompted, which is exactly what moves them toward mastery. Next time, slow down before conditionals; three of your errors were tense agreement under time pressure.';
