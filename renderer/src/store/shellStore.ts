import { create } from 'zustand';
import type { ScreenKey } from '@/features/shell/navConfig';

interface ShellState {
  screen: ScreenKey;
  collapsed: boolean;
  theme: 'dark' | 'light';
  heatTip: string;
  nowPlaying: string;
  goScreen: (key: ScreenKey) => void;
  goPlayer: (title: string) => void;
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

  goScreen: (key) => set({ screen: key }),
  // Mirrors the mockup's immersive() behavior: entering the player collapses
  // the nav to icon-only so the video area gets more room.
  goPlayer: (title) => set({ screen: 'player', collapsed: true, nowPlaying: title }),
  toggleNav: () => set({ collapsed: !get().collapsed }),
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    set({ theme: next });
  },
  setHeatTip: (tip) => set({ heatTip: tip }),
}));
