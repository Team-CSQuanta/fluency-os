import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type {
  CefrLevel,
  LlmMode,
  ModelRecommendation,
  ModelsCatalogOut,
  UserCreate,
  UserOut,
} from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';
import type { CloudProvider } from '@/features/onboarding/onboardingConfig';

export type OnboardingStep = 1 | 2 | 3 | 4;

interface HardwareInfo {
  cpuCores: number | null;
  totalRamBytes: number | null;
  platform: string | null;
  gpuVendor: string | null;
}

interface OnboardingState {
  step: OnboardingStep;
  userId: string | null;

  profile: {
    displayName: string;
    nativeLanguage: string;
    targetLanguage: string;
    dataFolder: string;
  };

  // The placed level, as the server last reported it. It is set by passing
  // the level test (the same one as Settings → Account) or by starting at A1,
  // both of which save it server-side — so there is nothing to submit here.
  placement: {
    level: CefrLevel | null;
  };

  hardware: HardwareInfo;
  recommendation: ModelRecommendation | null;
  engine: {
    mode: LlmMode;
    /** A key from the app's model catalog — the same one Settings → AI uses. */
    modelKey: string | null;
    cloudProvider: CloudProvider;
    apiKey: string;
  };

  // The daily targets the app actually runs on — the same settings as
  // Settings → Study, saved through the same endpoint.
  habit: {
    newCardsPerDay: number;
    dailyPageGoal: number;
    notificationsEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
  };

  submission: {
    status: 'idle' | 'submitting' | 'error' | 'done';
    error: string | null;
  };

  setStep: (n: OnboardingStep) => void;
  updateProfile: (patch: Partial<OnboardingState['profile']>) => void;
  updatePlacement: (patch: Partial<OnboardingState['placement']>) => void;
  loadHardwareInfo: () => Promise<void>;
  assessHardware: () => Promise<void>;
  updateEngine: (patch: Partial<OnboardingState['engine']>) => void;
  updateHabit: (patch: Partial<OnboardingState['habit']>) => void;
  goBack: () => void;
  goNext: () => Promise<void>;
}


