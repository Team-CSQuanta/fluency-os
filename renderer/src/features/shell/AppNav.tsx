import { useEffect } from 'react';
import { ICONS } from '@/features/shell/icons';
import { avatarUrl } from '@/lib/avatar';
import { NAV_GROUPS } from '@/features/shell/navConfig';
import { useAppStore } from '@/store/appStore';
import { useProfileStore } from '@/store/profileStore';
import { useReviewStore } from '@/store/reviewStore';
import { useShellStore } from '@/store/shellStore';


export function AppNav() {
  const collapsed = useShellStore((s) => s.collapsed);
  const screen = useShellStore((s) => s.screen);
  const goScreen = useShellStore((s) => s.goScreen);
  const toggleNav = useShellStore((s) => s.toggleNav);
  const currentUser = useAppStore((s) => s.currentUser);
  const dueNow = useReviewStore((s) => s.stats?.due_now ?? 0);
  const fetchReviewStats = useReviewStore((s) => s.fetchStats);
  const words = useProfileStore((s) => s.words);
  const streakDays = useProfileStore((s) => s.streakDays);
  const refreshProfile = useProfileStore((s) => s.refresh);
  const avatarVersion = useAppStore((s) => s.avatarVersion);

  // Refreshed on every screen change: answering cards, ending a conversation
  // and saving a new word all change what is due, and a badge that only
  // updates on reload is a badge nobody trusts.
  useEffect(() => {
    if (!currentUser) return;
    void fetchReviewStats();
    void refreshProfile();
  }, [currentUser, screen, fetchReviewStats, refreshProfile]);

  const navW = collapsed ? '62px' : '224px';
  const avatarSize = collapsed ? 34 : 48;

  return (
    <nav
      className="flex flex-none flex-col overflow-hidden border-r border-line2 bg-bg2 transition-[width] duration-150"
      style={{ width: navW }}
    >
      <div
        className="flex flex-col gap-[13px] border-b border-line2 px-[14px] pb-[18px] pt-4"
        style={{ alignItems: collapsed ? 'center' : 'flex-start' }}
      >
        <button
          onClick={() => goScreen('settings')}
          title="Your profile"
          className="relative flex-none"
        >
          <div
            className="grid place-items-center overflow-hidden rounded-full border border-line2 font-sans text-[15px] font-semibold text-tx3"
            style={{
              width: avatarSize,
              height: avatarSize,
              background: currentUser?.has_avatar
                ? 'transparent'
                : 'repeating-linear-gradient(135deg,var(--tile) 0 5px,var(--tileB) 5px 10px)',
            }}
          >
            {/* The reader's own picture, or the initial of the name they gave
                — either is better than the word "photo", which is what stood
                here whether or not one had ever been set. */}
            {currentUser?.has_avatar ? (
              <img
                src={avatarUrl(currentUser.id, avatarVersion)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              (currentUser?.display_name?.trim()?.[0]?.toUpperCase() ?? '·')
            )}
          </div>
        </button>

        {!collapsed && (
          <div className="w-full min-w-0">
            <div className="truncate font-sans text-[13.5px] font-semibold tracking-[-0.005em] text-tx">
              {currentUser?.display_name ?? '…'}
            </div>
            <div className="mt-[3px] whitespace-nowrap font-mono text-[10px] text-tx3">
              {currentUser?.cefr_level ?? '—'} · {currentUser?.native_language ?? '—'} → {currentUser?.target_language ?? '—'}
            </div>
            {/* Two numbers, both true. There was a level, an XP bar and a
                sunlight balance here, and all three were constants written
                into this file — a level system that exists nowhere in the
                app, beside a streak that contradicted the real one in the
                header. What is left is what the app actually knows. */}
            <div className="mt-[13px] grid grid-cols-2 gap-[6px]">
              <div className="rounded-field border border-line2 px-[8px] py-[7px]">
                <div className="font-mono text-[12px] tracking-[-0.02em] text-tx">
                  {words === null ? '—' : words.toLocaleString()}
                </div>
                <div className="mt-[2px] font-mono text-[8.5px] uppercase tracking-[0.04em] text-tx3">
                  words
                </div>
              </div>
              <div className="rounded-field border border-line2 px-[8px] py-[7px]">
                <div className="font-mono text-[12px] tracking-[-0.02em] text-tx">
                  {streakDays === null ? '—' : streakDays}
                </div>
                <div className="mt-[2px] font-mono text-[8.5px] uppercase tracking-[0.04em] text-tx3">
                  day streak
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 pt-2">
        {NAV_GROUPS.map((g) => (
          <div key={g.label} className="mt-3">
            {!collapsed && (
              <div className="px-2 pb-[6px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                {g.label}
              </div>
            )}
            <div className="flex flex-col gap-[1px]">
              {g.items.map((item) => {
                const on =
                  screen === item.key ||
                  (item.key === 'library' && screen === 'player') ||
                  (item.key === 'bookshelf' && screen === 'reader') ||
                  (item.key === 'vocab' && screen === 'word') ||
                  (item.key === 'conv' && (screen === 'convlive' || screen === 'report'));
                // Only Review carries a count, and it is the real number of
                // cards the scheduler says are due — it used to be the string
                // '47', which was wrong for everyone including a new user with
                // no words saved at all.
                const badge = item.key === 'review' && dueNow > 0 ? String(dueNow) : null;
                return (
                  <button
                    key={item.key}
                    onClick={() => goScreen(item.key)}
                    title={collapsed ? item.label + (badge ? ` · ${badge} due` : '') : undefined}
                    className="relative flex items-center gap-[10px] rounded-field p-2 text-left hover:bg-line2"
                    style={{
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      background: on ? 'var(--accSoft)' : 'transparent',
                    }}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className="h-4 w-[22px] flex-none overflow-visible"
                      fill="none"
                      stroke={on ? 'var(--acc)' : 'var(--tx3)'}
                      strokeWidth={1.35}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={ICONS[item.key]} />
                    </svg>
                    {!collapsed && (
                      <span
                        className="flex-1 whitespace-nowrap text-[12.5px]"
                        style={{ color: on ? 'var(--acc)' : 'var(--tx2)', fontWeight: on ? 600 : 400 }}
                      >
                        {item.label}
                      </span>
                    )}
                    {badge && !collapsed && (
                      <span className="flex-none rounded-full bg-accSoft px-[6px] py-[2px] font-mono text-[9.5px] font-semibold text-acc">
                        {badge}
                      </span>
                    )}
                    {badge && collapsed && (
                      <span className="absolute right-[6px] top-[5px] h-[6px] w-[6px] rounded-full bg-acc" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1 border-t border-line2 p-[10px]">
        <button
          onClick={toggleNav}
          className="grid h-[26px] w-[26px] flex-none place-items-center rounded-field border border-line2 font-mono text-[11px] text-tx2 hover:bg-line2"
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>
    </nav>
  );
}
