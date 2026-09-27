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
  const unloadAi = useEngineStore((s) => s.unloadAi);

  // Re-checked on every screen change (cheap local GETs) so this reflects
  // whatever was just picked, downloaded or launched in Settings without
  // needing a reload.
  useEffect(() => {
    if (!currentUser) return;
    void fetchReadiness('text');
    void fetchStatus();
    void fetchLlmProvider();
  }, [currentUser, fetchReadiness, fetchStatus, fetchLlmProvider, screen]);

  // And every so often while the app is open: a cloud AI becomes "checked"
  // the moment any feature's request succeeds, and "off"/"failed" the moment
  // one is refused — neither of which is a screen change. A local GET.
  useEffect(() => {
    if (!currentUser) return;
    const id = window.setInterval(() => void fetchStatus().catch(() => {}), 15000);
    return () => window.clearInterval(id);
  }, [currentUser, fetchStatus]);

  const runsLocally = llmProvider === null || llmProvider.provider === 'local';
  // For local this means the model file is on disk; for cloud, that an API key
  // is saved. Neither is the same as the engine being usable — see `ready`.
  const configured = readiness?.llm ?? false;
  // Local: actually resident in memory. Cloud: a real request has actually
  // succeeded — a saved key that's revoked or out of quota is not ready.
  const ready = status?.llm === 'ready';
  // Switched off on purpose, as opposed to never checked.
  const cloudOff = !runsLocally && Boolean(status?.llm_off);
  const engineLabel = readiness?.llm_model_label ?? '—';

  // Anything actually occupying RAM right now. A cloud LLM holds none, but the
  // local speech models still do, so they stay worth freeing either way.
  const loadedInMemory =
    (runsLocally && status?.llm === 'ready') || status?.stt === 'ready' || status?.tts === 'ready';

  // On, with a key, but nothing has answered since the backend started —
  // not the same as off, and must not look like it: requests will be sent.
  const cloudUnchecked = !runsLocally && configured && !ready && !cloudOff;
  const colour = ready ? GREEN : launching || cloudUnchecked ? AMBER : RED;
  const label = !configured
    ? runsLocally
      ? 'AI · not set up'
      : 'AI · no key'
    : launching
      ? 'AI · starting…'
      : ready
        ? `AI · ${runsLocally ? 'local' : 'cloud'}`
        : cloudUnchecked
          ? 'AI · cloud (unchecked)'
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
          ? `${engineLabel} — loaded and running on this device. Click to unload and free the memory.`
          : `${engineLabel} — key checked and answering; requests leave this device. Click to switch it off.`
        : runsLocally
          ? 'AI is not loaded — click to start it'
          : cloudOff
            ? 'Cloud AI is switched off — nothing is sent. Click to turn it on.'
            : 'Cloud AI is on, but nothing has answered yet or the last request failed. AI features will still send requests. Click to check the key.';

  const handleClick = () => {
    if (!configured) {
      goSettings('AI');
      return;
    }
    if (launching) return;
    // Toggle: the button that loads the models is also the one that hands the
    // memory back, which on a machine short of RAM is worth having without
    // quitting the app. Reversible at the cost of another load, so no prompt.
    // For a cloud AI that is on, this is the off switch — and it frees the
    // local speech models along the way.
    if (loadedInMemory || (ready && !runsLocally)) {
      void unloadAi().catch(() => {});
      return;
    }
    if (ready) return;
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
