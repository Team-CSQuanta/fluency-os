import { create } from 'zustand';
import type { ScreenKey } from '@/features/shell/navConfig';

interface ShellState {
  screen: ScreenKey;
  collapsed: boolean;
  theme: 'dark' | 'light';
  heatTip: string;
  goScreen: (key: ScreenKey) => void;
  toggleNav: () => void;
  toggleTheme: () => void;
  setHeatTip: (tip: string) => void;
}

export const useShellStore = create<ShellState>((set, get) => ({
  screen: 'dashboard',
  collapsed: false,
  theme: 'dark',
  heatTip: 'hover a day',

  goScreen: (key) => set({ screen: key }),
  toggleNav: () => set({ collapsed: !get().collapsed }),
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    set({ theme: next });
  },
  setHeatTip: (tip) => set({ heatTip: tip }),
}));
