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
  focus: FocusOut | null;

  fetchForest: () => Promise<void>;
  startFocus: (minutes: number) => Promise<void>;
  completeFocus: () => Promise<void>;
  clearFocus: () => void;
}

export const useForestStore = create<ForestState>((set, get) => ({
  forest: null,
  loading: false,
  error: null,
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

/** The trees to draw. Every tree, always: the forest is one place. */
export function visibleTrees(forest: ForestOut | null): TreeOut[] {
  if (!forest) return [];
  return forest.trees;
}
