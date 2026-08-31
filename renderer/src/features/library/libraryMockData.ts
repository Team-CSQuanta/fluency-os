// Ported from claude-ui-mockup-files/FluencyOS.html's library section — no
// media-ingestion backend exists yet (spec §4.1, Jubair's ownership per §12).

export type LibKind = 'local' | 'link';

export interface LibItem {
  title: string;
  kind: LibKind;
  path: string;
  dur: string;
  pct: number;
  subs: string;
  saves: number;
  thumbLabel: string;
}

export const LIB_ITEMS: LibItem[] = [
  { title: 'Arrival (2016)', kind: 'local', path: '~/Movies/Arrival.2016.1080p.mkv', dur: '2:01:38', pct: 61, subs: 'embedded · en, bn', saves: 34, thumbLabel: 'thumbnail' },
  { title: 'Interstellar (2014)', kind: 'local', path: '~/Movies/Interstellar.mkv', dur: '2:49:02', pct: 0, subs: 'embedded · en', saves: 0, thumbLabel: 'thumbnail' },
  { title: 'The Immune System Explained', kind: 'link', path: 'youtube.com/watch?v=zQGOcOUBi6s', dur: '9:41', pct: 42, subs: 'captions · en', saves: 7, thumbLabel: 'stream thumbnail' },
  { title: 'Chef’s Table · S1E2', kind: 'local', path: '~/Movies/Series/ChefsTable/S01E02.mp4', dur: '52:10', pct: 88, subs: 'sidecar .srt', saves: 22, thumbLabel: 'thumbnail' },
  { title: 'How to Speak — MIT lecture', kind: 'link', path: 'youtube.com/watch?v=Unzc731iCUY', dur: '1:03:44', pct: 12, subs: 'generated · whisper', saves: 41, thumbLabel: 'stream thumbnail' },
  { title: 'Everything Everywhere All at Once', kind: 'local', path: '~/Movies/EEAAO.1080p.mkv', dur: '2:19:33', pct: 0, subs: 'no track — generate?', saves: 0, thumbLabel: 'thumbnail' },
  { title: 'Dune (2021)', kind: 'local', path: '~/Movies/Dune.2021.2160p.mkv', dur: '2:35:16', pct: 24, subs: 'embedded · en', saves: 15, thumbLabel: 'thumbnail' },
  { title: 'A Conversation with Hinton', kind: 'link', path: 'youtube.com/watch?v=qpoRO378qRY', dur: '41:07', pct: 100, subs: 'captions · en', saves: 29, thumbLabel: 'stream thumbnail' },
];

export interface HistoryItem {
  title: string;
  pct: number;
  left: string;
  meta: string;
}

export const HISTORY: HistoryItem[] = [
  { title: 'Arrival (2016)', pct: 61, left: '46 min left', meta: 'yesterday · 8 saves' },
  { title: 'Chef’s Table · S1E2', pct: 88, left: '6 min left', meta: '2 days ago · 5 saves' },
  { title: 'How to Speak — MIT lecture', pct: 12, left: '56 min left', meta: '3 days ago · 11 saves' },
  { title: 'The Immune System Explained', pct: 42, left: '5 min left', meta: '5 days ago · 3 saves' },
];

export const LIB_FILTERS = [
  { n: 'All', c: '17' },
  { n: 'Local files', c: '12' },
  { n: 'From links', c: '5' },
  { n: 'Unfinished', c: '6' },
] as const;

export function matchesFilter(item: LibItem, filter: string): boolean {
  if (filter === 'All') return true;
  if (filter === 'Local files') return item.kind === 'local';
  if (filter === 'From links') return item.kind === 'link';
  if (filter === 'Unfinished') return item.pct > 0 && item.pct < 100;
  return true;
}

export const ADD_LOCAL_FIELDS = [
  { n: 'Title', sub: 'read from the filename, editable', v: 'Arrival (2016)' },
  { n: 'Subtitle track', sub: 'no track found in this file', v: 'generate with whisper' },
  { n: 'Native-language track', sub: 'for dual subtitles', v: 'bn · sidecar' },
  { n: 'Clip extraction', sub: 'clips cut from this file on save', v: '480p · store' },
];

export const ADD_LINK_FIELDS = [
  { n: 'Title', sub: 'resolved from the page', v: 'The Immune System…' },
  { n: 'Subtitle source', sub: 'captions found for this video', v: 'captions · en' },
  { n: 'Native-language track', sub: 'for dual subtitles', v: 'bn · translated' },
  { n: 'Clip storage', sub: 'links cannot be downloaded', v: 'timecodes only' },
];
