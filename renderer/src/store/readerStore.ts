import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import { useBookshelfStore } from '@/store/bookshelfStore';
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
} from '@/types/api';

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
  lookupWord: (word: string, sentence?: string) => Promise<void>;
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
  | 'levelMode'
  | 'leveled'
  | 'levelStatus'
  | 'levelBlockIndex'
  | 'session'
  | 'focusBlock'
  | 'status'
  | 'error'
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
};

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
      if (get().bookId !== bookId) return; // reader moved on to another book while this was in flight

      useShellStore.getState().setNowReading(book.title);
      set({ book, toc, percent: position.percent, highlights, bookmarks });

      await loadPage(bookId, position.page || 1, { get, set, savePosition: false });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
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

  lookupWord: async (word, sentence) => {
    const clean = word.trim();
    if (!clean) return;
    set({ lookupStatus: 'loading' });
    try {
      const query = new URLSearchParams({ w: clean });
      if (sentence) query.set('ctx', sentence);
      const result = await api.get<WordLookupOut>(`/reading/lookup?${query.toString()}`);
      set({ lookup: result, lookupStatus: 'idle' });
    } catch {
      set({ lookup: null, lookupStatus: 'error' });
    }
  },

  clearLookup: () => set({ lookup: null, lookupStatus: 'idle' }),

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
  set({ status: 'loading' });
  try {
    const pageData = await api.get<PageOut>(`/books/${bookId}/page?page=${pageNum}`);
    if (get().bookId !== bookId) return;

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
    set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}
