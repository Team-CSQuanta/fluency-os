import { useEffect, useRef, useState } from 'react';

export type VadPhase = 'off' | 'listening' | 'capturing' | 'error';

interface VadOptions {
  /** Holds the mic open and runs detection. Turning this off releases the device. */
  enabled: boolean;
  /** A turn is already being submitted — keep the stream open but capture nothing. */
  paused: boolean;
  /** True while the AI's reply is audible.
   *
   * Detection is deliberately much harder here. Interrupting is not the same
   * decision as starting to talk into silence: getting it wrong costs the
   * learner the rest of the reply, and the room contains the AI's own voice
   * coming back through the speakers. */
  aiSpeaking: boolean;
  /** How sensitive the microphone is and how long a pause ends a turn, from
   * the learner's settings. Applied live — see SpeechGate.setProfile. */
  profile: ListeningProfile;
  /** Fires the moment speech is detected — the barge-in signal. */
  onSpeechStart: () => void;
  /** A complete utterance, captured from before it began through to the pause
   * that ended it. */
  onUtterance: (blob: Blob) => void;
}

import { FRAME_MS, SpeechGate, type ListeningProfile } from '@/features/conversation/vadGate';

// Matches the backend's own too-short guard, so a blip never round-trips.
const MIN_UTTERANCE_MS = 400;
const MAX_UTTERANCE_MS = 30000;
// Recording runs continuously so an utterance is never clipped at its onset,
// which means each blob carries a little audio from before speech began. That
// pre-roll is recycled aggressively: anything longer and a barge-in would ship
// seconds of the AI's own reply (however well echo cancellation suppressed it)
// to the transcriber as if the learner had said it.
const IDLE_RESTART_MS = 1500;

/** Continuous hands-free capture: holds the microphone open, watches the live
 * signal level, and emits one blob per utterance without anything being
 * clicked. Detection is energy-based against a per-session ambient noise
 * floor — deliberately simple and fully local, with the real transcription
 * still done server-side by whisper (whose own VAD trims the padding this
 * leaves around each utterance). */
export function useVadRecorder({ enabled, paused, aiSpeaking, profile, onSpeechStart, onUtterance }: VadOptions) {
  const [phase, setPhase] = useState<VadPhase>('off');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Every value the polling loop reads lives in a ref: the loop is started
  // once per enable and would otherwise capture the first render's props.
  const callbacksRef = useRef({ onSpeechStart, onUtterance });
  callbacksRef.current = { onSpeechStart, onUtterance };
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const aiSpeakingRef = useRef(aiSpeaking);
  aiSpeakingRef.current = aiSpeaking;
  // A ref, not an effect dependency: re-running the effect would tear the
  // microphone down and back up mid-sentence just because a slider moved.
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    if (!enabled) {
      setPhase('off');
      return;
    }

    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let recorder: MediaRecorder | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let chunks: Blob[] = [];
    let disposed = false;

    const gate = new SpeechGate();
    let recorderStartedAt = 0;

    const startRecorder = () => {
      if (!stream || disposed) return;
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start();
      recorderStartedAt = Date.now();
    };

    /** Closes the current recording and hands back its audio, then immediately
     * arms a fresh recorder so the next utterance is never missed. */
    const cutRecording = (): Promise<Blob | null> =>
      new Promise((resolve) => {
        const active = recorder;
        if (!active || active.state === 'inactive') {
          resolve(null);
          return;
        }
        active.onstop = () => {
          const blob = chunks.length > 0 ? new Blob(chunks, { type: active.mimeType || 'audio/webm' }) : null;
          recorder = null;
          if (!disposed) startRecorder();
          resolve(blob);
        };
        active.stop();
      });

    const finishUtterance = () => {
      const spokenMs = Date.now() - gate.speechStartedAt;
      gate.reset();
      setPhase('listening');
      void cutRecording().then((blob) => {
        if (disposed || !blob || spokenMs < MIN_UTTERANCE_MS) return;
        callbacksRef.current.onUtterance(blob);
      });
    };

    const tick = (analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>) => {
      analyser.getFloatTimeDomainData(buffer);
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i += 1) sumSquares += buffer[i] * buffer[i];
      const rms = Math.sqrt(sumSquares / buffer.length);
      // Quantised so the live meter doesn't re-render the transcript 20x/second.
      setLevel((prev) => (Math.abs(prev - rms) > 0.004 ? rms : prev));

      const now = Date.now();

      if (pausedRef.current) {
        // Drop anything captured while a turn was mid-flight rather than
        // stitching it onto the next utterance — including the idle buffer,
        // which would otherwise grow for the whole round trip.
        if (gate.speaking) {
          gate.reset();
          setPhase('listening');
          void cutRecording();
        } else if (now - recorderStartedAt > IDLE_RESTART_MS) {
          void cutRecording();
        }
        return;
      }

      gate.setProfile(profileRef.current);
      const event = gate.observe({ rms, now, aiSpeaking: aiSpeakingRef.current });

      if (event === 'start') {
        setPhase('capturing');
        callbacksRef.current.onSpeechStart();
      } else if (event === 'end') {
        finishUtterance();
        return;
      } else if (!gate.speaking && now - recorderStartedAt > IDLE_RESTART_MS) {
        void cutRecording();
      }

      if (gate.speaking && now - gate.speechStartedAt > MAX_UTTERANCE_MS) finishUtterance();
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Echo cancellation is what makes barge-in workable on speakers at
          // all — without it the AI's own reply reliably interrupts itself.
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        audioContext = new AudioContext();
        if (audioContext.state === 'suspended') await audioContext.resume();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const buffer = new Float32Array(analyser.fftSize);

        startRecorder();
        setError(null);
        setPhase('listening');
        timer = setInterval(() => tick(analyser, buffer), FRAME_MS);
      } catch (err) {
        if (disposed) return;
        setPhase('error');
        setError(err instanceof Error ? err.message : 'Microphone access was denied');
      }
    })();

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      stream?.getTracks().forEach((t) => t.stop());
      void audioContext?.close();
      setLevel(0);
    };
  }, [enabled]);

  return { phase, level, error };
}
