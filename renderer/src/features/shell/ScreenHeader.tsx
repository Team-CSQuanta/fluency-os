import { useEffect } from 'react';
import { SCREEN_TITLES } from '@/features/shell/navConfig';
import { useAppStore } from '@/store/appStore';
import { useBookshelfStore } from '@/store/bookshelfStore';
import { useShellStore } from '@/store/shellStore';

export function ScreenHeader() {
  const screen = useShellStore((s) => s.screen);
  const theme = useShellStore((s) => s.theme);
  const nowPlaying = useShellStore((s) => s.nowPlaying);
  const nowReading = useShellStore((s) => s.nowReading);
  const selectedWord = useShellStore((s) => s.selectedWord);
  const toggleTheme = useShellStore((s) => s.toggleTheme);
  const currentUserId = useAppStore((s) => s.currentUserId);
  const stats = useBookshelfStore((s) => s.stats);
  const books = useBookshelfStore((s) => s.books);
  const fetchStats = useBookshelfStore((s) => s.fetchStats);

  // The header outlives every screen, so it seeds the stats itself rather than
  // showing a placeholder streak until the shelf happens to be visited.
  useEffect(() => {
    if (currentUserId) void fetchStats();
  }, [currentUserId, fetchStats]);

  const [title, staticSub] = SCREEN_TITLES[screen];
  const shelfSub =
    stats && books.length > 0
      ? `${books.length} ${books.length === 1 ? 'book' : 'books'} · ${stats.pages_today} of ${stats.goal_pages} pages today · nothing leaves this machine`
      : staticSub;
  const sub =
    screen === 'player'
      ? `${nowPlaying} · ${staticSub}`
      : screen === 'reader'
        ? `${nowReading} · ${staticSub}`
        : screen === 'word'
          ? `${selectedWord} · ${staticSub}`
          : screen === 'bookshelf'
            ? shelfSub
            : staticSub;

  return (
    <header className="flex h-[52px] flex-none items-center justify-between gap-4 border-b border-line2 bg-bg px-5">
      <div className="min-w-0">
        <div className="font-sans text-[15px] font-semibold tracking-[-0.01em] text-tx">{title}</div>
        <div className="truncate font-sans text-[11px] text-tx3">{sub}</div>
      </div>
      <div className="flex flex-none items-center gap-2">
        <div
          className="flex items-center gap-[6px] rounded-field border border-line2 px-[10px] py-[5px] font-mono text-[10.5px] font-medium text-tx2"
          title={stats ? `${stats.pages_today} of ${stats.goal_pages} pages read today` : undefined}
        >
          <span
            className="h-[6px] w-[6px] rounded-full"
            style={{ background: stats?.goal_met ? 'var(--acc)' : 'var(--line2)' }}
          />
          {stats
            ? stats.streak_days > 0
              ? `${stats.streak_days}-day streak`
              : 'no streak yet'
            : '— streak'}
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
