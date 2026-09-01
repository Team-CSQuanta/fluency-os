import { create } from 'zustand';
import type { ScreenKey } from '@/features/shell/navConfig';

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
  goScreen: (key: ScreenKey) => void;
  goPlayer: (title: string) => void;
  goReader: (bookId: string, title?: string) => void;
  setNowReading: (title: string) => void;
  goWord: (word: string) => void;
  goConvLive: (scenario: string) => void;
  goReport: () => void;
  toggleNav: () => void;
  toggleTheme: () => void;
  setHeatTip: (tip: string) => void;
}

export const useShellStore = create<ShellState>((set, get) => ({
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

  goScreen: (key) => set({ screen: key }),
  goWord: (word) => set({ screen: 'word', selectedWord: word }),
  // Mirrors the mockup's immersive() behavior: entering player/reader collapses
  // the nav to icon-only so the content area gets more room.
  goPlayer: (title) => set({ screen: 'player', collapsed: true, nowPlaying: title }),
  goReader: (bookId, title) =>
    set((s) => ({ screen: 'reader', collapsed: true, readerBookId: bookId, nowReading: title ?? s.nowReading })),
  goConvLive: (scenario) => set({ screen: 'convlive', collapsed: true, convScenario: scenario }),
  // Remembers which screen (session list or the live chat that just ended) the
  // report was opened from, so its back button returns to that exact place.
  goReport: () => set((s) => ({ screen: 'report', reportOrigin: s.screen })),
  setNowReading: (title) => set({ nowReading: title }),
  toggleNav: () => set({ collapsed: !get().collapsed }),
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    set({ theme: next });
  },
  setHeatTip: (tip) => set({ heatTip: tip }),
}));
