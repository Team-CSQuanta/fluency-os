import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type { AppSettingsOut, AppSettingsPatch, DictionaryCacheOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

/** The settings the page itself owns.
 *
 * The player's and the reader's live in their own stores, next to the screens
 * that write them; duplicating them here would give each setting two owners
 * and, sooner or later, two different values.
 *
 * Writes are optimistic and answered with the whole object: a control that
 * did not visibly move is indistinguishable from one that did not work, and a
 * settings page that lags a save by a round trip feels broken even when it is
 * not. A failed write puts the old value back and says why.
 */
interface SettingsState {
  settings: AppSettingsOut | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Which field is mid-flight, so one row can show it is saving. */
  saving: keyof AppSettingsPatch | null;
  cache: DictionaryCacheOut | null;

  fetch: () => Promise<void>;
  update: (patch: AppSettingsPatch) => Promise<void>;
  fetchCache: () => Promise<void>;
  clearCache: () => Promise<void>;
}

function requireUserId(): string {
  const id = useAppStore.getState().currentUserId;
  if (!id) throw new Error('No signed-in user');
  return id;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  status: 'idle',
  error: null,
  saving: null,
  cache: null,

  fetch: async () => {
    set({ status: 'loading', error: null });
    try {
      const userId = requireUserId();
      set({
        settings: await api.get<AppSettingsOut>(`/users/${encodeURIComponent(userId)}/settings`),
        status: 'ready',
      });
    } catch (err) {
      set({ status: 'error', error: friendlyMessage(err, 'Reading your settings') });
    }
  },

  update: async (patch) => {
    const previous = get().settings;
    if (!previous) return;
    const field = Object.keys(patch)[0] as keyof AppSettingsPatch;
    set({ settings: { ...previous, ...patch }, saving: field, error: null });
    try {
      const userId = requireUserId();
      const fresh = await api.patch<AppSettingsOut>(
        `/users/${encodeURIComponent(userId)}/settings`,
        patch,
      );
      set({ settings: fresh, saving: null });
    } catch (err) {
      // Back to what the server last confirmed, rather than leaving a control
      // showing a value that was never stored.
      set({
        settings: previous,
        saving: null,
        error: friendlyMessage(err, 'Saving that setting'),
      });
    }
  },

  fetchCache: async () => {
    set({ cache: await api.get<DictionaryCacheOut>('/vocabulary/dictionary-cache') });
  },

  clearCache: async () => {
    set({ cache: await api.delete<DictionaryCacheOut>('/vocabulary/dictionary-cache') });
  },
}));
