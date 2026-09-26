import { useEffect } from 'react';
import { AppTitleBar } from '@/features/shell/AppTitleBar';
import { AppNav } from '@/features/shell/AppNav';
import { ScreenHeader } from '@/features/shell/ScreenHeader';
import { ComingSoon } from '@/features/shell/ComingSoon';
import { OnboardingWizard } from '@/features/onboarding/OnboardingWizard';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { Library } from '@/features/library/Library';
import { Player } from '@/features/player/Player';
import { Bookshelf } from '@/features/bookshelf/Bookshelf';
import { Reader } from '@/features/reader/Reader';
import { VocabularyList } from '@/features/vocabulary/VocabularyList';
import { VocabularyEntry } from '@/features/vocabulary/VocabularyEntry';
import { Review } from '@/features/review/Review';
import { ConversationList } from '@/features/conversation/ConversationList';
import { ConversationLive } from '@/features/conversation/ConversationLive';
import { LeaveConversationDialog } from '@/features/conversation/LeaveConversationDialog';
import { CloseDuringDownloadDialog } from '@/features/shell/CloseDuringDownloadDialog';
import { ErrorDialog } from '@/features/shell/ErrorDialog';
import { Report } from '@/features/conversation/Report';
import { Challenge } from '@/features/challenge/Challenge';
import { Forest } from '@/features/forest/Forest';
import { Settings } from '@/features/settings/Settings';
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
    case 'bookshelf':
      return <Bookshelf />;
    case 'reader':
      return <Reader />;
    case 'vocab':
      return <VocabularyList />;
    case 'word':
      return <VocabularyEntry />;
    case 'review':
      return <Review />;
    case 'conv':
      return <ConversationList />;
    case 'convlive':
      return <ConversationLive />;
    case 'report':
      return <Report />;
    case 'challenge':
      return <Challenge />;
    case 'forest':
      return <Forest />;
    case 'settings':
      return <Settings />;
    default:
      return <ComingSoon />;
  }
}

function MainApp() {
  const screen = useShellStore((s) => s.screen);
  // Player/Reader want the full content area with no scroll container of their own.
  const immersive = screen === 'player' || screen === 'reader' || screen === 'convlive';
  const contentClass = immersive ? 'flex min-h-0 flex-1' : 'min-h-0 flex-1 overflow-auto';

  return (
    <div className="flex min-h-0 flex-1">
      <AppNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <ScreenHeader />
        <div className={contentClass}>
          <ScreenContent />
        </div>
      </div>
      <LeaveConversationDialog />
      <CloseDuringDownloadDialog />
      <ErrorDialog />
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

  // Chromium does not remember the zoom factor across launches, so the stored
  // preference has to be re-applied each time or the setting silently resets.
  const uiScale = useShellStore((s) => s.uiScale);
  useEffect(() => {
    window.fluencyos?.setUiScale(uiScale);
  }, [uiScale]);

  const screenTitle = onboardingCompleted ? 'Dashboard' : 'Onboarding';

  return (
    <div className="flex h-screen flex-col bg-bg text-tx" style={{ fontFamily: 'var(--sans)' }}>
      <AppTitleBar screenTitle={screenTitle} />
      {initError && (
        <div className="grid flex-1 place-items-center p-6">
          <div className="max-w-[420px] text-center">
            <div className="font-sans text-[15px] font-semibold text-tx">FluencyOS couldn’t start</div>
            <p className="mt-[8px] font-sans text-[12.5px] leading-[1.7] text-tx2">{initError}</p>
          </div>
        </div>
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
