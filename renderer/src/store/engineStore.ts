import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type { EngineStatusOut, ModelsCatalogOut, ReadinessOut } from '@/types/api';

interface EngineState {
  catalog: ModelsCatalogOut | null;
  catalogStatus: 'idle' | 'loading' | 'error';

  readiness: ReadinessOut | null;

  // Whether each engine is actually loaded into memory right now (distinct
  // from readiness, which only reflects what's downloaded to disk) — driven
  // by the global "Launch AI" action below.
  status: EngineStatusOut | null;
  launching: boolean;
  launchError: string | null;

  fetchCatalog: () => Promise<void>;
  downloadLlm: (key: string) => Promise<void>;
  downloadStt: () => Promise<void>;
  downloadTts: () => Promise<void>;
  deleteLlm: (key: string) => Promise<void>;
  deleteStt: () => Promise<void>;
  deleteTts: () => Promise<void>;
  selectModel: (key: string) => Promise<void>;
  fetchReadiness: (channel: 'voice' | 'text') => Promise<void>;
  fetchStatus: () => Promise<void>;
  launchAi: () => Promise<void>;
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
      catalog.tts.download.status === 'downloading');
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
  const ensurePolling = () => {
    if (pollHandle) return;
    pollHandle = setInterval(async () => {
      await get().fetchCatalog();
      const c = get().catalog;
      const stillGoing =
        c && (c.llm.some((o) => o.download.status === 'downloading') || c.stt.download.status === 'downloading' || c.tts.download.status === 'downloading');
      if (!stillGoing && pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    }, POLL_MS);
  };

  return {
    catalog: null,
    catalogStatus: 'idle',
    readiness: null,
    status: null,
    launching: false,
    launchError: null,

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
    },

    deleteStt: async () => {
      await api.delete('/engine/models/stt');
      await get().fetchCatalog();
      await get().fetchStatus();
    },

    deleteTts: async () => {
      await api.delete('/engine/models/tts');
      await get().fetchCatalog();
      await get().fetchStatus();
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
    },

    fetchReadiness: async (channel) => {
      const userId = requireUserId();
      const readiness = await api.get<ReadinessOut>(
        `/engine/readiness?user_id=${encodeURIComponent(userId)}&channel=${channel}`,
      );
      set({ readiness });
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
        set({ launching: false, launchError: err instanceof Error ? err.message : 'Could not launch AI' });
        throw err;
      } finally {
        clearInterval(pollId);
      }
    },
  };
});
