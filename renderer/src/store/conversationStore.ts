import { create } from 'zustand';
import { api, fetchBlobUrl } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type {
  ConversationChannel,
  ConversationReportOut,
  ConversationSessionDetailOut,
  ConversationSessionOut,
  EngineStatusOut,
  ScenarioKey,
  TurnSubmitOut,
} from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

interface ConversationState {
  sessions: ConversationSessionOut[];
  sessionsStatus: 'idle' | 'loading' | 'error';

  activeSession: ConversationSessionDetailOut | null;
  activeStatus: 'idle' | 'loading' | 'error';
  activeError: string | null;

  report: ConversationReportOut | null;
  reportStatus: 'idle' | 'loading' | 'error';
  reportError: string | null;

  engineStatus: EngineStatusOut | null;

  // True only right after startSession created a brand-new session — lets
  // ConversationLive auto-play the AI's opening line for a genuinely fresh
  // conversation without ever auto-playing on a plain resume, where the
  // same fetchSessionDetail call is used to load an existing transcript.
  justStarted: boolean;

  fetchSessions: () => Promise<void>;
  startSession: (scenario: ScenarioKey, channel: ConversationChannel, seedWordIds?: string[]) => Promise<string>;
  regenerateReport: (sessionId: string) => Promise<void>;
  fetchSessionDetail: (sessionId: string) => Promise<void>;
  consumeJustStarted: () => boolean;
  submitTextTurn: (sessionId: string, text: string) => Promise<TurnSubmitOut>;
  submitAudioTurn: (sessionId: string, blob: Blob) => Promise<TurnSubmitOut>;
  endSession: (sessionId: string) => Promise<void>;
  fetchReport: (sessionId: string) => Promise<void>;
  fetchEngineStatus: () => Promise<void>;
  turnAudioUrl: (turnId: string, chunk?: number) => Promise<string>;
  deleteSession: (sessionId: string) => Promise<void>;
}

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user — cannot use Conversation yet');
  return id;
}

// Tracks the most recently requested session id so an out-of-order
// fetchSessionDetail response (an earlier request that resolves after a
// later one) can be dropped instead of clobbering fresher data.
let lastRequestedSessionId: string | null = null;

