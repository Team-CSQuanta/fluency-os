import { COMPANIONS } from '@/features/onboarding/onboardingConfig';
import { useOnboardingStore } from '@/store/onboardingStore';

export function StepCompanion() {
  const companion = useOnboardingStore((s) => s.companion);
  const updateCompanion = useOnboardingStore((s) => s.updateCompanion);

  return (
    <div>
      <div className="grid grid-cols-4 gap-3">
        {COMPANIONS.map((c) => {
          const on = companion.species === c.key;
          return (
            <button
              key={c.key}
              onClick={() => updateCompanion({ species: c.key })}
              className="flex flex-col items-center gap-[11px] rounded-panel border px-[18px] py-[18px]"
              style={{ borderColor: on ? 'var(--accLine)' : 'var(--line2)', background: on ? 'var(--accSoft)' : 'var(--panel)' }}
            >
              <div className="grid h-14 w-14 place-items-center rounded-full border border-line2 bg-panel2 font-mono text-[8px] text-tx3">
                {c.key}
              </div>
              <span className="font-sans text-[12.5px] font-semibold" style={{ color: on ? 'var(--acc)' : 'var(--tx)' }}>
                {c.label}
              </span>
            </button>
          );
        })}
      </div>

    </div>
  );
}
