import { create } from 'zustand';
import { initApiClient, api } from '@/lib/apiClient';
import type { ProfileUpdate, UserOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

const STORAGE_KEY = 'fluencyos.currentUserId';

interface AppState {
  backendReady: boolean;
  onboardingCompleted: boolean | null; // null = unknown/loading
  currentUserId: string | null;
  currentUser: UserOut | null;
  initError: string | null;
  initialize: () => Promise<void>;
  setCurrentUserId: (id: string) => void;
  setOnboardingComplete: (user: UserOut) => void;
  /** Change name, languages or level. Returns nothing; the row is replaced. */
  updateProfile: (patch: ProfileUpdate) => Promise<void>;
  /** Copy a picture from disk and use it as the profile picture. */
  setAvatar: (path: string) => Promise<void>;
  clearAvatar: () => Promise<void>;
  /** Bumped whenever the picture changes, to defeat the image cache. */
  avatarVersion: number;
}

export const useAppStore = create<AppState>((set, get) => ({
  backendReady: false,
  onboardingCompleted: null,
  currentUserId: localStorage.getItem(STORAGE_KEY),
  currentUser: null,
  avatarVersion: 0,
  initError: null,

  initialize: async () => {
    try {
      await initApiClient();
      set({ backendReady: true });

      const storedId = localStorage.getItem(STORAGE_KEY);
      if (!storedId) {
        set({ onboardingCompleted: false });
        return;
      }

      try {
        const user = await api.get<UserOut>(`/users/${storedId}`);
        set({
          currentUserId: user.id,
          currentUser: user,
          onboardingCompleted: !!user.onboarding_completed_at,
        });
      } catch {
        // Stored id no longer resolves (e.g. DB reset) — fall back to onboarding.
        localStorage.removeItem(STORAGE_KEY);
        set({ currentUserId: null, onboardingCompleted: false });
      }
    } catch (err) {
      set({ initError: friendlyMessage(err, 'Starting FluencyOS') });
    }
  },

  setCurrentUserId: (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    set({ currentUserId: id });
  },

  setOnboardingComplete: (user: UserOut) => {
    set({ currentUser: user, onboardingCompleted: true });
  },

  updateProfile: async (patch) => {
    const id = get().currentUserId;
    if (!id) return;
    const user = await api.patch<UserOut>(`/users/${id}`, patch);
    set({ currentUser: user });
  },

  setAvatar: async (path) => {
    const id = get().currentUserId;
    if (!id) return;
    const user = await api.put<UserOut>(`/users/${id}/avatar`, { path });
    // The URL does not change when the picture does, so without this the
    // browser keeps showing the old face until the app restarts.
    set((s) => ({ currentUser: user, avatarVersion: s.avatarVersion + 1 }));
  },

  clearAvatar: async () => {
    const id = get().currentUserId;
    if (!id) return;
    const user = await api.delete<UserOut>(`/users/${id}/avatar`);
    set((s) => ({ currentUser: user, avatarVersion: s.avatarVersion + 1 }));
  },
}));
