import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type {
  EngineStatusOut,
  LlmProvider,
  LlmProviderOut,
  ModelsCatalogOut,
  ReadinessOut,
  TtsEngine,
} from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

interface EngineState {
  catalog: ModelsCatalogOut | null;
  catalogStatus: 'idle' | 'loading' | 'error';

  // Keyed by channel: 'text' readiness deliberately reports STT/TTS as ready
  // (a text turn needs neither), so storing both in one slot let AppNav's
  // 'text' fetch clobber Conversation's 'voice' one and hide genuinely
  // missing speech models behind a Launch AI button that could never succeed.
  readiness: Record<'voice' | 'text', ReadinessOut | null>;

  // Whether each engine is actually loaded into memory right now (distinct
  // from readiness, which only reflects what's downloaded to disk) — driven
  // by the global "Launch AI" action below.
  status: EngineStatusOut | null;
  launching: boolean;
  launchError: string | null;

  // local (llama.cpp) vs cloud (OpenRouter) — which one Conversation and
  // Vocabulary's AI features actually call.
  llmProvider: LlmProviderOut | null;

  fetchCatalog: () => Promise<void>;
  downloadLlm: (key: string) => Promise<void>;
  downloadStt: () => Promise<void>;
  downloadTts: () => Promise<void>;
  deleteLlm: (key: string) => Promise<void>;
  deleteStt: () => Promise<void>;
  deleteTts: () => Promise<void>;
  downloadPocketTts: () => Promise<void>;
  deletePocketTts: () => Promise<void>;
  selectTtsEngine: (engine: TtsEngine) => Promise<void>;
  selectModel: (key: string) => Promise<void>;
  fetchReadiness: (channel: 'voice' | 'text') => Promise<void>;
  fetchStatus: () => Promise<void>;
  launchAi: () => Promise<void>;
  unloadAi: () => Promise<void>;
  fetchLlmProvider: () => Promise<void>;
  setLlmProvider: (
    provider: LlmProvider,
    opts?: { openrouterApiKey?: string; openrouterModel?: string; geminiApiKey?: string; geminiModel?: string },
  ) => Promise<void>;
}

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user — cannot manage models yet');
  return id;
}

// Lets the main process warn before letting the window close while a real
// download is in flight (no partial-file resume — closing loses the
// progress). Only actually notifies main when the flag flips, not on every
// poll tick.
let lastReportedActive = false;
function reportDownloadActive(catalog: ModelsCatalogOut | null): void {
  const active =
    !!catalog &&
    (catalog.llm.some((o) => o.download.status === 'downloading') ||
      catalog.stt.download.status === 'downloading' ||
      catalog.tts_options.some((o) => o.download.status === 'downloading'));
  if (active === lastReportedActive) return;
  lastReportedActive = active;
  window.fluencyos?.setDownloadActive(active);
}

// Any in-flight download (llm/stt/tts) gets polled at this cadence until it
// leaves the 'downloading' state, refreshing the whole catalog each time so
// every open view (Settings, Conversation's gate) sees the same progress.
const POLL_MS = 1200;
let pollHandle: ReturnType<typeof setInterval> | null = null;

