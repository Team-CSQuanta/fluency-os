import { create } from 'zustand';
import { api, fetchBlobUrl } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type {
  BookCountsOut,
  BookImportRequest,
  BookIngestStatus,
  BookOut,
  ReadingStatsOut,
} from '@/types/api';

export interface ImportQueueItem {
  path: string;
  name: string;
  status: BookIngestStatus;
  error: string | null;
}

interface BookshelfState {
  books: BookOut[];
  counts: BookCountsOut | null;
  stats: ReadingStatsOut | null;
  filter: string;
  query: string;
  booksStatus: 'idle' | 'loading' | 'error';
  booksError: string | null;
  importQueue: ImportQueueItem[];
  coverUrls: Record<string, string>;

  setFilter: (name: string) => void;
  setQuery: (query: string) => void;
  fetchBooks: () => Promise<void>;
  fetchCounts: () => Promise<void>;
  fetchStats: () => Promise<void>;
  setGoal: (pages: number) => Promise<void>;
  importBooks: (paths: string[], opts?: { countTowardGoal?: boolean; heatOverlay?: boolean }) => Promise<void>;
  retryIngest: (bookId: string) => Promise<void>;
  deleteBook: (bookId: string) => Promise<void>;
  clearImportQueue: () => void;
  loadCover: (bookId: string) => void;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user — cannot load or import books yet');
  return id;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export const useBookshelfStore = create<BookshelfState>((set, get) => ({
  books: [],
  counts: null,
  stats: null,
  filter: 'All',
  query: '',
  booksStatus: 'idle',
  booksError: null,
  importQueue: [],
  coverUrls: {},

  setFilter: (name) => set({ filter: name }),
  setQuery: (query) => set({ query }),

  loadCover: (bookId) => {
    if (get().coverUrls[bookId]) return; // already fetched (or in flight, close enough for a shelf tile)
    void fetchBlobUrl(`/books/${bookId}/cover`)
      .then((url) => set((s) => ({ coverUrls: { ...s.coverUrls, [bookId]: url } })))
      .catch(() => {
        // No cover for this book (e.g. TXT import) — tile keeps the placeholder.
      });
  },

  fetchBooks: async () => {
    set({ booksStatus: 'loading', booksError: null });
    try {
      const userId = requireUserId();
      const books = await api.get<BookOut[]>(`/books?user_id=${encodeURIComponent(userId)}`);
      set({ books, booksStatus: 'idle' });
    } catch (err) {
      set({ booksStatus: 'error', booksError: err instanceof Error ? err.message : String(err) });
    }
  },

  fetchCounts: async () => {
    try {
      const userId = requireUserId();
      const counts = await api.get<BookCountsOut>(`/books/counts?user_id=${encodeURIComponent(userId)}`);
      set({ counts });
    } catch {
      // Decorative (filter-chip badges) — a failure here shouldn't block the shelf.
    }
  },

  fetchStats: async () => {
    try {
      const userId = requireUserId();
      const stats = await api.get<ReadingStatsOut>(`/reading/stats?user_id=${encodeURIComponent(userId)}`);
      set({ stats });
    } catch {
      // The shelf still works without the goal ring — leave the panel empty
      // rather than failing the whole screen.
    }
  },

  setGoal: async (pages) => {
    const userId = requireUserId();
    // The response is the recomputed stats: changing the target also changes
    // whether today counts and how long the streak is.
    const stats = await api.put<ReadingStatsOut>('/reading/goal', {
      user_id: userId,
      daily_page_goal: pages,
    });
    set({ stats });
  },

  importBooks: async (paths, opts) => {
    if (paths.length === 0) return;
    const userId = requireUserId();

    const newItems: ImportQueueItem[] = paths.map((path) => ({
      path,
      name: fileName(path),
      status: 'queued',
      error: null,
    }));
    set((s) => ({ importQueue: [...s.importQueue, ...newItems] }));

    const payload: BookImportRequest = {
      user_id: userId,
      paths,
      count_toward_goal: opts?.countTowardGoal ?? true,
      heat_overlay: opts?.heatOverlay ?? true,
    };

    let accepted: BookOut[];
    try {
      accepted = await api.post<BookOut[]>('/books/import', payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        importQueue: s.importQueue.map((q) =>
          paths.includes(q.path) ? { ...q, status: 'failed', error: message } : q,
        ),
      }));
      return;
    }

    // The backend returns one BookOut per input path, in the same order.
    const byPath = new Map(paths.map((p, i) => [p, accepted[i]]));
    set((s) => ({
      importQueue: s.importQueue.map((q) => {
        const book = byPath.get(q.path);
        return book ? { ...q, status: book.ingest_status, error: book.ingest_error } : q;
      }),
    }));

    await get().fetchBooks();
    void get().fetchCounts();

    const bookIds = accepted.map((b) => b.id);
    void pollUntilSettled(userId, paths, bookIds, get, set);
  },

  retryIngest: async (bookId) => {
    await api.post<BookOut>(`/books/${bookId}/retry-ingest`);
    await get().fetchBooks();
  },

  deleteBook: async (bookId) => {
    await api.delete(`/books/${bookId}`);
    // Drop the row and its cover object URL locally so the tile disappears
    // immediately rather than after the refetch round-trip.
    const url = get().coverUrls[bookId];
    if (url) URL.revokeObjectURL(url);
    set((s) => {
      const { [bookId]: _removed, ...coverUrls } = s.coverUrls;
      return { books: s.books.filter((b) => b.id !== bookId), coverUrls };
    });
    void get().fetchCounts();
  },

  clearImportQueue: () => set({ importQueue: [] }),
}));

async function pollUntilSettled(
  userId: string,
  paths: string[],
  bookIds: string[],
  get: () => BookshelfState,
  set: (partial: Partial<BookshelfState>) => void,
): Promise<void> {
  const start = Date.now();

  const tick = async (): Promise<void> => {
    if (Date.now() - start > POLL_TIMEOUT_MS) return;

    const current = await api.get<BookOut[]>(`/books?user_id=${encodeURIComponent(userId)}`);
    const byId = new Map(current.map((b) => [b.id, b]));

    set({
      books: current,
      importQueue: get().importQueue.map((q) => {
        const i = paths.indexOf(q.path);
        const book = i >= 0 ? byId.get(bookIds[i]) : undefined;
        return book ? { ...q, status: book.ingest_status, error: book.ingest_error } : q;
      }),
    });

    const stillGoing = bookIds.some((id) => {
      const b = byId.get(id);
      return b && (b.ingest_status === 'queued' || b.ingest_status === 'parsing');
    });

    if (stillGoing) {
      setTimeout(() => void tick(), POLL_INTERVAL_MS);
    } else {
      void get().fetchCounts();
    }
  };

  setTimeout(() => void tick(), POLL_INTERVAL_MS);
}

export function matchesBookFilter(book: BookOut, filter: string): boolean {
  if (filter === 'All') return true;
  if (filter === 'Finished') return !!book.finished_at;
  // These two mirror GET /books/counts exactly: a book is "reading" once it
  // has a position row, so opening it moves it out of "Not started".
  if (filter === 'Reading') return !!book.last_read_at && !book.finished_at;
  if (filter === 'Not started') {
    return book.ingest_status === 'ready' && !book.finished_at && !book.last_read_at;
  }
  return true;
}

export function matchesBookQuery(book: BookOut, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    book.title.toLowerCase().includes(q) || (book.author ?? '').toLowerCase().includes(q)
  );
}
