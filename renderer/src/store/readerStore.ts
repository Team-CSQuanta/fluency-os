import { create } from 'zustand';
import { ApiError, api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import { useBookshelfStore } from '@/store/bookshelfStore';
import { useEngineStore } from '@/store/engineStore';
import { useShellStore } from '@/store/shellStore';
import type {
  BlockHeatOut,
  BlockOut,
  BookmarkOut,
  BookOut,
  ChapterOut,
  HeatOut,
  HighlightColour,
  HighlightOut,
  LeveledTextOut,
  LevelMode,
  PageOut,
  PositionOut,
  ReaderPrefsOut,
  SearchHitOut,
  SessionOut,
  WordLookupOut,
  PageTextLayerOut,
  PageHighlightOut,
  HighlightRect,
  HighlightStyle,
  PageLabelOut,
} from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

const SEARCH_DEBOUNCE_MS = 200;
const PREFS_SAVE_DEBOUNCE_MS = 400;

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user — cannot open a book yet');
  return id;
}

interface ReaderState {
  bookId: string | null;
  book: BookOut | null;
  toc: ChapterOut[];
  blocks: BlockOut[];
  page: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  percent: number;
  highlights: HighlightOut[];
  bookmarks: BookmarkOut[];
  searchQuery: string;
  searchHits: SearchHitOut[];
  searchStatus: 'idle' | 'loading' | 'error';
  heat: BlockHeatOut[];
  heatEnabled: boolean;
  heatTarget: string;
  heatTotal: number;
  lookup: WordLookupOut | null;
  lookupStatus: 'idle' | 'loading' | 'error';
  // The block the current lookup's word was clicked in — the vocabulary
  // save action needs this for context provenance (book_id + block_index).
  lookupBlockIndex: number | null;
  levelMode: LevelMode;
  leveled: LeveledTextOut | null;
  levelStatus: 'idle' | 'loading' | 'error';
  levelBlockIndex: number | null;
  session: SessionOut | null;
  prefs: ReaderPrefsOut;
  // The block a jump (search hit, bookmark, highlight) is aiming at. The
  // reader clears it once it has scrolled there — a page load has to land
  // first, so the target can't be acted on at click time.
  focusBlock: number | null;
  status: 'idle' | 'loading' | 'error' | 'ready';
  error: string | null;

