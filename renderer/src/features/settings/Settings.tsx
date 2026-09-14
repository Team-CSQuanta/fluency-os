import { useState } from 'react';
import { ModelsPanel } from '@/features/settings/ModelsPanel';
import { SETTINGS_GROUPS, SETTINGS_GROUP_ORDER, type SettingsGroupName } from '@/features/settings/settingsMockData';
import { useAppStore } from '@/store/appStore';
import { useShellStore } from '@/store/shellStore';

export function Settings() {
  const initialGroup = useShellStore((s) => s.settingsGroup);
  const [group, setGroup] = useState<SettingsGroupName>(initialGroup);
  const currentUser = useAppStore((s) => s.currentUser);
  const theme = useShellStore((s) => s.theme);

  const def = SETTINGS_GROUPS[group];
  const fields = def.fields.map((f) => {
    if (group === 'Account') {
      if (f.n === 'Display name') return { ...f, v: currentUser?.display_name ?? '—' };
      if (f.n === 'Native language') return { ...f, v: currentUser?.native_language ?? '—' };
      if (f.n === 'CEFR estimate') return { ...f, v: currentUser?.cefr_level ?? '—' };
    }
    if (group === 'Appearance' && f.n === 'Theme') return { ...f, v: theme };
    return f;
  });

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[206px] flex-none flex-col gap-[1px] overflow-y-auto border-r border-line2 p-[14px_10px]">
        {SETTINGS_GROUP_ORDER.map((g) => {
          const on = g === group;
          return (
            <button
              key={g}
              onClick={() => setGroup(g)}
              className="rounded-field px-[10px] py-2 text-left font-sans text-[12.5px] font-medium hover:bg-line2"
              style={{ background: on ? 'var(--accSoft)' : 'transparent', color: on ? 'var(--acc)' : 'var(--tx2)' }}
            >
              {g}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-[var(--pad)]">
        <div className="max-w-[660px]">
          <div className="font-sans text-[18px] font-semibold tracking-[-0.015em] text-tx">{group}</div>
          <div className="mt-[5px] font-sans text-[12px] text-tx3">{def.sub}</div>

          {group === 'AI' ? (
            <ModelsPanel />
          ) : (
            <>
            {group === 'Appearance' && <TextSizeControl />}
            <div className="mt-5 flex flex-col gap-[1px] overflow-hidden rounded-panel border border-line2 bg-panel">
              {fields.map((f) => (
                <div
                  key={f.n}
                  className="flex items-center justify-between gap-5 border-b border-line2 px-4 py-[14px] last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="font-sans text-[12.5px] font-medium text-tx">{f.n}</div>
                    {f.sub && <div className="mt-[3px] font-mono text-[10.5px] leading-[1.6] text-tx3">{f.sub}</div>}
                  </div>
                  <div className="flex-none rounded-field border border-line2 px-[11px] py-[6px] font-mono text-[11px] font-medium text-tx2">
                    {f.v}
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


/** Interface text size.
 *
 * The app sizes several hundred elements in absolute px — over four hundred
 * of them at 11px or below — so no font change moves them together. Switching
 * typeface buys about 6% of lowercase height (Inter's x-height is 0.546em
 * against Public Sans's 0.517); this buys as much as the reader wants, and
 * scales borders, spacing and images with the type rather than leaving them
 * behind.
 */
function TextSizeControl() {
  const uiScale = useShellStore((s) => s.uiScale);
  const setUiScale = useShellStore((s) => s.setUiScale);

  const STEPS: Array<{ factor: number; label: string }> = [
    { factor: 0.9, label: 'compact' },
    { factor: 1.0, label: 'default' },
    { factor: 1.15, label: 'larger' },
    { factor: 1.3, label: 'largest' },
  ];

  return (
    <div className="mt-5 overflow-hidden rounded-panel border border-line2 bg-panel">
      <div className="flex items-center justify-between gap-5 border-b border-line2 px-4 py-[14px]">
        <div className="min-w-0">
          <div className="font-sans text-[12.5px] font-medium text-tx">Text size</div>
          <div className="mt-[3px] font-mono text-[10.5px] leading-[1.6] text-tx3">
            scales the whole interface · applies immediately
          </div>
        </div>
        <div className="flex flex-none gap-[5px]">
          {STEPS.map((s) => {
            const on = Math.abs(uiScale - s.factor) < 0.01;
            return (
              <button
                key={s.factor}
                onClick={() => setUiScale(s.factor)}
                className="rounded-field border px-[10px] py-[6px] font-mono text-[11px] font-medium"
                style={{
                  borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                  background: on ? 'var(--accSoft)' : 'transparent',
                  color: on ? 'var(--acc)' : 'var(--tx2)',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="px-4 py-[13px]">
        <div className="font-sans text-[13px] leading-[1.7] text-tx">
          The quick brown fox jumps over the lazy dog.
        </div>
        <div className="mt-[5px] font-mono text-[10.5px] text-tx3">
          Illegible? Il1 O0 rn m — a sample at the size labels use.
        </div>
      </div>
    </div>
  );
}