export const useEngineStore = create<EngineState>((set, get) => {
  // Anything that changes what's downloaded, selected, or which provider is
  // active also changes readiness — refreshed for both channels here so the
  // nav's AI indicator and Conversation's gate update while the learner is
  // still sitting in Settings, rather than only after a screen change.
  const refreshReadiness = async () => {
    await Promise.all([get().fetchReadiness('voice'), get().fetchReadiness('text')]).catch(() => {});
  };

  const ensurePolling = () => {
    if (pollHandle) return;
    pollHandle = setInterval(async () => {
      await get().fetchCatalog();
      const c = get().catalog;
      const stillGoing =
        c &&
        (c.llm.some((o) => o.download.status === 'downloading') ||
          c.stt.download.status === 'downloading' ||
          c.tts_options.some((o) => o.download.status === 'downloading'));
      if (!stillGoing && pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
        // A download that just finished is exactly when readiness flips.
        void refreshReadiness();
      }
    }, POLL_MS);
  };

  return {
    catalog: null,
    catalogStatus: 'idle',
    readiness: { voice: null, text: null },
    status: null,
    launching: false,
    launchError: null,
    llmProvider: null,

    fetchCatalog: async () => {
      set({ catalogStatus: 'loading' });
      try {
        const userId = requireUserId();
        const catalog = await api.get<ModelsCatalogOut>(`/engine/models?user_id=${encodeURIComponent(userId)}`);
        set({ catalog, catalogStatus: 'idle' });
        reportDownloadActive(catalog);
      } catch {
        set({ catalogStatus: 'error' });
      }
    },

    downloadLlm: async (key) => {
      await api.post(`/engine/models/llm/${encodeURIComponent(key)}/download`);
      await get().fetchCatalog();
      ensurePolling();
    },

    downloadStt: async () => {
      await api.post('/engine/models/stt/download');
      await get().fetchCatalog();
      ensurePolling();
    },

    downloadTts: async () => {
      await api.post('/engine/models/tts/download');
      await get().fetchCatalog();
      ensurePolling();
    },

    deleteLlm: async (key) => {
      await api.delete(`/engine/models/llm/${encodeURIComponent(key)}`);
      await get().fetchCatalog();
      // Deleting the model currently loaded in memory unloads it
      // server-side too — refresh status so Launch AI reflects that.
      await get().fetchStatus();
      await refreshReadiness();
    },

    deleteStt: async () => {
      await api.delete('/engine/models/stt');
      await get().fetchCatalog();
      await get().fetchStatus();
      await refreshReadiness();
    },

    deleteTts: async () => {
      await api.delete('/engine/models/tts');
      await get().fetchCatalog();
      await get().fetchStatus();
      await refreshReadiness();
    },

    downloadPocketTts: async () => {
      await api.post('/engine/models/pocket-tts/download');
      await get().fetchCatalog();
      ensurePolling();
    },

    deletePocketTts: async () => {
      await api.delete('/engine/models/pocket-tts');
      await get().fetchCatalog();
      await get().fetchStatus();
      await refreshReadiness();
    },

    selectTtsEngine: async (engine) => {
      const userId = requireUserId();
      await api.post('/engine/models/tts-engine', { user_id: userId, engine });
      await get().fetchCatalog();
      // Switching unloads both voices server-side, and readiness now asks
      // about a different engine — which may not be downloaded at all, so
      // Conversation's gate has to re-evaluate before the learner starts a
      // session that could not speak.
      await get().fetchStatus();
      await refreshReadiness();
    },

    selectModel: async (key) => {
      const userId = requireUserId();
      await api.post('/engine/models/select', { user_id: userId, model_key: key });
      await get().fetchCatalog();
      // The newly selected model likely isn't the one resident in memory —
      // refresh status right away so the Launch AI indicator (AppNav, the
      // Conversation gate) reflects that immediately instead of still
      // showing "launched" off whatever was previously loaded.
      await get().fetchStatus();
      // Picking a local model also switches the provider back to 'local'
      // server-side (see /engine/models/select) — reflect that here too.
      await get().fetchLlmProvider();
      await refreshReadiness();
    },

    fetchReadiness: async (channel) => {
      const userId = requireUserId();
      const result = await api.get<ReadinessOut>(
        `/engine/readiness?user_id=${encodeURIComponent(userId)}&channel=${channel}`,
      );
      set((s) => ({ readiness: { ...s.readiness, [channel]: result } }));
    },

    fetchStatus: async () => {
      const userId = requireUserId();
      const status = await api.get<EngineStatusOut>(`/engine/status?user_id=${encodeURIComponent(userId)}`);
      set({ status });
    },

    launchAi: async () => {
      const userId = requireUserId();
      set({ launching: true, launchError: null });
      // Loading a ~1GB GGUF cold on CPU is real, sometimes multi-minute
      // work — poll /engine/status in the background while the blocking
      // POST below is in flight, so any UI watching `status` can show which
      // piece (llm/stt/tts) has finished rather than just spinning.
      const pollId = setInterval(() => void get().fetchStatus(), 1500);
      try {
        const status = await api.post<EngineStatusOut>(
          `/engine/launch?user_id=${encodeURIComponent(userId)}`,
        );
        set({ status, launching: false });
      } catch (err) {
        set({ launching: false, launchError: friendlyMessage(err, 'Starting the AI') });
        throw err;
      } finally {
        clearInterval(pollId);
      }
    },

    unloadAi: async () => {
      // The counterpart to launchAi. Each engine's unload() takes the same
      // lock generation holds, so this waits for an in-flight turn rather than
      // pulling a model out from under it.
      const userId = requireUserId();
      set({ launchError: null });
      const status = await api.post<EngineStatusOut>(`/engine/unload?user_id=${encodeURIComponent(userId)}`);
      set({ status });
    },

    fetchLlmProvider: async () => {
      const userId = requireUserId();
      const llmProvider = await api.get<LlmProviderOut>(`/engine/llm-provider?user_id=${encodeURIComponent(userId)}`);
      set({ llmProvider });
    },

    setLlmProvider: async (provider, opts) => {
      const userId = requireUserId();
      await api.post('/engine/llm-provider', {
        user_id: userId,
        provider,
        openrouter_api_key: opts?.openrouterApiKey ? opts.openrouterApiKey : undefined,
        openrouter_model: opts?.openrouterModel ? opts.openrouterModel : undefined,
        gemini_api_key: opts?.geminiApiKey ? opts.geminiApiKey : undefined,
        gemini_model: opts?.geminiModel ? opts.geminiModel : undefined,
      });
      await get().fetchLlmProvider();
      // The active engine may have just changed entirely — refresh
      // readiness/status/catalog so every dependent view (AppNav, the
      // Conversation gate) reflects it immediately.
      await Promise.all([get().fetchCatalog(), get().fetchStatus(), refreshReadiness()]);
    },
  };
});
