import { useEffect } from 'react';
import { AppTitleBar } from '@/features/shell/AppTitleBar';
import { AppNav } from '@/features/shell/AppNav';
import { ScreenHeader } from '@/features/shell/ScreenHeader';
import { ComingSoon } from '@/features/shell/ComingSoon';
import { OnboardingWizard } from '@/features/onboarding/OnboardingWizard';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { Library } from '@/features/library/Library';
import { Player } from '@/features/player/Player';
import { useAppStore } from '@/store/appStore';
import { useShellStore } from '@/store/shellStore';

function ScreenContent() {
  const screen = useShellStore((s) => s.screen);
  switch (screen) {
    case 'dashboard':
      return <Dashboard />;
    case 'library':
      return <Library />;
    case 'player':
      return <Player />;
    default:
      return <ComingSoon />;
  }
}

function MainApp() {
  const screen = useShellStore((s) => s.screen);
  // Player wants the full content area with no scroll container of its own.
  const contentClass = screen === 'player' ? 'flex min-h-0 flex-1' : 'min-h-0 flex-1 overflow-auto';

  return (
    <div className="flex min-h-0 flex-1">
      <AppNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <ScreenHeader />
        <div className={contentClass}>
          <ScreenContent />
        </div>
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
