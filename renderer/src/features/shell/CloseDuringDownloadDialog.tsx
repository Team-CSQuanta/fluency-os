import { useEffect, useState } from 'react';

/** Rendered at the app root. The main process defers a window close while a
 * model download is in flight and asks for this instead of a native message
 * box, so the warning looks like the rest of FluencyOS. */
export function CloseDuringDownloadDialog() {
  const [asking, setAsking] = useState(false);

  useEffect(() => window.fluencyos?.onConfirmClose(() => setAsking(true)), []);

  if (!asking) return null;

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/45 p-6" onClick={() => setAsking(false)}>
      <div
        className="w-full max-w-[420px] rounded-panel border border-line bg-panel p-5 shadow-[0_24px_60px_rgba(0,0,0,.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-sans text-[14px] font-semibold text-tx">A download is still running</div>
        <div className="mt-2 font-sans text-[12px] leading-[1.6] text-tx2">
          Closing now interrupts it. There's no partial-file resume yet, so the download starts again from the
          beginning next time.
        </div>
        <div className="mt-4 flex justify-end gap-[8px]">
          <button
            onClick={() => setAsking(false)}
            className="rounded-field border border-line2 px-3 py-[7px] font-mono text-[11px] font-medium text-tx2 hover:border-acc hover:text-acc"
          >
            keep downloading
          </button>
          <button
            onClick={() => window.fluencyos?.forceClose()}
            className="rounded-field border border-[#c0563f] bg-[#c0563f]/10 px-3 py-[7px] font-mono text-[11px] font-medium text-[#c0563f] hover:bg-[#c0563f]/20"
          >
            close anyway
          </button>
        </div>
      </div>
    </div>
  );
}
