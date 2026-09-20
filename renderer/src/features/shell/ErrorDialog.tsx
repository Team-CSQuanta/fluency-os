import { useEffect, useState } from 'react';
import { AiRequiredDialog } from '@/features/shell/AiRequiredDialog';
import { useErrorStore } from '@/store/errorStore';

/** The one window that says something went wrong.
 *
 * It says what did not happen, in the reader's own terms, and what they can
 * do next. The original message is kept behind "technical details" rather
 * than shown or thrown away: nobody needs it until something is properly
 * broken, and then it is the only thing that helps.
 *
 * A failure that turns out to be "the AI is not running" is handed to
 * AiRequiredDialog instead, which can start it — telling someone their AI is
 * off, in a box whose only button is OK, is worse than useless.
 */
export function ErrorDialog() {
  const current = useErrorStore((s) => s.current);
  const retry = useErrorStore((s) => s.retry);
  const dismiss = useErrorStore((s) => s.dismiss);
  const [showTechnical, setShowTechnical] = useState(false);

  useEffect(() => setShowTechnical(false), [current]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, dismiss]);

  if (!current) return null;

  if (current.needsAi) {
    return (
      <AiRequiredDialog
        what={current.doing}
        detail={current.body}
        onClose={dismiss}
        onLaunched={() => {
          const again = retry;
          dismiss();
          again?.();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-6" onClick={dismiss} role="presentation">
      <div
        className="w-full max-w-[440px] rounded-panel border border-line2 bg-panel p-[20px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-title"
      >
        <h2 id="error-title" className="font-sans text-[15px] font-semibold tracking-[-0.01em] text-tx">
          {current.title}
        </h2>
        <p className="mt-[8px] font-sans text-[12.5px] leading-[1.7] text-tx2">{current.body}</p>

        {current.technical && (
          <div className="mt-[14px] border-t border-line2 pt-[10px]">
            <button
              onClick={() => setShowTechnical((v) => !v)}
              className="font-mono text-[10px] text-tx3 hover:text-acc"
            >
              {showTechnical ? 'hide technical details' : 'technical details'}
            </button>
            {showTechnical && (
              <pre className="mt-[8px] max-h-[140px] overflow-auto whitespace-pre-wrap break-all rounded-field bg-panel2 p-[9px] font-mono text-[10px] leading-[1.55] text-tx3">
                {current.technical}
              </pre>
            )}
          </div>
        )}

        <div className="mt-[16px] flex items-center justify-end gap-[8px]">
          {retry && (
            <button
              onClick={() => {
                const again = retry;
                dismiss();
                again();
              }}
              className="rounded-field border border-line px-[13px] py-[7px] font-sans text-[11.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
            >
              Try again
            </button>
          )}
          <button
            onClick={dismiss}
            autoFocus
            className="rounded-field bg-accSolid px-[15px] py-[7px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
