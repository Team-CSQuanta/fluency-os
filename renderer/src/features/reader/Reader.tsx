import { useCallback, useEffect, useRef, useState } from 'react';
import { BlockText } from '@/features/reader/BlockText';
import { PageScroller, ZOOM_STEPS, zoomIn, zoomOut } from '@/features/reader/PageScroller';
import { HIGHLIGHT_COLOURS } from '@/features/reader/PageSelectionToolbar';
import {
  HIGHLIGHT_COLORS,
  LEVEL_MODES,
  MODE_LABELS,
  OFFLINE_MODES,
} from '@/features/reader/readerConstants';
import { getBlockSelectionRanges } from '@/features/reader/useSelectionRange';
import { useReadingSession } from '@/features/reader/useReadingSession';
import { useReaderStore } from '@/store/readerStore';
import { useShellStore } from '@/store/shellStore';
import { useVocabularyStore } from '@/store/vocabularyStore';
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

/** Which way the printed pages run. Named for what the reader sees rather
 * than for the axis: "down" and "across" need no explaining. */
const PAGE_SCROLLS = [
  { key: 'vertical' as const, label: 'down', title: 'Pages run down the screen, like a document' },
  { key: 'horizontal' as const, label: 'across', title: 'Pages run across the screen, side by side' },
];

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

/** The swatch for a page mark, falling back rather than rendering nothing
 * for a colour added after this build. */
