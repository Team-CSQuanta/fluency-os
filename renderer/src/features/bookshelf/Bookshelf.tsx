import { useEffect, useState } from 'react';
import { AddBookModal } from '@/features/bookshelf/AddBookModal';
import { useAppStore } from '@/store/appStore';
import { matchesBookFilter, matchesBookQuery, useBookshelfStore } from '@/store/bookshelfStore';
import { useShellStore } from '@/store/shellStore';

const GOAL_OPTIONS = [10, 20, 30, 50];

const FMT_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  epub: { bg: 'rgba(var(--accRGB),.2)', fg: 'var(--acc)', bd: 'var(--accLine)' },
  pdf: { bg: 'var(--line2)', fg: 'var(--tx2)', bd: 'var(--line2)' },
  mobi: { bg: 'var(--line2)', fg: 'var(--tx2)', bd: 'var(--line2)' },
  azw3: { bg: 'var(--line2)', fg: 'var(--tx2)', bd: 'var(--line2)' },
  txt: { bg: 'var(--line2)', fg: 'var(--tx2)', bd: 'var(--line2)' },
};

export function Bookshelf() {
  const [addOpen, setAddOpen] = useState(false);
  // Deleting removes the stored file and every highlight with it, so the trash
  // icon arms an in-tile confirm rather than deleting on the first click.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const goReader = useShellStore((s) => s.goReader);
  const currentUserId = useAppStore((s) => s.currentUserId);

  const allBooks = useBookshelfStore((s) => s.books);
  const counts = useBookshelfStore((s) => s.counts);
  const stats = useBookshelfStore((s) => s.stats);
  const filter = useBookshelfStore((s) => s.filter);
  const setFilter = useBookshelfStore((s) => s.setFilter);
  const query = useBookshelfStore((s) => s.query);
  const setQuery = useBookshelfStore((s) => s.setQuery);
  const fetchBooks = useBookshelfStore((s) => s.fetchBooks);
  const fetchCounts = useBookshelfStore((s) => s.fetchCounts);
  const fetchStats = useBookshelfStore((s) => s.fetchStats);
  const setGoal = useBookshelfStore((s) => s.setGoal);
  const retryIngest = useBookshelfStore((s) => s.retryIngest);
  const coverUrls = useBookshelfStore((s) => s.coverUrls);
  const loadCover = useBookshelfStore((s) => s.loadCover);
  const deleteBook = useBookshelfStore((s) => s.deleteBook);
  const setFinished = useBookshelfStore((s) => s.setFinished);

  // Refetched on every return from the reader, which is where pages actually
  // get read — the goal ring and streak would otherwise show stale numbers.
  useEffect(() => {
    if (!currentUserId) return;
    void fetchBooks();
    void fetchCounts();
    void fetchStats();
  }, [currentUserId, fetchBooks, fetchCounts, fetchStats]);

  useEffect(() => {
    for (const b of allBooks) {
      if (b.ingest_status === 'ready' && b.cover_path) loadCover(b.id);
    }
  }, [allBooks, loadCover]);

  const bookFilters = [
    { n: 'All', c: String(counts?.all ?? allBooks.length) },
    { n: 'Reading', c: String(counts?.reading ?? 0) },
    { n: 'Not started', c: String(counts?.not_started ?? 0) },
    { n: 'Finished', c: String(counts?.finished ?? 0) },
  ];
  const books = allBooks.filter((b) => matchesBookFilter(b, filter) && matchesBookQuery(b, query));

  const goalTarget = stats?.goal_pages ?? 20;
  const pagesToday = stats?.pages_today ?? 0;
  const goalDeg = Math.round(Math.min(1, pagesToday / Math.max(1, goalTarget)) * 360);
  const week = stats?.week ?? [];

  // Most recently opened first, which is what "continue" means — the books
  // list itself is ordered by import date.
  const continueReading = allBooks
    .filter((b) => b.ingest_status === 'ready' && !b.finished_at && b.last_read_at)
    .sort((a, b) => (a.last_read_at! < b.last_read_at! ? 1 : -1))
    .slice(0, 2);

  return (
    <div className="flex min-w-0 flex-col gap-[22px] p-[var(--pad)]">
      {/* auto-fit rather than a fixed 2-up: expanding the nav shrinks this
          column, and two 1fr panels would squeeze the goal copy into a
          two-words-per-line ribbon instead of stacking. */}
      <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))' }}>
        <div className="min-w-0 rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
          <div className="mb-[14px] flex items-baseline justify-between">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">Reading goal</div>
            <span className="font-mono text-[10.5px] text-tx3">
              {stats ? (stats.streak_days > 0 ? `${stats.streak_days}-day streak` : 'no streak yet') : '…'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-[18px]">
            <div
              className="grid h-[88px] w-[88px] flex-none place-items-center rounded-full"
              style={{ background: `conic-gradient(var(--acc) ${goalDeg}deg, var(--line2) 0)` }}
            >
              <div className="grid h-[70px] w-[70px] place-items-center rounded-full bg-panel text-center">
                <div>
                  <div className="font-mono text-[16px] font-semibold tracking-[-0.02em] text-tx">{pagesToday}</div>
                  <div className="font-mono text-[8.5px] text-tx3">of {goalTarget}</div>
                </div>
              </div>
            </div>
            <div className="min-w-[190px] flex-1 basis-[190px]">
              <div className="font-sans text-[12.5px] leading-[1.6] text-tx2">
                {stats?.goal_met
                  ? `Goal met today — ${pagesToday} pages read across ${stats.books_today} ${stats.books_today === 1 ? 'book' : 'books'}.`
                  : `${Math.max(0, goalTarget - pagesToday)} pages left today. Reading counts toward your daily goal alongside reviews and conversation.`}
              </div>
              <div className="mt-3 flex flex-wrap gap-[5px]">
                {GOAL_OPTIONS.map((v) => {
                  const on = goalTarget === v;
                  return (
                    <button
                      key={v}
                      onClick={() => void setGoal(v)}
                      className="rounded-full border px-[10px] py-[5px] font-mono text-[10.5px] font-medium"
                      style={{
                        borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                        background: on ? 'var(--accSoft)' : 'transparent',
                        color: on ? 'var(--acc)' : 'var(--tx2)',
                      }}
                    >
                      {v} pages
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-[5px]">
            {week.map((d, i) => (
              <div key={d.date} className="text-center" title={`${d.date} · ${d.pages} pages`}>
                <div className="flex h-[38px] items-end overflow-hidden rounded-[5px] bg-line2">
                  <div
                    className="w-full transition-[height]"
                    style={{
                      height: `${d.percent}%`,
                      background:
                        d.percent >= 100 ? 'var(--acc)' : d.percent === 0 ? 'var(--line2)' : 'rgba(var(--accRGB),.4)',
                    }}
                  />
                </div>
                {/* Today is the last bar — marking it keeps the row readable
                    when two weekdays share a letter. */}
                <div
                  className="mt-1 font-mono text-[9px]"
                  style={{ color: i === week.length - 1 ? 'var(--acc)' : 'var(--tx3)' }}
                >
                  {d.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
          <div className="mb-[14px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Continue reading
          </div>
          <div className="flex flex-col gap-[10px]">
            {continueReading.length === 0 && (
              <div className="font-mono text-[10.5px] text-tx3">Nothing in progress yet — open a book to start.</div>
            )}
            {continueReading.map((b) => (
              <button
                key={b.id}
                onClick={() => goReader(b.id, b.title)}
                className="flex items-center gap-[13px] rounded-panel border border-line2 p-[9px] text-left hover:border-acc"
              >
                <div
                  className="grid h-[62px] w-11 flex-none place-items-center overflow-hidden rounded-[3px] font-mono text-[7px] text-tx3"
                  style={{ background: 'repeating-linear-gradient(135deg,var(--tile) 0 5px,var(--tileB) 5px 10px)' }}
                >
                  {coverUrls[b.id] ? (
                    <img src={coverUrls[b.id]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    'cover'
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-sans text-[12.5px] font-semibold text-tx">{b.title}</div>
                  <div className="my-1 font-mono text-[9.5px] text-tx3">
                    {b.percent}% · page {Math.max(1, Math.round((b.percent / 100) * b.page_estimate))} of{' '}
                    {b.page_estimate}
                  </div>
                  <div className="h-[3px] overflow-hidden rounded-full bg-line2">
                    <div className="h-full bg-acc" style={{ width: `${b.percent}%` }} />
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-auto pt-[14px] font-mono text-[10px] leading-[1.7] text-tx3">
            last position, highlights and notes are stored per book — reopen and you land exactly where you stopped
          </div>
        </div>
      </div>

      <div>
        <div className="mb-[14px] flex flex-wrap items-center gap-2">
          <div className="mr-[6px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            My books
          </div>
          {bookFilters.map((f) => {
            const on = filter === f.n;
            return (
              <button
                key={f.n}
                onClick={() => setFilter(f.n)}
                className="rounded-full border px-[11px] py-[6px] font-sans text-[11px] font-medium"
                style={{
                  borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                  background: on ? 'var(--accSoft)' : 'transparent',
                  color: on ? 'var(--acc)' : 'var(--tx2)',
                }}
              >
                {f.n} <span className="font-mono text-[9.5px] opacity-60">{f.c}</span>
              </button>
            );
          })}
          <div className="flex-1" />
          <label className="flex items-center gap-[7px] rounded-field border border-line2 px-[11px] py-[6px] font-sans text-[11px] text-tx3 focus-within:border-acc">
            <span aria-hidden>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search titles &amp; authors"
              aria-label="Search titles and authors"
              className="w-[150px] bg-transparent text-tx placeholder:text-tx3 focus:outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="text-tx3 hover:text-acc">
                ✕
              </button>
            )}
          </label>
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-field bg-accSolid px-[14px] py-2 font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
          >
            + Add books
          </button>
        </div>

        {books.length === 0 && allBooks.length > 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line py-[48px] text-center">
            <div className="font-sans text-[13px] font-medium text-tx">
              {query ? `No books match "${query.trim()}"` : `Nothing in ${filter}`}
            </div>
            <button
              onClick={() => {
                setQuery('');
                setFilter('All');
              }}
              className="font-mono text-[10.5px] text-acc hover:underline"
            >
              show all {allBooks.length} books
            </button>
          </div>
        ) : books.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line py-[48px] text-center">
            <div className="font-sans text-[13px] font-medium text-tx">Your shelf is empty</div>
            <div className="max-w-[280px] font-mono text-[10.5px] leading-[1.6] text-tx3">
              Drag a TXT or EPUB file onto the shelf, or use "Add books" to browse for one.
            </div>
          </div>
        ) : (
          <div className="grid items-stretch gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(158px,1fr))' }}>
            {books.map((b) => {
              const fs = FMT_STYLE[b.format] ?? FMT_STYLE.txt;
              const pct = b.finished_at ? 100 : b.percent;
              const meta =
                b.ingest_status === 'ready'
                  ? `~${b.page_estimate} pages · ${b.total_words.toLocaleString()} words`
                  : b.ingest_status === 'failed'
                    ? (b.ingest_error ?? 'Import failed')
                    : b.ingest_status === 'parsing'
                      ? 'parsing…'
                      : 'queued…';
              const busy = b.ingest_status === 'queued' || b.ingest_status === 'parsing';
              const failed = b.ingest_status === 'failed';

              const confirming = confirmDeleteId === b.id;

              return (
                <div key={b.id} className="group relative flex h-full min-w-0 flex-col">
                  <button
                    onClick={() => {
                      if (confirming) return;
                      if (failed) {
                        void retryIngest(b.id);
                        return;
                      }
                      if (busy) return;
                      goReader(b.id, b.title);
                    }}
                    className="flex h-full flex-col text-left hover:-translate-y-[2px]"
                    style={{ opacity: busy ? 0.6 : 1 }}
                  >
                    <div
                      className="relative overflow-hidden rounded-[4px] border border-line2 shadow-panel"
                      style={{
                        aspectRatio: '2/3',
                        background: 'repeating-linear-gradient(135deg,var(--tile) 0 6px,var(--tileB) 6px 12px)',
                      }}
                    >
                      {coverUrls[b.id] ? (
                        <img
                          src={coverUrls[b.id]}
                          alt={`${b.title} cover`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full place-items-center font-mono text-[8px] text-tx3">
                          {busy ? '⟳ parsing' : failed ? '⚠ failed' : 'cover'}
                        </div>
                      )}
                      <span
                        className="absolute right-[7px] top-[7px] rounded-[3px] border px-[5px] py-[2px] font-mono text-[8.5px] font-medium uppercase tracking-[0.05em]"
                        style={{ color: fs.fg, background: fs.bg, borderColor: fs.bd }}
                      >
                        {b.format}
                      </span>
                      {pct > 0 && (
                        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/25">
                          <span className="block h-[3px] bg-acc" style={{ width: `${pct}%` }} />
                        </span>
                      )}
                    </div>
                    {/* Fixed line budgets per field: a one-line title next to a
                        three-line one would otherwise push each tile's metadata
                        to a different baseline across the shelf. */}
                    <div className="mt-[9px] line-clamp-2 min-h-[33px] font-sans text-[12px] font-semibold leading-[1.35] text-tx">
                      {b.title}
                    </div>
                    <div className="mt-[3px] truncate font-mono text-[10px] text-tx3">{b.author ?? '—'}</div>
                    <div className="mt-[5px] line-clamp-2 min-h-[26px] font-mono text-[9.5px] leading-[1.35] text-tx3">
                      {meta}
                      {failed && <span className="ml-1 text-acc">· tap to retry</span>}
                    </div>
                  </button>

                  {/* Finishing usually happens in the reader, at the end of
                      the last page; this is the shelf-side way to correct it
                      or to mark a book you finished elsewhere. */}
                  {b.ingest_status === 'ready' && (
                    <button
                      onClick={() => void setFinished(b.id, !b.finished_at)}
                      aria-label={b.finished_at ? `Mark ${b.title} unread` : `Mark ${b.title} finished`}
                      title={b.finished_at ? 'Finished — click to reopen' : 'Mark as finished'}
                      className="absolute left-[35px] top-[7px] grid h-[22px] w-[22px] place-items-center rounded-[4px] border opacity-0 transition-opacity hover:border-acc hover:text-acc focus-visible:opacity-100 group-hover:opacity-100"
                      style={{
                        // A finished book keeps its tick visible; the rest only
                        // show the control on hover.
                        opacity: b.finished_at ? 1 : undefined,
                        borderColor: b.finished_at ? 'var(--accLine)' : 'var(--line2)',
                        background: b.finished_at ? 'var(--accSoft)' : 'var(--bg2)',
                        color: b.finished_at ? 'var(--acc)' : 'var(--tx3)',
                      }}
                    >
                      <svg viewBox="0 0 16 16" className="h-[12px] w-[12px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    </button>
                  )}

                  <button
                    onClick={() => setConfirmDeleteId(b.id)}
                    aria-label={`Delete ${b.title}`}
                    title="Delete book"
                    className="absolute left-[7px] top-[7px] grid h-[22px] w-[22px] place-items-center rounded-[4px] border border-line2 bg-bg2 text-tx3 opacity-0 transition-opacity hover:border-red-400/60 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 16 16" className="h-[12px] w-[12px]" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5l.6 8.2h5.8l.6-8.2 M6.8 7v3.4 M9.2 7v3.4" />
                    </svg>
                  </button>

                  {confirming && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-[9px] rounded-[6px] border border-line2 bg-bg2 p-[10px] text-center">
                      <div className="font-sans text-[11.5px] font-semibold leading-[1.4] text-tx">Delete this book?</div>
                      <div className="font-mono text-[9px] leading-[1.5] text-tx3">
                        removes the file, highlights and notes
                      </div>
                      <div className="flex gap-[6px]">
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-field border border-line2 px-[9px] py-[5px] font-sans text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            setConfirmDeleteId(null);
                            void deleteBook(b.id);
                          }}
                          className="rounded-field bg-red-500/90 px-[9px] py-[5px] font-sans text-[10.5px] font-semibold text-white hover:bg-red-500"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => setAddOpen(true)}
              className="flex h-full min-h-[210px] flex-col items-center justify-center gap-[9px] rounded-[6px] border border-dashed border-line text-tx3 hover:border-acc hover:text-acc"
            >
              <span className="font-sans text-[26px] font-light leading-none">+</span>
              <span className="font-sans text-[11px] font-medium">Add books</span>
              <span className="max-w-[110px] text-center font-mono text-[9px] leading-[1.6]">
                pdf · epub · mobi · azw3 · txt
              </span>
            </button>
          </div>
        )}
      </div>

      {addOpen && <AddBookModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}
