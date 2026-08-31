// Ported from claude-ui-mockup-files/FluencyOS.html's bookshelf section — no
// e-reader/ingestion backend exists yet (spec §4.3, Jubair's ownership per §12).

export type BookFormat = 'epub' | 'pdf' | 'mobi' | 'azw3';
export type BookStatus = 'reading' | 'finished' | 'new';

export interface Book {
  title: string;
  author: string;
  fmt: BookFormat;
  pct: number;
  meta: string;
  status: BookStatus;
  chapter: string;
  pos: string;
}

export const BOOKS: Book[] = [
  { title: 'The Overstory', author: 'Richard Powers', fmt: 'epub', pct: 34, meta: 'page 118 / 342 · 51 saves', status: 'reading', chapter: 'Chapter 4 · The Weight of Small Words', pos: '118 / 342' },
  { title: 'Sapiens', author: 'Yuval Noah Harari', fmt: 'pdf', pct: 12, meta: 'page 61 / 498 · 22 saves', status: 'reading', chapter: 'Chapter 3 · A Day in the Life of Adam and Eve', pos: '61 / 498' },
  { title: 'Klara and the Sun', author: 'Kazuo Ishiguro', fmt: 'epub', pct: 100, meta: 'finished · 88 saves', status: 'finished', chapter: 'Part 6 · final chapter', pos: '303 / 303' },
  { title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', fmt: 'pdf', pct: 0, meta: 'not started · 512 pages', status: 'new', chapter: 'Introduction', pos: '1 / 512' },
  { title: 'Normal People', author: 'Sally Rooney', fmt: 'mobi', pct: 0, meta: 'not started · 266 pages', status: 'new', chapter: 'January 2011', pos: '1 / 266' },
  { title: 'The Economist · Aug 24', author: 'weekly', fmt: 'pdf', pct: 61, meta: 'page 31 / 84 · 14 saves', status: 'reading', chapter: 'Briefing · The next shock', pos: '31 / 84' },
  { title: 'Educated', author: 'Tara Westover', fmt: 'azw3', pct: 100, meta: 'finished · 40 saves', status: 'finished', chapter: 'Part 3 · Epilogue', pos: '334 / 334' },
  { title: 'Piranesi', author: 'Susanna Clarke', fmt: 'epub', pct: 0, meta: 'not started · 245 pages', status: 'new', chapter: 'Part 1 · Piranesi', pos: '1 / 245' },
  { title: 'IELTS Academic Reading Sets', author: 'Cambridge', fmt: 'pdf', pct: 47, meta: 'set 6 / 14 · 63 saves', status: 'reading', chapter: 'Set 6 · Passage 2', pos: '112 / 238' },
];

export const BOOK_FILTERS = [
  { n: 'All', c: '9' },
  { n: 'Reading', c: '4' },
  { n: 'Not started', c: '3' },
  { n: 'Finished', c: '2' },
] as const;

export function matchesBookFilter(book: Book, filter: string): boolean {
  if (filter === 'All') return true;
  if (filter === 'Reading') return book.status === 'reading';
  if (filter === 'Not started') return book.status === 'new';
  if (filter === 'Finished') return book.status === 'finished';
  return true;
}

export const READING_NOW = BOOKS.filter((b) => b.status === 'reading').slice(0, 2);

export const GOAL_WEEK: Array<{ n: string; h: number }> = [
  { n: 'M', h: 100 },
  { n: 'T', h: 80 },
  { n: 'W', h: 45 },
  { n: 'T', h: 100 },
  { n: 'F', h: 0 },
  { n: 'S', h: 100 },
  { n: 'S', h: 70 },
];

export const READING_GOAL = { done: 14, options: [10, 20, 30, 50] };

export const BOOK_FORMATS = ['pdf', 'epub', 'mobi', 'azw3', 'txt'];

export const BOOK_QUEUE = [
  { n: 'Piranesi — Susanna Clarke.epub', sub: '1.2 MB · cover and metadata read', v: 'ready', ready: true },
  { n: 'Thinking Fast and Slow.pdf', sub: '8.4 MB · text layer present', v: 'ready', ready: true },
  { n: 'Normal People.mobi', sub: '0.9 MB · converting to reflowable text', v: 'converting…', ready: false },
];

export const ADD_BOOK_FIELDS = [
  { n: 'Reading language', sub: 'drives lookups and dual glosses', v: 'English' },
  { n: 'Difficulty heat overlay', sub: 'tint words above your level', v: 'on' },
  { n: 'Count toward reading goal', sub: '20 pages a day', v: 'yes' },
];
