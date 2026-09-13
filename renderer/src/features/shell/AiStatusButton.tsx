import { useEffect } from 'react';
import { useAppStore } from '@/store/appStore';
import { useEngineStore } from '@/store/engineStore';
import { useShellStore } from '@/store/shellStore';

const GREEN = '#3f9d5c';
const RED = '#c0563f';
const AMBER = '#d9a441';

/** The app-wide AI indicator: whether the engine that answers is actually
 * usable right now, and the one click that makes it so. Lives in the header
 * because it applies to every screen, not just Conversation. */
export function AiStatusButton() {
  const currentUser = useAppStore((s) => s.currentUser);
  const screen = useShellStore((s) => s.screen);
  const goSettings = useShellStore((s) => s.goSettings);

  const readiness = useEngineStore((s) => s.readiness.text);
  const fetchReadiness = useEngineStore((s) => s.fetchReadiness);
  const status = useEngineStore((s) => s.status);
  const fetchStatus = useEngineStore((s) => s.fetchStatus);
  const llmProvider = useEngineStore((s) => s.llmProvider);
  const fetchLlmProvider = useEngineStore((s) => s.fetchLlmProvider);
  const launching = useEngineStore((s) => s.launching);
  const launchError = useEngineStore((s) => s.launchError);
  const launchAi = useEngineStore((s) => s.launchAi);

  // Re-checked on every screen change (cheap local GETs) so this reflects
  // whatever was just picked, downloaded or launched in Settings without
  // needing a reload.
  useEffect(() => {
    if (!currentUser) return;
    void fetchReadiness('text');
    void fetchStatus();
    void fetchLlmProvider();
  }, [currentUser, fetchReadiness, fetchStatus, fetchLlmProvider, screen]);

  const runsLocally = llmProvider === null || llmProvider.provider === 'local';
  // For local this means the model file is on disk; for cloud, that an API key
  // is saved. Neither is the same as the engine being usable — see `ready`.
  const configured = readiness?.llm ?? false;
  // Local: actually resident in memory. Cloud: a real request has actually
  // succeeded — a saved key that's revoked or out of quota is not ready.
  const ready = status?.llm === 'ready';
  const engineLabel = readiness?.llm_model_label ?? '—';

  const colour = ready ? GREEN : launching ? AMBER : RED;
  const label = !configured
    ? runsLocally
      ? 'AI · not set up'
      : 'AI · no key'
    : launching
      ? 'AI · starting…'
      : ready
        ? `AI · ${runsLocally ? 'local' : 'cloud'}`
        : 'AI · off';

  const title = !configured
    ? runsLocally
      ? 'No AI model downloaded yet — click to go to Settings'
      : 'No API key saved for your cloud provider — click to go to Settings'
    : launching
      ? runsLocally
        ? 'Loading the model into memory…'
        : 'Checking your API key with a real request…'
      : ready
        ? runsLocally
          ? `${engineLabel} — loaded and running on this device`
          : `${engineLabel} — key checked and answering; requests leave this device`
        : runsLocally
          ? 'AI is not loaded — click to start it'
          : 'Cloud AI is unverified or last request failed — click to check the key';

  const handleClick = () => {
    if (!configured) {
      goSettings('AI');
      return;
    }
    if (ready || launching) return;
    void launchAi().catch(() => {});
  };

  return (
    <button
      onClick={handleClick}
      disabled={launching}
      title={launchError ? `${title} · last attempt failed: ${launchError}` : title}
      className="flex flex-none items-center gap-[6px] rounded-field border px-[10px] py-[5px] font-mono text-[10.5px] font-medium disabled:cursor-default"
      style={{ borderColor: ready ? colour : 'var(--line2)', color: ready ? colour : 'var(--tx2)' }}
    >
      <span
        className="h-[7px] w-[7px] flex-none rounded-full"
        style={{ background: colour, boxShadow: ready ? `0 0 6px ${GREEN}` : undefined }}
      />
      {label}
    </button>
  );
}
