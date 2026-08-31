import { DAILY_GOAL_ITEMS } from '@/features/onboarding/onboardingConfig';
import { useOnboardingStore } from '@/store/onboardingStore';

export function StepHabit() {
  const habit = useOnboardingStore((s) => s.habit);
  const updateHabit = useOnboardingStore((s) => s.updateHabit);

  const toggleGoal = (key: (typeof DAILY_GOAL_ITEMS)[number]['key']) => {
    const current = habit.dailyGoal[key];
    updateHabit({ dailyGoal: { ...habit.dailyGoal, [key]: { ...current, enabled: !current.enabled } } });
  };

  const setTarget = (key: (typeof DAILY_GOAL_ITEMS)[number]['key'], target: number) => {
    const current = habit.dailyGoal[key];
    updateHabit({ dailyGoal: { ...habit.dailyGoal, [key]: { ...current, target } } });
  };

  const enabledCount = DAILY_GOAL_ITEMS.filter((item) => habit.dailyGoal[item.key].enabled).length;

  return (
    <div className="flex max-w-[560px] flex-col gap-[11px]">
      <div className="font-mono text-[10px] text-tx3">
        {enabledCount} goal{enabledCount === 1 ? '' : 's'} enabled — meeting any two counts as your daily goal
      </div>

      {DAILY_GOAL_ITEMS.map((item) => {
        const goal = habit.dailyGoal[item.key];
        return (
          <div
            key={item.key}
            className="flex items-center justify-between gap-4 rounded-panel border px-[14px] py-3"
            style={{
              borderColor: goal.enabled ? 'var(--accLine)' : 'var(--line2)',
              background: goal.enabled ? 'var(--accSoft)' : 'var(--panel)',
            }}
          >
            <button onClick={() => toggleGoal(item.key)} className="min-w-0 flex-1 text-left">
              <div className="font-sans text-[12.5px] font-medium text-tx">{item.title}</div>
              <div className="mt-[2px] font-mono text-[10px] text-tx3">{item.sub}</div>
            </button>

            <div className="flex flex-none items-center gap-2">
              {goal.enabled && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    value={goal.target}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v)) setTarget(item.key, Math.min(item.max, Math.max(item.min, v)));
                    }}
                    className="w-16 rounded-field border border-line2 bg-panel2 px-2 py-[6px] text-right font-mono text-[11px] text-acc outline-none focus:border-acc"
                  />
                  <span className="font-mono text-[10px] text-tx3">{item.unit}</span>
                </div>
              )}
              <button
                onClick={() => toggleGoal(item.key)}
                className="font-mono text-[11px]"
                style={{ color: goal.enabled ? 'var(--acc)' : 'var(--tx3)' }}
              >
                {goal.enabled ? 'on' : 'off'}
              </button>
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-4 rounded-panel border border-line2 bg-panel px-[14px] py-3">
        <div>
          <div className="font-sans text-[12.5px] font-medium text-tx">Quiet hours</div>
          <div className="mt-[2px] font-mono text-[10px] text-tx3">no notifications in this window</div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-acc">
          <input
            type="time"
            value={habit.quietHoursStart}
            onChange={(e) => updateHabit({ quietHoursStart: e.target.value })}
            className="rounded-field border border-line2 bg-panel2 px-2 py-1 text-tx"
          />
          <span className="text-tx3">–</span>
          <input
            type="time"
            value={habit.quietHoursEnd}
            onChange={(e) => updateHabit({ quietHoursEnd: e.target.value })}
            className="rounded-field border border-line2 bg-panel2 px-2 py-1 text-tx"
          />
        </div>
      </div>
    </div>
  );
}
