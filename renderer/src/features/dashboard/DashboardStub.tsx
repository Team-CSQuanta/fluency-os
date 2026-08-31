import { useAppStore } from '@/store/appStore';

export function DashboardStub() {
  const currentUser = useAppStore((s) => s.currentUser);

  return (
    <div className="flex h-full items-center justify-center p-[var(--pad)]">
      <div className="max-w-[520px] rounded-panel border border-line2 bg-panel p-6 text-center shadow-panel">
        <div className="font-sans text-[22px] font-light tracking-[-0.02em] text-tx">
          Welcome{currentUser ? `, ${currentUser.display_name}` : ''}
        </div>
        <div className="mt-3 font-sans text-[13px] leading-[1.7] text-tx2">
          Onboarding is complete. The import screen — bring in your first video or book — lands here in the next
          increment.
        </div>
      </div>
    </div>
  );
}
