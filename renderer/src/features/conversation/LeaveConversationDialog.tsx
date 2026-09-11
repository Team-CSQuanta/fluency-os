import { useShellStore } from '@/store/shellStore';

/** Rendered at the app root — appears whenever navigation away from a live
 * conversation was deferred because a real operation (recording,
 * transcribing, waiting on the local LLM, or playing back a reply) was in
 * flight, so it isn't silently abandoned mid-turn. */
export function LeaveConversationDialog() {
  const pendingNav = useShellStore((s) => s.pendingNav);
  const confirmLeaveConv = useShellStore((s) => s.confirmLeaveConv);
  const cancelLeaveConv = useShellStore((s) => s.cancelLeaveConv);

  if (!pendingNav) return null;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/45 p-6" onClick={cancelLeaveConv}>
      <div
        className="w-full max-w-[400px] rounded-panel border border-line bg-panel p-5 shadow-[0_24px_60px_rgba(0,0,0,.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-sans text-[14px] font-semibold text-tx">Leave this conversation?</div>
        <div className="mt-2 font-sans text-[12px] leading-[1.6] text-tx2">
          Juno is still recording, transcribing, thinking, or speaking. Leaving now interrupts that — your messages
          so far stay saved, and you can resume this session later.
        </div>
        <div className="mt-4 flex justify-end gap-[8px]">
          <button
            onClick={cancelLeaveConv}
            className="rounded-field border border-line2 px-3 py-[7px] font-mono text-[11px] font-medium text-tx2 hover:border-acc hover:text-acc"
          >
            stay
          </button>
          <button
            onClick={confirmLeaveConv}
            className="rounded-field border border-[#c0563f] bg-[#c0563f]/10 px-3 py-[7px] font-mono text-[11px] font-medium text-[#c0563f] hover:bg-[#c0563f]/20"
          >
            leave anyway
          </button>
        </div>
      </div>
    </div>
  );
}
