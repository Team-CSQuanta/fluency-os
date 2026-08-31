import { create } from 'zustand';
import type { ScreenKey } from '@/features/shell/navConfig';

interface ShellState {
  screen: ScreenKey;
  collapsed: boolean;
  theme: 'dark' | 'light';
  heatTip: string;
  nowPlaying: string;
  nowReading: string;
  readerChapter: string;
  readerPos: string;
  selectedWord: string;
  goScreen: (key: ScreenKey) => void;
  goPlayer: (title: string) => void;
  goReader: (title: string, chapter: string, pos: string) => void;
  goWord: (word: string) => void;
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
  readerChapter: 'Chapter 4 · The Weight of Small Words',
  readerPos: '118 / 342',
  selectedWord: 'reticent',

  goScreen: (key) => set({ screen: key }),
  goWord: (word) => set({ screen: 'word', selectedWord: word }),
  // Mirrors the mockup's immersive() behavior: entering player/reader collapses
  // the nav to icon-only so the content area gets more room.
  goPlayer: (title) => set({ screen: 'player', collapsed: true, nowPlaying: title }),
  goReader: (title, chapter, pos) =>
    set({ screen: 'reader', collapsed: true, nowReading: title, readerChapter: chapter, readerPos: pos }),
  toggleNav: () => set({ collapsed: !get().collapsed }),
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    set({ theme: next });
  },
  setHeatTip: (tip) => set({ heatTip: tip }),
}));