  openBook: (bookId: string) => Promise<void>;
  goToPage: (page: number) => Promise<void>;
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;
  jumpToChapter: (chapter: ChapterOut) => Promise<void>;
  createHighlight: (params: {
    blockIndex: number;
    startChar: number;
    endChar: number;
    colour: HighlightColour;
    quotedText: string;
  }) => Promise<void>;
  updateHighlight: (id: string, patch: { colour?: HighlightColour; note?: string | null }) => Promise<void>;
  deleteHighlight: (id: string) => Promise<void>;
  createBookmark: (blockIndex: number, label: string) => Promise<void>;
  deleteBookmark: (id: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  lookupWord: (word: string, sentence?: string, blockIndex?: number) => Promise<void>;

  // The printed page, made selectable. See PageTextLayer.tsx.
  /** Word boxes, keyed by page.
   *
   * Keyed rather than single, because the reader scrolls through a book
   * rather than turning one page at a time: several pages are on screen at
   * once and each needs its own words under it. Held to a window of recent
   * pages — a 938-page book's worth would be tens of megabytes of boxes for
   * pages nobody is looking at. */
  layers: Record<number, PageTextLayerOut>;
  /** Every page highlight in the book — they are fetched once, on open, and
   * each page's marks are those with its number. */
  allPageHighlights: PageHighlightOut[];
  /** How tall a page is against its width, learned from the first page that
   * loads. Every slot in the book is that shape until proven otherwise, so a
   * page that has not loaded yet still holds the right amount of room. */
  pageRatio: number;
  setPageRatio: (ratio: number) => void;
  loadPageLayer: (page: number) => Promise<void>;
  addPageHighlight: (h: {
    page: number;
    rects: HighlightRect[];
    colour: string;
    style: HighlightStyle;
    quotedText: string;
  }) => Promise<void>;
  recolourPageHighlight: (id: string, colour: string, style?: HighlightStyle) => Promise<void>;
  removePageHighlight: (id: string) => Promise<void>;

  /** Passages shown in plainer words, pinned over the originals, by page. */
  labelsByPage: Record<number, PageLabelOut[]>;
  /** Asks the model for a simpler version and pins it where the words were.
   * Returns the note the engine sent back, when it had something to say —
   * "no model configured", or which mode it actually ran. */
  simplifySelection: (args: {
    page: number;
    rects: HighlightRect[];
    text: string;
  }) => Promise<string | null>;
  removePageLabel: (id: string) => Promise<void>;
  clearLookup: () => void;
  setLevelMode: (mode: LevelMode) => void;
  levelBlock: (blockIndex: number, mode?: LevelMode) => Promise<void>;
  openSession: () => Promise<void>;
  heartbeat: (seconds: number) => Promise<void>;
  loadPrefs: () => Promise<void>;
  setPrefs: (patch: Partial<ReaderPrefsOut>) => void;
  jumpToBlock: (page: number, blockIndex: number) => Promise<void>;
  clearFocusBlock: () => void;
  setFinished: (finished: boolean) => Promise<void>;
  close: () => void;
}

const INITIAL: Pick<
  ReaderState,
  | 'bookId'
  | 'book'
  | 'toc'
  | 'blocks'
  | 'page'
  | 'totalPages'
  | 'hasPrev'
  | 'hasNext'
  | 'percent'
  | 'highlights'
  | 'bookmarks'
  | 'searchQuery'
  | 'searchHits'
  | 'searchStatus'
  | 'heat'
  | 'heatEnabled'
  | 'heatTarget'
  | 'heatTotal'
  | 'lookup'
  | 'lookupStatus'
  | 'lookupBlockIndex'
  | 'levelMode'
  | 'leveled'
  | 'levelStatus'
  | 'levelBlockIndex'
  | 'session'
  | 'focusBlock'
  | 'status'
  | 'error'
  | 'layers'
  | 'labelsByPage'
  | 'allPageHighlights'
> = {
  bookId: null,
  book: null,
  toc: [],
  blocks: [],
  page: 1,
  totalPages: 0,
  hasPrev: false,
  hasNext: false,
  percent: 0,
  highlights: [],
  bookmarks: [],
  searchQuery: '',
  searchHits: [],
  searchStatus: 'idle',
  heat: [],
  heatEnabled: true,
  heatTarget: 'B1',
  heatTotal: 0,
  lookup: null,
  lookupStatus: 'idle',
  lookupBlockIndex: null,
  // Defaults to a mode that actually works offline; the two generative modes
  // are selectable but gated.
  levelMode: 'inline',
  leveled: null,
  levelStatus: 'idle',
  levelBlockIndex: null,
  session: null,
  focusBlock: null,
  status: 'idle',
  error: null,
  layers: {},
  labelsByPage: {},
  allPageHighlights: [],
};

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let searchAbortController: AbortController | null = null;
// Leveling is a POST, so it can't be cancelled the way search is — the
// sequence number drops a stale response instead.
let levelRequestSeq = 0;

function cancelPendingSearch(): void {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  searchAbortController?.abort();
  searchAbortController = null;
}

const DEFAULT_PREFS: ReaderPrefsOut = {
  font_size: 15.5,
  page_theme: 'auto',
  heat_on: true,
  panel_open: true,
  panel_tab: 'toc',
  page_view: false,
  page_scroll: 'vertical',
  page_zoom: 1,
};

/** The last few pages' worth of word boxes, around the one being read.
 *
 * A window rather than everything: the boxes for one page of a textbook are
 * a few hundred entries, which is nothing, and a whole book of them is tens
 * of megabytes held for pages that are no longer on screen. */
const LAYER_WINDOW = 12;

function keepRecent(
  layers: Record<number, PageTextLayerOut>,
  around: number,
): Record<number, PageTextLayerOut> {
  const pages = Object.keys(layers).map(Number);
  if (pages.length <= LAYER_WINDOW) return layers;
  const kept = pages
    .sort((a, b) => Math.abs(a - around) - Math.abs(b - around))
    .slice(0, LAYER_WINDOW);
  return Object.fromEntries(kept.map((p) => [p, layers[p]]));
}

/* Recently fetched pages, keyed `<bookId>:<page>`.
 *
 * Every page turn was a network round trip with the text dimmed until it
 * landed, and turning back re-fetched a page just read. Small on purpose: the
 * point is that the page either side of where you are is already here, not
 * that a whole book is held in memory. */
const PAGE_CACHE_LIMIT = 12;
const pageCache = new Map<string, PageOut>();

function cacheKey(bookId: string, page: number): string {
  return `${bookId}:${page}`;
}

function rememberPage(bookId: string, data: PageOut): void {
  const key = cacheKey(bookId, data.page);
  // Deleted first so that re-reading a page moves it to the end and the
  // eviction below takes the genuinely least recent one.
  pageCache.delete(key);
  pageCache.set(key, data);
  while (pageCache.size > PAGE_CACHE_LIMIT) {
    const oldest = pageCache.keys().next().value;
    if (oldest === undefined) break;
    pageCache.delete(oldest);
  }
}

/** Fetch the page after this one into the cache, without disturbing the view.
 *
 * Deliberately fire-and-forget and deliberately silent: it is a guess about
 * what happens next, so a failure must do nothing at all rather than surface
 * an error for a page nobody asked for yet. */
function prefetchNext(bookId: string, page: number, totalPages: number): void {
  const next = page + 1;
  if (next > totalPages) return;
  if (pageCache.has(cacheKey(bookId, next))) return;
  void api
    .get<PageOut>(`/books/${bookId}/page?page=${next}`)
    .then((data) => rememberPage(bookId, data))
    .catch(() => undefined);
}

let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
// Set the moment the reader touches a control. loadPrefs resolving after that
// must not overwrite the change with the value it was already fetching.
let prefsTouched = false;

export const useReaderStore = create<ReaderState>((set, get) => ({
  ...INITIAL,
  // Deliberately outside INITIAL — these belong to the reader, not to the
  // book that happens to be open, so closing a book must not reset them.
  prefs: DEFAULT_PREFS,

  openBook: async (bookId) => {
    cancelPendingSearch();
    set({ ...INITIAL, bookId, status: 'loading' });
    try {
      const userId = requireUserId();
      const [book, toc, position, highlights, bookmarks] = await Promise.all([
        api.get<BookOut>(`/books/${bookId}`),
        api.get<ChapterOut[]>(`/books/${bookId}/toc`),
        api.get<PositionOut>(`/books/${bookId}/position?user_id=${encodeURIComponent(userId)}`),
        api.get<HighlightOut[]>(`/books/${bookId}/highlights?user_id=${encodeURIComponent(userId)}`),
        api.get<BookmarkOut[]>(`/books/${bookId}/bookmarks?user_id=${encodeURIComponent(userId)}`),
      ]);
      // Page marks come separately and are allowed to fail: a book with no
      // printed pages has none, and that is not a reason to fail to open it.
      const allPageHighlights = await api
        .get<PageHighlightOut[]>(
          `/books/${bookId}/page-highlights?user_id=${encodeURIComponent(userId)}`,
        )
        .catch(() => [] as PageHighlightOut[]);
      if (get().bookId !== bookId) return; // reader moved on to another book while this was in flight

      useShellStore.getState().setNowReading(book.title);
      set({ book, toc, percent: position.percent, highlights, bookmarks, allPageHighlights });

      await loadPage(bookId, position.page || 1, { get, set, savePosition: false });
    } catch (err) {
      set({ status: 'error', error: friendlyMessage(err, 'Opening this book') });
    }
  },

  goToPage: async (pageNum) => {
    const { bookId } = get();
    if (!bookId) return;
    await loadPage(bookId, pageNum, { get, set, savePosition: true });
  },

  nextPage: async () => {
    const { hasNext, page } = get();
    if (!hasNext) return;
    await get().goToPage(page + 1);
  },

  prevPage: async () => {
    const { hasPrev, page } = get();
    if (!hasPrev) return;
    await get().goToPage(page - 1);
  },

  jumpToChapter: async (chapter) => {
    await get().goToPage(chapter.page);
  },

  createHighlight: async ({ blockIndex, startChar, endChar, colour, quotedText }) => {
    const { bookId } = get();
    if (!bookId) return;
    const userId = requireUserId();
    const created = await api.post<HighlightOut>(`/books/${bookId}/highlights`, {
      user_id: userId,
      block_index: blockIndex,
      start_char: startChar,
      end_char: endChar,
      colour,
      quoted_text: quotedText,
    });
    if (get().bookId !== bookId) return;
    set((s) => ({ highlights: [...s.highlights, created] }));
  },

  updateHighlight: async (id, patch) => {
    const { bookId } = get();
    if (!bookId) return;
    const updated = await api.patch<HighlightOut>(`/books/${bookId}/highlights/${id}`, patch);
    if (get().bookId !== bookId) return;
    set((s) => ({ highlights: s.highlights.map((h) => (h.id === id ? updated : h)) }));
  },

  deleteHighlight: async (id) => {
    const { bookId } = get();
    if (!bookId) return;
    await api.delete(`/books/${bookId}/highlights/${id}`);
    if (get().bookId !== bookId) return;
    set((s) => ({ highlights: s.highlights.filter((h) => h.id !== id) }));
  },

  createBookmark: async (blockIndex, label) => {
    const { bookId } = get();
    if (!bookId) return;
    const userId = requireUserId();
    const created = await api.post<BookmarkOut>(`/books/${bookId}/bookmarks`, {
      user_id: userId,
      block_index: blockIndex,
      label,
    });
    if (get().bookId !== bookId) return;
    set((s) => ({ bookmarks: [...s.bookmarks, created] }));
  },

  deleteBookmark: async (id) => {
    const { bookId } = get();
    if (!bookId) return;
    await api.delete(`/books/${bookId}/bookmarks/${id}`);
    if (get().bookId !== bookId) return;
    set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) }));
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
    cancelPendingSearch();

