import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type { RateCardOut, ReviewCardOut, ReviewRating, ReviewStatsOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';
import { reportError } from '@/store/errorStore';

/** A card in this sitting. `returning` marks one answered "Again" (or not yet
 * convincingly) earlier in the same sitting and put back to be tried again. */
export type SessionCard = ReviewCardOut & { returning?: boolean };

/** How many other cards come between a forgotten card and its second try —
 * long enough that the answer is not simply still on screen in the mind. */
const RETURN_GAP = 3;

/** One answer in this sitting, kept so it can be taken back. */
interface Answered {
  card: SessionCard;
  rating: ReviewRating;
  /** Where in `queue` it was answered. */
  at: number;
}

export interface SessionTally {
  again: number;
  hard: number;
  good: number;
  easy: number;
  startedAt: number;
}

const EMPTY_TALLY = (): SessionTally => ({ again: 0, hard: 0, good: 0, easy: 0, startedAt: Date.now() });
const RATING_KEY = ['again', 'hard', 'good', 'easy'] as const;

interface ReviewState {
  queue: SessionCard[];
  queueStatus: 'idle' | 'loading' | 'error';
  queueError: string | null;

  stats: ReviewStatsOut | null;

  /** Position in `queue`. Cards are answered in order; a card still in short
   * steps after its answer is inserted again a few places ahead. */
  index: number;
  /** What the last answer scheduled, so the UI can say "back in 3.2 mo". */
  lastResult: RateCardOut | null;
  answered: number;
  tally: SessionTally;
  history: Answered[];
  /** Answers sent and not yet acknowledged. Undo waits for these: taking back
   * an answer the server has not recorded yet would undo the one before it. */
  inFlight: number;

  fetchStats: () => Promise<void>;
  startSession: () => Promise<void>;
  rate: (rating: ReviewRating) => Promise<void>;
  undo: () => Promise<void>;
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
  tally: EMPTY_TALLY(),
  history: [],
  inFlight: 0,

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
    set({
      queueStatus: 'loading',
      queueError: null,
      index: 0,
      answered: 0,
      lastResult: null,
      tally: EMPTY_TALLY(),
      history: [],
    });
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
    const key = RATING_KEY[rating - 1];
    // Advance immediately. Making the learner wait on a round-trip between
    // cards is the difference between a review session and a form.
    set((s) => ({
      index: s.index + 1,
      answered: s.answered + 1,
      lastResult: null,
      tally: { ...s.tally, [key]: s.tally[key] + 1 },
      history: [...s.history, { card, rating, at: index }],
      inFlight: s.inFlight + 1,
    }));
    try {
      const result = await api.post<RateCardOut>(
        `/review/cards/${encodeURIComponent(card.vocab_word_id)}/rate`,
        { user_id: userId, rating },
      );
      set((s) => {
        let queue = s.queue;
        if (result.requeue) {
          // A few cards on from wherever the learner is now, or at the end.
          const at = Math.min(s.queue.length, s.index + RETURN_GAP);
          queue = [...s.queue.slice(0, at), { ...result.requeue, returning: true }, ...s.queue.slice(at)];
        }
        return { queue, lastResult: result, inFlight: s.inFlight - 1 };
      });
    } catch (err) {
      // Put it back: an answer that never reached the scheduler is an answer
      // the learner will otherwise believe was counted.
      set((s) => ({
        index: Math.max(0, s.index - 1),
        answered: Math.max(0, s.answered - 1),
        tally: { ...s.tally, [key]: Math.max(0, s.tally[key] - 1) },
        history: s.history.slice(0, -1),
        inFlight: s.inFlight - 1,
      }));
      // Said out loud, because the rollback on its own is invisible: the card
      // simply reappears.
      reportError(err, 'Saving that answer', () => void get().rate(rating));
    }
  },

  undo: async () => {
    const { history, inFlight } = get();
    const last = history[history.length - 1];
    if (!last || inFlight > 0) return;
    const userId = requireUserId();
    let restored: ReviewCardOut;
    try {
      restored = await api.post<ReviewCardOut>(
        `/review/cards/${encodeURIComponent(last.card.vocab_word_id)}/undo`,
        { user_id: userId },
      );
    } catch (err) {
      reportError(err, 'Undoing that answer');
      return;
    }
    const key = RATING_KEY[last.rating - 1];
    set((s) => {
      // The answer's second try, if it earned one, goes with it — it was put
      // somewhere after the answer, never before.
      const queue = s.queue.filter(
        (c, i) => i <= last.at || !(c.returning && c.vocab_word_id === last.card.vocab_word_id),
      );
      // And the card is asked again where it was, as it was.
      queue[last.at] = { ...restored, returning: last.card.returning };
      return {
        queue,
        index: last.at,
        answered: Math.max(0, s.answered - 1),
        tally: { ...s.tally, [key]: Math.max(0, s.tally[key] - 1) },
        history: s.history.slice(0, -1),
        lastResult: null,
      };
    });
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
    // Suspended, so any second try of it waiting later in the sitting goes too.
    set((s) => ({
      queue: s.queue.filter((c, i) => i <= s.index || c.vocab_word_id !== card.vocab_word_id),
      index: s.index + 1,
      lastResult: null,
    }));
  },

  reset: () =>
    set({ queue: [], index: 0, answered: 0, lastResult: null, queueError: null, history: [], tally: EMPTY_TALLY() }),
}));