export const useConversationStore = create<ConversationState>((set, get) => ({
  sessions: [],
  sessionsStatus: 'idle',

  activeSession: null,
  activeStatus: 'idle',
  activeError: null,

  report: null,
  reportStatus: 'idle',
  reportError: null,

  engineStatus: null,
  justStarted: false,

  fetchSessions: async () => {
    set({ sessionsStatus: 'loading' });
    try {
      const userId = requireUserId();
      const sessions = await api.get<ConversationSessionOut[]>(
        `/conversation/sessions?user_id=${encodeURIComponent(userId)}`,
      );
      set({ sessions, sessionsStatus: 'idle' });
    } catch {
      set({ sessionsStatus: 'error' });
    }
  },

  startSession: async (scenario, channel, seedWordIds) => {
    const userId = requireUserId();
    const session = await api.post<ConversationSessionOut>('/conversation/sessions', {
      user_id: userId,
      scenario,
      channel,
      seed_word_ids: seedWordIds,
    });
    set({ activeSession: null, activeStatus: 'idle', report: null });
    await get().fetchSessionDetail(session.id);
    // fetchSessionDetail always clears justStarted at the top of its own
    // call (so a resume never sets it) — set it true here, after, so only
    // this genuinely-fresh creation flow leaves it set.
    set({ justStarted: true });
    return session.id;
  },

  consumeJustStarted: () => {
    const value = get().justStarted;
    set({ justStarted: false });
    return value;
  },

  fetchSessionDetail: async (sessionId) => {
    lastRequestedSessionId = sessionId;
    set({ activeStatus: 'loading', activeError: null, justStarted: false });
    try {
      const userId = requireUserId();
      const detail = await api.get<ConversationSessionDetailOut>(
        `/conversation/sessions/${sessionId}?user_id=${encodeURIComponent(userId)}`,
      );
      // If a newer fetchSessionDetail call has started since (e.g. the
      // learner clicked resume on a different session before this one
      // returned), drop this response instead of overwriting the newer one.
      if (lastRequestedSessionId !== sessionId) return;
      set({ activeSession: detail, activeStatus: 'idle' });
    } catch (err) {
      if (lastRequestedSessionId !== sessionId) return;
      set({ activeStatus: 'error', activeError: friendlyMessage(err, 'Opening this conversation') });
    }
  },

  submitTextTurn: async (sessionId, text) => {
    const userId = requireUserId();
    const form = new FormData();
    form.set('text', text);
    const result = await api.postForm<TurnSubmitOut>(
      `/conversation/sessions/${sessionId}/turns?user_id=${encodeURIComponent(userId)}`,
      form,
    );
    // Guard against a stale response landing after the learner has since
    // navigated away and resumed a *different* session — without the id
    // check this would silently append the old session's turns onto
    // whatever session happens to be active by the time this resolves.
    set((s) =>
      s.activeSession?.id === sessionId
        ? { activeSession: { ...s.activeSession, turns: [...s.activeSession.turns, result.user_turn, result.ai_turn] } }
        : {},
    );
    return result;
  },

  submitAudioTurn: async (sessionId, blob) => {
    const userId = requireUserId();
    const form = new FormData();
    form.set('audio', blob, 'turn.webm');
    const result = await api.postForm<TurnSubmitOut>(
      `/conversation/sessions/${sessionId}/turns?user_id=${encodeURIComponent(userId)}`,
      form,
    );
    set((s) =>
      s.activeSession?.id === sessionId
        ? { activeSession: { ...s.activeSession, turns: [...s.activeSession.turns, result.user_turn, result.ai_turn] } }
        : {},
    );
    return result;
  },

  endSession: async (sessionId) => {
    const userId = requireUserId();
    const report = await api.post<ConversationReportOut>(
      `/conversation/sessions/${sessionId}/end?user_id=${encodeURIComponent(userId)}`,
    );
    set({ report, reportStatus: 'idle', reportError: null });
    // Ending is what sets ended_at and has_report server-side, so without
    // this the history list keeps showing the conversation as unfinished and
    // offers no way into the report that was just generated.
    await get().fetchSessions();
  },

  fetchReport: async (sessionId) => {
    // Clearing `report` up front matters: without it a failed fetch left the
    // previously-viewed session's report on screen, so the Report screen
    // showed another conversation's numbers as if they were this one's.
    set({ reportStatus: 'loading', report: null, reportError: null });
    try {
      const userId = requireUserId();
      const report = await api.get<ConversationReportOut>(
        `/conversation/sessions/${sessionId}/report?user_id=${encodeURIComponent(userId)}`,
      );
      set({ report, reportStatus: 'idle' });
    } catch (err) {
      set({ reportStatus: 'error', reportError: friendlyMessage(err, 'Opening this report') });
    }
  },

  regenerateReport: async (sessionId) => {
    // A POST, not a refetch: this re-runs the analysis and rewrites the
    // session's usage logs, so it costs a real LLM call.
    const userId = requireUserId();
    set({ reportStatus: 'loading', reportError: null });
    try {
      const report = await api.post<ConversationReportOut>(
        `/conversation/sessions/${sessionId}/report/regenerate?user_id=${encodeURIComponent(userId)}`,
      );
      set({ report, reportStatus: 'idle' });
    } catch (err) {
      // Keep the old report on screen — it's still the real one, just older.
      set({ reportStatus: 'idle', reportError: friendlyMessage(err, 'Bringing this report up to date') });
    }
  },

  fetchEngineStatus: async () => {
    const userId = requireUserId();
    const engineStatus = await api.get<EngineStatusOut>(
      `/conversation/engine-status?user_id=${encodeURIComponent(userId)}`,
    );
    set({ engineStatus });
  },

  turnAudioUrl: async (turnId, chunk = 0) => {
    // This request is also what triggers synthesis of that sentence, so it can
    // take a few seconds on the first fetch and is instant afterwards.
    const userId = requireUserId();
    return fetchBlobUrl(
      `/conversation/turns/${turnId}/audio?user_id=${encodeURIComponent(userId)}&chunk=${chunk}`,
    );
  },

  deleteSession: async (sessionId) => {
    const userId = requireUserId();
    await api.delete(`/conversation/sessions/${sessionId}?user_id=${encodeURIComponent(userId)}`);
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.id !== sessionId),
      activeSession: s.activeSession?.id === sessionId ? null : s.activeSession,
      // The report belongs to the session that just stopped existing —
      // leaving it loaded would show a deleted conversation's numbers on the
      // next visit to the Report screen.
      report: s.activeSession?.id === sessionId ? null : s.report,
    }));
  },
}));
