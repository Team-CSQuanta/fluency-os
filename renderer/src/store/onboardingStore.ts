import { create } from 'zustand';
import { api } from '@/lib/apiClient';
import { useAppStore } from '@/store/appStore';
import type {
  CompanionSpecies,
  CompanionUpdate,
  DailyGoalSpec,
  EngineAssessment,
  LlmMode,
  ModelTier,
  PlacementAnswer,
  PlacementQuestion,
  PlacementResult,
  PlacementUpdate,
  UserCreate,
  UserOut,
  UserSettingsUpdate,
} from '@/types/api';

export type OnboardingStep = 1 | 2 | 3 | 4 | 5;

interface HardwareInfo {
  cpuCores: number | null;
  totalRamBytes: number | null;
  platform: string | null;
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

  placement: {
    selfAssessedCefr: string;
    placementCheckStatus: 'not_started' | 'in_progress' | 'scored';
    estimatedCefr: string | null;
    questions: PlacementQuestion[] | null;
    currentIndex: number;
    answers: Record<string, number>;
    result: PlacementResult | null;
  };

  hardware: HardwareInfo;
  engineAssessment: EngineAssessment | null;
  engine: {
    mode: LlmMode;
    modelTier: ModelTier | null;
    apiProvider: string;
    apiKey: string;
  };

  habit: {
    dailyGoal: DailyGoalSpec;
    notificationsEnabled: boolean;
    quietHoursStart: string;
    quietHoursEnd: string;
  };

  companion: {
    species: CompanionSpecies | null;
    startingBiome: string | null;
  };

  submission: {
    status: 'idle' | 'submitting' | 'error' | 'done';
    error: string | null;
  };

  setStep: (n: OnboardingStep) => void;
  updateProfile: (patch: Partial<OnboardingState['profile']>) => void;
  updatePlacement: (patch: Partial<OnboardingState['placement']>) => void;
  startPlacementQuiz: () => Promise<void>;
  answerPlacementQuestion: (questionId: string, selectedIndex: number) => void;
  goToPlacementQuestion: (index: number) => void;
  submitPlacementQuiz: () => Promise<void>;
  retakePlacementQuiz: () => void;
  loadHardwareInfo: () => Promise<void>;
  assessHardware: () => Promise<void>;
  updateEngine: (patch: Partial<OnboardingState['engine']>) => void;
  updateHabit: (patch: Partial<OnboardingState['habit']>) => void;
  updateCompanion: (patch: Partial<OnboardingState['companion']>) => void;
  goBack: () => void;
  goNext: () => Promise<void>;
}

