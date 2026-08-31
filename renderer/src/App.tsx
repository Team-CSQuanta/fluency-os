import { useEffect } from 'react';
import { AppTitleBar } from '@/features/shell/AppTitleBar';
import { OnboardingWizard } from '@/features/onboarding/OnboardingWizard';
import { DashboardStub } from '@/features/dashboard/DashboardStub';
import { useAppStore } from '@/store/appStore';

export function App() {
  const initialize = useAppStore((s) => s.initialize);
  const backendReady = useAppStore((s) => s.backendReady);
  const onboardingCompleted = useAppStore((s) => s.onboardingCompleted);
  const initError = useAppStore((s) => s.initError);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const screenTitle = onboardingCompleted ? 'Dashboard' : 'Onboarding';

  return (
    <div className="flex h-screen flex-col bg-bg text-tx" style={{ fontFamily: 'var(--sans)' }}>
      <AppTitleBar screenTitle={screenTitle} />
      <div className="min-h-0 flex-1 overflow-auto">
        {initError && (
          <div className="p-6 font-mono text-[12px] text-red-400">Failed to reach backend: {initError}</div>
        )}
        {!initError && !backendReady && (
          <div className="grid h-full place-items-center font-mono text-[12px] text-tx3">starting…</div>
        )}
        {!initError && backendReady && onboardingCompleted === false && <OnboardingWizard />}
        {!initError && backendReady && onboardingCompleted === true && <DashboardStub />}
      </div>
    </div>
  );
}
