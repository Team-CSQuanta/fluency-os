import { useEngineStore } from '@/store/engineStore';
import { useShellStore } from '@/store/shellStore';

/** Shown when something the learner just asked for needs the AI and the AI is
 * not running.
 *
 * It launches from here rather than only pointing at the header button. Being
 * told where a button is, closing a dialog, hunting for it and coming back is
 * four steps to reach one click that the dialog could have offered — and the
 * learner has already lost the thing they were doing.
 *
 * The two failures are genuinely different and are not merged:
 *
 *   nothing downloaded / no API key  -> there is nothing to launch; Settings
 *   downloaded but not in memory     -> one click, right here
 */
export function AiRequiredDialog({
  what,
  detail,
  onClose,
  onLaunched,
}: {
  /** What the learner was trying to do, in a few words. */
  what: string;
  /** The backend's own message, when it sent one worth repeating. */
  detail?: string | null;
  onClose: () => void;
  /** Fired once the engines report ready, so the caller can retry. */
  onLaunched?: () => void;
}) {
  const goSettings = useShellStore((s) => s.goSettings);
  const readiness = useEngineStore((s) => s.readiness.text);
  const launching = useEngineStore((s) => s.launching);
  const launchError = useEngineStore((s) => s.launchError);
  const launchAi = useEngineStore((s) => s.launchAi);
  const fetchStatus = useEngineStore((s) => s.fetchStatus);

  // Downloaded, or a key saved. Not the same as loaded — that is the point.
  const configured = readiness?.llm ?? false;
  const engineLabel = readiness?.llm_model_label ?? 'your AI model';

  const launch = async () => {
    await launchAi();
    await fetchStatus();
    if (useEngineStore.getState().status?.llm === 'ready') {
      onLaunched?.();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[440px] rounded-panel border border-line2 bg-panel p-[20px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="font-sans text-[15px] font-semibold text-tx">The AI isn’t running yet</div>
        <p className="mt-[8px] font-sans text-[12.5px] leading-[1.65] text-tx2">
          {what} needs the language model, and it isn’t loaded into memory right now.
          {configured
            ? ' It only takes one click — the model is already on this machine.'
            : ' There’s no model downloaded and no API key saved yet, so there’s nothing to start.'}
        </p>

        {detail && (
          <p className="mt-[9px] rounded-field border border-line2 bg-panel2 p-[9px] font-mono text-[10.5px] leading-[1.6] text-tx3">
            {detail}
          </p>
        )}

        {launchError && (
          <p className="mt-[9px] font-sans text-[11.5px] leading-[1.55] text-[#e06c6c]">{launchError}</p>
        )}

        <div className="mt-[16px] flex flex-wrap items-center gap-[10px]">
          {configured ? (
            <button
              onClick={() => void launch()}
              disabled={launching}
              className="rounded-field bg-accSolid px-[15px] py-[8px] font-sans text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
            >
              {launching ? 'starting the AI…' : `Launch ${engineLabel}`}
            </button>
          ) : (
            <button
              onClick={() => {
                goSettings();
                onClose();
              }}
              className="rounded-field bg-accSolid px-[15px] py-[8px] font-sans text-[12px] font-semibold text-white hover:brightness-110"
            >
              Open Settings
            </button>
          )}
          <button
            onClick={onClose}
            className="font-mono text-[11px] text-tx3 hover:text-acc hover:underline"
          >
            not now
          </button>
          <span className="ml-auto font-mono text-[9.5px] leading-[1.5] text-tx3">
            same as the AI button in the header
          </span>
        </div>
      </div>
    </div>
  );
}