const DEFAULT_BIOME = 'meadow';

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  step: 1,
  userId: null,

  profile: {
    displayName: '',
    nativeLanguage: 'Bengali',
    targetLanguage: 'English',
    dataFolder: '~/FluencyOS',
  },

  placement: {
    selfAssessedCefr: 'B1',
    placementCheckStatus: 'not_started',
    estimatedCefr: null,
    questions: null,
    currentIndex: 0,
    answers: {},
    result: null,
  },

  hardware: { cpuCores: null, totalRamBytes: null, platform: null },
  engineAssessment: null,
  engine: { mode: 'local', modelTier: null, apiProvider: 'openai', apiKey: '' },

  habit: {
    dailyGoal: {
      reviews_cleared: { enabled: true, target: 20 },
      conversation_minutes: { enabled: true, target: 3 },
      watch_minutes: { enabled: false, target: 15 },
      reading_minutes: { enabled: false, target: 15 },
      new_words: { enabled: false, target: 5 },
    },
    notificationsEnabled: true,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00',
  },

  companion: { species: null, startingBiome: DEFAULT_BIOME },

  submission: { status: 'idle', error: null },

  setStep: (n) => set({ step: n, submission: { status: 'idle', error: null } }),
  updateProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
  updatePlacement: (patch) => set((s) => ({ placement: { ...s.placement, ...patch } })),

  startPlacementQuiz: async () => {
    set((s) => ({
      placement: { ...s.placement, placementCheckStatus: 'in_progress', currentIndex: 0, answers: {}, result: null },
    }));
    const questions = await api.get<PlacementQuestion[]>('/placement/questions');
    set((s) => ({ placement: { ...s.placement, questions } }));
  },

  answerPlacementQuestion: (questionId, selectedIndex) => {
    set((s) => ({
      placement: { ...s.placement, answers: { ...s.placement.answers, [questionId]: selectedIndex } },
    }));
  },

  goToPlacementQuestion: (index) => {
    set((s) => {
      const total = s.placement.questions?.length ?? 0;
      return { placement: { ...s.placement, currentIndex: Math.max(0, Math.min(total - 1, index)) } };
    });
  },

  submitPlacementQuiz: async () => {
    const { answers } = get().placement;
    const payload: { answers: PlacementAnswer[] } = {
      answers: Object.entries(answers).map(([question_id, selected_index]) => ({ question_id, selected_index })),
    };
    const result = await api.post<PlacementResult>('/placement/score', payload);
    set((s) => ({
      placement: {
        ...s.placement,
        placementCheckStatus: 'scored',
        estimatedCefr: result.estimated_cefr,
        result,
      },
    }));
  },

  retakePlacementQuiz: () => {
    set((s) => ({
      placement: {
        ...s.placement,
        placementCheckStatus: 'not_started',
        currentIndex: 0,
        answers: {},
        result: null,
        estimatedCefr: null,
      },
    }));
  },

  loadHardwareInfo: async () => {
    const info = await window.fluencyos.getSystemInfo();
    set({ hardware: info });
    await get().assessHardware();
  },

  assessHardware: async () => {
    const { hardware } = get();
    if (hardware.cpuCores === null || hardware.totalRamBytes === null) return;

    const assessment = await api.post<EngineAssessment>('/engine/assess-hardware', {
      cpu_cores: hardware.cpuCores,
      total_ram_bytes: hardware.totalRamBytes,
    });

    set((s) => {
      if (!assessment.any_local_capable) {
        return { engineAssessment: assessment, engine: { ...s.engine, mode: 'api', modelTier: null } };
      }
      const currentTierCapable = s.engine.modelTier
        ? assessment.tiers.find((t) => t.tier === s.engine.modelTier)?.capable
        : false;
      const modelTier = currentTierCapable ? s.engine.modelTier : assessment.recommended_tier;
      return { engineAssessment: assessment, engine: { ...s.engine, modelTier } };
    });
  },

  updateEngine: (patch) => set((s) => ({ engine: { ...s.engine, ...patch } })),
  updateHabit: (patch) => set((s) => ({ habit: { ...s.habit, ...patch } })),
  updateCompanion: (patch) => set((s) => ({ companion: { ...s.companion, ...patch } })),

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
      if (state.step === 1) {
        const payload: UserCreate = {
          display_name: state.profile.displayName.trim(),
          native_language: state.profile.nativeLanguage.trim(),
          target_language: state.profile.targetLanguage.trim(),
          data_folder: state.profile.dataFolder.trim(),
        };
        const user = await api.post<UserOut>('/users', payload);
        set({ userId: user.id });
        useAppStore.getState().setCurrentUserId(user.id);
      } else if (state.step === 2) {
        const userId = requireUserId(state.userId);
        const payload: PlacementUpdate = {
          cefr_level: state.placement.estimatedCefr ?? state.placement.selfAssessedCefr,
        };
        await api.patch(`/users/${userId}/placement`, payload);
      } else if (state.step === 4) {
        // Step 4 persists the combined Engine (step 3) + Habit (step 4) settings in one call.
        const userId = requireUserId(state.userId);
        const payload: UserSettingsUpdate = {
          llm_mode: state.engine.mode,
          llm_model_id: state.engine.mode === 'local' ? state.engine.modelTier : null,
          api_provider: state.engine.mode === 'api' ? state.engine.apiProvider : null,
          // Never the raw key (NFR-10) — real key storage lands with OS-keychain
          // integration in Settings; the value typed here stays client-side only.
          api_key_ref: state.engine.mode === 'api' ? 'pending-keychain-setup' : null,
          daily_goal_spec: state.habit.dailyGoal,
          notifications_enabled: state.habit.notificationsEnabled,
          quiet_hours_start: state.habit.quietHoursStart,
          quiet_hours_end: state.habit.quietHoursEnd,
        };
        await api.put(`/users/${userId}/settings`, payload);
      } else if (state.step === 5) {
        const userId = requireUserId(state.userId);
        const payload: CompanionUpdate = {
          companion_species: requireCompanion(state.companion.species),
          starting_biome: state.companion.startingBiome ?? DEFAULT_BIOME,
        };
        await api.post(`/users/${userId}/companion`, payload);
        const user = await api.post<UserOut>(`/users/${userId}/onboarding/complete`);
        useAppStore.getState().setOnboardingComplete(user);
        set({ submission: { status: 'done', error: null } });
        return;
      }

      set((s) => ({
        step: Math.min(5, s.step + 1) as OnboardingStep,
        submission: { status: 'idle', error: null },
      }));
    } catch (err) {
      set({ submission: { status: 'error', error: err instanceof Error ? err.message : String(err) } });
    }
  },
}));

function validateStep(state: OnboardingState): string | null {
  if (state.step === 1) {
    if (!state.profile.displayName.trim()) {
      return 'Please enter your name to continue.';
    }
  }
  if (state.step === 3) {
    if (state.engine.mode === 'local' && !state.engine.modelTier) {
      return 'Pick a model tier to continue.';
    }
  }
  if (state.step === 5) {
    if (!state.companion.species) {
      return 'Pick a companion to continue.';
    }
  }
  return null;
}

function requireUserId(id: string | null): string {
  if (!id) throw new Error('Onboarding step reached before user was created (Step 1 must complete first)');
  return id;
}

function requireCompanion(species: CompanionSpecies | null): CompanionSpecies {
  if (!species) throw new Error('Pick a companion before finishing onboarding');
  return species;
}
