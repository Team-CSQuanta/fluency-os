import { useEffect, useState } from 'react';
import { AddBookModal } from '@/features/bookshelf/AddBookModal';
import { GOAL_WEEK, READING_GOAL } from '@/features/bookshelf/bookshelfMockData';
import { useAppStore } from '@/store/appStore';
import { matchesBookFilter, useBookshelfStore } from '@/store/bookshelfStore';
import { useShellStore } from '@/store/shellStore';

const FMT_STYLE: Record<string, { bg: string; fg: string; bd: string }> = {
  epub: { bg: 'rgba(62,124,90,.2)', fg: 'var(--acc)', bd: 'var(--accLine)' },
  pdf: { bg: 'var(--line2)', fg: 'var(--tx2)', bd: 'var(--line2)' },
  mobi: { bg: 'var(--line2)', fg: 'var(--tx2)', bd: 'var(--line2)' },
  azw3: { bg: 'var(--line2)', fg: 'var(--tx2)', bd: 'var(--line2)' },
  txt: { bg: 'var(--line2)', fg: 'var(--tx2)', bd: 'var(--line2)' },
};

export function Bookshelf() {
  const [addOpen, setAddOpen] = useState(false);
  const [goalTarget, setGoalTarget] = useState(20);
  const goReader = useShellStore((s) => s.goReader);
  const currentUserId = useAppStore((s) => s.currentUserId);

  const allBooks = useBookshelfStore((s) => s.books);
  const counts = useBookshelfStore((s) => s.counts);
  const filter = useBookshelfStore((s) => s.filter);
  const setFilter = useBookshelfStore((s) => s.setFilter);
  const fetchBooks = useBookshelfStore((s) => s.fetchBooks);
  const fetchCounts = useBookshelfStore((s) => s.fetchCounts);
  const retryIngest = useBookshelfStore((s) => s.retryIngest);
  const coverUrls = useBookshelfStore((s) => s.coverUrls);
  const loadCover = useBookshelfStore((s) => s.loadCover);

  useEffect(() => {
    if (!currentUserId) return;
    void fetchBooks();
    void fetchCounts();
  }, [currentUserId, fetchBooks, fetchCounts]);

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
  const books = allBooks.filter((b) => matchesBookFilter(b, filter));
  // allBooks is already ordered most-recently-imported-first by the API;
  // a real "last opened" ordering needs per-book position data (Phase 7).
  const continueReading = allBooks.filter((b) => b.ingest_status === 'ready' && !b.finished_at).slice(0, 2);
  const goalDeg = Math.round(Math.min(1, READING_GOAL.done / goalTarget) * 360);

  return (
    <div className="flex flex-col gap-[22px] p-[var(--pad)]">
      <div className="grid grid-cols-[1.15fr_1fr] gap-[14px]">
        <div className="rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
          <div className="mb-[14px] flex items-baseline justify-between">
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">Reading goal</div>
            <span className="font-mono text-[10.5px] text-tx3">11-day streak</span>
          </div>
          <div className="flex items-center gap-[18px]">
            <div
              className="grid h-[88px] w-[88px] flex-none place-items-center rounded-full"
              style={{ background: `conic-gradient(var(--acc) ${goalDeg}deg, var(--line2) 0)` }}
            >
              <div className="grid h-[70px] w-[70px] place-items-center rounded-full bg-panel text-center">
                <div>
                  <div className="font-mono text-[16px] font-semibold tracking-[-0.02em] text-tx">{READING_GOAL.done}</div>
                  <div className="font-mono text-[8.5px] text-tx3">of {goalTarget}</div>
                </div>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-sans text-[12.5px] leading-[1.6] text-tx2">
                {READING_GOAL.done >= goalTarget
                  ? `Goal met today — ${READING_GOAL.done} pages read across 2 books.`
                  : `${goalTarget - READING_GOAL.done} pages left today. Reading counts toward your daily goal alongside reviews and conversation.`}
              </div>
              <div className="mt-3 flex flex-wrap gap-[5px]">
                {READING_GOAL.options.map((v) => {
                  const on = goalTarget === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setGoalTarget(v)}
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
            {GOAL_WEEK.map((d, i) => (
              <div key={i} className="text-center">
                <div className="flex h-[38px] items-end overflow-hidden rounded-[5px] bg-line2">
                  <div
                    className="w-full"
                    style={{ height: `${d.h}%`, background: d.h >= 100 ? 'var(--acc)' : d.h === 0 ? 'var(--line2)' : 'rgba(62,124,90,.4)' }}
                  />
                </div>
                <div className="mt-1 font-mono text-[9px] text-tx3">{d.n}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col rounded-panel border border-line2 bg-panel p-[18px] shadow-panel">
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
                  className="grid h-[62px] w-11 flex-none place-items-center rounded-[3px] font-mono text-[7px] text-tx3"
                  style={{ background: 'repeating-linear-gradient(135deg,var(--tile) 0 5px,var(--tileB) 5px 10px)' }}
                >
                  cover
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-sans text-[12.5px] font-semibold text-tx">{b.title}</div>
                  <div className="my-1 font-mono text-[9.5px] text-tx3">
                    ~{b.page_estimate} pages · {b.total_words.toLocaleString()} words
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
          <div className="flex items-center gap-[7px] rounded-field border border-line2 px-[11px] py-[6px] font-sans text-[11px] text-tx3">
            ⌕ search titles &amp; authors
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-field bg-acc px-[14px] py-2 font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
          >
            + Add books
          </button>
        </div>

        {books.length === 0 && allBooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line py-[48px] text-center">
            <div className="font-sans text-[13px] font-medium text-tx">Your shelf is empty</div>
            <div className="max-w-[280px] font-mono text-[10.5px] leading-[1.6] text-tx3">
              Drag a TXT or EPUB file onto the shelf, or use "Add books" to browse for one.
            </div>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(158px,1fr))' }}>
            {books.map((b) => {
              const fs = FMT_STYLE[b.format] ?? FMT_STYLE.txt;
              const pct = b.finished_at ? 100 : 0;
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

              return (
                <button
                  key={b.id}
                  onClick={() => {
                    if (failed) {
                      void retryIngest(b.id);
                      return;
                    }
                    if (busy) return;
                    goReader(b.id, b.title);
                  }}
                  className="text-left hover:-translate-y-[2px]"
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
                  <div className="mt-[9px] font-sans text-[12px] font-semibold leading-[1.35] text-tx">{b.title}</div>
                  <div className="mt-[3px] font-mono text-[10px] text-tx3">{b.author ?? '—'}</div>
                  <div className="mt-[5px] font-mono text-[9.5px] text-tx3">
                    {meta}
                    {failed && <span className="ml-1 text-acc">· tap to retry</span>}
                  </div>
                </button>
              );
            })}
            <button
              onClick={() => setAddOpen(true)}
              className="flex flex-col items-center justify-center gap-[9px] rounded-[6px] border border-dashed border-line text-tx3 hover:border-acc hover:text-acc"
              style={{ aspectRatio: '2/3' }}
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
