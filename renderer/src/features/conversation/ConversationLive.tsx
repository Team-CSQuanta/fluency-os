import { useEffect, useRef, useState } from 'react';
import { CorrectedText, KIND_LABEL } from './CorrectedText';
import { SpokenText, type SpeakingState } from './SpokenText';
import { spokenCount, timeWords } from './spokenTiming';
import { useMicRecorder } from '@/features/conversation/useMicRecorder';
import { useVadRecorder } from '@/features/conversation/useVadRecorder';
import { DEFAULT_PROFILE, type ListeningProfile } from '@/features/conversation/vadGate';
import { UserAvatar } from '@/features/shell/UserAvatar';
import { useConversationStore } from '@/store/conversationStore';
import { useEngineStore } from '@/store/engineStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
import { friendlyMessage } from '@/lib/friendlyError';

type MicState = 'idle' | 'recording' | 'thinking' | 'speaking' | 'listening' | 'hearing';

const MIC_META: Record<MicState, { label: string; sub: string; bg: string; bd: string; fg: string; icon: string }> = {
  idle: { label: 'Ready', sub: 'tap to talk', bg: 'var(--panel)', bd: 'var(--line2)', fg: 'var(--tx2)', icon: '●' },
  recording: { label: 'Recording…', sub: 'tap to stop', bg: 'var(--accSoft)', bd: 'var(--acc)', fg: 'var(--acc)', icon: '■' },
  listening: { label: 'Listening', sub: 'just start talking', bg: 'var(--panel)', bd: 'var(--acc)', fg: 'var(--acc)', icon: '◉' },
  hearing: { label: 'I hear you…', sub: 'pause when you’re done', bg: 'var(--accSoft)', bd: 'var(--acc)', fg: 'var(--acc)', icon: '▮' },
  thinking: { label: 'Thinking…', sub: 'transcribing + generating a reply', bg: 'var(--panel)', bd: 'var(--line2)', fg: 'var(--tx2)', icon: '…' },
  speaking: { label: 'Juno is speaking', sub: 'playing the reply', bg: 'var(--tile)', bd: 'var(--line2)', fg: 'var(--tx)', icon: '▮▮' },
};

/** What each reason a target word was picked for means, for its tooltip. */
const REASON_HELP: Record<string, string> = {
  due: 'due for review — using it here counts as the review',
  new: 'not reviewed yet',
  retry: 'you used it wrongly last time',
  'not said yet': "reviewed, but never said in a conversation — the only way past mastery level 2",
  stretch: 'one level above yours',
  'fits scene': 'belongs naturally in this scene',
  again: 'from the conversation you are practising again',
  practice: 'picked for practice',
};

function reasonHelp(reason: string): string {
  return reason
    .split(' · ')
    .map((r) => REASON_HELP[r] ?? r)
    .join('; ');
}

