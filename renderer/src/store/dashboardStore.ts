import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { friendlyMessage } from '@/lib/friendlyError';
import { useAppStore } from '@/store/appStore';
import type {
  ActivityOut,
  BookOut,
  ReadingStatsOut,
  ReviewStatsOut,
  VocabWordOut,
} from '@/types/api';

/** How many days the consistency calendar covers. */
export const CALENDAR_DAYS = 365;
const RECENT_WORDS = 8;

interface DashboardState {
  review: ReviewStatsOut | null;
  reading: ReadingStatsOut | null;
  activity: ActivityOut | null;
  recentWords: VocabWordOut[];
  /** Books with a reading position, most recently read first. */
  continueReading: BookOut[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  load: () => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  review: null,
  reading: null,
  activity: null,
  recentWords: [],
  continueReading: [],
  status: 'idle',
  error: null,

  /* One load for the whole screen, in parallel. */
  load: async () => {
    const userId = useAppStore.getState().currentUserId;
    if (!userId) return;
    const q = `user_id=${encodeURIComponent(userId)}`;
    set({ status: 'loading', error: null });
    try {
      const [review, reading, activity, words, books] = await Promise.all([
        api.get<ReviewStatsOut>(`/review/stats?${q}`),
        api.get<ReadingStatsOut>(`/reading/stats?${q}`),
        api.get<ActivityOut>(`/activity?${q}&days=${CALENDAR_DAYS}`),
        api.get<VocabWordOut[]>(`/vocabulary?${q}&sort=recent`),
        api.get<BookOut[]>(`/books?${q}`),
      ]);
      set({
        review,
        reading,
        activity,
        recentWords: words.slice(0, RECENT_WORDS),
        // Unopened books are not something to continue.
        continueReading: books
          .filter((b) => b.last_read_at && b.ingest_status === 'ready')
          .sort((a, b) => (a.last_read_at! < b.last_read_at! ? 1 : -1)),
        status: 'ready',
      });
    } catch (err) {
      set({ status: 'error', error: friendlyMessage(err, 'Loading your dashboard') });
    }
  },
}));
