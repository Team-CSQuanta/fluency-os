import { SCREEN_TITLES } from '@/features/shell/navConfig';
import { useShellStore } from '@/store/shellStore';

export function ScreenHeader() {
  const screen = useShellStore((s) => s.screen);
  const theme = useShellStore((s) => s.theme);
  const nowPlaying = useShellStore((s) => s.nowPlaying);
  const toggleTheme = useShellStore((s) => s.toggleTheme);
  const [title, staticSub] = SCREEN_TITLES[screen];
  const sub = screen === 'player' ? `${nowPlaying} · ${staticSub}` : staticSub;

  return (
    <header className="flex h-[52px] flex-none items-center justify-between gap-4 border-b border-line2 bg-bg px-5">
      <div className="min-w-0">
        <div className="font-sans text-[15px] font-semibold tracking-[-0.01em] text-tx">{title}</div>
        <div className="truncate font-sans text-[11px] text-tx3">{sub}</div>
      </div>
      <div className="flex flex-none items-center gap-2">
        <div className="flex items-center gap-[6px] rounded-field border border-line2 px-[10px] py-[5px] font-mono text-[10.5px] font-medium text-tx2">
          <span className="h-[6px] w-[6px] rounded-full bg-acc" />
          23-day streak
        </div>
        <button
          onClick={toggleTheme}
          className="rounded-field border border-line2 px-[11px] py-[6px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
        >
          {theme === 'dark' ? '☾ dark' : '☀ light'}
        </button>
      </div>
    </header>
  );
}
