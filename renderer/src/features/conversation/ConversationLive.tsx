import { useEffect, useRef, useState } from 'react';
import { useMicRecorder } from '@/features/conversation/useMicRecorder';
import { useConversationStore } from '@/store/conversationStore';
import { useEngineStore } from '@/store/engineStore';
import { useShellStore } from '@/store/shellStore';

type MicState = 'idle' | 'recording' | 'thinking' | 'speaking';

const MIC_META: Record<MicState, { label: string; sub: string; bg: string; bd: string; fg: string; icon: string }> = {
  idle: { label: 'Ready', sub: 'tap to talk', bg: 'var(--panel)', bd: 'var(--line2)', fg: 'var(--tx2)', icon: '●' },
  recording: { label: 'Recording…', sub: 'tap to stop', bg: 'var(--accSoft)', bd: 'var(--acc)', fg: 'var(--acc)', icon: '■' },
  thinking: { label: 'Thinking…', sub: 'transcribing + generating a reply', bg: 'var(--panel)', bd: 'var(--line2)', fg: 'var(--tx2)', icon: '…' },
  speaking: { label: 'Juno is speaking', sub: 'playing the reply', bg: 'var(--tile)', bd: 'var(--line2)', fg: 'var(--tx)', icon: '▮▮' },
};