/** "Maya" → "MA", "Ms. Carter" → "MC": the scene character's initials. */
function initials(name: string): string {
  const parts = name.replace(/\./g, '').split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

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
  const fetchLlmProvider = useEngineStore((s) => s.fetchLlmProvider);
  const aiLaunching = useEngineStore((s) => s.launching);
  const aiLaunchError = useEngineStore((s) => s.launchError);
  const launchAi = useEngineStore((s) => s.launchAi);

  const [micState, setMicState] = useState<MicState>('idle');
  const [textInput, setTextInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  // Settings → Conversation, when already loaded — so the microphone does
  // not open for a moment before a "start with tap-to-talk" setting arrives.
  const [handsFree, setHandsFree] = useState(
    () => useSettingsStore.getState().settings?.conversation_hands_free ?? true,
  );
  // Shown immediately on submit, before the round trip (STT + LLM reply)
  // resolves — otherwise a typed message just sits invisible in the input's
  // cleared state until the AI's reply arrives alongside it, which reads as
  // the app ignoring the message rather than thinking about it.
  const [pendingUserText, setPendingUserText] = useState<string | null>(null);
  const recorder = useMicRecorder();
  // Lets the unmount cleanup reach the current recorder without re-running.
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
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
  // Bumped to cancel an in-progress sentence-by-sentence playback run.
  const playbackIdRef = useRef(0);
  // Which turn is being spoken and how far into it, so the bubble can light
  // up in time with the voice. Null whenever nothing is playing, which is
  // what makes finished replies render as ordinary text.
  const [speaking, setSpeaking] = useState<(SpeakingState & { turnId: string }) | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const turns = activeSession?.turns ?? [];

  /* Listening practice (Settings → Conversation): a reply that arrives while
   * the learner is here stays blurred until it has been heard, or they click
   * it. Replies already in the conversation when it was opened are shown —
   * they were heard last time. A freshly started session's opening line is
   * new, so it counts as arriving now. */
  const loadedTurnIds = useRef<Set<string> | null>(null);
  const loadedFor = useRef<string | null>(null);
  const [heardIds, setHeardIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    // Once per session: React's StrictMode runs effects twice in
    // development, and by the second run the "just started" signal has been
    // used up by the autoplay below.
    if (!activeSession || loadedFor.current === activeSession.id) return;
    loadedFor.current = activeSession.id;
    const fresh = useConversationStore.getState().justStarted;
    loadedTurnIds.current = new Set(fresh ? [] : activeSession.turns.map((t) => t.id));
    setHeardIds(new Set());
    // Once per session opened, before the opening line's autoplay below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id]);
  const markHeard = (turnId: string) =>
    setHeardIds((prev) => (prev.has(turnId) ? prev : new Set(prev).add(turnId)));
  const isVoice = activeSession?.channel === 'voice';
  // This session's own pinned engine — the one its turns actually call. The
  // global engine state reflects what Settings points at *now*, which can be
  // something else entirely, so gating on it claimed the AI was ready while
  // the turns were going somewhere else.
  const sessionUsesCloud = activeSession !== null && activeSession.engine_provider !== 'local';
  // A turn already being submitted. Two overlapping submissions would each
  // compute the next turn_index from the same pre-insert snapshot server-side,
  // producing two turns with the same index and an interleaved transcript —
  // so mic and send are both held until the in-flight one lands.
  const turnInFlight = pendingUserText !== null;
  // Text-only turns don't need STT/TTS loaded, only the LLM — voice needs
  // all three, matching backend's _ensure_launched requirements. A
  // cloud-pinned session has no LLM to load at all, so requiring one would
  // block a conversation that is perfectly able to run.
  const aiLaunched =
    engineGlobalStatus !== null &&
    (sessionUsesCloud || engineGlobalStatus.llm === 'ready') &&
    (!isVoice || (engineGlobalStatus.stt === 'ready' && engineGlobalStatus.tts === 'ready'));

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, pendingUserText]);

  useEffect(() => {
    void fetchEngineGlobalStatus();
    void fetchLlmProvider();
  }, [fetchEngineGlobalStatus, fetchLlmProvider]);

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
      // stop() is a no-op on an inactive recorder, so this is called
      // unconditionally — reading recorder.status here would see the *first*
      // render's value (this cleanup has no deps) and so never fire.
      void recorderRef.current.stop();
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* How long the learner takes to start answering, for the report.
   *
   * The floor opens when the learner could reply — the AI finished speaking,
   * or its reply appeared if it is not spoken — and the reply starts when
   * they begin: voice detected, mic tapped, or first keystroke. Talking over
   * the AI counts as no delay at all. Measured here because nothing on the
   * server knows either moment: a turn's timestamps also include the AI
   * talking, the learner talking, transcription and generation. */
  const floorOpenAt = useRef<number | null>(null);
  const replyDelayMs = useRef<number | null>(null);
  const openFloor = () => {
    floorOpenAt.current = performance.now();
    replyDelayMs.current = null;
  };
  const markReplyStart = (bargeIn = false) => {
    if (replyDelayMs.current !== null) return; // the first start counts
    if (bargeIn) replyDelayMs.current = 0;
    else if (floorOpenAt.current !== null) replyDelayMs.current = performance.now() - floorOpenAt.current;
  };
  /** The measured delay for the turn being sent; the floor closes with it. */
  const takeReplyDelay = () => {
    const ms = replyDelayMs.current;
    floorOpenAt.current = null;
    replyDelayMs.current = null;
    return ms;
  };

  /** Stops whatever the AI is currently saying, and reports whether anything
   * was actually playing. */
  const stopPlayback = () => {
    // Invalidate any running sequence first, so its next sentence never starts.
    playbackIdRef.current += 1;
    setSpeaking(null);
    const audio = currentAudioRef.current;
    if (!audio) return false;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    currentAudioRef.current = null;
    return true;
  };

  /** Plays a reply one sentence at a time, fetching the next while the current
   * one is audible.
   *
   * Each fetch is also what synthesizes that sentence, and synthesis is slower
   * than real time on this hardware — so waiting for a whole reply before any
   * of it was audible cost tens of seconds. Starting on sentence one cuts the
   * wait to roughly its own synthesis time. `playbackId` makes every sequence
   * cancellable, so barge-in or a newer reply stops the whole run rather than
   * just the clip currently playing. */
  const playTurnAudio = async (turnId: string, chunkTexts: string[] = []) => {
    lastAutoPlayedTurnId.current = turnId; // dedupes against the effect below firing for the same turn
    stopPlayback();
    const runId = ++playbackIdRef.current;
    // A turn recorded before the API returned chunk texts still has exactly
    // one clip to play — it just gets no word highlighting, which is the
    // right fallback rather than refusing to speak.
    const total = Math.max(1, chunkTexts.length);
    setMicState('speaking');

    const fetchChunk = (index: number) =>
      index < total ? turnAudioUrl(turnId, index).catch(() => null) : Promise.resolve(null);

    // Each chunk arrives as an object URL holding a whole WAV in memory, and
    // the browser frees one only when it is explicitly revoked — closing the
    // page is otherwise the only thing that reclaims it. A voice conversation
    // fetches two per reply, so leaving them was a steady leak of a few
    // hundred KB per turn for as long as the app stayed open. Every URL this
    // run creates is tracked and released when the run ends, including the
    // prefetched one that barge-in means we never play.
    const created: string[] = [];
    const trackedFetch = async (index: number) => {
      const url = await fetchChunk(index);
      if (url) created.push(url);
      return url;
    };

    let pending = trackedFetch(0);
    try {
      for (let i = 0; i < total; i += 1) {
        const url = await pending;
        if (runId !== playbackIdRef.current) return; // superseded
        if (!url) break;
        // Kick off the next sentence's synthesis before playing this one, so
        // the gap between sentences is as small as the hardware allows.
        pending = trackedFetch(i + 1);
        const words = timeWords(chunkTexts[i] ?? '');
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          // Settings → Conversation. Read at play time, so a change applies to
          // the next reply without reopening the conversation.
          audio.playbackRate = useSettingsStore.getState().settings?.conversation_voice_speed ?? 1;
          currentAudioRef.current = audio;

          // Read from the element every frame rather than running a timer
          // alongside it. currentTime is the sound's own position, so the
          // highlight cannot drift away from what is audible — through a
          // stall, a slow decode, or a pause.
          let frame = 0;
          let lastCount = -1;
          const follow = () => {
            if (runId !== playbackIdRef.current) return;
            const total = audio.duration;
            if (Number.isFinite(total) && total > 0) {
              const count = spokenCount(words, audio.currentTime / total);
              // Only when the word actually changes: re-rendering the
              // transcript 60 times a second to move a highlight nobody can
              // see move is not worth it on this hardware.
              if (count !== lastCount) {
                lastCount = count;
                setSpeaking({ turnId, chunkIndex: i, spokenInChunk: count });
              }
            }
            frame = requestAnimationFrame(follow);
          };
          frame = requestAnimationFrame(follow);

          const finish = () => {
            cancelAnimationFrame(frame);
            resolve();
          };
          audio.onended = finish;
          audio.onerror = finish;
          void audio.play().catch(finish);
        });
        if (runId !== playbackIdRef.current) return;
        // The clip finished: mark every one of its words said, so the last
        // word doesn't sit un-highlighted while the next clip is fetched.
        setSpeaking({ turnId, chunkIndex: i, spokenInChunk: words.length });
      }
    } finally {
      // Played through or talked over — either way it has been heard.
      markHeard(turnId);
      // Awaited, not fire-and-forget: the in-flight prefetch has to land
      // before its URL can be revoked, or it leaks exactly in the barge-in
      // case this is here to cover.
      void pending.finally(() => created.forEach((url) => URL.revokeObjectURL(url)));
      if (runId === playbackIdRef.current) {
        currentAudioRef.current = null;
        setSpeaking(null);
        setMicState('idle');
        // Finished, not interrupted: now it is the learner's turn.
        openFloor();
      }
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
    if (!isVoice) {
      // Nothing is spoken, so the floor opens as the opening line appears.
      if (turns.length === 1 && useConversationStore.getState().consumeJustStarted()) openFloor();
      return;
    }
    const lastAiTurn = [...turns].reverse().find((t) => t.speaker === 'ai');
    if (!lastAiTurn?.audio_url || lastAiTurn.id === lastAutoPlayedTurnId.current) return;

    const isFreshOpeningLine = turns.length === 1 && useConversationStore.getState().consumeJustStarted();
    if (isFreshOpeningLine) {
      void playTurnAudio(lastAiTurn.id, lastAiTurn.audio_chunks);
    } else {
      // Not something to auto-play (a resumed session's existing history) —
      // still mark it "seen" so nothing tries to play it later either.
      lastAutoPlayedTurnId.current = lastAiTurn.id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length, isVoice]);

  /** The one path both tap-to-talk and hands-free capture funnel through. */
  const submitAudio = async (blob: Blob) => {
    if (!activeSession) return;
    setPendingUserText('🎤 …'); // real text isn't known until the backend transcribes it
    setError(null);
    try {
      const { ai_turn } = await submitAudioTurn(activeSession.id, blob, takeReplyDelay());
      setPendingUserText(null);
      if (isVoice && ai_turn.audio_url) {
        void playTurnAudio(ai_turn.id, ai_turn.audio_chunks);
      } else {
        setMicState('idle');
        openFloor();
      }
    } catch (err) {
      setPendingUserText(null);
      setError(friendlyMessage(err, 'Sending that'));
      setMicState('idle');
      // A failed turn can mean the engine itself is no longer usable (key
      // revoked, quota gone) — refresh so the header indicator says so now
      // rather than at the next screen change.
      void fetchEngineGlobalStatus();
    }
  };

  // Settings → Conversation. Read here rather than inside the recorder so the
  // hook stays a hook about microphones, with no idea where its numbers came
  // from — which is what let it be simulated without a browser.
  //
  // Fetched from here as well as from the settings page: someone can open a
  // conversation without ever visiting settings, and the tuned defaults are
  // what they would get anyway, so a slow or failed read costs nothing.
  const settings = useSettingsStore((s) => s.settings);
  // Settings → Conversation decides whether a conversation opens hands-free —
  // once, when it opens; toggling it here afterwards is the learner's call.
  const handsFreeApplied = useRef(false);
  useEffect(() => {
    if (!settings || handsFreeApplied.current) return;
    handsFreeApplied.current = true;
    setHandsFree(settings.conversation_hands_free);
  }, [settings]);
  const hideUntilHeard = Boolean(settings?.conversation_hide_text) && isVoice;
  const fetchSettings = useSettingsStore((s) => s.fetch);
  useEffect(() => {
    if (!settings) void fetchSettings();
  }, [settings, fetchSettings]);

  const listening: ListeningProfile = {
    sensitivity: settings?.conversation_mic_sensitivity ?? DEFAULT_PROFILE.sensitivity,
    pace: settings?.conversation_turn_pace ?? DEFAULT_PROFILE.pace,
  };

  const vad = useVadRecorder({
    enabled: handsFree && isVoice && aiLaunched && activeSession !== null,
    paused: turnInFlight,
    // While the reply is audible, interrupting takes sustained speech rather
    // than any passing sound — see useVadRecorder for why the bar moves.
    aiSpeaking: micState === 'speaking',
    profile: listening,
    onSpeechStart: () => {
      const interrupted = stopPlayback();
      if (interrupted) setMicState('idle');
      markReplyStart(interrupted);
    },
    onUtterance: (blob) => void submitAudio(blob),
  });

  const handleMicClick = async () => {
    setError(null);
    if (!aiLaunched) {
      setError('AI isn’t launched yet — use the Launch AI button below before talking.');
      return;
    }
    if (turnInFlight) return;
    if (micState === 'idle') {
      markReplyStart();
      const startError = await recorder.start();
      if (startError) setError(startError);
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
      await submitAudio(blob);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = textInput.trim();
    // Enter submits the form even while the send button is disabled, so the
    // in-flight guard has to live here too, not only on the button.
    if (!text || !activeSession || turnInFlight) return;
    if (!aiLaunched) {
      setError('AI isn’t launched yet — use the Launch AI button below before sending.');
      return;
    }
    setTextInput('');
    setError(null);
    setPendingUserText(text);
    try {
      const { ai_turn } = await submitTextTurn(activeSession.id, text, takeReplyDelay());
      setPendingUserText(null);
      if (isVoice && ai_turn.audio_url) {
        void playTurnAudio(ai_turn.id, ai_turn.audio_chunks);
      } else {
        openFloor();
      }
    } catch (err) {
      setPendingUserText(null);
      // Put the message back in the box. The input is cleared optimistically
      // so the conversation feels responsive, but a turn can genuinely fail
      // (AI not launched, quota gone, model still loading) and losing what
      // someone just typed makes a recoverable error feel like data loss —
      // they have to retype it to retry.
      setTextInput((current) => (current ? current : text));
      setError(friendlyMessage(err, 'Sending that'));
      void fetchEngineGlobalStatus();
    }
  };

  const handleEnd = async () => {
    if (!activeSession) return;
    setEnding(true);
    try {
      await endSession(activeSession.id);
      goReport();
    } catch (err) {
      setError(friendlyMessage(err, 'Ending this conversation'));
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

  // In hands-free mode the circle is a status light, not a button: what it
  // shows comes from the detector, except while a turn is in flight or the
  // reply is playing, which the component itself still owns.
  const displayState: MicState = handsFree
    ? turnInFlight
      ? 'thinking'
      : micState === 'speaking'
        ? 'speaking'
        : vad.phase === 'capturing'
          ? 'hearing'
          : vad.phase === 'listening'
            ? 'listening'
            : 'idle'
    : micState;
  const meta = MIC_META[displayState];
  // The scene's character, not a fixed "Juno" — the barista is Maya.
  const personaName = activeSession.persona_name || 'Juno';
  const handsFreeUnavailable = handsFree && !isVoice;

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
                {isAi ? (
                  <div
                    className="grid h-7 w-7 flex-none place-items-center rounded-full font-mono text-[8px] font-semibold"
                    style={{ background: 'var(--accSoft)', color: 'var(--acc)' }}
                  >
                    {initials(personaName)}
                  </div>
                ) : (
                  // Their own picture, when they have set one.
                  <UserAvatar />
                )}
                <div>
                  <div
                    className="rounded-field border px-[14px] py-[11px] font-sans text-[13.5px] leading-[1.65]"
                    style={{
                      background: isAi ? 'var(--panel)' : 'var(--accSoft)',
                      borderColor: isAi ? 'var(--line2)' : 'var(--accLine)',
                      color: 'var(--tx)',
                    }}
                  >
                    {t.text && isAi && hideUntilHeard && t.audio_url && !heardIds.has(t.id) &&
                    !loadedTurnIds.current?.has(t.id) ? (
                      <button
                        onClick={() => markHeard(t.id)}
                        title="Listening practice — click to show the text now"
                        className="relative block text-left"
                      >
                        <span className="pointer-events-none select-none blur-[6px]">{t.text}</span>
                        <span className="absolute inset-0 grid place-items-center font-mono text-[10.5px] text-acc">
                          🎧 listen first · click to show
                        </span>
                      </button>
                    ) : t.text && t.corrections?.length ? (
                      <CorrectedText
                        text={t.text}
                        corrections={t.corrections}
                        animate={!loadedTurnIds.current?.has(t.id)}
                      />
                    ) : t.text ? (
                      <SpokenText
                        text={t.text}
                        chunks={t.audio_chunks}
                        speaking={speaking?.turnId === t.id ? speaking : null}
                      />
                    ) : (
                      <span className="italic text-tx3">{isAi ? '(no reply)' : '(no speech detected)'}</span>
                    )}
                  </div>
                  <div
                    className="mt-[5px] flex items-center gap-[8px] font-mono text-[9.5px] text-tx3"
                    style={{ justifyContent: isAi ? 'flex-start' : 'flex-end' }}
                  >
                    {isAi ? personaName : t.stt_confidence !== null ? `confidence ${Math.round(t.stt_confidence * 100)}%` : ''}
                    {!isAi && !!t.corrections?.length && (
                      <span className="text-acc" title="Hover a fix to see why">
                        fixed · {[...new Set(t.corrections.map((c) => KIND_LABEL[c.kind]))].join(' · ')}
                      </span>
                    )}
                    {t.audio_url && (
                      <button onClick={() => void playTurnAudio(t.id, t.audio_chunks)} className="hover:text-acc">
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
              <UserAvatar />
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
          {vad.error && handsFree && (
            <div className="font-mono text-[10.5px] text-[#c0563f]">hands-free needs the mic: {vad.error}</div>
          )}
          <div className="flex items-center gap-[14px]">
            <button
              onClick={() => void handleMicClick()}
              disabled={
                handsFree || micState === 'thinking' || micState === 'speaking' || turnInFlight || !aiLaunched
              }
              title={handsFree ? 'hands-free is on — just talk' : undefined}
              className="relative grid h-14 w-14 place-items-center rounded-full border-2 font-mono text-[9px] font-semibold disabled:opacity-60"
              style={{ background: meta.bg, borderColor: meta.bd, color: meta.fg }}
            >
              {/* Live input level, so it's obvious the mic is actually hearing
                  something before anything is sent anywhere. */}
              {handsFree && (displayState === 'listening' || displayState === 'hearing') && (
                <span
                  className="pointer-events-none absolute inset-[-4px] rounded-full border transition-opacity"
                  style={{ borderColor: 'var(--acc)', opacity: Math.min(1, vad.level * 14) }}
                />
              )}
              {meta.icon}
            </button>
            <div className="w-[160px]">
              <div className="font-sans text-[12px] font-semibold" style={{ color: meta.fg }}>
                {displayState === 'speaking' ? `${personaName} is speaking` : meta.label}
              </div>
              <div className="font-mono text-[10px] text-tx3">
                {handsFreeUnavailable ? 'text session — type below' : meta.sub}
              </div>
            </div>
            <button
              onClick={() => {
                setHandsFree((on) => !on);
                setError(null);
                setMicState('idle');
              }}
              disabled={!isVoice}
              title={
                isVoice
                  ? 'Hands-free listens continuously and lets you interrupt the reply by talking over it'
                  : 'Hands-free only applies to voice sessions'
              }
              className="rounded-field border px-[11px] py-[7px] font-mono text-[10px] font-medium disabled:opacity-40"
              style={{
                borderColor: handsFree && isVoice ? 'var(--accLine)' : 'var(--line2)',
                background: handsFree && isVoice ? 'var(--accSoft)' : 'transparent',
                color: handsFree && isVoice ? 'var(--acc)' : 'var(--tx3)',
              }}
            >
              hands-free {handsFree ? 'on' : 'off'}
            </button>
          </div>
          <form onSubmit={handleTextSubmit} className="flex w-full max-w-[500px] items-center gap-2">
            <input
              value={textInput}
              onChange={(e) => {
                // The first keystroke is when a typed reply starts.
                if (!textInput && e.target.value) markReplyStart(micState === 'speaking');
                setTextInput(e.target.value);
              }}
              placeholder="or type instead…"
              className="min-w-0 flex-1 rounded-field border border-line2 bg-panel2 px-3 py-2 font-sans text-[11.5px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
            />
            <button
              type="submit"
              disabled={!textInput.trim() || turnInFlight || !aiLaunched}
              className="rounded-field border border-accLine bg-accSoft px-[13px] py-2 font-mono text-[11px] font-medium text-acc disabled:opacity-50"
            >
              send
            </button>
          </form>
        </div>
      </div>

      <aside className="flex w-[270px] flex-none flex-col overflow-y-auto border-l border-line2 bg-panel">
        <div className="flex items-center gap-[11px] border-b border-line2 p-4">
          <div className="grid h-11 w-11 flex-none place-items-center rounded-full border border-accLine bg-accSoft font-mono text-[11px] font-semibold text-acc">
            {initials(personaName)}
          </div>
          <div className="min-w-0">
            <div className="font-sans text-[12.5px] font-semibold text-tx">{personaName}</div>
            {activeSession.persona_role && (
              <div className="truncate font-sans text-[10.5px] text-tx2" title={activeSession.persona_role}>
                {activeSession.persona_role}
              </div>
            )}
            <div className="truncate font-mono text-[10px] text-tx3" title={activeSession.engine_label}>
              {sessionUsesCloud ? 'cloud' : 'local'} · {activeSession.engine_label}
            </div>
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
                  {/* How it went, once the report has judged it; until then,
                      why it was picked. */}
                  {w.used_outcome ? (
                    <span className="font-mono text-[9px] font-medium text-acc">{w.used_outcome}</span>
                  ) : w.reason ? (
                    <span
                      className="truncate text-right font-mono text-[9px] font-medium text-tx3"
                      title={reasonHelp(w.reason)}
                    >
                      {w.reason}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <div className="mt-[14px] border-t border-line2 pt-3 font-mono text-[10px] leading-[1.7] text-tx3">
            picked by what needs practice, your level and this scene · hover a reason for what it means ·
            the model is asked to never say a target word first
          </div>
        </div>
      </aside>
    </div>
  );
}
