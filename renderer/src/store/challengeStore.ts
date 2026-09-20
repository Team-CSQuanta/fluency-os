import { create } from 'zustand';
import { api, ApiError } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type {
  EnrichmentOut,
  ChallengeRoundOut,
  ChallengeStatsOut,
  HintsOut,
} from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

interface ChallengeState {
  round: ChallengeRoundOut | null;
  stats: ChallengeStatsOut | null;
  hints: HintsOut | null;
  history: ChallengeRoundOut[];
  status: 'idle' | 'starting' | 'ready' | 'scoring' | 'scored';
  error: string | null;
  setEmbedsEnabled: (enabled: boolean) => Promise<void>;
  reportUnavailable: () => Promise<void>;
  skipScene: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  startRound: () => Promise<void>;
  askHints: (level?: number) => Promise<void>;
  reportPlaybackError: (reason: string) => Promise<void>;
  enrich: () => Promise<void>;
  /** What the learner was doing when the engines turned out not to be running,
   * so the dialog can name it. Null when nothing is blocked. */
  aiNeededFor: string | null;
  aiNeededDetail: string | null;
  dismissAiNeeded: () => void;
  enrichment: EnrichmentOut | null;
  enriching: boolean;
  submit: (payload: { audio?: Blob; text?: string }) => Promise<void>;
  reset: () => void;
}

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user');
  return id;
}

/** Turn a failure into what the interface should do about it.
 *
 * A 503 from any of these endpoints means the engines are not launched — not a
 * mistake the learner made, and not something to print at them. Everything else
 * shows the backend's own `detail`, which is written for a person, rather than
 * the full "API POST /path failed: 503 {...}" line, which is written for a log.
 */
function asFailure(err: unknown, what: string): Partial<ConversationFailure> {
  if (err instanceof ApiError && err.status === 503) {
    return { aiNeededFor: what, aiNeededDetail: err.detail };
  }
  return { error: friendlyMessage(err, what) };
}

interface ConversationFailure {
  error: string | null;
  aiNeededFor: string | null;
  aiNeededDetail: string | null;
}

export const useChallengeStore = create<ChallengeState>((set, get) => ({
  round: null,
  stats: null,
  hints: null,
  enrichment: null,
  enriching: false,
  aiNeededFor: null,
  aiNeededDetail: null,
  history: [],
  status: 'idle',
  error: null,

  setEmbedsEnabled: async (enabled) => {
    const stats = await api.put<ChallengeStatsOut>('/challenge/prefs/embeds', {
      user_id: requireUserId(),
      enabled,
    });
    set({ stats });
  },

  /** The learner does not want this scene — unfamiliar subject, no interest.
   * Distinct from reportUnavailable on purpose: the video is fine, so it
   * stays in the pool for everyone else and is simply not shown to them
   * again (they have now "seen" it). */
  skipScene: async () => {
    const round = get().round;
    if (!round) return;
    await api.post(`/challenge/rounds/${round.id}/abandon`, {});
    set({ round: null, hints: null, enrichment: null, status: 'idle' });
    await get().startRound();
  },

  /** The clip would not play. These are decade-old YouTube links and a fair
   * share have gone; reporting it retires the id for everyone. */
  reportUnavailable: async () => {
    const round = get().round;
    if (!round) return;
    await api.post(`/challenge/rounds/${round.id}/unavailable`, {});
    set({ round: null, hints: null, enrichment: null, status: 'idle' });
    await get().startRound();
  },

  fetchStats: async () => {
    const userId = requireUserId();
    set({ stats: await api.get<ChallengeStatsOut>(`/challenge/stats?user_id=${encodeURIComponent(userId)}`) });
  },

  fetchHistory: async () => {
    const userId = requireUserId();
    set({ history: await api.get<ChallengeRoundOut[]>(`/challenge/history?user_id=${encodeURIComponent(userId)}`) });
  },

  startRound: async () => {
    set({ status: 'starting', error: null, hints: null, enrichment: null, round: null });
    try {
      const round = await api.post<ChallengeRoundOut>('/challenge/rounds', {
        user_id: requireUserId(),
      });
      set({ round, status: 'ready' });
    } catch (err) {
      set({ status: 'idle', ...asFailure(err, 'Starting a round') });
    }
  },

  askHints: async (level?: number) => {
    const round = get().round;
    if (!round) return;
    const q = level === undefined ? '' : `?level=${level}`;
    const hints = await api.get<HintsOut>(`/challenge/rounds/${round.id}/hints${q}`);
    // The round carries the penalty now, so re-read it: the score card shows
    // what the description was worth and what the help cost, and those numbers
    // have to agree with what the server actually charged.
    const fresh = await api.get<ChallengeRoundOut>(`/challenge/rounds/${round.id}`);
    set({ hints, round: fresh });
  },

  /** The embed told us the video will not play.
   *
   * About one VATEX video in five has been deleted or made private since the
   * corpus was collected, and until now the only way that was discovered was
   * the learner sitting in front of a dead frame and pressing a button. The
   * player reports an error code within a second of loading, so this records it
   * and takes the next scene without the learner having to diagnose anything.
   */
  reportPlaybackError: async (reason: string) => {
    const round = get().round;
    if (!round?.video_id) return;
    try {
      await api.post(`/challenge/rounds/${round.id}/playback-error?reason=${encodeURIComponent(reason)}`, {});
    } catch {
      // A failure to report is not worth interrupting the learner for; the
      // next scene matters more than the bookkeeping.
    }
    await get().startRound();
  },

  submit: async ({ audio, text }) => {
    const round = get().round;
    if (!round) return;
    set({ status: 'scoring', error: null });
    try {
      const form = new FormData();
      form.append('user_id', requireUserId());
      if (audio) form.append('audio', audio, 'attempt.webm');
      if (text) form.append('text', text);
      const scored = await api.postForm<ChallengeRoundOut>(`/challenge/rounds/${round.id}/submit`, form);
      set({ round: scored, status: 'scored' });
      await get().fetchStats();
      await get().fetchHistory();
    } catch (err) {
      // 503 from this endpoint means the engines are not launched. That is not
      // an error about the attempt — the recording is still good — so it opens
      // the launch dialog instead of being printed as a failure.
      set({ status: 'ready', ...asFailure(err, 'Scoring your description') });
    }
  },

  /** The model's own description of the scene, built from the ten and drawing
   * on the learner's vocabulary. Asked for explicitly: it spends a real model
   * call, so it is never fetched just because a round finished. */
  enrich: async () => {
    const round = get().round;
    if (!round || get().enriching) return;
    set({ enriching: true, error: null });
    try {
      const enrichment = await api.post<EnrichmentOut>(
        `/challenge/rounds/${round.id}/enrich?user_id=${encodeURIComponent(requireUserId())}`,
        {},
      );
      set({ enrichment, enriching: false });
    } catch (err) {
      set({ enriching: false, ...asFailure(err, 'Writing a richer version') });
    }
  },

  dismissAiNeeded: () => set({ aiNeededFor: null, aiNeededDetail: null }),

  reset: () =>
    set({
      round: null,
      hints: null,
      enrichment: null,
      status: 'idle',
      error: null,
      aiNeededFor: null,
      aiNeededDetail: null,
    }),
}));
