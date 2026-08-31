import { useEffect } from 'react';
import { AppTitleBar } from '@/features/shell/AppTitleBar';
import { AppNav } from '@/features/shell/AppNav';
import { ScreenHeader } from '@/features/shell/ScreenHeader';
import { ComingSoon } from '@/features/shell/ComingSoon';
import { OnboardingWizard } from '@/features/onboarding/OnboardingWizard';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { useAppStore } from '@/store/appStore';
import { useShellStore } from '@/store/shellStore';

function MainApp() {
  const screen = useShellStore((s) => s.screen);

  return (
    <div className="flex min-h-0 flex-1">
      <AppNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <ScreenHeader />
        <div className="min-h-0 flex-1 overflow-auto">{screen === 'dashboard' ? <Dashboard /> : <ComingSoon />}</div>
      </div>
    </div>
  );
}

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
      {initError && (
        <div className="p-6 font-mono text-[12px] text-red-400">Failed to reach backend: {initError}</div>
      )}
      {!initError && !backendReady && (
        <div className="grid flex-1 place-items-center font-mono text-[12px] text-tx3">starting…</div>
      )}
      {!initError && backendReady && onboardingCompleted === false && (
        <div className="min-h-0 flex-1 overflow-auto">
          <OnboardingWizard />
        </div>
      )}
      {!initError && backendReady && onboardingCompleted === true && <MainApp />}
    </div>
  );
}
