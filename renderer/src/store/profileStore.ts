import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type { ReadingStatsOut, VocabOverviewOut } from '@/types/api';

interface ProfileState {
  /** Words saved, all time. */
  words: number | null;
  /** Consecutive days the reading goal was met. */
  streakDays: number | null;
  refresh: () => Promise<void>;
}

/* The two numbers under the reader's name in the sidebar. Kept out of the
 * heavier screens' stores because this runs on every screen. */
export const useProfileStore = create<ProfileState>((set) => ({
  words: null,
  streakDays: null,

  refresh: async () => {
    const userId = useAppStore.getState().currentUserId;
    if (!userId) return;
    const q = `user_id=${encodeURIComponent(userId)}`;
    try {
      const [vocab, reading] = await Promise.all([
        api.get<VocabOverviewOut>(`/vocabulary/overview?${q}`),
        api.get<ReadingStatsOut>(`/reading/stats?${q}`),
      ]);
      set({ words: vocab.total, streakDays: reading.streak_days });
    } catch {
      // The nav is not the place to report a failed count: it keeps the last
      // numbers it had, or shows none at all.
    }
  },
}));
