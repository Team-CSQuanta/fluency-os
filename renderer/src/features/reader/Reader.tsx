import { useEffect, useRef, useState } from 'react';
import { BlockText } from '@/features/reader/BlockText';
import {
  HIGHLIGHT_COLORS,
  LEVEL_MODES,
  MODE_LABELS,
  OFFLINE_MODES,
} from '@/features/reader/readerConstants';
import { getBlockSelectionRange } from '@/features/reader/useSelectionRange';
import { useReadingSession } from '@/features/reader/useReadingSession';
import { useReaderStore } from '@/store/readerStore';
import { useShellStore } from '@/store/shellStore';
import type { ChapterOut, HighlightColour } from '@/types/api';

type Tab = 'toc' | 'search' | 'marks' | 'text' | 'ai' | 'level';

const TAB_ICONS: Record<Tab, string> = {
  toc: 'M2.5 4h11 M2.5 8h11 M2.5 12h7',
  search: 'M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z M10.4 10.4L13.5 13.5',
  marks: 'M4 2.5h8v11l-4-3-4 3z',
  text: 'M2 12l3.2-8h1.6L10 12 M3.4 9.2h5.2 M11 5.5h3.5 M11 8.5h3.5 M11 11.5h3.5',
  ai: 'M8 2.6a3 3 0 013 3c0 1.6-1.4 2.2-2.2 3-.4.4-.5.9-.5 1.4 M8 12.6v.8',
  level: 'M3 13h3l7.2-7.2-3-3L3 10z M10.2 2.8l3 3',
};

const TAB_META: Record<Tab, { label: string; title: string; hint: string }> = {
  toc: { label: 'Contents', title: 'Table of contents', hint: 'Jump to any chapter. Current chapter is marked.' },
  search: { label: 'Search', title: 'Search in book', hint: 'Full-text search across the whole book.' },
  marks: { label: 'Bookmarks', title: 'Highlights & bookmarks', hint: 'Colour, note, and every highlight in this book.' },
  text: { label: 'Text', title: 'Text size & display', hint: 'Size, theme, difficulty tint and read-aloud.' },
  ai: { label: 'AI', title: 'AI explanation', hint: 'Meaning, pronunciation and sense in context.' },
  level: { label: 'Level', title: 'Adaptive text label', hint: 'Rewrites of the selection at your target level.' },
};

type PageTheme = 'auto' | 'light' | 'sepia' | 'dark';

// "auto" reads var(--bg)/var(--tx) directly, so it always matches the rest
// of the app's current theme — live, not just at the moment the book was
// opened — which is why it's the default rather than a fixed theme.
const PAGE_THEMES: Array<{ key: PageTheme; label: string; sub: string; bg: string; fg: string }> = [
  { key: 'auto', label: 'Auto', sub: 'matches app theme', bg: 'var(--bg)', fg: 'var(--tx)' },
  { key: 'light', label: 'Light', sub: 'bright paper', bg: '#fbfbf9', fg: '#171a19' },
  { key: 'sepia', label: 'Sepia', sub: 'warm, low glare', bg: '#f4ecdd', fg: '#3a3227' },
  { key: 'dark', label: 'Dark', sub: 'dim-room reading', bg: '#111312', fg: '#e6e8e6' },
];
const READER_BG: Record<PageTheme, string> = Object.fromEntries(PAGE_THEMES.map((t) => [t.key, t.bg])) as Record<PageTheme, string>;
const READER_TX: Record<PageTheme, string> = Object.fromEntries(PAGE_THEMES.map((t) => [t.key, t.fg])) as Record<PageTheme, string>;

function TabIcon({ tab, color }: { tab: Tab; color: string }) {
  return (
    <svg viewBox="0 0 16 16" className="h-[13px] w-[13px] flex-none" fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d={TAB_ICONS[tab]} />
    </svg>
  );
}

