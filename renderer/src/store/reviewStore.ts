import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type { RateCardOut, ReviewCardOut, ReviewRating, ReviewStatsOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';
import { reportError } from '@/store/errorStore';

interface ReviewState {
  queue: ReviewCardOut[];
  queueStatus: 'idle' | 'loading' | 'error';
  queueError: string | null;

  stats: ReviewStatsOut | null;

  /** Position in `queue`. Cards are answered in order and never revisited
   * within a sitting — a card rated Again comes back in its own time, from
   * the scheduler, not by being pushed to the end of this list. */
  index: number;
  /** What the last answer scheduled, so the UI can say "back in 3.2 mo". */
  lastResult: RateCardOut | null;
  answered: number;

  fetchStats: () => Promise<void>;
  startSession: () => Promise<void>;
  rate: (rating: ReviewRating) => Promise<void>;
  suspendCurrent: () => Promise<void>;
  reset: () => void;
}

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user — cannot review yet');
  return id;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  queue: [],
  queueStatus: 'idle',
  queueError: null,
  stats: null,
  index: 0,
  lastResult: null,
  answered: 0,

  fetchStats: async () => {
    try {
      const userId = requireUserId();
      const stats = await api.get<ReviewStatsOut>(`/review/stats?user_id=${encodeURIComponent(userId)}`);
      set({ stats });
    } catch {
      // The badge and the summary are decoration; failing to load them must
      // not block the screen from rendering what it does have.
    }
  },

  startSession: async () => {
    set({ queueStatus: 'loading', queueError: null, index: 0, answered: 0, lastResult: null });
    try {
      const userId = requireUserId();
      const queue = await api.get<ReviewCardOut[]>(`/review/queue?user_id=${encodeURIComponent(userId)}`);
      set({ queue, queueStatus: 'idle' });
    } catch (err) {
      set({ queueStatus: 'error', queueError: friendlyMessage(err, 'Building your review session') });
    }
  },

  rate: async (rating) => {
    const { queue, index } = get();
    const card = queue[index];
    if (!card) return;
    const userId = requireUserId();
    // Advance immediately. The scheduler's answer does not change which card
    // comes next, and making the learner wait on a round-trip between cards
    // is the difference between a review session and a form.
    set((s) => ({ index: s.index + 1, answered: s.answered + 1, lastResult: null }));
    try {
      const result = await api.post<RateCardOut>(
        `/review/cards/${encodeURIComponent(card.vocab_word_id)}/rate`,
        { user_id: userId, rating },
      );
      set({ lastResult: result });
    } catch (err) {
      // Put it back: an answer that never reached the scheduler is an answer
      // the learner will otherwise believe was counted.
      set((s) => ({
        index: Math.max(0, s.index - 1),
        answered: Math.max(0, s.answered - 1),
      }));
      // Said out loud, because the rollback on its own is invisible: the card
      // simply reappears. queueError is only ever drawn on the finished
      // screen, so mid-session this failed in complete silence.
      reportError(err, 'Saving that answer', () => void get().rate(rating));
    }
  },

  suspendCurrent: async () => {
    const { queue, index } = get();
    const card = queue[index];
    if (!card) return;
    const userId = requireUserId();
    await api.post(`/review/cards/${encodeURIComponent(card.vocab_word_id)}/suspend`, {
      user_id: userId,
      suspended: true,
    });
    set((s) => ({ index: s.index + 1, lastResult: null }));
  },

  reset: () => set({ queue: [], index: 0, answered: 0, lastResult: null, queueError: null }),
}));
