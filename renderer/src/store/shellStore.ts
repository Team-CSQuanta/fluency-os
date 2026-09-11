import { create } from 'zustand';
import type { ScreenKey } from '@/features/shell/navConfig';
import type { SettingsGroupName } from '@/features/settings/settingsMockData';

interface ShellState {
  screen: ScreenKey;
  collapsed: boolean;
  theme: 'dark' | 'light';
  heatTip: string;
  nowPlaying: string;
  nowReading: string;
  readerBookId: string | null;
  selectedWord: string;
  convScenario: string;
  reportOrigin: ScreenKey;
  settingsGroup: SettingsGroupName;
  // Set by ConversationLive while a real operation (recording, transcribing,
  // waiting on the LLM, or playing back a reply) is in flight, so navigation
  // away can be gated instead of silently abandoning it mid-flight.
  convBusy: boolean;
  // The navigation that was deferred because convBusy was true, waiting on
  // the learner to confirm or cancel via the leave-conversation dialog.
  pendingNav: (() => void) | null;
  goScreen: (key: ScreenKey) => void;
  goPlayer: (title: string) => void;
  goReader: (bookId: string, title?: string) => void;
  setNowReading: (title: string) => void;
  goWord: (word: string) => void;
  goConvLive: (scenario: string) => void;
  goReport: () => void;
  goSettings: (group?: SettingsGroupName) => void;
  toggleNav: () => void;
  toggleTheme: () => void;
  setHeatTip: (tip: string) => void;
  setConvBusy: (busy: boolean) => void;
  confirmLeaveConv: () => void;
  cancelLeaveConv: () => void;
}

export const useShellStore = create<ShellState>((set, get) => {
  // Every navigation action funnels through here. If the learner is mid-way
  // through a real conversation operation, the navigation is held as
  // `pendingNav` instead of applied immediately — a confirmation dialog
  // (rendered at the app root) then either runs it (confirmLeaveConv) or
  // drops it (cancelLeaveConv).
  const attemptNav = (perform: () => void) => {
    if (get().screen === 'convlive' && get().convBusy) {
      set({ pendingNav: perform });
      return;
    }
    perform();
  };

  return {
    screen: 'dashboard',
    collapsed: false,
    theme: 'dark',
    heatTip: 'hover a day',
    nowPlaying: 'Arrival (2016)',
    nowReading: 'The Overstory — Richard Powers',
    readerBookId: null,
    selectedWord: 'reticent',
    convScenario: 'Free talk',
    reportOrigin: 'conv',
    settingsGroup: 'Media',
    convBusy: false,
    pendingNav: null,

    goScreen: (key) => attemptNav(() => set({ screen: key })),
    goWord: (word) => attemptNav(() => set({ screen: 'word', selectedWord: word })),
    // Mirrors the mockup's immersive() behavior: entering player/reader collapses
    // the nav to icon-only so the content area gets more room.
    goPlayer: (title) => attemptNav(() => set({ screen: 'player', collapsed: true, nowPlaying: title })),
    goReader: (bookId, title) =>
      attemptNav(() =>
        set((s) => ({ screen: 'reader', collapsed: true, readerBookId: bookId, nowReading: title ?? s.nowReading })),
      ),
    goConvLive: (scenario) => attemptNav(() => set({ screen: 'convlive', collapsed: true, convScenario: scenario })),
    // Remembers which screen (session list or the live chat that just ended) the
    // report was opened from, so its back button returns to that exact place.
    goReport: () => attemptNav(() => set((s) => ({ screen: 'report', reportOrigin: s.screen }))),
    goSettings: (group) => attemptNav(() => set((s) => ({ screen: 'settings', settingsGroup: group ?? s.settingsGroup }))),
    setNowReading: (title) => set({ nowReading: title }),
    toggleNav: () => set({ collapsed: !get().collapsed }),
    toggleTheme: () => {
      const next = get().theme === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-theme', next);
      set({ theme: next });
    },
    setHeatTip: (tip) => set({ heatTip: tip }),
    setConvBusy: (busy) => set({ convBusy: busy }),
    confirmLeaveConv: () => {
      const pending = get().pendingNav;
      set({ pendingNav: null, convBusy: false });
      pending?.();
    },
    cancelLeaveConv: () => set({ pendingNav: null }),
  };
});