    if (query.trim() === '') {
      set({ searchHits: [], searchStatus: 'idle' });
      return;
    }

    searchDebounceTimer = setTimeout(() => {
      const { bookId } = get();
      if (!bookId) return;
      const controller = new AbortController();
      searchAbortController = controller;
      set({ searchStatus: 'loading' });

      api
        .get<SearchHitOut[]>(`/books/${bookId}/search?q=${encodeURIComponent(query)}`, controller.signal)
        .then((hits) => {
          if (controller.signal.aborted || get().bookId !== bookId) return;
          set({ searchHits: hits, searchStatus: 'idle' });
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          set({ searchStatus: 'error', searchHits: [] });
        });
    }, SEARCH_DEBOUNCE_MS);
  },

  lookupWord: async (word, sentence, blockIndex) => {
    const clean = word.trim();
    if (!clean) return;
    set({ lookupStatus: 'loading', lookupBlockIndex: blockIndex ?? null });
    try {
      const query = new URLSearchParams({ w: clean });
      if (sentence) query.set('ctx', sentence);
      const result = await api.get<WordLookupOut>(`/reading/lookup?${query.toString()}`);
      set({ lookup: result, lookupStatus: 'idle' });
    } catch {
      set({ lookup: null, lookupStatus: 'error' });
    }
  },

  clearLookup: () => set({ lookup: null, lookupStatus: 'idle', lookupBlockIndex: null }),

  // A4 and US Letter are 1.41 and 1.29 tall; a textbook is usually between
  // them. Only used until a real page says otherwise.
  pageRatio: 1.33,
  setPageRatio: (ratio) => {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    if (Math.abs(get().pageRatio - ratio) < 0.005) return;
    set({ pageRatio: ratio });
  },

  /** The words and the plainer-word labels for one page.
   *
   * Asked for by each page as it comes into view and ignored if that page
   * already has its words, so scrolling back over a page costs nothing. The
   * marks are not fetched here: the whole book's are already in hand from
   * the open. */
  loadPageLayer: async (page) => {
    const bookId = get().bookId;
    if (!bookId) return;
    if (get().layers[page]) return;
    const userId = useAppStore.getState().currentUserId;
    try {
      const [layer, labels] = await Promise.all([
        api.get<PageTextLayerOut>(`/books/${bookId}/page/${page}/text-layer`),
        userId
          ? api.get<PageLabelOut[]>(
              `/books/${bookId}/page-labels?user_id=${encodeURIComponent(userId)}&page=${page}`,
            )
          : Promise.resolve([] as PageLabelOut[]),
      ]);
      // The reader may have closed the book while this was in flight.
      if (get().bookId !== bookId) return;
      get().setPageRatio(layer.height / layer.width);
      set((st) => ({
        layers: keepRecent({ ...st.layers, [page]: layer }, page),
        labelsByPage: { ...st.labelsByPage, [page]: labels },
      }));
    } catch {
      // A page that cannot be laid over is still a page that can be read;
      // it simply cannot be selected on.
    }
  },

  addPageHighlight: async ({ page, rects, colour, style, quotedText }) => {
    const bookId = get().bookId;
    const userId = useAppStore.getState().currentUserId;
    if (!bookId || !userId) return;
    const made = await api.post<PageHighlightOut>(`/books/${bookId}/page-highlights`, {
      user_id: userId,
      page,
      rects,
      colour,
      style,
      quoted_text: quotedText,
    });
    set((s) => ({ allPageHighlights: [...s.allPageHighlights, made] }));
  },

  recolourPageHighlight: async (id, colour, style) => {
    const bookId = get().bookId;
    if (!bookId) return;
    const updated = await api.patch<PageHighlightOut>(
      `/books/${bookId}/page-highlights/${id}`,
      style ? { colour, style } : { colour },
    );
    set((s) => ({
      allPageHighlights: s.allPageHighlights.map((h) => (h.id === id ? updated : h)),
    }));
  },

  /** The whole of the feature: ask for a passage in plainer words, then pin
   * the answer where the original words are.
   *
   * The simplification goes through the same engines and the same cache as
   * the side panel's — so a passage simplified once is instant the next time,
   * and a reader with no model configured gets the rules-based rewrite with a
   * note saying so rather than an error. */
  simplifySelection: async ({ page, rects, text }) => {
    const bookId = get().bookId;
    const userId = useAppStore.getState().currentUserId;
    if (!bookId || !userId) return null;

    /* The AI writes these, and nothing else may.
     *
     * The label is drawn OVER the printed words, so a wordlist substitution
     * that happens to change nothing — which is what the offline modes do to
     * most academic prose — covers a sentence with a copy of itself and looks
     * like the feature ran and failed. The side panel is welcome to degrade,
     * because it shows its answer beside the original and says what it did.
     *
     * Asked for before anything is sent, so a reader whose AI is not running
     * gets the dialog that starts it rather than a wait and then a refusal —
     * but only when the app has actually looked. Nobody having asked yet is
     * not the same as the answer being no, and the server checks anyway. */
    const engines = useEngineStore.getState().status;
    if (engines && engines.llm !== 'ready') {
      throw new ApiError(
        'POST',
        '/reading/level-text',
        503,
        JSON.stringify({
          detail: 'The AI writes these simpler versions, and it is not running yet.',
        }),
      );
    }

    const mode: LevelMode = get().levelMode === 'semantic' ? 'semantic' : 'contextual';
    const leveled = await api.post<LeveledTextOut>('/reading/level-text', {
      text,
      mode,
      user_id: userId,
      require_model: true,
    });
    const simple = leveled.segments.map((seg) => seg.text).join('');
    // Nothing to pin. An engine that returned the original unchanged has not
    // simplified anything, and covering the page with a copy of itself would
    // be worse than saying so.
    if (!simple.trim() || simple.trim() === text.trim()) {
      return leveled.note ?? 'Nothing here needed putting in simpler words.';
    }

    const made = await api.post<PageLabelOut>(`/books/${bookId}/page-labels`, {
      user_id: userId,
      page,
      rects,
      original_text: text,
      simple_text: simple,
      mode: leveled.served_mode,
    });
    set((s) => ({
      labelsByPage: { ...s.labelsByPage, [page]: [...(s.labelsByPage[page] ?? []), made] },
    }));
    return leveled.available ? null : leveled.note;
  },

  removePageLabel: async (id) => {
    const bookId = get().bookId;
    if (!bookId) return;
    const before = get().labelsByPage;
    const without = Object.fromEntries(
      Object.entries(before).map(([page, labels]) => [page, labels.filter((l) => l.id !== id)]),
    );
    set({ labelsByPage: without });
    try {
      await api.delete(`/books/${bookId}/page-labels/${id}`);
    } catch (err) {
      set({ labelsByPage: before });
      throw err;
    }
  },

  removePageHighlight: async (id) => {
    const bookId = get().bookId;
    if (!bookId) return;
    // Optimistic: the mark disappears under the cursor that asked for it.
    const beforeAll = get().allPageHighlights;
    set({ allPageHighlights: beforeAll.filter((h) => h.id !== id) });
    try {
      await api.delete(`/books/${bookId}/page-highlights/${id}`);
    } catch (err) {
      set({ allPageHighlights: beforeAll });
      throw err;
    }
  },

  loadPrefs: async () => {
    try {
      const userId = requireUserId();
      const prefs = await api.get<ReaderPrefsOut>(
        `/reading/prefs?user_id=${encodeURIComponent(userId)}`,
      );
      if (prefsTouched) return;
      set({ prefs });
    } catch {
      // Defaults are already in place; a failed load must not block reading.
    }
  },

  setPrefs: (patch) => {
    // Optimistic, then debounced: dragging the font size past four steps
    // should be one write, not four.
    prefsTouched = true;
    const prefs = { ...get().prefs, ...patch };
    set({ prefs });

    if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
    prefsSaveTimer = setTimeout(() => {
      prefsSaveTimer = null;
      const userId = useAppStore.getState().currentUserId;
      if (!userId) return;
      void api.put<ReaderPrefsOut>('/reading/prefs', { user_id: userId, ...get().prefs }).catch(() => {
        // Losing a preference write is survivable; losing the reader is not.
      });
    }, PREFS_SAVE_DEBOUNCE_MS);
  },

  jumpToBlock: async (targetPage, blockIndex) => {
    // Arm the target before the page loads: the block only exists in the DOM
    // once its page has rendered, so the reader scrolls to it from an effect.
    set({ focusBlock: blockIndex });
    if (targetPage !== get().page) {
      await get().goToPage(targetPage);
    }
  },

  clearFocusBlock: () => set({ focusBlock: null }),

  setFinished: async (finished) => {
    const { bookId } = get();
    if (!bookId) return;
    const updated = await api.patch<BookOut>(`/books/${bookId}`, { finished });
    if (get().bookId !== bookId) return;
    set({ book: updated });
    // The shelf is behind the reader and re-reads on mount, but its counts
    // are fetched separately — keep them honest without a round trip.
    void useBookshelfStore.getState().fetchCounts();
  },

  setLevelMode: (mode) => {
    set({ levelMode: mode });
    const { levelBlockIndex } = get();
    if (levelBlockIndex !== null) void get().levelBlock(levelBlockIndex, mode);
  },

  levelBlock: async (blockIndex, mode) => {
    const { bookId, levelMode } = get();
    if (!bookId) return;
    const requested = mode ?? levelMode;

    levelRequestSeq += 1;
    const seq = levelRequestSeq;
    set({ levelStatus: 'loading', levelBlockIndex: blockIndex });

    try {
      const result = await api.post<LeveledTextOut>('/reading/level', {
        book_id: bookId,
        block_index: blockIndex,
        mode: requested,
        user_id: useAppStore.getState().currentUserId,
      });
      // A slower earlier request must not overwrite a newer one's result.
      if (seq !== levelRequestSeq || get().bookId !== bookId) return;
      set({ leveled: result, levelStatus: 'idle' });
    } catch {
      if (seq !== levelRequestSeq) return;
      set({ leveled: null, levelStatus: 'error' });
    }
  },

  openSession: async () => {
    const { bookId } = get();
    if (!bookId) return;
    try {
      const userId = requireUserId();
      const session = await api.post<SessionOut>(`/books/${bookId}/sessions`, { user_id: userId });
      if (get().bookId !== bookId) return;
      set({ session });
    } catch {
      // Time-on-page is a nice-to-have; failing to open a session must never
      // stop someone reading.
    }
  },

  heartbeat: async (seconds) => {
    const { bookId, session } = get();
    if (!bookId || !session || seconds <= 0) return;
    try {
      const updated = await api.patch<SessionOut>(
        `/books/${bookId}/sessions/${session.id}`,
        { seconds },
      );
      if (get().bookId !== bookId) return;
      set({ session: updated });
    } catch {
      // Same: a dropped beat costs one interval, nothing more.
    }
  },

  close: () => {
    cancelPendingSearch();
    set({ ...INITIAL });
  },
}));