export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  step: 1,
  userId: null,

  profile: {
    displayName: '',
    nativeLanguage: 'Bengali',
    targetLanguage: 'English',
    dataFolder: '~/FluencyOS',
  },

  placement: { level: null },

  hardware: { cpuCores: null, totalRamBytes: null, platform: null, gpuVendor: null },
  recommendation: null,
  engine: { mode: 'local', modelKey: null, cloudProvider: 'openrouter', apiKey: '' },

  // The schema's own defaults (0001_init / 0004_reading_goal).
  habit: {
    newCardsPerDay: 15,
    dailyPageGoal: 20,
    notificationsEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
  },

  submission: { status: 'idle', error: null },

  setStep: (n) => set({ step: n, submission: { status: 'idle', error: null } }),
  updateProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
  updatePlacement: (patch) => set((s) => ({ placement: { ...s.placement, ...patch } })),

  loadHardwareInfo: async () => {
    const info = await window.fluencyos.getSystemInfo();
    set({
      hardware: {
        cpuCores: info.cpuCores,
        totalRamBytes: info.totalRamBytes,
        platform: info.platform,
        gpuVendor: info.gpuVendor ?? null,
      },
    });
    await get().assessHardware();
  },

  assessHardware: async () => {
    const { hardware } = get();
    if (hardware.cpuCores === null || hardware.totalRamBytes === null) return;

    const recommendation = await api.post<ModelRecommendation>('/engine/recommend', {
      cpu_cores: hardware.cpuCores,
      total_ram_bytes: hardware.totalRamBytes,
      gpu_vendor: hardware.gpuVendor,
    });

    set((s) => {
      // Keep a choice already made, unless it cannot fit on this machine.
      const kept = recommendation.models.find((m) => m.key === s.engine.modelKey && m.fit !== 'too_big');
      return {
        recommendation,
        engine: { ...s.engine, modelKey: kept ? kept.key : recommendation.recommended },
      };
    });
  },

  updateEngine: (patch) => set((s) => ({ engine: { ...s.engine, ...patch } })),
  updateHabit: (patch) => set((s) => ({ habit: { ...s.habit, ...patch } })),

  goBack: () =>
    set((s) => ({
      step: Math.max(1, s.step - 1) as OnboardingStep,
      submission: { status: 'idle', error: null },
    })),

  goNext: async () => {
    const state = get();

    const validationError = validateStep(state);
    if (validationError) {
      set({ submission: { status: 'error', error: validationError } });
      return;
    }

    set({ submission: { status: 'submitting', error: null } });
    try {
      if (state.step === 1 && state.userId) {
        // Back to step 1 and on again: the same learner, edited — not a
        // second account, which would strand the level they had already
        // placed at under the first one.
        await api.patch<UserOut>(`/users/${state.userId}`, {
          display_name: state.profile.displayName.trim(),
          native_language: state.profile.nativeLanguage.trim(),
          target_language: state.profile.targetLanguage.trim(),
        });
      } else if (state.step === 1) {
        const payload: UserCreate = {
          display_name: state.profile.displayName.trim(),
          native_language: state.profile.nativeLanguage.trim(),
          target_language: state.profile.targetLanguage.trim(),
          data_folder: state.profile.dataFolder.trim(),
        };
        const user = await api.post<UserOut>('/users', payload);
        set({ userId: user.id });
        useAppStore.getState().setCurrentUserId(user.id);
      } else if (state.step === 3) {
        // Saved through the same endpoints Settings → AI uses, so what is
        // chosen here is exactly what the app then runs.
        const userId = requireUserId(state.userId);
        if (state.engine.mode === 'local') {
          const key = requireModelKey(state.engine.modelKey);
          await api.post('/engine/models/select', { user_id: userId, model_key: key });
          // Downloading starts now, in the background, so the model is
          // likely ready by the end of onboarding. Settings → AI shows it.
          const catalog = await api.get<ModelsCatalogOut>(`/engine/models?user_id=${encodeURIComponent(userId)}`);
          const option = catalog.llm.find((o) => o.key === key);
          if (option && !option.downloaded && option.download.status !== 'downloading') {
            await api.post(`/engine/models/llm/${encodeURIComponent(key)}/download`);
          }
        } else {
          const key = state.engine.apiKey.trim();
          await api.post('/engine/llm-provider', {
            user_id: userId,
            provider: state.engine.cloudProvider,
            // Only sent when given: an empty field must not wipe a saved key.
            ...(key
              ? state.engine.cloudProvider === 'gemini'
                ? { gemini_api_key: key }
                : { openrouter_api_key: key }
              : {}),
          });
        }
      } else if (state.step === 4) {
        const userId = requireUserId(state.userId);
        await api.patch(`/users/${userId}/settings`, {
          new_cards_per_day: state.habit.newCardsPerDay,
          daily_page_goal: state.habit.dailyPageGoal,
          notifications_enabled: state.habit.notificationsEnabled,
          quiet_hours_start: state.habit.quietHoursStart,
          quiet_hours_end: state.habit.quietHoursEnd,
        });
        // The last step: onboarding is done.
        const user = await api.post<UserOut>(`/users/${userId}/onboarding/complete`);
        useAppStore.getState().setOnboardingComplete(user);
        set({ submission: { status: 'done', error: null } });
        return;
      }

      set((s) => ({
        step: Math.min(4, s.step + 1) as OnboardingStep,
        submission: { status: 'idle', error: null },
      }));
    } catch (err) {
      set({ submission: { status: 'error', error: friendlyMessage(err, 'Saving your answers') } });
    }
  },
}));

function validateStep(state: OnboardingState): string | null {
  if (state.step === 1) {
    if (!state.profile.displayName.trim()) {
      return 'Please enter your name to continue.';
    }
  }
  if (state.step === 2) {
    if (!state.placement.level) {
      return 'Take the level test, or start at A1, to set your level.';
    }
  }
  if (state.step === 3) {
    if (state.engine.mode === 'local' && !state.engine.modelKey) {
      return 'Pick a model to continue.';
    }
  }
  return null;
}

function requireUserId(id: string | null): string {
  if (!id) throw new Error('Onboarding step reached before user was created (Step 1 must complete first)');
  return id;
}

function requireModelKey(key: string | null): string {
  if (!key) throw new Error('Pick a model before continuing');
  return key;
}
