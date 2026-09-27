import type { ReactNode } from 'react';
import { useOnboardingStore } from '@/store/onboardingStore';

const NEW_WORDS = [5, 10, 15, 20, 30];
const PAGES = [5, 10, 20, 30, 50];

/** What each new-words setting means for a day, in the learner's terms. */
const NEW_WORDS_NOTE: Record<number, string> = {
  5: 'A gentle start — reviews stay to a few minutes a day.',
  10: 'A steady pace for a busy week.',
  15: 'The usual pace: new words every day, reviews that stay manageable.',
  20: 'Faster progress, and noticeably more reviewing a few weeks in.',
  30: 'Intensive. Expect a long review session every day once it builds up.',
};

function Choices({ value, options, onChange, unit }: { value: number; options: number[]; onChange: (v: number) => void; unit: string }) {
  return (
    <div className="flex flex-wrap gap-[5px]" role="radiogroup">
      {options.map((n) => {
        const on = n === value;
        return (
          <button
            key={n}
            role="radio"
            aria-checked={on}
            aria-label={`${n} ${unit}`}
            onClick={() => onChange(n)}
            className="min-w-[40px] rounded-field border px-[10px] py-[6px] font-mono text-[11px]"
            style={{
              borderColor: on ? 'var(--accLine)' : 'var(--line2)',
              background: on ? 'var(--accSoft)' : 'transparent',
              color: on ? 'var(--acc)' : 'var(--tx2)',
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line2 bg-panel px-[14px] py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-sans text-[12.5px] font-medium text-tx">{title}</div>
        {children}
      </div>
      <div className="mt-[6px] font-sans text-[11.5px] leading-[1.55] text-tx3">{sub}</div>
    </div>
  );
}

/** The daily targets the app actually runs on: the review workload, the
 * reading streak, and a reminder when words are due. The same three settings
 * as Settings → Study. */
export function StepHabit() {
  const habit = useOnboardingStore((s) => s.habit);
  const updateHabit = useOnboardingStore((s) => s.updateHabit);

  return (
    <div className="flex max-w-[560px] flex-col gap-[11px]">
      <Card
        title="New words a day"
        sub={
          <>
            How many words you have saved but not yet studied join your reviews each day.{' '}
            {NEW_WORDS_NOTE[habit.newCardsPerDay] ?? ''} Each new word comes back several times over the next month,
            so this is what sets your daily review time.
          </>
        }
      >
        <Choices
          value={habit.newCardsPerDay}
          options={NEW_WORDS}
          unit="new words a day"
          onChange={(v) => updateHabit({ newCardsPerDay: v })}
        />
      </Card>

      <Card
        title="Pages a day"
        sub="Your reading goal. Each day you reach it adds to your reading streak on the bookshelf. A page is one screen of a book, whatever the window size."
      >
        <Choices
          value={habit.dailyPageGoal}
          options={PAGES}
          unit="pages a day"
          onChange={(v) => updateHabit({ dailyPageGoal: v })}
        />
      </Card>

      <div className="rounded-panel border border-line2 bg-panel px-[14px] py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="font-sans text-[12.5px] font-medium text-tx">Review reminder</div>
          <button
            role="switch"
            aria-checked={habit.notificationsEnabled}
            aria-label="Review reminder"
            onClick={() => updateHabit({ notificationsEnabled: !habit.notificationsEnabled })}
            className="relative h-[20px] w-[34px] flex-none rounded-full border transition-colors"
            style={{
              borderColor: habit.notificationsEnabled ? 'var(--accLine)' : 'var(--line)',
              background: habit.notificationsEnabled ? 'var(--accSoft)' : 'transparent',
            }}
          >
            <span
              className="absolute top-[3px] h-[12px] w-[12px] rounded-full transition-all"
              style={{
                left: habit.notificationsEnabled ? 17 : 3,
                background: habit.notificationsEnabled ? 'var(--acc)' : 'var(--tx3)',
              }}
            />
          </button>
        </div>
        <div className="mt-[6px] font-sans text-[11.5px] leading-[1.55] text-tx3">
          A desktop notification when words are due for review, while FluencyOS is open — minimised is fine. At most
          one every three hours, and never while you are already in the app.
        </div>
        {habit.notificationsEnabled && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line2 pt-3">
            <div>
              <div className="font-sans text-[12px] text-tx2">Quiet hours</div>
              <div className="font-mono text-[10px] text-tx3">no reminders in this window</div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <input
                type="time"
                aria-label="Quiet hours start"
                value={habit.quietHoursStart}
                onChange={(e) => updateHabit({ quietHoursStart: e.target.value })}
                className="rounded-field border border-line2 bg-panel2 px-2 py-1 text-tx"
              />
              <span className="text-tx3">–</span>
              <input
                type="time"
                aria-label="Quiet hours end"
                value={habit.quietHoursEnd}
                onChange={(e) => updateHabit({ quietHoursEnd: e.target.value })}
                className="rounded-field border border-line2 bg-panel2 px-2 py-1 text-tx"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