export function Reader() {
  const bookId = useShellStore((s) => s.readerBookId);
  const goScreen = useShellStore((s) => s.goScreen);

  const openBook = useReaderStore((s) => s.openBook);
  const close = useReaderStore((s) => s.close);
  const book = useReaderStore((s) => s.book);
  const toc = useReaderStore((s) => s.toc);
  const blocks = useReaderStore((s) => s.blocks);
  const page = useReaderStore((s) => s.page);
  const totalPages = useReaderStore((s) => s.totalPages);
  const hasPrev = useReaderStore((s) => s.hasPrev);
  const hasNext = useReaderStore((s) => s.hasNext);
  const percent = useReaderStore((s) => s.percent);
  const readerStatus = useReaderStore((s) => s.status);
  const readerError = useReaderStore((s) => s.error);
  const jumpToChapter = useReaderStore((s) => s.jumpToChapter);
  const nextPage = useReaderStore((s) => s.nextPage);
  const prevPage = useReaderStore((s) => s.prevPage);
  const highlights = useReaderStore((s) => s.highlights);
  const bookmarks = useReaderStore((s) => s.bookmarks);
  const createHighlight = useReaderStore((s) => s.createHighlight);
  const updateHighlight = useReaderStore((s) => s.updateHighlight);
  const deleteHighlight = useReaderStore((s) => s.deleteHighlight);
  const createBookmark = useReaderStore((s) => s.createBookmark);
  const deleteBookmark = useReaderStore((s) => s.deleteBookmark);
  const searchQuery = useReaderStore((s) => s.searchQuery);
  const searchHits = useReaderStore((s) => s.searchHits);
  const searchStatus = useReaderStore((s) => s.searchStatus);
  const setSearchQuery = useReaderStore((s) => s.setSearchQuery);
  const heat = useReaderStore((s) => s.heat);
  const heatEnabled = useReaderStore((s) => s.heatEnabled);
  const heatTarget = useReaderStore((s) => s.heatTarget);
  const heatTotal = useReaderStore((s) => s.heatTotal);
  const lookup = useReaderStore((s) => s.lookup);
  const lookupStatus = useReaderStore((s) => s.lookupStatus);
  const lookupWord = useReaderStore((s) => s.lookupWord);
  const levelMode = useReaderStore((s) => s.levelMode);
  const setLevelMode = useReaderStore((s) => s.setLevelMode);
  const leveled = useReaderStore((s) => s.leveled);
  const levelStatus = useReaderStore((s) => s.levelStatus);
  const levelBlock = useReaderStore((s) => s.levelBlock);
  const jumpToBlock = useReaderStore((s) => s.jumpToBlock);
  const focusBlock = useReaderStore((s) => s.focusBlock);
  const clearFocusBlock = useReaderStore((s) => s.clearFocusBlock);
  const setFinished = useReaderStore((s) => s.setFinished);

  const [selectedPara, setSelectedPara] = useState(0);

  // Display preferences are per-reader and persisted (spec Phase 2 step 5) —
  // the Text panel used to forget all of this on every book open.
  const prefs = useReaderStore((s) => s.prefs);
  const setPrefs = useReaderStore((s) => s.setPrefs);
  const loadPrefs = useReaderStore((s) => s.loadPrefs);
  const { font_size: fontSize, page_theme: pageTheme, heat_on: heatOn, panel_open: panelOpen } = prefs;
  const tab = prefs.panel_tab;
  const setTab = (next: Tab) => setPrefs({ panel_tab: next });
  const setPanelOpen = (next: boolean) => setPrefs({ panel_open: next });
  const [showOriginal, setShowOriginal] = useState(false);
  const [highlighterColor, setHighlighterColor] = useState<HighlightColour | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const justDraggedRef = useRef(false);

  // Open the requested book once, and reset the store's reading state on
  // the way out — every page turn already writes position immediately, so
  // there's nothing left to flush on close.
  useEffect(() => {
    if (bookId) void openBook(bookId);
    return () => close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  useReadingSession(bookId);

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  // ORDER MATTERS: loading a page sets `blocks` and `page` in one store
  // update, so both this effect and the jump-scroll below fire in the same
  // commit, in declaration order. The reset has to run *first* and bail out
  // while a jump is still pending — if it ran second it would read the
  // already-cleared focusBlock and yank the reader back to the top of the
  // page it had just scrolled into.
  useEffect(() => {
    if (useReaderStore.getState().focusBlock !== null) return;
    if (blocks.length > 0) setSelectedPara(blocks[0].block_index);
    scrollRef.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Scroll a jump target into view once its page has actually rendered, and
  // select it so the AI/Level panels act on the paragraph you jumped to.
  useEffect(() => {
    if (focusBlock === null) return;
    if (!blocks.some((b) => b.block_index === focusBlock)) return;

    setSelectedPara(focusBlock);
    const el = scrollRef.current?.querySelector(`[data-block-index="${focusBlock}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    clearFocusBlock();
  }, [focusBlock, blocks, clearFocusBlock]);

  // Level on demand for the selected block only — never the whole book. At a
  // couple of seconds per generative call, pre-leveling a 800-block book would
  // be half an hour of work for text nobody may open.
  useEffect(() => {
    if (tab !== 'level' || selectedPara === null) return;
    void levelBlock(selectedPara);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedPara, bookId]);

  // Left/Right arrow keys turn pages, like an e-reader.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') void nextPage();
      else if (e.key === 'ArrowLeft') void prevPage();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nextPage, prevPage]);

  // Heat spans for the blocks on screen, indexed for O(1) lookup per block.
  // The panel's own switch gates it on top of the per-book heat_overlay flag.
  const showHeat = heatOn && heatEnabled;
  const heatByBlock = new Map(heat.map((h) => [h.block_index, h.spans]));

  const handleWordClick = (word: string, sentence: string) => {
    setTab('ai');
    void lookupWord(word, sentence);
  };
  const fsPct = Math.round(((fontSize - 12) / 10) * 100);
  const selectedBlock = blocks.find((b) => b.block_index === selectedPara);
  const selectedText = selectedBlock?.text ?? '';

  const currentChapter = [...toc].reverse().find((c) => c.start_block <= (blocks[0]?.block_index ?? 0));
  const breadcrumb = currentChapter?.label ?? book?.title ?? '';

  // A drag-selection is handled on mouseUp (below); the click that follows
  // it would otherwise also fire and mark the whole block a second time, so
  // that click is swallowed once via this flag.
  const handleParaClick = (i: number) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    if (highlighterColor) {
      const block = blocks.find((b) => b.block_index === i);
      if (block) {
        void createHighlight({
          blockIndex: i,
          startChar: 0,
          endChar: block.text.length,
          colour: highlighterColor,
          quotedText: block.text,
        });
      }
    } else {
      setSelectedPara(i);
    }
  };

  // Drag-select part of a line while a colour is armed to highlight just
  // that substring (spec §7.2) — the whole-block click above is the v1
  // fallback for when there's no drag, only a plain click.
  const handleBlocksMouseUp = () => {
    if (!highlighterColor) return;
    const range = getBlockSelectionRange();
    if (!range) return;
    justDraggedRef.current = true;
    void createHighlight({
      blockIndex: range.blockIndex,
      startChar: range.startChar,
      endChar: range.endChar,
      colour: highlighterColor,
      quotedText: range.quotedText,
    });
    window.getSelection()?.removeAllRanges();
  };

  const handleJumpToChapter = (chapter: ChapterOut) => {
    void jumpToChapter(chapter);
  };

  // Search hits, bookmarks and highlights all know their exact block, so a
  // jump lands on the paragraph rather than merely on the right page — the
  // scroll itself happens in the effect below, once the page has rendered.
  const handleJumpTo = (targetPage: number, blockIndex: number) => {
    void jumpToBlock(targetPage, blockIndex);
  };

  const handleBookmarkPage = () => {
    if (blocks.length === 0) return;
    const label = breadcrumb || `Page ${page}`;
    void createBookmark(blocks[0].block_index, label);
  };

  const handleCloseBook = () => {
    close();
    goScreen('bookshelf');
  };

  const tabs: Tab[] = ['toc', 'search', 'marks', 'text', 'ai', 'level'];
  const isTurning = readerStatus === 'loading' && blocks.length > 0;

  return (
    <div className="flex h-full min-h-0 w-full">
      <div
        ref={scrollRef}
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-9 transition-colors duration-200"
        style={{ background: READER_BG[pageTheme] }}
      >
        <div
          className="sticky top-0 z-[12] mb-[30px] flex w-full justify-center border-b border-line2 py-[10px] transition-colors duration-200"
          style={{ background: READER_BG[pageTheme] }}
        >
          <div className="flex w-full max-w-[760px] flex-wrap items-center gap-[6px]">
            <button
              onClick={handleCloseBook}
              title="Return to the bookshelf — your place is already saved"
              className="flex flex-none items-center gap-[6px] rounded-[5px] border border-line2 px-[9px] py-1 font-mono text-[10.5px] font-medium text-tx2 transition-colors hover:border-acc hover:text-acc"
            >
              <svg viewBox="0 0 16 16" className="h-[10px] w-[10px] flex-none" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.5 3.5L5 8l4.5 4.5" />
              </svg>
              close book
            </button>
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-tx3">{breadcrumb}</span>
            {highlighterColor && (
              <div className="flex items-center gap-[5px] rounded-full border border-accLine bg-accSoft px-2 py-1">
                {Object.entries(HIGHLIGHT_COLORS).map(([name, hex]) => (
                  <button
                    key={name}
                    onClick={() => setHighlighterColor(name as HighlightColour)}
                    title={name}
                    className="h-4 w-4 rounded-full"
                    style={{ background: `${hex}8c`, border: `2px solid ${highlighterColor === name ? 'var(--tx)' : 'transparent'}` }}
                  />
                ))}
                <span className="ml-[3px] font-mono text-[9.5px] font-medium text-acc">click a line to mark</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex w-full max-w-[640px] flex-1 flex-col">
          <div className="mb-[26px] flex items-center justify-between gap-3 font-mono text-[10.5px] text-tx3">
            <span className="flex-1 truncate">page {page} / {totalPages || '—'}</span>
            <span>{Math.round(percent)}% read</span>
          </div>

          {readerStatus === 'loading' && blocks.length === 0 && (
            <div className="py-16 text-center font-mono text-[11px] text-tx3">opening book…</div>
          )}
          {readerStatus === 'error' && (
            <div className="py-16 text-center font-mono text-[11px] text-tx3">
              couldn't open this book{readerError ? ` — ${readerError}` : ''}
            </div>
          )}

          <div
            onMouseUp={handleBlocksMouseUp}
            style={{ opacity: isTurning ? 0.5 : 1, transition: 'opacity 120ms ease' }}
          >
            {blocks.map((b) => (
              <BlockText
                key={b.block_index}
                block={b}
                highlights={highlights.filter((h) => h.block_index === b.block_index)}
                heatSpans={showHeat ? (heatByBlock.get(b.block_index) ?? []) : []}
                onWordClick={handleWordClick}
                selected={selectedPara === b.block_index}
                fontSize={fontSize}
                textColor={READER_TX[pageTheme]}
                onClick={handleParaClick}
              />
            ))}
          </div>

          {/* The end of the last page is where finishing a book actually
              happens, so the action lives here rather than only on the shelf. */}
          {blocks.length > 0 && !hasNext && (
            <div className="mt-auto flex flex-col items-center gap-[7px] border-t border-line2 pt-4">
              <button
                onClick={() => void setFinished(!book?.finished_at)}
                className="w-full rounded-field border py-[10px] font-sans text-[12px] font-semibold transition-colors"
                style={{
                  borderColor: book?.finished_at ? 'var(--accLine)' : 'var(--line)',
                  background: book?.finished_at ? 'var(--accSoft)' : 'transparent',
                  color: book?.finished_at ? 'var(--acc)' : 'var(--tx2)',
                }}
              >
                {book?.finished_at ? '✓ Finished — mark as unread' : 'Mark as finished'}
              </button>
              <span className="font-mono text-[9.5px] text-tx3">
                {book?.finished_at
                  ? `finished ${new Date(book.finished_at).toLocaleDateString()}`
                  : 'that was the last page'}
              </span>
            </div>
          )}

          {blocks.length > 0 && (
            <div
              className={`flex items-center justify-between gap-3 border-t border-line2 pt-4 ${
                hasNext ? 'mt-auto' : 'mt-4'
              }`}
            >
              <button
                onClick={() => void prevPage()}
                disabled={!hasPrev || isTurning}
                className="flex items-center gap-[6px] rounded-field border border-line px-[14px] py-2 font-mono text-[11px] font-medium text-tx2 transition-colors hover:border-acc hover:text-acc disabled:cursor-default disabled:opacity-30 disabled:hover:border-line disabled:hover:text-tx2"
              >
                <svg viewBox="0 0 16 16" className="h-[11px] w-[11px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 3.5L5 8l4.5 4.5" />
                </svg>
                previous
              </button>
              <div className="flex items-center gap-[6px]">
                {Array.from({ length: Math.min(totalPages, 7) }, (_, idx) => {
                  // A compact dot strip centred on the current page, rather
                  // than one dot per page on a 300-page book.
                  const span = Math.min(totalPages, 7);
                  const start = Math.max(1, Math.min(page - Math.floor(span / 2), totalPages - span + 1));
                  const p = start + idx;
                  const on = p === page;
                  return (
                    <span
                      key={p}
                      className="h-[6px] w-[6px] rounded-full transition-colors"
                      style={{ background: on ? 'var(--acc)' : 'var(--line2)' }}
                    />
                  );
                })}
              </div>
              <button
                onClick={() => void nextPage()}
                disabled={!hasNext || isTurning}
                className="flex items-center gap-[6px] rounded-field border border-line px-[14px] py-2 font-mono text-[11px] font-medium text-tx2 transition-colors hover:border-acc hover:text-acc disabled:cursor-default disabled:opacity-30 disabled:hover:border-line disabled:hover:text-tx2"
              >
                next
                <svg viewBox="0 0 16 16" className="h-[11px] w-[11px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6.5 3.5L11 8l-4.5 4.5" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {!panelOpen && (
        <aside className="flex min-h-0 w-[46px] flex-none flex-col items-center gap-[3px] border-l border-line2 bg-panel py-[9px]">
          <button
            onClick={() => setPanelOpen(true)}
            title="Expand panel"
            className="grid h-[30px] w-[30px] place-items-center rounded-field border border-line2 text-tx2 hover:border-acc hover:text-acc"
          >
            ‹
          </button>
          <div className="my-[5px] h-px w-[22px] bg-line2" />
          {tabs.map((t) => {
            const on = tab === t;
            return (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setPanelOpen(true);
                }}
                title={TAB_META[t].label}
                className="grid h-[30px] w-[30px] place-items-center rounded-field border hover:border-acc"
                style={{ borderColor: on ? 'var(--accLine)' : 'var(--line2)', background: on ? 'var(--accSoft)' : 'transparent' }}
              >
                <TabIcon tab={t} color={on ? 'var(--acc)' : 'var(--tx2)'} />
              </button>
            );
          })}
        </aside>
      )}

      {panelOpen && (
        <aside className="flex min-h-0 w-[308px] flex-none flex-col border-l border-line2 bg-panel">
          <div className="grid flex-none grid-cols-3 gap-[2px] px-[9px] pt-[9px]">
            {tabs.map((t) => {
              const on = tab === t;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="flex items-center justify-center gap-[5px] rounded-field border py-[7px] font-sans text-[10px] font-medium"
                  style={{
                    borderColor: on ? 'var(--accLine)' : 'transparent',
                    background: on ? 'var(--accSoft)' : 'transparent',
                    color: on ? 'var(--acc)' : 'var(--tx3)',
                  }}
                >
                  <TabIcon tab={t} color={on ? 'var(--acc)' : 'var(--tx3)'} />
                  {TAB_META[t].label}
                </button>
              );
            })}
          </div>

          <div className="mt-[9px] flex flex-none items-start gap-[10px] border-y border-line2 px-[13px] py-[10px]">
            <div className="min-w-0 flex-1">
              <div className="mb-[5px] font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                {TAB_META[tab].title}
              </div>
              <div className="font-sans text-[10.5px] leading-[1.6] text-tx2">{TAB_META[tab].hint}</div>
            </div>
            <button
              onClick={() => setPanelOpen(false)}
              title="Collapse panel"
              className="grid h-[26px] w-[26px] flex-none place-items-center rounded-field border border-line2 text-tx3 hover:border-acc hover:text-acc"
            >
              ›
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-[13px] pb-5 pt-[13px]">
            {tab === 'toc' && (
              <div className="flex flex-col gap-[1px]">
                {toc.length === 0 && (
                  <div className="font-mono text-[10.5px] text-tx3">
                    {book ? 'This book has no chapter markers.' : 'Loading…'}
                  </div>
                )}
                {toc.map((c) => {
                  const on = currentChapter?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => handleJumpToChapter(c)}
                      className="flex items-baseline justify-between gap-[10px] rounded-field px-[9px] py-2 text-left hover:bg-line2"
                      style={{ background: on ? 'var(--accSoft)' : 'transparent', borderLeft: `2px solid ${on ? 'var(--acc)' : 'transparent'}` }}
                    >
                      <span
                        className="min-w-0 font-sans text-[11.5px] leading-[1.5]"
                        style={{ color: on ? 'var(--acc)' : 'var(--tx2)', fontWeight: on ? 600 : 400, paddingLeft: c.depth * 10 }}
                      >
                        {c.label}
                      </span>
                      <span className="flex-none font-mono text-[9.5px] text-tx3">{c.page}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {tab === 'search' && (
              <div>
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="search this book…"
                  className="w-full rounded-field border border-line2 bg-transparent px-[10px] py-2 font-mono text-[11.5px] text-tx outline-none focus:border-accLine focus:bg-accSoft"
                />
                <div className="my-2 font-mono text-[9.5px] text-tx3">
                  {searchQuery.trim() === ''
                    ? 'type to search'
                    : searchStatus === 'loading'
                      ? 'searching…'
                      : searchStatus === 'error'
                        ? 'search failed'
                        : `${searchHits.length} match${searchHits.length === 1 ? '' : 'es'} in this book`}
                </div>
                <div className="flex flex-col gap-[7px]">
                  {searchHits.map((h, i) => (
                    <button
                      key={`${h.block_index}-${i}`}
                      onClick={() => handleJumpTo(h.page, h.block_index)}
                      className="rounded-field border border-line2 px-[10px] py-[9px] text-left hover:border-acc"
                    >
                      <div className="font-sans text-[11px] leading-[1.6] text-tx2">
                        {h.snippet.map((seg, j) =>
                          seg.matched ? (
                            <mark key={j} className="rounded-[2px] bg-accSoft px-[1px] text-acc">
                              {seg.text}
                            </mark>
                          ) : (
                            <span key={j}>{seg.text}</span>
                          ),
                        )}
                      </div>
                      <div className="mt-1 font-mono text-[9px] text-tx3">
                        page {h.page}
                        {h.chapter_label ? ` · ${h.chapter_label}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === 'marks' && (
              <div className="flex flex-col gap-[13px]">
                <div>
                  <div className="mb-[7px] font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Colour</div>
                  <div className="flex gap-[6px]">
                    {Object.entries(HIGHLIGHT_COLORS).map(([name, hex]) => (
                      <button
                        key={name}
                        onClick={() => setHighlighterColor(highlighterColor === name ? null : (name as HighlightColour))}
                        title={name}
                        className="h-[30px] flex-1 rounded-field"
                        style={{ background: `${hex}8c`, border: `2px solid ${highlighterColor === name ? 'var(--tx)' : 'transparent'}` }}
                      />
                    ))}
                  </div>
                  <div className="mt-[7px] font-mono text-[10px] text-tx3">
                    {highlighterColor ? `highlighter on · drag over text, or click a paragraph to mark it whole` : 'pick a colour, then drag over text (or click a paragraph)'}
                  </div>
                </div>
                <div className="border-t border-line2 pt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                      Bookmarks · {bookmarks.length}
                    </span>
                    <button
                      onClick={handleBookmarkPage}
                      className="font-mono text-[9.5px] font-medium text-acc hover:underline"
                    >
                      ＋ bookmark this page
                    </button>
                  </div>
                  <div className="flex flex-col gap-[7px]">
                    {bookmarks.length === 0 && (
                      <div className="font-mono text-[10px] text-tx3">No bookmarks yet.</div>
                    )}
                    {bookmarks.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center gap-[9px] rounded-field border border-line2 px-[10px] py-[9px] hover:border-acc"
                      >
                        <button onClick={() => handleJumpTo(b.page, b.block_index)} className="min-w-0 flex-1 text-left">
                          <span className="block truncate font-sans text-[11.5px] font-medium text-tx">{b.label}</span>
                          <span className="mt-[3px] block font-mono text-[9px] text-tx3">page {b.page}</span>
                        </button>
                        <button
                          onClick={() => void deleteBookmark(b.id)}
                          title="Remove bookmark"
                          className="flex-none font-mono text-[10px] text-tx3 hover:text-acc"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-line2 pt-3">
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                    All highlights · {highlights.length}
                  </div>
                  <div className="flex flex-col gap-2">
                    {highlights.length === 0 && (
                      <div className="font-mono text-[10px] text-tx3">No highlights yet.</div>
                    )}
                    {highlights.map((h) => (
                      <div
                        key={h.id}
                        className="rounded-field border border-line2 px-[10px] py-[10px]"
                        style={{ borderLeft: `3px solid ${HIGHLIGHT_COLORS[h.colour]}` }}
                      >
                        <button onClick={() => handleJumpTo(h.page, h.block_index)} className="block w-full text-left">
                          <span className="font-sans text-[11px] leading-[1.6] text-tx2">"{h.quoted_text}"</span>
                        </button>
                        <input
                          defaultValue={h.note ?? ''}
                          placeholder="add a note…"
                          onBlur={(e) => {
                            const note = e.target.value.trim();
                            if (note !== (h.note ?? '')) void updateHighlight(h.id, { note: note || null });
                          }}
                          className="mt-[6px] w-full border-t border-line2 bg-transparent pt-[6px] font-sans text-[10.5px] leading-[1.6] text-tx3 outline-none focus:text-tx"
                        />
                        <div className="mt-[6px] flex items-center justify-between gap-2">
                          <span className="font-mono text-[9px] text-tx3">page {h.page}</span>
                          <button
                            onClick={() => void deleteHighlight(h.id)}
                            className="font-mono text-[9px] text-tx3 hover:text-acc"
                          >
                            remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'ai' && (
              <div className="flex flex-col gap-[14px]">
                {!lookup && lookupStatus !== 'loading' && (
                  <div className="font-mono text-[10.5px] leading-[1.7] text-tx3">
                    {showHeat
                      ? 'Click a tinted word in the text to look it up.'
                      : 'Turn on difficulty heat in the Text panel, then click a tinted word to look it up.'}
                  </div>
                )}

                {lookupStatus === 'loading' && (
                  <div className="font-mono text-[10.5px] text-tx3">looking up…</div>
                )}

                {lookupStatus === 'error' && (
                  <div className="font-mono text-[10.5px] text-tx3">lookup failed</div>
                )}

                {lookup && lookupStatus !== 'loading' && (
                  <>
                    <div>
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-sans text-[21px] font-semibold leading-[1.2] tracking-[-0.02em] text-tx">
                          {lookup.lemma ?? lookup.word}
                        </span>
                        {lookup.ipa && <span className="font-mono text-[11.5px] text-tx3">{lookup.ipa}</span>}
                      </div>
                      {lookup.found && (
                        <div className="mt-[9px] flex flex-wrap items-center gap-[6px]">
                          {lookup.pos && (
                            <span className="rounded-[4px] bg-line2 px-2 py-1 font-mono text-[9.5px] font-medium text-tx3">
                              {lookup.pos}
                            </span>
                          )}
                          {lookup.cefr && (
                            <span className="rounded-[4px] border border-accLine px-2 py-1 font-mono text-[9.5px] font-medium text-acc">
                              {lookup.cefr}
                            </span>
                          )}
                          {lookup.simpler && (
                            <span className="rounded-[4px] border border-line2 px-2 py-1 font-mono text-[9.5px] text-tx2">
                              simpler: {lookup.simpler}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {!lookup.found ? (
                      <div className="rounded-field border border-line2 px-[10px] py-[9px] font-sans text-[11px] leading-[1.6] text-tx2">
                        "{lookup.word}" isn't in the offline dictionary. It may be a name, or a
                        word the bundled list doesn't cover yet.
                      </div>
                    ) : (
                      <>
                        <div className="border-t border-line2 pt-3">
                          <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                            Dictionary
                          </div>
                          <div className="flex flex-col gap-[9px]">
                            {lookup.senses.map((sense, i) => (
                              <div key={i} className="flex gap-2">
                                <span className="mt-[2px] flex-none font-mono text-[10px] font-medium text-acc">
                                  {i + 1}.
                                </span>
                                <span className="min-w-0">
                                  <span className="block font-sans text-[12px] leading-[1.65] text-tx">
                                    {sense.definition}
                                  </span>
                                  {sense.example && (
                                    <span className="mt-[3px] block font-sans text-[11px] leading-[1.6] text-tx3">
                                      "{sense.example}"
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {lookup.synonyms.length > 0 && (
                          <div className="border-t border-line2 pt-3">
                            <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                              Near synonyms
                            </div>
                            <div className="flex flex-wrap gap-[5px]">
                              {lookup.synonyms.map((syn) => (
                                <span
                                  key={syn}
                                  className="rounded-full border border-line2 px-[9px] py-1 font-sans text-[10.5px] text-tx2"
                                >
                                  {syn}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    <div className="border-t border-line2 pt-3">
                      <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                        In this sentence
                      </div>
                      {lookup.context_available && lookup.context_note ? (
                        <div className="font-sans text-[12px] leading-[1.7] text-tx2">{lookup.context_note}</div>
                      ) : (
                        <div className="font-mono text-[10px] leading-[1.7] text-tx3">
                          explaining the word in context needs a local model — not installed yet
                        </div>
                      )}
                    </div>

                    {/* The vocabulary tables belong to the SRS increment. Until
                        they exist the button is disabled rather than faking a save. */}
                    <button
                      disabled
                      title="Saving to vocabulary arrives with the vocabulary & SRS increment"
                      className="rounded-field border border-line2 py-[10px] font-sans text-[11.5px] font-medium text-tx3 opacity-60"
                    >
                      ＋ Save to vocabulary with this sentence
                    </button>
                    <div className="font-mono text-[9.5px] leading-[1.7] text-tx3">
                      definitions come from the bundled offline wordlist · no model required
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'level' && (
              <div className="flex flex-col gap-[13px]">
                <div className="rounded-field border border-line2 p-[11px]">
                  <div className="mb-[6px] font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                    Selection · {leveled?.target_cefr ?? heatTarget} target
                  </div>
                  <div className="font-sans text-[11.5px] leading-[1.7] text-tx3">"{selectedText}"</div>
                </div>
                <div className="flex flex-col gap-[5px]">
                  {LEVEL_MODES.map((m) => {
                    const on = levelMode === m.key;
                    const offline = OFFLINE_MODES.includes(m.key);
                    return (
                      <button
                        key={m.key}
                        onClick={() => setLevelMode(m.key)}
                        className="flex items-center justify-between gap-2 rounded-field border px-[10px] py-2 text-left font-sans text-[11px] font-medium"
                        style={{ borderColor: on ? 'var(--accLine)' : 'var(--line)', background: on ? 'var(--accSoft)' : 'transparent', color: on ? 'var(--acc)' : 'var(--tx2)' }}
                      >
                        <span>{m.label}</span>
                        <span
                          className="font-mono text-[9px]"
                          style={{ color: offline ? 'var(--tx3)' : 'var(--tx3)', opacity: offline ? 1 : 0.7 }}
                        >
                          {m.tag}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-line2 pt-3">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em] text-acc">
                      {MODE_LABELS[levelMode]}
                      {leveled && leveled.available
                        ? ` · ${leveled.substitutions.length} replaced`
                        : ''}
                    </div>
                    {leveled?.cached && (
                      <span className="font-mono text-[8.5px] text-tx3" title="Served from the paragraph-hash cache">
                        cached
                      </span>
                    )}
                  </div>

                  {levelStatus === 'loading' && (
                    <div className="font-mono text-[10.5px] text-tx3">leveling…</div>
                  )}
                  {levelStatus === 'error' && (
                    <div className="font-mono text-[10.5px] text-tx3">Couldn't level this passage.</div>
                  )}

                  {levelStatus !== 'loading' && leveled && (
                    <div className="font-sans text-[12.5px] leading-[1.8] text-tx">
                      {showOriginal || leveled.segments.length === 0 ? (
                        <span>{leveled.original}</span>
                      ) : (
                        leveled.segments.map((seg, i) =>
                          seg.original ? (
                            <span
                              key={i}
                              className="cursor-help border-b border-dashed border-acc"
                              title={seg.original}
                            >
                              {seg.text}
                            </span>
                          ) : (
                            <span key={i}>{seg.text}</span>
                          ),
                        )
                      )}
                    </div>
                  )}

                  {/* The two generative modes have no model behind them yet;
                      say so rather than passing off a weaker result as the
                      one that was asked for. */}
                  {leveled?.note && (
                    <div
                      className="mt-[9px] rounded-field border px-[9px] py-[7px] font-mono text-[9.5px] leading-[1.6]"
                      style={{
                        borderColor: leveled.available ? 'var(--line2)' : 'var(--accLine)',
                        background: leveled.available ? 'transparent' : 'var(--accSoft)',
                        color: leveled.available ? 'var(--tx3)' : 'var(--acc)',
                      }}
                    >
                      {leveled.note}
                    </div>
                  )}
                </div>

                {leveled && leveled.substitutions.length > 0 && (
                  <div className="border-t border-line2 pt-3">
                    <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Substitutions</div>
                    <div className="flex flex-col gap-[6px]">
                      {leveled.substitutions.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-field border border-line2 px-[9px] py-[7px]">
                          <span className="font-mono text-[11px] text-tx3 line-through">{s.from_text}</span>
                          <span className="font-mono text-[10px] text-tx3">→</span>
                          <span className="font-sans text-[11px] font-medium text-tx">{s.to_text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setShowOriginal((v) => !v)}
                  disabled={!leveled || leveled.segments.length === 0}
                  className="rounded-field border border-line py-2 font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40 disabled:hover:border-line disabled:hover:text-tx2"
                >
                  {showOriginal ? 'show simplified' : 'show original'}
                </button>
                <div className="font-mono text-[9.5px] leading-[1.7] text-tx3">
                  applies to the selection only · cached by paragraph hash
                </div>
              </div>
            )}

            {tab === 'text' && (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Text size</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPrefs({ font_size: Math.max(12, fontSize - 1) })}
                      className="grid h-[34px] w-[34px] place-items-center rounded-field border border-line font-sans text-[13px] text-tx2 hover:border-acc hover:text-acc"
                    >
                      A−
                    </button>
                    <div className="h-[3px] flex-1 rounded-field bg-line2">
                      <div className="h-[3px] rounded-field bg-acc" style={{ width: `${fsPct}%` }} />
                    </div>
                    <button
                      onClick={() => setPrefs({ font_size: Math.min(22, fontSize + 1) })}
                      className="grid h-[34px] w-[34px] place-items-center rounded-field border border-line font-sans text-[15px] font-semibold text-tx2 hover:border-acc hover:text-acc"
                    >
                      A+
                    </button>
                  </div>
                  <div className="mt-[7px] font-mono text-[10px] text-tx3">{fontSize.toFixed(1)}px · line height 1.85 · column 640px</div>
                </div>
                <div>
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Page theme</div>
                  <div className="grid grid-cols-2 gap-[6px]">
                    {PAGE_THEMES.map((t) => {
                      const on = pageTheme === t.key;
                      return (
                        <button
                          key={t.key}
                          onClick={() => setPrefs({ page_theme: t.key })}
                          className="flex items-center gap-[8px] rounded-field border px-[10px] py-[8px] text-left transition-colors"
                          style={{ borderColor: on ? 'var(--acc)' : 'var(--line2)', background: on ? 'var(--accSoft)' : 'transparent' }}
                        >
                          <span
                            className="h-[22px] w-[22px] flex-none rounded-full border"
                            style={{ background: t.bg, borderColor: on ? 'var(--acc)' : 'var(--line2)', color: t.fg }}
                          >
                            <span className="grid h-full w-full place-items-center font-mono text-[10px] leading-none" style={{ color: t.fg }}>
                              {on ? '✓' : ''}
                            </span>
                          </span>
                          <span className="min-w-0">
                            <span className="block font-sans text-[11px] font-medium" style={{ color: on ? 'var(--acc)' : 'var(--tx)' }}>
                              {t.label}
                            </span>
                            <span className="block truncate font-mono text-[9px] text-tx3">{t.sub}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Difficulty heat</div>
                  <button
                    onClick={() => setPrefs({ heat_on: !heatOn })}
                    className="flex w-full items-center justify-between rounded-field border px-[10px] py-[9px] font-sans text-[11px] font-medium text-tx2"
                    style={{ borderColor: heatOn ? 'var(--accLine)' : 'var(--line)' }}
                  >
                    <span>Tint above-level words</span>
                    <span className="font-mono text-[10px] font-medium" style={{ color: heatOn ? 'var(--acc)' : 'var(--tx3)' }}>
                      {heatOn ? 'on' : 'off'}
                    </span>
                  </button>
                  <div className="mt-[7px] font-mono text-[10px] leading-[1.6] text-tx3">
                    {!heatEnabled
                      ? 'turned off for this book in its import settings'
                      : !heatOn
                        ? `${heatTotal} word${heatTotal === 1 ? '' : 's'} above ${heatTarget} on this page`
                        : heatTotal === 0
                          ? `nothing above ${heatTarget} on this page`
                          : `${heatTotal} word${heatTotal === 1 ? '' : 's'} above ${heatTarget} on this page · click one for its meaning`}
                  </div>
                </div>
                <div>
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Read aloud</div>
                  {/* Read-aloud is the TTS increment's, not this one's. An
                      enabled button that silently does nothing is worse than
                      one that says why it can't. */}
                  <button
                    disabled
                    title="Text-to-speech ships with the TTS increment"
                    className="w-full cursor-default rounded-field border border-line py-2 font-mono text-[11px] text-tx3 opacity-60"
                  >
                    ▶ Kokoro TTS · not installed yet
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
