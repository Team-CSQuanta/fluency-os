import { useEffect } from 'react';
import { ICONS } from '@/features/shell/icons';
import { NAV_GROUPS } from '@/features/shell/navConfig';
import { useAppStore } from '@/store/appStore';
import { useEngineStore } from '@/store/engineStore';
import { useShellStore } from '@/store/shellStore';

// Mock profile stats — no gamification backend yet (spec §8, Foyez's ownership per §12).
const PROFILE_STATS = [
  { v: '1,847', n: 'words' },
  { v: '23', n: 'streak' },
  { v: '☀ 640', n: 'sunlight' },
];
const MOCK_LEVEL = 14;
const MOCK_XP = { current: 18240, next: 29300 };

export function AppNav() {
  const collapsed = useShellStore((s) => s.collapsed);
  const screen = useShellStore((s) => s.screen);
  const goScreen = useShellStore((s) => s.goScreen);
  const toggleNav = useShellStore((s) => s.toggleNav);
  const currentUser = useAppStore((s) => s.currentUser);
  const readiness = useEngineStore((s) => s.readiness);
  const fetchReadiness = useEngineStore((s) => s.fetchReadiness);
  const status = useEngineStore((s) => s.status);
  const launching = useEngineStore((s) => s.launching);
  const launchError = useEngineStore((s) => s.launchError);
  const fetchStatus = useEngineStore((s) => s.fetchStatus);
  const launchAi = useEngineStore((s) => s.launchAi);
  const goSettings = useShellStore((s) => s.goSettings);

  // Re-checked on every screen change (cheap GETs) so this reflects whatever
  // was just picked/downloaded/launched in Settings' AI panel without a
  // manual reload.
  useEffect(() => {
    if (currentUser) {
      void fetchReadiness('text');
      void fetchStatus();
    }
  }, [currentUser, fetchReadiness, fetchStatus, screen]);

  const downloaded = readiness?.llm ?? false;
  const launched = status?.llm === 'ready';

  const handleLaunchClick = () => {
    if (!downloaded) {
      goSettings('AI');
      return;
    }
    if (launched || launching) return;
    void launchAi().catch(() => {});
  };

  const navW = collapsed ? '62px' : '224px';
  const avatarSize = collapsed ? 34 : 48;
  const xpPct = Math.min(100, Math.round((MOCK_XP.current / MOCK_XP.next) * 100));

  return (
    <nav
      className="flex flex-none flex-col overflow-hidden border-r border-line2 bg-bg2 transition-[width] duration-150"
      style={{ width: navW }}
    >
      <div
        className="flex flex-col gap-[13px] border-b border-line2 px-[14px] pb-[18px] pt-4"
        style={{ alignItems: collapsed ? 'center' : 'flex-start' }}
      >
        <div className="relative flex-none">
          <div
            className="grid place-items-center rounded-full border border-line2 font-mono text-[7px] text-tx3"
            style={{
              width: avatarSize,
              height: avatarSize,
              background: 'repeating-linear-gradient(135deg,var(--tile) 0 5px,var(--tileB) 5px 10px)',
            }}
          >
            photo
          </div>
          <div className="absolute -bottom-[3px] -right-[3px] grid h-5 w-5 place-items-center rounded-full border-[1.5px] border-accLine bg-bg2 font-mono text-[9px] font-semibold text-acc">
            {MOCK_LEVEL}
          </div>
        </div>

        {!collapsed && (
          <div className="w-full min-w-0">
            <div className="truncate font-sans text-[13.5px] font-semibold tracking-[-0.005em] text-tx">
              {currentUser?.display_name ?? '…'}
            </div>
            <div className="mt-[3px] whitespace-nowrap font-mono text-[10px] text-tx3">
              {currentUser?.cefr_level ?? '—'} · {currentUser?.native_language ?? '—'} → {currentUser?.target_language ?? '—'}
            </div>
            <div className="mb-[5px] mt-[11px] flex items-center justify-between font-mono text-[9.5px] font-medium text-tx3">
              <span>Level {MOCK_LEVEL}</span>
              <span>
                {MOCK_XP.current.toLocaleString()} / {MOCK_XP.next.toLocaleString()} XP
              </span>
            </div>
            <div className="h-1 rounded-field bg-line2">
              <div className="h-1 rounded-field bg-acc" style={{ width: `${xpPct}%` }} />
            </div>
            <div className="mt-[13px] grid grid-cols-3 gap-[6px]">
              {PROFILE_STATS.map((s) => (
                <div key={s.n} className="rounded-field border border-line2 px-[6px] py-[7px]">
                  <div className="font-mono text-[12px] tracking-[-0.02em] text-tx">{s.v}</div>
                  <div className="mt-[2px] font-mono text-[8.5px] uppercase tracking-[0.04em] text-tx3">{s.n}</div>
                </div>
              ))}
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
                return (
                  <button
                    key={item.key}
                    onClick={() => goScreen(item.key)}
                    title={collapsed ? item.label + (item.badge ? ` · ${item.badge} due` : '') : undefined}
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
                    {item.badge && !collapsed && (
                      <span className="flex-none rounded-full bg-accSoft px-[6px] py-[2px] font-mono text-[9.5px] font-semibold text-acc">
                        {item.badge}
                      </span>
                    )}
                    {item.badge && collapsed && (
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
        <div className="flex items-center gap-2">
          <button
            onClick={toggleNav}
            className="grid h-[26px] w-[26px] flex-none place-items-center rounded-field border border-line2 font-mono text-[11px] text-tx2 hover:bg-line2"
          >
            {collapsed ? '»' : '«'}
          </button>
          {!collapsed && (
            <button
              onClick={handleLaunchClick}
              disabled={launching}
              title={
                !downloaded
                  ? 'No AI model downloaded yet — click to go to Settings'
                  : launched
                    ? `local · ${readiness?.llm_model_label} — AI is launched and ready`
                    : launching
                      ? 'Launching AI — loading the local model into memory…'
                      : 'AI isn’t launched yet — click to launch it'
              }
              className="flex min-w-0 flex-1 items-center gap-[6px] overflow-hidden whitespace-nowrap rounded-field px-1 py-1 text-left font-mono text-[9.5px] text-tx3 hover:bg-line2 disabled:cursor-default"
            >
              <span
                className="h-[6px] w-[6px] flex-none rounded-full"
                style={{ background: launched ? 'var(--acc)' : launching ? '#d9a441' : downloaded ? '#c0563f' : 'var(--tx3)' }}
              />
              <span className="truncate">
                {!downloaded
                  ? 'local · not yet configured'
                  : launching
                    ? 'launching AI…'
                    : launched
                      ? `local · ${readiness?.llm_model_label}`
                      : 'AI not launched · tap to launch'}
              </span>
            </button>
          )}
        </div>
        {!collapsed && launchError && (
          <div className="font-mono text-[9px] leading-[1.5] text-[#c0563f]">{launchError}</div>
        )}
      </div>
    </nav>
  );
}
