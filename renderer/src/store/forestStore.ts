import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type { FocusOut, ForestOut, TreeOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user');
  return id;
}

interface ForestState {
  forest: ForestOut | null;
  loading: boolean;
  error: string | null;
  /** The biome being looked at, or null for the whole forest at once. */
  biome: string | null;
  focus: FocusOut | null;

  fetchForest: () => Promise<void>;
  setBiome: (key: string | null) => void;
  spend: (kind: string, vocabWordId?: string) => Promise<void>;
  startFocus: (minutes: number) => Promise<void>;
  completeFocus: () => Promise<void>;
  clearFocus: () => void;
}

export const useForestStore = create<ForestState>((set, get) => ({
  forest: null,
  loading: false,
  error: null,
  biome: null,
  focus: null,

  fetchForest: async () => {
    set({ loading: true, error: null });
    try {
      const forest = await api.get<ForestOut>(
        `/forest?user_id=${encodeURIComponent(requireUserId())}`,
      );
      set({ forest, loading: false });
    } catch (err) {
      set({ loading: false, error: friendlyMessage(err, 'Loading your forest') });
    }
  },

  setBiome: (biome) => set({ biome }),

  spend: async (kind, vocabWordId) => {
    try {
      await api.post('/forest/spend', {
        user_id: requireUserId(),
        kind,
        vocab_word_id: vocabWordId ?? null,
      });
      // Re-read rather than adjusting locally: a revive changes a tree's state
      // as well as the balance, and guessing at both here is how the two end
      // up disagreeing with the server.
      await get().fetchForest();
    } catch (err) {
      set({ error: friendlyMessage(err, 'Loading your forest') });
    }
  },

  startFocus: async (minutes) => {
    try {
      const focus = await api.post<FocusOut>('/forest/focus', {
        user_id: requireUserId(),
        minutes,
      });
      set({ focus, error: null });
    } catch (err) {
      set({ error: friendlyMessage(err, 'Loading your forest') });
    }
  },

  completeFocus: async () => {
    const focus = get().focus;
    if (!focus) return;
    try {
      const done = await api.post<FocusOut>(
        `/forest/focus/${focus.id}/complete?user_id=${encodeURIComponent(requireUserId())}`,
        {},
      );
      set({ focus: done });
      await get().fetchForest();
    } catch (err) {
      // The server refuses to pay out early, which is the point — surface it
      // rather than pretending the session finished.
      set({ error: friendlyMessage(err, 'Loading your forest') });
    }
  },

  clearFocus: () => set({ focus: null }),
}));

/** The trees to draw: one biome, or all of them. */
export function visibleTrees(forest: ForestOut | null, biome: string | null): TreeOut[] {
  if (!forest) return [];
  return biome ? forest.trees.filter((t) => t.biome === biome) : forest.trees;
}
