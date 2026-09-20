import { useEffect, useMemo, useState } from 'react';
import { AccountPanel } from '@/features/settings/AccountPanel';
import { ChallengePanel } from '@/features/settings/ChallengePanel';
import { ConversationPanel } from '@/features/settings/ConversationPanel';
import { ModelsPanel } from '@/features/settings/ModelsPanel';
import { PrivacyPanel } from '@/features/settings/PrivacyPanel';
import { ReadingPanel } from '@/features/settings/ReadingPanel';
import { Row, Section, Segmented } from '@/features/settings/controls';
import {
  SETTINGS_GROUPS,
  matchingGroups,
  type SettingsGroupName,
} from '@/features/settings/settingsGroups';
import { StudyPanel } from '@/features/settings/StudyPanel';
import { WatchingPanel } from '@/features/settings/WatchingPanel';
import { useSettingsStore } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';

/** Settings.
 *
 * Two things were wrong with the page this replaces. Its groups described the
 * app as it was imagined rather than as it is — a "Media" group and no
 * mention of conversation, reading, or the challenge — and almost every row
 * in it was a hard-coded value drawn to look like a control. A settings page
 * that reports the wrong microphone is worse than one that reports nothing.
 *
 * So: one group per thing the learner actually does, and every row either a
 * real control or plainly marked as a statement of fact.
 */
export function Settings() {
  const initialGroup = useShellStore((s) => s.settingsGroup);
  const [group, setGroup] = useState<SettingsGroupName>(initialGroup);
  const [query, setQuery] = useState('');

  const status = useSettingsStore((s) => s.status);
  const error = useSettingsStore((s) => s.error);
  const saving = useSettingsStore((s) => s.saving);
  const fetch = useSettingsStore((s) => s.fetch);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  // Deep links (the AI status button, the "launch AI" dialog) land on a group
  // directly, and must move the page even when it is already open.
  useEffect(() => setGroup(initialGroup), [initialGroup]);

  const visible = useMemo(() => matchingGroups(query), [query]);
  const def = SETTINGS_GROUPS[group];

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-[214px] flex-none flex-col border-r border-line2">
        <div className="p-[12px_10px_8px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search settings"
            aria-label="Search settings"
            className="w-full rounded-field border border-line2 bg-transparent px-[9px] py-[6px] font-mono text-[10.5px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[1px] overflow-y-auto px-[10px] pb-[12px]">
          {visible.map((g) => {
            const on = g === group;
            return (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className="rounded-field px-[10px] py-[7px] text-left transition-colors hover:bg-line2"
                style={{ background: on ? 'var(--accSoft)' : 'transparent' }}
              >
                <span
                  className="block font-sans text-[12.5px] font-medium"
                  style={{ color: on ? 'var(--acc)' : 'var(--tx2)' }}
                >
                  {g}
                </span>
                {/* The one-liner in the rail, not only in the header: which
                    group holds a given setting is the hard part of finding it. */}
                <span className="mt-[1px] block font-mono text-[9px] leading-[1.45] text-tx3">
                  {SETTINGS_GROUPS[g].sub}
                </span>
              </button>
            );
          })}

          {visible.length === 0 && (
            <p className="px-[10px] py-[8px] font-mono text-[10px] leading-[1.6] text-tx3">
              Nothing matches “{query}”. Try the feature's name — conversation, watching, reading.
            </p>
          )}
        </div>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-[var(--pad)]">
        <div className="max-w-[680px]">
          <header className="mb-[18px]">
            <div className="flex items-baseline gap-[10px]">
              <h2 className="font-sans text-[18px] font-semibold tracking-[-0.015em] text-tx">{group}</h2>
              {/* Controls move the moment they are pressed, so without this
                  there is no sign that anything was written down. */}
              {saving && <span className="font-mono text-[9.5px] text-tx3">saving…</span>}
            </div>
            <p className="mt-[4px] font-sans text-[12px] text-tx3">{def.sub}</p>
          </header>

          {error && (
            <div className="mb-[14px] rounded-panel border border-line2 bg-panel px-[14px] py-[10px] font-sans text-[11.5px] leading-[1.6] text-tx2">
              {error}
            </div>
          )}

          {/* Only the groups that read the settings row wait on it. The AI,
              player, reader and appearance panels have their own sources and
              would otherwise be held up by a request they do not need. */}
          {!SELF_CONTAINED.includes(group) && status !== 'ready' ? (
            status === 'error' ? null : (
              <p className="font-mono text-[10.5px] text-tx3">reading your settings…</p>
            )
          ) : (
            <Panel group={group} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Groups that read their own data and do not wait on the settings row. */
const SELF_CONTAINED: SettingsGroupName[] = ['AI', 'Account', 'Watching', 'Reading', 'Appearance'];

function Panel({ group }: { group: SettingsGroupName }) {
  switch (group) {
    case 'Account':
      return <AccountPanel />;
    case 'Study':
      return <StudyPanel />;
    case 'AI':
      return <ModelsPanel />;
    case 'Conversation':
      return <ConversationPanel />;
    case 'Watching':
      return <WatchingPanel />;
    case 'Reading':
      return <ReadingPanel />;
    case 'Challenge':
      return <ChallengePanel />;
    case 'Appearance':
      return <AppearancePanel />;
    case 'Privacy':
      return <PrivacyPanel />;
  }
}

/** Theme, and the size of everything.
 *
 * The app sizes several hundred elements in absolute px — over four hundred
 * of them at 11px or below — so no font change moves them together. Text size
 * here is Chromium's own zoom, which scales borders, spacing and images with
 * the type rather than leaving them behind.
 */
function AppearancePanel() {
  const theme = useShellStore((s) => s.theme);
  const toggleTheme = useShellStore((s) => s.toggleTheme);
  const uiScale = useShellStore((s) => s.uiScale);
  const setUiScale = useShellStore((s) => s.setUiScale);

  const STEPS = [
    { value: 0.9, label: 'compact' },
    { value: 1.0, label: 'default' },
    { value: 1.15, label: 'larger' },
    { value: 1.3, label: 'largest' },
  ];
  const nearest = STEPS.reduce((best, s) =>
    Math.abs(s.value - uiScale) < Math.abs(best.value - uiScale) ? s : best,
  ).value;

  return (
    <>
      <Section title="Theme">
        <Row
          label="Appearance"
          sub="Also tells the browser how to draw the parts we do not — dropdown lists, checkboxes, date pickers."
          control={
            <Segmented
              value={theme}
              options={[
                { value: 'dark', label: 'dark' },
                { value: 'light', label: 'light' },
              ]}
              onChange={(next) => next !== theme && toggleTheme()}
            />
          }
        />
      </Section>

      <Section
        title="Interface size"
        note="Applies immediately, to the whole interface. The reader's own text size is separate, under Reading."
      >
        <Row
          label="Text size"
          control={<Segmented value={nearest} options={STEPS} onChange={(v) => setUiScale(v)} />}
        />
        <div className="px-4 py-[13px]">
          <div className="font-sans text-[13px] leading-[1.7] text-tx">
            The quick brown fox jumps over the lazy dog.
          </div>
          <div className="mt-[5px] font-mono text-[10.5px] text-tx3">
            Illegible? Il1 O0 rn m — a sample at the size labels use.
          </div>
        </div>
      </Section>
    </>
  );
}
