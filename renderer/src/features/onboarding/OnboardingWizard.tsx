import { ONBOARDING_STEPS } from '@/features/onboarding/onboardingConfig';
import { StepProfile } from '@/features/onboarding/steps/StepProfile';
import { StepPlacement } from '@/features/onboarding/steps/StepPlacement';
import { StepEngine } from '@/features/onboarding/steps/StepEngine';
import { StepHabit } from '@/features/onboarding/steps/StepHabit';
import { StepCompanion } from '@/features/onboarding/steps/StepCompanion';
import { useOnboardingStore } from '@/store/onboardingStore';

const STEP_COMPONENTS = {
  1: StepProfile,
  2: StepPlacement,
  3: StepEngine,
  4: StepHabit,
  5: StepCompanion,
} as const;

export function OnboardingWizard() {
  const step = useOnboardingStore((s) => s.step);
  const setStep = useOnboardingStore((s) => s.setStep);
  const goBack = useOnboardingStore((s) => s.goBack);
  const goNext = useOnboardingStore((s) => s.goNext);
  const submission = useOnboardingStore((s) => s.submission);

  const current = ONBOARDING_STEPS[step - 1];
  const StepComponent = STEP_COMPONENTS[step];
  const nextLabel =
    submission.status === 'submitting'
      ? 'Saving…'
      : step === 5
        ? 'Finish → import media'
        : 'Continue';

  return (
    <div className="flex min-h-full justify-center p-[var(--pad)] pt-[12vh]">
      <div className="w-full max-w-[760px]">
        <div className="mb-[26px] flex gap-1">
          {ONBOARDING_STEPS.map((s) => {
            const on = s.n === step;
            const done = s.n < step;
            return (
              <button
                key={s.n}
                onClick={() => setStep(s.n)}
                className="flex-1 border-t-2 pt-[9px] text-left"
                style={{ borderColor: on ? 'var(--acc)' : done ? 'var(--accLine)' : 'var(--line2)' }}
              >
                <div className="font-mono text-[9.5px]" style={{ color: on ? 'var(--acc)' : 'var(--tx3)' }}>
                  Step {s.n}
                </div>
                <div className="mt-[2px] font-sans text-[11px]" style={{ color: on ? 'var(--tx)' : 'var(--tx3)' }}>
                  {s.name}
                </div>
              </button>
            );
          })}
        </div>

        <div className="font-sans text-[30px] font-light leading-[1.25] tracking-[-0.025em] text-tx">
          {current.title}
        </div>
        <div className="mt-[10px] max-w-[560px] font-sans text-[13.5px] leading-[1.7] text-tx2">{current.body}</div>

        <div className="mt-6">
          <StepComponent />
        </div>

        {submission.status === 'error' && (
          <div className="mt-4 rounded-field border border-accLine bg-accSoft px-3 py-2 font-mono text-[11px] text-tx">
            {submission.error}
          </div>
        )}

        <div className="mt-[26px] flex gap-2">
          <button
            onClick={goBack}
            disabled={step === 1}
            className="rounded-field border border-line px-4 py-[11px] font-sans text-[12px] font-medium text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
          >
            Back
          </button>
          <button
            onClick={goNext}
            disabled={submission.status === 'submitting'}
            className="rounded-field bg-acc px-5 py-[11px] font-sans text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
