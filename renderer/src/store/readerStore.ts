import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import { useShellStore } from '@/store/shellStore';
import type { BlockOut, BookOut, ChapterOut, PageOut, PositionOut } from '@/types/api';

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
  status: 'idle' | 'loading' | 'error' | 'ready';
  error: string | null;

  openBook: (bookId: string) => Promise<void>;
  goToPage: (page: number) => Promise<void>;
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;
  jumpToChapter: (chapter: ChapterOut) => Promise<void>;
  close: () => void;
}

const INITIAL: Pick<
  ReaderState,
  'bookId' | 'book' | 'toc' | 'blocks' | 'page' | 'totalPages' | 'hasPrev' | 'hasNext' | 'percent' | 'status' | 'error'
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
  status: 'idle',
  error: null,
};

export const useReaderStore = create<ReaderState>((set, get) => ({
  ...INITIAL,

  openBook: async (bookId) => {
    set({ ...INITIAL, bookId, status: 'loading' });
    try {
      const userId = requireUserId();
      const [book, toc, position] = await Promise.all([
        api.get<BookOut>(`/books/${bookId}`),
        api.get<ChapterOut[]>(`/books/${bookId}/toc`),
        api.get<PositionOut>(`/books/${bookId}/position?user_id=${encodeURIComponent(userId)}`),
      ]);
      if (get().bookId !== bookId) return; // reader moved on to another book while this was in flight

      useShellStore.getState().setNowReading(book.title);
      set({ book, toc, percent: position.percent });

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

  close: () => set({ ...INITIAL }),
}));

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
    });

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