export function ConversationLive() {
  const scenario = useShellStore((s) => s.convScenario);
  const goScreen = useShellStore((s) => s.goScreen);
  const goReport = useShellStore((s) => s.goReport);
  const setConvBusy = useShellStore((s) => s.setConvBusy);

  const activeSession = useConversationStore((s) => s.activeSession);
  const activeStatus = useConversationStore((s) => s.activeStatus);
  const submitTextTurn = useConversationStore((s) => s.submitTextTurn);
  const submitAudioTurn = useConversationStore((s) => s.submitAudioTurn);
  const endSession = useConversationStore((s) => s.endSession);
  const turnAudioUrl = useConversationStore((s) => s.turnAudioUrl);

  const engineGlobalStatus = useEngineStore((s) => s.status);
  const fetchEngineGlobalStatus = useEngineStore((s) => s.fetchStatus);
  const aiLaunching = useEngineStore((s) => s.launching);
  const aiLaunchError = useEngineStore((s) => s.launchError);
  const launchAi = useEngineStore((s) => s.launchAi);

  const [micState, setMicState] = useState<MicState>('idle');
  const [textInput, setTextInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  // Shown immediately on submit, before the round trip (STT + LLM reply)
  // resolves — otherwise a typed message just sits invisible in the input's
  // cleared state until the AI's reply arrives alongside it, which reads as
  // the app ignoring the message rather than thinking about it.
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const recorder = useMicRecorder();
  const lastAutoPlayedTurnId = useRef<string | null>(null);
  // Only one reply should ever be audible at once — the direct-trigger call
  // in the submit handlers below and the mount/resume fallback effect can
  // otherwise both end up starting playback for close-together turns (and a
  // manual "▶ play" tap can land while an autoplay is still going), each
  // producing its own independent Audio object with nothing stopping the
  // others. Tracking the single currently-playing element and always
  // stopping it first makes overlap impossible regardless of which path
  // triggered it.
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const turns = activeSession?.turns ?? [];
  const isVoice = activeSession?.channel === 'voice';
  // Text-only turns don't need STT/TTS loaded, only the LLM — voice needs
  // all three, matching backend's _ensure_launched requirements.
  const aiLaunched =
    engineGlobalStatus !== null &&
    engineGlobalStatus.llm === 'ready' &&
    (!isVoice || (engineGlobalStatus.stt === 'ready' && engineGlobalStatus.tts === 'ready'));

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, pendingUserText]);

  useEffect(() => {
    void fetchEngineGlobalStatus();
  }, [fetchEngineGlobalStatus]);

  // Keeps this in sync if AI gets launched from elsewhere (AppNav, or the
  // sessions list) while this screen is already open.
  useEffect(() => {
    if (aiLaunched) return;
    const id = setInterval(() => void fetchEngineGlobalStatus(), 2000);
    return () => clearInterval(id);
  }, [aiLaunched, fetchEngineGlobalStatus]);

  // Tells the shell whether a real operation is in flight, so navigating
  // away (sidebar, "‹ sessions") gets gated behind a confirmation instead of
  // silently abandoning it — see LeaveConversationDialog. Deliberately
  // excludes `ending`: clicking "End & analyse" is itself the leave action,
  // so its own goReport() call shouldn't immediately re-prompt.
  useEffect(() => {
    setConvBusy(micState !== 'idle' || pendingUserText !== null);
  }, [micState, pendingUserText, setConvBusy]);

  // Leaving this screen (confirmed or otherwise) shouldn't leave the mic hot
  // or a reply still audibly playing in the background.
  useEffect(() => {
    return () => {
      setConvBusy(false);
      if (recorder.status === 'recording') void recorder.stop();
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const playTurnAudio = async (turnId: string) => {
    lastAutoPlayedTurnId.current = turnId; // dedupes against the effect below firing for the same turn
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current = null;
    }
    try {
      const url = await turnAudioUrl(turnId);
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      setMicState('speaking');
      audio.onended = () => {
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        setMicState('idle');
      };
      audio.onerror = () => {
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        setMicState('idle');
      };
      await audio.play();
    } catch {
      setMicState('idle');
    }
  };

  // Fallback path: covers turns that arrive without going through this
  // component's own submit handlers below (specifically the opening AI line
  // of a session that was JUST freshly started). The handlers call
  // playTurnAudio directly as the primary path for every other turn — that
  // keeps play() tied as closely as possible to the actual user gesture
  // (mic tap / send click), since routing it only through a state effect
  // several async hops away from the click risks Chromium's autoplay policy
  // silently dropping it.
  //
  // Resuming an existing session also runs through fetchSessionDetail and
  // lands here with turns already populated — that must NOT trigger
  // playback (it used to, and would loudly replay whatever the AI last said
  // the moment you opened an old conversation). `justStarted` distinguishes
  // the two: only startSession sets it, and consuming it here resets it
  // immediately so it can't leak into a later resume in the same app session.
  useEffect(() => {
    if (!isVoice) return;
    const lastAiTurn = [...turns].reverse().find((t) => t.speaker === 'ai');
    if (!lastAiTurn?.audio_url || lastAiTurn.id === lastAutoPlayedTurnId.current) return;

    const isFreshOpeningLine = turns.length === 1 && useConversationStore.getState().consumeJustStarted();
    if (isFreshOpeningLine) {
      void playTurnAudio(lastAiTurn.id);
    } else {
      // Not something to auto-play (a resumed session's existing history) —
      // still mark it "seen" so nothing tries to play it later either.
      lastAutoPlayedTurnId.current = lastAiTurn.id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length, isVoice]);

  const handleMicClick = async () => {
    setError(null);
    if (!aiLaunched) {
      setError('AI isn’t launched yet — use the Launch AI button below before talking.');
      return;
    }
    if (micState === 'idle') {
      await recorder.start();
      if (recorder.error) setError(recorder.error);
      else setMicState('recording');
      return;
    }
    if (micState === 'recording') {
      setMicState('thinking');
      const blob = await recorder.stop();
      if (!blob || !activeSession) {
        setMicState('idle');
        return;
      }
      setPendingUserText('🎤 …'); // real text isn't known until the backend transcribes it
      try {
        const { ai_turn } = await submitAudioTurn(activeSession.id, blob);
        setPendingUserText(null);
        if (isVoice && ai_turn.audio_url) {
          void playTurnAudio(ai_turn.id);
        } else {
          setMicState('idle');
        }
      } catch (err) {
        setPendingUserText(null);
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setMicState('idle');
      }
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = textInput.trim();
    if (!text || !activeSession) return;
    if (!aiLaunched) {
      setError('AI isn’t launched yet — use the Launch AI button below before sending.');
      return;
    }
    setTextInput('');
    setError(null);
    setPendingUserText(text);
    try {
      const { ai_turn } = await submitTextTurn(activeSession.id, text);
      setPendingUserText(null);
      if (isVoice && ai_turn.audio_url) {
        void playTurnAudio(ai_turn.id);
      }
    } catch (err) {
      setPendingUserText(null);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const handleEnd = async () => {
    if (!activeSession) return;
    setEnding(true);
    try {
      await endSession(activeSession.id);
      goReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end the session');
    } finally {
      setEnding(false);
    }
  };

  if (activeStatus === 'loading' || !activeSession) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[11px] text-tx3">
        {activeStatus === 'loading' ? 'loading…' : 'no active session'}
      </div>
    );
  }

  const meta = MIC_META[micState];

  return (
    <div className="flex h-full w-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none flex-wrap items-center gap-[10px] border-b border-line2 px-[var(--pad)] py-3">
          <button
            onClick={() => goScreen('conv')}
            className="flex items-center gap-[6px] rounded-field border border-line2 px-[9px] py-[5px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
          >
            ‹ sessions
          </button>
          <span className="rounded-field bg-panel2 px-[9px] py-1 font-mono text-[10.5px] font-medium text-tx2">{scenario}</span>
          <span className="rounded-field bg-panel2 px-[9px] py-1 font-mono text-[10.5px] font-medium text-tx2">
            {activeSession.channel}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => void handleEnd()}
            disabled={ending}
            className="rounded-field border border-line px-[11px] py-[6px] font-mono text-[11px] font-medium text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
          >
            {ending ? 'analysing…' : 'End & analyse'}
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-[14px] overflow-y-auto p-[var(--pad)]">
          {turns.map((t) => {
            const isAi = t.speaker === 'ai';
            return (
              <div
                key={t.id}
                className="flex max-w-[78%] gap-[11px]"
                style={{ flexDirection: isAi ? 'row' : 'row-reverse', alignSelf: isAi ? 'flex-start' : 'flex-end' }}
              >
                <div
                  className="grid h-7 w-7 flex-none place-items-center rounded-full font-mono text-[8px] font-semibold"
                  style={{
                    background: isAi ? 'var(--accSoft)' : 'var(--tile)',
                    color: isAi ? 'var(--acc)' : 'var(--tx3)',
                  }}
                >
                  {isAi ? 'fox' : 'you'}
                </div>
                <div>
                  <div
                    className="rounded-field border px-[14px] py-[11px] font-sans text-[13.5px] leading-[1.65]"
                    style={{
                      background: isAi ? 'var(--panel)' : 'var(--accSoft)',
                      borderColor: isAi ? 'var(--line2)' : 'var(--accLine)',
                      color: 'var(--tx)',
                    }}
                  >
                    {t.text || <span className="italic text-tx3">(no speech detected)</span>}
                  </div>
                  <div
                    className="mt-[5px] flex items-center gap-[8px] font-mono text-[9.5px] text-tx3"
                    style={{ justifyContent: isAi ? 'flex-start' : 'flex-end' }}
                  >
                    {isAi ? 'Juno' : t.stt_confidence !== null ? `confidence ${Math.round(t.stt_confidence * 100)}%` : ''}
                    {t.audio_url && (
                      <button onClick={() => void playTurnAudio(t.id)} className="hover:text-acc">
                        ▶ play
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {pendingUserText && (
            <div className="flex max-w-[78%] gap-[11px]" style={{ flexDirection: 'row-reverse', alignSelf: 'flex-end' }}>
              <div className="grid h-7 w-7 flex-none place-items-center rounded-full bg-tile font-mono text-[8px] font-semibold text-tx3">
                you
              </div>
              <div>
                <div
                  className="rounded-field border px-[14px] py-[11px] font-sans text-[13.5px] leading-[1.65] text-tx opacity-60"
                  style={{ background: 'var(--accSoft)', borderColor: 'var(--accLine)' }}
                >
                  {pendingUserText}
                </div>
                <div className="mt-[5px] text-right font-mono text-[9.5px] text-tx3">sending…</div>
              </div>
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>

        <div className="flex flex-none flex-col items-center gap-3 border-t border-line2 px-[var(--pad)] pb-[18px] pt-[14px]">
          {!aiLaunched && (
            <div className="flex w-full max-w-[500px] flex-wrap items-center gap-[10px] rounded-field border border-accLine bg-accSoft px-3 py-[10px]">
              <span className="flex-1 font-mono text-[10.5px] leading-[1.6] text-tx2">
                AI isn't launched yet — nothing can be sent until it's loaded into memory.
              </span>
              <button
                onClick={() => void launchAi().catch(() => {})}
                disabled={aiLaunching}
                className="rounded-field bg-acc px-3 py-[6px] font-mono text-[10.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
              >
                {aiLaunching ? 'launching…' : 'Launch AI'}
              </button>
              {aiLaunchError && <span className="w-full font-mono text-[10px] text-[#c0563f]">{aiLaunchError}</span>}
            </div>
          )}
          {error && <div className="font-mono text-[10.5px] text-[#c0563f]">{error}</div>}
          <div className="flex items-center gap-[14px]">
            <button
              onClick={() => void handleMicClick()}
              disabled={micState === 'thinking' || micState === 'speaking' || !aiLaunched}
              className="grid h-14 w-14 place-items-center rounded-full border-2 font-mono text-[9px] font-semibold disabled:opacity-60"
              style={{ background: meta.bg, borderColor: meta.bd, color: meta.fg }}
            >
              {meta.icon}
            </button>
            <div className="w-[160px]">
              <div className="font-sans text-[12px] font-semibold" style={{ color: meta.fg }}>
                {meta.label}
              </div>
              <div className="font-mono text-[10px] text-tx3">{meta.sub}</div>
            </div>
          </div>
          <form onSubmit={handleTextSubmit} className="flex w-full max-w-[500px] items-center gap-2">
            <input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="or type instead…"
              className="min-w-0 flex-1 rounded-field border border-line2 bg-panel2 px-3 py-2 font-sans text-[11.5px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
            />
            <button
              type="submit"
              disabled={!textInput.trim() || !aiLaunched}
              className="rounded-field border border-accLine bg-accSoft px-[13px] py-2 font-mono text-[11px] font-medium text-acc disabled:opacity-50"
            >
              send
            </button>
          </form>
        </div>
      </div>

      <aside className="flex w-[270px] flex-none flex-col overflow-y-auto border-l border-line2 bg-panel">
        <div className="flex items-center gap-[11px] border-b border-line2 p-4">
          <div className="grid h-11 w-11 flex-none place-items-center rounded-full border border-accLine bg-accSoft font-mono text-[7.5px] text-acc">
            fox
          </div>
          <div>
            <div className="font-sans text-[12.5px] font-semibold text-tx">Juno</div>
            <div className="font-mono text-[10px] text-tx3">local AI conversation partner</div>
          </div>
        </div>
        <div className="p-4">
          <div className="mb-[11px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Target words · {activeSession.target_words.length}
          </div>
          {activeSession.target_words.length === 0 ? (
            <div className="font-mono text-[10.5px] text-tx3">
              save some words in Vocabulary and they'll show up here next session
            </div>
          ) : (
            <div className="flex flex-col gap-[5px]">
              {activeSession.target_words.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between gap-2 rounded-field border border-line2 px-[10px] py-2 text-left"
                >
                  <span className="font-sans text-[12px] font-medium text-tx">{w.word}</span>
                  <span className="font-mono text-[9px] font-medium text-tx3">{w.used_outcome ?? 'due'}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-[14px] border-t border-line2 pt-3 font-mono text-[10px] leading-[1.7] text-tx3">
            the model is asked to never say a target word first
          </div>
        </div>
      </aside>
    </div>
  );
}
