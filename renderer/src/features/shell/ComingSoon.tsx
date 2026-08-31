import { SCREEN_TITLES } from '@/features/shell/navConfig';
import { useShellStore } from '@/store/shellStore';

export function ComingSoon() {
  const screen = useShellStore((s) => s.screen);
  const [title] = SCREEN_TITLES[screen];

  return (
    <div className="flex h-full items-center justify-center p-[var(--pad)]">
      <div className="max-w-[420px] rounded-panel border border-dashed border-line px-6 py-8 text-center">
        <div className="font-sans text-[15px] font-semibold text-tx">{title}</div>
        <div className="mt-2 font-sans text-[12.5px] leading-[1.7] text-tx2">
          This screen isn't built yet — it's coming in a later increment.
        </div>
      </div>
    </div>
  );
}
