import { useState } from 'react';
import { SETTINGS_GROUPS, SETTINGS_GROUP_ORDER, type SettingsGroupName } from '@/features/settings/settingsMockData';
import { useAppStore } from '@/store/appStore';
import { useShellStore } from '@/store/shellStore';

export function Settings() {
  const [group, setGroup] = useState<SettingsGroupName>('Media');
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
        </div>
      </div>
    </div>
  );
}
