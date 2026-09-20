import { Pill, Row, Section, Slider, Toggle } from '@/features/settings/controls';
import { useSettingsStore } from '@/store/settingsStore';

/** Review scheduling and the daily targets.
 *
 * Every number here changes how much work tomorrow holds, which is the one
 * thing about a spaced-repetition app people most want control over and are
 * least often given. Each says what raising it costs.
 */
export function StudyPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  if (!settings) return null;

  const retention = Math.round(settings.target_retention * 100);

  return (
    <>
      <Section
        title="Review scheduling"
        note="FluencyOS works out when each word should come back to you. These two set how hard it pushes."
      >
        <Row
          label="Target retention"
          sub={
            <>
              How much you want to remember at the moment of review. {retention}% means roughly{' '}
              {retention} of every 100 cards should come back to you.{' '}
              <span className="text-tx2">Higher is not better — it buys recall with reviews.</span>
            </>
          }
          stacked
          control={
            <Slider
              label="Target retention"
              value={settings.target_retention}
              min={0.7}
              max={0.97}
              step={0.01}
              onCommit={(v) => void update({ target_retention: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          }
        />
        <Row
          label="New words per day"
          sub="The cap on unseen cards entering the queue. Every new word today is several reviews across the next month, so this is the dial that really sets the workload."
          stacked
          control={
            <Slider
              label="New words per day"
              value={settings.new_cards_per_day}
              min={0}
              max={60}
              step={5}
              onCommit={(v) => void update({ new_cards_per_day: v })}
              format={(v) => (v === 0 ? 'paused' : `${v} / day`)}
            />
          }
        />
      </Section>

      <Section title="Daily reading goal" note="What the reading streak counts against.">
        <Row
          label="Pages a day"
          stacked
          sub="A page is one screen of a book, not a paper page — a phone-sized screen and a maximised window count the same."
          control={
            <Slider
              label="Pages a day"
              value={settings.daily_page_goal}
              min={0}
              max={100}
              step={5}
              onCommit={(v) => void update({ daily_page_goal: v })}
              format={(v) => (v === 0 ? 'off' : `${v} pages`)}
            />
          }
        />
      </Section>

      <Section
        title="Reminders"
        note="Local notifications from this machine. Nothing is scheduled anywhere else, so they only arrive while the app is running."
      >
        <Row
          label="Notifications"
          sub="a nudge when reviews are due"
          control={
            <Toggle
              label="Notifications"
              checked={settings.notifications_enabled}
              onChange={(v) => void update({ notifications_enabled: v })}
            />
          }
        />
        <Row
          label="Quiet hours"
          sub="no notifications between these times"
          control={
            <div className="flex items-center gap-[7px]">
              <TimeField
                label="Quiet hours start"
                value={settings.quiet_hours_start}
                disabled={!settings.notifications_enabled}
                onChange={(v) => void update({ quiet_hours_start: v })}
              />
              <span className="font-mono text-[10px] text-tx3">→</span>
              <TimeField
                label="Quiet hours end"
                value={settings.quiet_hours_end}
                disabled={!settings.notifications_enabled}
                onChange={(v) => void update({ quiet_hours_end: v })}
              />
            </div>
          }
        />
      </Section>

      <Section
        title="Queue shape"
        note="Not configurable yet. Stated rather than hidden, because how the queue is built changes what a review session feels like."
      >
        <Row
          label="Card types"
          sub="Four kinds of question — what a word means, how to say it, filling it into a gap, and hearing it — mixed together rather than grouped, so two cards in a row are rarely the same kind."
          control={<Pill>all four</Pill>}
        />
        <Row
          label="Leeches"
          sub="A card lapsed enough times is a card the wording is wrong for, not a card you need more of. Reworking them is not built yet."
          control={<Pill>not built</Pill>}
        />
      </Section>
    </>
  );
}

function TimeField({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="rounded-field border border-line2 bg-panel2 px-[8px] py-[4px] font-mono text-[10.5px] text-tx disabled:opacity-40"
    />
  );
}