/** Difficulty heat for the blocks now on screen. Fetched per page rather than
 * per book: a 500-page book's spans would be megabytes, and the reader only
 * ever tints what it is currently showing. */
async function loadHeat(
  bookId: string,
  opts: { get: () => ReaderState; set: (partial: Partial<ReaderState>) => void },
): Promise<void> {
  const { get, set } = opts;
  const blocks = get().blocks;
  if (blocks.length === 0) {
    set({ heat: [], heatTotal: 0 });
    return;
  }

  const fromIndex = blocks[0].block_index;
  const limit = blocks.length;
  try {
    const userId = useAppStore.getState().currentUserId;
    const query = new URLSearchParams({
      book_id: bookId,
      from_index: String(fromIndex),
      limit: String(limit),
    });
    if (userId) query.set('user_id', userId);

    const result = await api.get<HeatOut>(`/reading/heat?${query.toString()}`);
    // The page may have turned while this was in flight.
    if (get().bookId !== bookId || get().blocks[0]?.block_index !== fromIndex) return;

    set({
      heat: result.blocks,
      heatEnabled: result.enabled,
      heatTarget: result.target_cefr,
      heatTotal: result.total_above_level,
    });
  } catch {
    // Heat is decorative — a failure here must not blank the page.
    set({ heat: [], heatTotal: 0 });
  }
}

