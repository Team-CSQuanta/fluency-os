import { create } from 'zustand';
import { initApiClient, api } from '@/lib/apiClient';
import type { UserOut } from '@/types/api';

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
}

export const useAppStore = create<AppState>((set) => ({
  backendReady: false,
  onboardingCompleted: null,
  currentUserId: localStorage.getItem(STORAGE_KEY),
  currentUser: null,
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
      set({ initError: err instanceof Error ? err.message : String(err) });
    }
  },

  setCurrentUserId: (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    set({ currentUserId: id });
  },

  setOnboardingComplete: (user: UserOut) => {
    set({ currentUser: user, onboardingCompleted: true });
  },
}));
