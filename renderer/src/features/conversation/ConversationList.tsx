import { useEffect, useState } from 'react';
import { CONV_SCENARIOS } from '@/features/conversation/conversationMockData';
import { useConversationStore } from '@/store/conversationStore';
import { useEngineStore } from '@/store/engineStore';
import { useShellStore } from '@/store/shellStore';
import type { ConversationSessionOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

const SCENARIO_LABEL: Record<string, string> = Object.fromEntries(CONV_SCENARIOS.map((s) => [s.key, s.n]));

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return 'in progress';
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
}

export function ConversationList() {
  const goConvLive = useShellStore((s) => s.goConvLive);
  const goReport = useShellStore((s) => s.goReport);
  const sessions = useConversationStore((s) => s.sessions);
  const sessionsStatus = useConversationStore((s) => s.sessionsStatus);
  const fetchSessions = useConversationStore((s) => s.fetchSessions);
  const startSession = useConversationStore((s) => s.startSession);
  const fetchSessionDetail = useConversationStore((s) => s.fetchSessionDetail);
  const fetchReport = useConversationStore((s) => s.fetchReport);
  const deleteSession = useConversationStore((s) => s.deleteSession);
  const fetchEngineStatus = useConversationStore((s) => s.fetchEngineStatus);
  const engineStatus = useConversationStore((s) => s.engineStatus);
  // Every scenario below starts a voice session, so this screen must gate on
  // voice readiness specifically — text readiness always reports STT/TTS as
  // ready and would wave through a session that can't actually run.
  const readiness = useEngineStore((s) => s.readiness.voice);
  const fetchReadiness = useEngineStore((s) => s.fetchReadiness);
  const engineGlobalStatus = useEngineStore((s) => s.status);
  const fetchEngineGlobalStatus = useEngineStore((s) => s.fetchStatus);
  const llmProvider = useEngineStore((s) => s.llmProvider);
  const fetchLlmProvider = useEngineStore((s) => s.fetchLlmProvider);
  const aiLaunching = useEngineStore((s) => s.launching);
  const aiLaunchError = useEngineStore((s) => s.launchError);
  const launchAi = useEngineStore((s) => s.launchAi);
  const goSettings = useShellStore((s) => s.goSettings);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    void fetchSessions();
    void fetchReadiness('voice');
    void fetchEngineGlobalStatus();
    void fetchLlmProvider();
  }, [fetchSessions, fetchReadiness, fetchEngineGlobalStatus, fetchLlmProvider]);

  const notReady = readiness !== null && !readiness.ready;
  // A cloud provider has nothing to download for the LLM — what it's missing
  // is an API key, so "go download a model" would be the wrong instruction.
  const usingCloud = llmProvider !== null && llmProvider.provider !== 'local';
  // Every scenario here runs on the voice channel, so all three engines
  // (LLM/STT/TTS) need to be actually loaded, not just downloaded, before a
  // session can start — see backend's _ensure_launched.
  const aiLaunched =
    engineGlobalStatus !== null &&
    engineGlobalStatus.llm === 'ready' &&
    engineGlobalStatus.stt === 'ready' &&
    engineGlobalStatus.tts === 'ready';
  const needsLaunch = !notReady && !aiLaunched;

  // The local LLM/STT/TTS models load lazily on first real use and can take
  // a real while (a ~1GB GGUF, cold CPU inference) — poll while a session is
  // starting so "starting…" can become an honest "warming up the local
  // model…" instead of looking stuck.
  useEffect(() => {
    if (starting === null) return;
    void fetchEngineStatus();
    const id = setInterval(() => void fetchEngineStatus(), 1500);
    return () => clearInterval(id);
  }, [starting, fetchEngineStatus]);

  // Keeps this screen in sync if AI gets launched from elsewhere (the
  // AppNav button) while it's open, without the learner needing to reload.
  useEffect(() => {
    if (!needsLaunch) return;
    const id = setInterval(() => void fetchEngineGlobalStatus(), 2000);
    return () => clearInterval(id);
  }, [needsLaunch, fetchEngineGlobalStatus]);

  const handleStart = async (scenarioKey: (typeof CONV_SCENARIOS)[number]['key']) => {
    if (notReady || needsLaunch) return;
    setStartError(null);
    setStarting(scenarioKey);
    try {
      await startSession(scenarioKey, 'voice');
      goConvLive(SCENARIO_LABEL[scenarioKey]);
    } catch (err) {
      setStartError(friendlyMessage(err, 'Starting a conversation'));
    } finally {
      setStarting(null);
    }
  };

  const warmingUp = starting !== null && engineStatus && engineStatus.llm !== 'ready';

  const handleResume = async (session: ConversationSessionOut) => {
    await fetchSessionDetail(session.id);
    goConvLive(SCENARIO_LABEL[session.scenario] ?? session.scenario);
  };

  const handleReport = async (session: ConversationSessionOut) => {
    await fetchReport(session.id);
    goReport();
  };

  const handleDelete = async (session: ConversationSessionOut) => {
    setDeletingId(session.id);
    try {
      await deleteSession(session.id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1000px] px-[var(--pad)] pb-11 pt-[18px]">
        <div className="flex flex-wrap items-end gap-[18px] border-b border-line2 pb-[18px]">
          <div className="min-w-[260px] flex-1">
            <div className="font-sans text-[22px] font-semibold tracking-[-0.02em] text-tx">Conversations</div>
            <div className="mt-[6px] font-sans text-[11.5px] leading-[1.6] text-tx2">
              Practice with a real local AI partner — your saved vocabulary is injected as target words.
            </div>
          </div>
          <div className="min-w-[104px] rounded-field border border-line2 bg-panel px-3 py-[10px]">
            <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">sessions</div>
            <div className="mt-[5px] font-sans text-[15px] font-semibold text-tx">{sessions.length}</div>
          </div>
        </div>

        <div className="mt-5 rounded-panel border border-accLine bg-accSoft p-4">
          <div className="flex flex-wrap items-center gap-[14px]">
            <div className="min-w-[220px] flex-1">
              <div className="font-sans text-[13.5px] font-semibold text-tx">Start a new conversation</div>
              <div className="mt-1 font-sans text-[11px] leading-[1.6] text-tx2">
                {notReady
                  ? usingCloud && !readiness!.llm
                    ? 'Your cloud provider needs an API key before you can start.'
                    : "You'll need to download a model before you can start."
                  : needsLaunch
                    ? 'Models are downloaded, but the AI needs to be launched before a conversation can use it.'
                    : 'Runs a real local model — the first message may take a while to warm up.'}
              </div>
            </div>
          </div>

          {notReady ? (
            <div className="mt-[14px] flex flex-wrap items-center gap-[10px] border-t border-accLine pt-[13px]">
              <span className="font-mono text-[10.5px] leading-[1.6] text-tx2">
                Missing: {[
                  !readiness!.llm && (usingCloud ? 'a cloud API key' : 'AI model'),
                  !readiness!.stt && 'speech-to-text',
                  !readiness!.tts && 'text-to-speech',
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
              <button
                onClick={() => goSettings('AI')}
                className="rounded-field bg-acc px-[13px] py-[7px] font-sans text-[11px] font-semibold text-white hover:brightness-110"
              >
                Go to Settings
              </button>
            </div>
          ) : needsLaunch ? (
            <div className="mt-[14px] flex flex-wrap items-center gap-[10px] border-t border-accLine pt-[13px]">
              <span className="font-mono text-[10.5px] leading-[1.6] text-tx2">
                AI isn't launched yet — it needs to be loaded into memory first.
              </span>
              <button
                onClick={() => void launchAi().catch(() => {})}
                disabled={aiLaunching}
                className="rounded-field bg-acc px-[13px] py-[7px] font-sans text-[11px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
              >
                {aiLaunching ? 'launching…' : 'Launch AI'}
              </button>
              {aiLaunchError && <span className="font-mono text-[10px] text-[#c0563f]">{aiLaunchError}</span>}
            </div>
          ) : (
            <div className="mt-[14px] flex flex-wrap gap-[6px] border-t border-accLine pt-[13px]">
              {CONV_SCENARIOS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => void handleStart(c.key)}
                  disabled={starting !== null}
                  className="flex items-center gap-[7px] rounded-full border border-line2 bg-panel px-3 py-[7px] font-sans text-[11px] font-medium text-tx2 hover:border-acc disabled:opacity-50"
                >
                  {starting === c.key ? (warmingUp ? 'warming up the local model…' : 'starting…') : c.n}
                  <span className="font-mono text-[9.5px] text-tx3">{c.k}</span>
                </button>
              ))}
            </div>
          )}
          {startError && <div className="mt-3 font-mono text-[10.5px] text-[#c0563f]">{startError}</div>}
        </div>

        <div className="mb-[10px] mt-6 flex items-center justify-between gap-[10px]">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Previous sessions · {sessions.length}
          </span>
          <span className="font-mono text-[9.5px] text-tx3">transcripts kept locally</span>
        </div>

        {sessionsStatus === 'loading' && <div className="font-mono text-[11px] text-tx3">loading…</div>}
        {sessionsStatus === 'idle' && sessions.length === 0 && (
          <div className="font-sans text-[12px] leading-[1.6] text-tx2">
            No conversations yet — start one above.
          </div>
        )}
        <div className="flex flex-col gap-[9px]">
          {sessions.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-[14px] rounded-field border border-line2 bg-panel px-[15px] py-[13px]"
            >
              <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-field bg-tile font-mono text-[9px] text-tx3">
                {c.scenario}
              </span>
              <span className="min-w-[180px] flex-1">
                <span className="block font-sans text-[13px] font-semibold text-tx">
                  {SCENARIO_LABEL[c.scenario] ?? c.scenario}
                </span>
                <span className="mt-1 block font-mono text-[10px] text-tx3">
                  {new Date(c.started_at).toLocaleDateString()} · {formatDuration(c.started_at, c.ended_at)}
                </span>
                {/* Resuming keeps the engine it started on, so name it here
                    rather than letting the global indicator imply otherwise. */}
                <span className="mt-[3px] block truncate font-mono text-[9.5px] text-tx3" title={c.engine_label}>
                  {c.engine_provider === 'local' ? 'local' : 'cloud'} · {c.engine_label}
                </span>
              </span>
              <span className="min-w-[96px] flex-none">
                <span className="block font-mono text-[9px] uppercase tracking-[0.1em] text-tx3">target words</span>
                <span className="mt-[5px] block font-mono text-[10px] font-medium text-tx2">
                  {c.target_words.filter((w) => w.used_outcome === 'spontaneous' || w.used_outcome === 'prompted').length}/
                  {c.target_words.length} used
                </span>
              </span>
              <span className="flex flex-none gap-[6px]">
                {c.has_report && (
                  <button
                    onClick={() => void handleReport(c)}
                    className="rounded-field border border-line px-[11px] py-[7px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
                  >
                    report
                  </button>
                )}
                <button
                  onClick={() => void handleResume(c)}
                  className="rounded-field border border-accLine bg-accSoft px-3 py-[7px] font-mono text-[10.5px] font-medium text-acc"
                >
                  resume
                </button>
                <button
                  onClick={() => void handleDelete(c)}
                  disabled={deletingId === c.id}
                  title="Delete this conversation"
                  className="rounded-field border border-line px-[9px] py-[7px] font-mono text-[10.5px] font-medium text-tx3 hover:border-[#c0563f] hover:text-[#c0563f] disabled:opacity-50"
                >
                  {deletingId === c.id ? '…' : '✕'}
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