const PAGE_MARK_COLOUR = (key: string): string =>
  HIGHLIGHT_COLOURS.find((c) => c.key === key)?.value ?? 'var(--line)';

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
  const goToPage = useReaderStore((s) => s.goToPage);
  const highlights = useReaderStore((s) => s.highlights);
  const bookmarks = useReaderStore((s) => s.bookmarks);
  const createHighlight = useReaderStore((s) => s.createHighlight);
  const updateHighlight = useReaderStore((s) => s.updateHighlight);
  const deleteHighlight = useReaderStore((s) => s.deleteHighlight);
  const createBookmark = useReaderStore((s) => s.createBookmark);
  const deleteBookmark = useReaderStore((s) => s.deleteBookmark);
  const searchQuery = useReaderStore((s) => s.searchQuery);
  const searchHits = useReaderStore((s) => s.searchHits);
  const allPageHighlights = useReaderStore((s) => s.allPageHighlights);
  const removePageHighlight = useReaderStore((s) => s.removePageHighlight);
  const searchStatus = useReaderStore((s) => s.searchStatus);
  const setSearchQuery = useReaderStore((s) => s.setSearchQuery);
  const heat = useReaderStore((s) => s.heat);
  const heatEnabled = useReaderStore((s) => s.heatEnabled);
  const heatTarget = useReaderStore((s) => s.heatTarget);
  const heatTotal = useReaderStore((s) => s.heatTotal);
  const lookup = useReaderStore((s) => s.lookup);
  const lookupStatus = useReaderStore((s) => s.lookupStatus);
  const lookupBlockIndex = useReaderStore((s) => s.lookupBlockIndex);
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

  /* The book's own typeset page, for the things the text pipeline cannot
   * carry: figures, plates, equations set as images, the layout itself. Only
   * PDFs have one — every other format is reflowable and never had a page. */
  const canShowPage = Boolean(book?.has_page_images);
  const showingPage = prefs.page_view && canShowPage;
  const zoom = prefs.page_zoom;
  // null while not being edited, so the box shows wherever the reader
  // actually is rather than the last thing they typed into it.
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [highlighterColor, setHighlighterColor] = useState<HighlightColour | null>(null);
  const saveWord = useVocabularyStore((s) => s.saveWord);
  const [toast, setToast] = useState('');
  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  };

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

  useEffect(() => {
    setPageDraft(null);
  }, [page, bookId]);

  const commitPageDraft = () => {
    const wanted = Number(pageDraft);
    setPageDraft(null);
    if (!pageDraft || Number.isNaN(wanted)) return;
    const clamped = Math.max(1, Math.min(wanted, totalPages || wanted));
    if (clamped !== page) void goToPage(clamped);
  };

  /** Where the reader has scrolled to, once they stop.
   *
   * Settling rather than reporting every page that goes by: scrolling
   * through thirty pages to reach a figure should not write thirty reading
   * positions, or fetch thirty pages of text nobody looked at. */
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScrolledTo = useCallback(
    (reached: number) => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        void goToPage(reached);
      }, 400);
    },
    [goToPage],
  );
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  /* Keys. On the printed page the arrows scroll it, as they do in any
   * document — the pages run continuously, so there is nothing to turn. In
   * the text view, which is still a page at a time, they still turn it. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (showingPage) {
        if (!(e.ctrlKey || e.metaKey)) return;
        const at = useReaderStore.getState().prefs.page_zoom;
        if (e.key === '+' || e.key === '=') setPrefs({ page_zoom: zoomIn(at) });
        else if (e.key === '-') setPrefs({ page_zoom: zoomOut(at) });
        else if (e.key === '0') setPrefs({ page_zoom: 1 });
        else return;
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowRight') void nextPage();
      else if (e.key === 'ArrowLeft') void prevPage();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nextPage, prevPage, showingPage, setPrefs]);

  // Heat spans for the blocks on screen, indexed for O(1) lookup per block.
  // The panel's own switch gates it on top of the per-book heat_overlay flag.
  const showHeat = heatOn && heatEnabled;
  const heatByBlock = new Map(heat.map((h) => [h.block_index, h.spans]));

  const handleWordClick = (word: string, sentence: string, blockIndex: number) => {
    setTab('ai');
    void lookupWord(word, sentence, blockIndex);
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
    // One highlight per paragraph covered. A drag across a paragraph break
    // used to produce nothing at all, which reads as broken rather than as a
    // limit — and sentences run across breaks often enough to hit it early.
    const ranges = getBlockSelectionRanges();
    if (ranges.length === 0) return;
    justDraggedRef.current = true;
    for (const range of ranges) {
      void createHighlight({
        blockIndex: range.blockIndex,
        startChar: range.startChar,
        endChar: range.endChar,
        colour: highlighterColor,
        quotedText: range.quotedText,
      });
    }
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

  /* Finishing a book belongs at the end of it, so this sits after the last
   * page — under the text in the text view, after the last sheet in the
   * page view. One definition, because it is the same button either way. */
  const finishBlock = (
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
  );

  const tabs: Tab[] = ['toc', 'search', 'marks', 'text', 'ai', 'level'];
  const isTurning = readerStatus === 'loading' && blocks.length > 0;

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* The book's own frame: two fixed bars and, under them, whatever is
          being read. The bars used to scroll with the text and be pinned
          back in place; with pages running continuously underneath they are
          simply the top of the window. */}
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col transition-colors duration-200"
        style={{ background: READER_BG[pageTheme] }}
      >
        <div className="flex w-full flex-none justify-center border-b border-line2 px-6 py-[10px]">
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

        <div className="flex w-full flex-none justify-center border-b border-line2 px-6 py-[7px]">
          <div className="flex w-full max-w-[760px] flex-wrap items-center gap-[9px] font-mono text-[10.5px] text-tx3">
            <span className="flex flex-none items-center gap-[5px]">
              page
              {/* Typing a number is how you get to page 400 of a 600-page
                  book. Stepping one at a time and the table of contents were
                  the only ways here before, and neither is one. */}
              <input
                value={pageDraft ?? String(page)}
                onChange={(e) => setPageDraft(e.target.value.replace(/[^0-9]/g, ''))}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitPageDraft();
                  else if (e.key === 'Escape') setPageDraft(null);
                }}
                onBlur={commitPageDraft}
                aria-label="Go to page"
                title="Type a page number and press Enter"
                className="w-[46px] rounded-[4px] border border-line2 bg-transparent px-[5px] py-[2px] text-center font-mono text-[10.5px] text-tx2 outline-none transition-colors focus:border-acc focus:text-acc"
              />
              / {totalPages || '—'}
            </span>

            {showingPage && (
              <>
                {/* Zoom. 100% is a whole page rather than a fixed size, so it
                    means the same thing on a laptop and on a large monitor. */}
                <span className="flex flex-none items-center gap-[3px]">
                  <button
                    onClick={() => setPrefs({ page_zoom: zoomOut(zoom) })}
                    disabled={zoom <= ZOOM_STEPS[0]}
                    title="Smaller — or hold Ctrl and turn the wheel"
                    className="h-[21px] w-[21px] rounded-[4px] border border-line2 text-tx2 transition-colors hover:border-acc hover:text-acc disabled:opacity-30 disabled:hover:border-line2 disabled:hover:text-tx2"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setPrefs({ page_zoom: 1 })}
                    title="Back to a whole page"
                    className="min-w-[46px] rounded-[4px] border border-line2 px-[5px] py-[2px] text-tx2 transition-colors hover:border-acc hover:text-acc"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    onClick={() => setPrefs({ page_zoom: zoomIn(zoom) })}
                    disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                    title="Larger — or hold Ctrl and turn the wheel"
                    className="h-[21px] w-[21px] rounded-[4px] border border-line2 text-tx2 transition-colors hover:border-acc hover:text-acc disabled:opacity-30 disabled:hover:border-line2 disabled:hover:text-tx2"
                  >
                    +
                  </button>
                </span>

                {/* Which way the pages run. Also in Settings → Reading, for
                    someone who wants it set before opening anything. */}
                <span className="flex flex-none items-center gap-[3px]">
                  {PAGE_SCROLLS.map((dir) => {
                    const on = prefs.page_scroll === dir.key;
                    return (
                      <button
                        key={dir.key}
                        onClick={() => setPrefs({ page_scroll: dir.key })}
                        title={dir.title}
                        className="rounded-[4px] border px-[7px] py-[2px] transition-colors"
                        style={{
                          borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                          background: on ? 'var(--accSoft)' : 'transparent',
                          color: on ? 'var(--acc)' : 'var(--tx3)',
                        }}
                      >
                        {dir.label}
                      </button>
                    );
                  })}
                </span>
              </>
            )}

            <span className="min-w-0 flex-1" />
            {canShowPage && (
              <button
                onClick={() => setPrefs({ page_view: !prefs.page_view })}
                title={
                  showingPage
                    ? 'Back to the text, where lookup and highlighting live'
                    : "Show the book's own page, with its figures and layout"
                }
                className="flex-none rounded-field border px-[9px] py-[3px] font-mono text-[10px] transition-colors"
                style={{
                  borderColor: showingPage ? 'var(--accLine)' : 'var(--line2)',
                  background: showingPage ? 'var(--accSoft)' : 'transparent',
                  color: showingPage ? 'var(--acc)' : 'var(--tx3)',
                }}
              >
                {showingPage ? 'original page' : 'show original page'}
              </button>
            )}
            <span className="flex-none">{Math.round(percent)}% read</span>
          </div>
        </div>

        {/* Both views need these, so they sit above the fork: a book that
            failed to open would otherwise show an empty frame and no reason. */}
        {readerStatus === 'loading' && blocks.length === 0 && (
          <div className="py-16 text-center font-mono text-[11px] text-tx3">opening book…</div>
        )}
        {readerStatus === 'error' && (
          <div className="py-16 text-center font-mono text-[11px] text-tx3">
            couldn't open this book{readerError ? ` — ${readerError}` : ''}
          </div>
        )}

        {showingPage && bookId ? (
          <PageScroller
            bookId={bookId}
            total={totalPages}
            page={page}
            zoom={zoom}
            scroll={prefs.page_scroll}
            onPage={handleScrolledTo}
            onZoom={(next) => setPrefs({ page_zoom: next })}
            tail={
              <div className="mx-auto w-full max-w-[420px] flex-none pt-3">
                {finishBlock}
                <p className="pt-[10px] text-center font-mono text-[9.5px] leading-[1.7] text-tx3">
                  select any text to highlight it, look it up, or ask for it in simpler
                  words · the difficulty overlay still works in the text view
                </p>
              </div>
            }
          />
        ) : (
          <div
            ref={scrollRef}
            className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-9"
          >
            <div className="flex w-full max-w-[640px] flex-1 flex-col pt-[24px]">

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

              {/* A page can legitimately hold no prose — a plate, a full-page
                  figure, a blank leaf. It used to render as an empty screen
                  with no explanation AND no way off it, because the pager
                  below was hidden along with the text. */}
              {readerStatus === 'ready' && blocks.length === 0 && (
                <div className="py-14 text-center">
                  <div className="font-mono text-[11px] text-tx2">no text on this page</div>
                  <p className="mx-auto mt-[7px] max-w-[330px] font-sans text-[11.5px] leading-[1.7] text-tx3">
                    It's a full-page image, a plate, or a blank leaf — there was no prose
                    here to extract.
                  </p>
                  {canShowPage && (
                    <button
                      onClick={() => setPrefs({ page_view: true })}
                      className="mt-[11px] rounded-field border border-line px-[13px] py-[7px] font-mono text-[10.5px] text-tx2 transition-colors hover:border-acc hover:text-acc"
                    >
                      show the original page
                    </button>
                  )}
                </div>
              )}
              </div>

              {/* The end of the last page is where finishing a book actually
                  happens, so the action lives here rather than only on the
                  shelf. */}
              {totalPages > 0 && !hasNext && finishBlock}

          {totalPages > 0 && (
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
        )}
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
                    All highlights · {highlights.length + allPageHighlights.length}
                  </div>
                  <div className="flex flex-col gap-2">
                    {highlights.length + allPageHighlights.length === 0 && (
                      <div className="font-mono text-[10px] text-tx3">No highlights yet.</div>
                    )}
                    {/* Marks drawn on the printed page. Listed alongside the
                        ones made in the text view rather than in a section of
                        their own: they are the same act to the reader, and
                        which view a passage was marked in is not something
                        anyone remembers a week later. */}
                    {allPageHighlights.map((h) => (
                      <div
                        key={h.id}
                        className="rounded-field border border-line2 px-[10px] py-[10px]"
                        style={{ borderLeft: `3px solid ${PAGE_MARK_COLOUR(h.colour)}` }}
                      >
                        <button onClick={() => void goToPage(h.page)} className="block w-full text-left">
                          <span className="font-sans text-[11px] leading-[1.6] text-tx2">
                            "{h.quoted_text.slice(0, 220)}
                            {h.quoted_text.length > 220 ? '…' : ''}"
                          </span>
                        </button>
                        <div className="mt-[6px] flex items-center justify-between gap-2">
                          <span className="font-mono text-[9px] text-tx3">
                            page {h.page} · on the printed page
                          </span>
                          <button
                            onClick={() => void removePageHighlight(h.id)}
                            className="font-mono text-[9px] text-tx3 hover:text-acc"
                          >
                            remove
                          </button>
                        </div>
                      </div>
                    ))}
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
                        No dictionary here has "{lookup.word}". It may be a name, a typo, or a
                        word none of them cover — and if you were offline just now, trying again
                        with a connection may find it.
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

                    {/* Only offered once found — there is no dictionary data
                        to snapshot for a word the offline lexicon doesn't know. */}
                    {lookup.found && (
                      <>
                        <button
                          onClick={async () => {
                            const sentence = blocks.find((b) => b.block_index === lookupBlockIndex)?.text;
                            const { alreadySaved } = await saveWord({
                              word: lookup.word,
                              sentence,
                              bookId: bookId ?? undefined,
                              blockIndex: lookupBlockIndex ?? undefined,
                            });
                            flashToast(
                              alreadySaved
                                ? `"${lookup.word}" is already in your vocabulary`
                                : `"${lookup.word}" saved to vocabulary`,
                            );
                          }}
                          className="rounded-field border border-accLine bg-accSoft py-[10px] font-sans text-[11.5px] font-medium text-acc hover:brightness-105"
                        >
                          ＋ Save to vocabulary with this sentence
                        </button>
                        <div className="font-mono text-[9.5px] leading-[1.7] text-tx3">
                          definitions come from the bundled offline wordlist · no model required
                        </div>
                      </>
                    )}
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
                    title="Reading the page aloud isn’t built yet"
                    className="w-full cursor-default rounded-field border border-line py-2 font-mono text-[11px] text-tx3 opacity-60"
                  >
                    ▶ Read this aloud · not built yet
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-field border border-accLine bg-panel2 px-[14px] py-[10px] font-mono text-[11.5px] font-medium text-tx shadow-panel">
          {toast}
        </div>
      )}
    </div>
  );
}