async function loadPage(
  bookId: string,
  pageNum: number,
  opts: {
    get: () => ReaderState;
    set: (partial: Partial<ReaderState>) => void;
    savePosition: boolean;
  },
): Promise<void> {
  const { get, set, savePosition } = opts;
  const cached = pageCache.get(cacheKey(bookId, pageNum));
  // Only the *text* comes from the cache. Heat spans and the reading position
  // are still re-fetched below, because both can have changed since the page
  // was last seen — a word saved to vocabulary changes the overlay.
  if (!cached) set({ status: 'loading' });
  try {
    const pageData = cached ?? (await api.get<PageOut>(`/books/${bookId}/page?page=${pageNum}`));
    if (get().bookId !== bookId) return;
    rememberPage(bookId, pageData);

    set({
      blocks: pageData.blocks,
      page: pageData.page,
      totalPages: pageData.total_pages,
      hasPrev: pageData.has_prev,
      hasNext: pageData.has_next,
      status: 'ready',
      // Drop the previous page's spans immediately so stale tinting never
      // paints over the new page's text while the fetch is in flight.
      heat: [],
      heatTotal: 0,
    });

    void loadHeat(bookId, { get, set });
    prefetchNext(bookId, pageData.page, pageData.total_pages);

    // Page turns are discrete, deliberate actions — write position
    // immediately rather than debouncing, unlike a continuous-scroll reader.
    if (savePosition && pageData.blocks.length > 0) {
      const userId = requireUserId();
      await api.put(`/books/${bookId}/position`, {
        user_id: userId,
        block_index: pageData.first_block_index,
        char_offset: 0,
      });
      if (get().bookId !== bookId) return;
      const position = await api.get<PositionOut>(`/books/${bookId}/position?user_id=${encodeURIComponent(userId)}`);
      if (get().bookId !== bookId) return;
      set({ percent: position.percent });
    }
  } catch (err) {
    set({ status: 'error', error: friendlyMessage(err, 'Closing this book') });
  }
}
