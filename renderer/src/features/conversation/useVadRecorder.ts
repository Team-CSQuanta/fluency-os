import { useEffect, useRef, useState } from 'react';

export type VadPhase = 'off' | 'listening' | 'capturing' | 'error';

interface VadOptions {
  /** Holds the mic open and runs detection. Turning this off releases the device. */
  enabled: boolean;
  /** A turn is already being submitted — keep the stream open but capture nothing. */
  paused: boolean;
  /** Raised while the AI's reply is audible so its own voice through the
   * speakers is far less likely to trip detection and interrupt itself. */
  thresholdScale: number;
  /** Fires the moment speech is detected — the barge-in signal. */
  onSpeechStart: () => void;
  /** A complete utterance, captured from before it began through to the pause
   * that ended it. */
  onUtterance: (blob: Blob) => void;
}

const FRAME_MS = 50;
// Two consecutive loud frames before believing it's speech — one is too easy
// to trip with a keyboard clack or a chair creak.
const SPEECH_FRAMES = 2;
// How long a pause has to last before the utterance counts as finished. Every
// millisecond here is dead air the learner feels, so it is kept just long
// enough that a normal mid-sentence breath doesn't cut them off.
const SILENCE_MS = 600;
// Matches the backend's own too-short guard, so a blip never round-trips.
const MIN_UTTERANCE_MS = 400;
const MAX_UTTERANCE_MS = 30000;
// Recording runs continuously so an utterance is never clipped at its onset,
// which means each blob carries a little audio from before speech began. That
// pre-roll is recycled aggressively: anything longer and a barge-in would ship
// seconds of the AI's own reply (however well echo cancellation suppressed it)
// to the transcriber as if the learner had said it.
const IDLE_RESTART_MS = 1500;
const NOISE_FLOOR_FRAMES = 10;
// Ambient noise is measured per session, but a room this quiet still needs a
// floor or the threshold collapses to near zero and everything reads as speech.
const ABS_MIN_THRESHOLD = 0.012;
const NOISE_FLOOR_MULTIPLE = 3;

/** Continuous hands-free capture: holds the microphone open, watches the live
 * signal level, and emits one blob per utterance without anything being
 * clicked. Detection is energy-based against a per-session ambient noise
 * floor — deliberately simple and fully local, with the real transcription
 * still done server-side by whisper (whose own VAD trims the padding this
 * leaves around each utterance). */
export function useVadRecorder({ enabled, paused, thresholdScale, onSpeechStart, onUtterance }: VadOptions) {
  const [phase, setPhase] = useState<VadPhase>('off');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Every value the polling loop reads lives in a ref: the loop is started
  // once per enable and would otherwise capture the first render's props.
  const callbacksRef = useRef({ onSpeechStart, onUtterance });
  callbacksRef.current = { onSpeechStart, onUtterance };
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const scaleRef = useRef(thresholdScale);
  scaleRef.current = thresholdScale;

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

    let noiseFloor = 0;
    let floorFrames = 0;
    let loudFrames = 0;
    let speaking = false;
    let speechStartedAt = 0;
    let lastLoudAt = 0;
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
      const spokenMs = Date.now() - speechStartedAt;
      speaking = false;
      loudFrames = 0;
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

      if (floorFrames < NOISE_FLOOR_FRAMES) {
        floorFrames += 1;
        noiseFloor += (rms - noiseFloor) / floorFrames;
        return;
      }

      const now = Date.now();
      const threshold = Math.max(ABS_MIN_THRESHOLD, noiseFloor * NOISE_FLOOR_MULTIPLE) * scaleRef.current;

      if (pausedRef.current) {
        // Drop anything captured while a turn was mid-flight rather than
        // stitching it onto the next utterance — including the idle buffer,
        // which would otherwise grow for the whole round trip.
        if (speaking) {
          speaking = false;
          loudFrames = 0;
          setPhase('listening');
          void cutRecording();
        } else if (now - recorderStartedAt > IDLE_RESTART_MS) {
          void cutRecording();
        }
        return;
      }

      if (rms > threshold) {
        loudFrames += 1;
        lastLoudAt = now;
        if (!speaking && loudFrames >= SPEECH_FRAMES) {
          speaking = true;
          speechStartedAt = now;
          setPhase('capturing');
          callbacksRef.current.onSpeechStart();
        }
      } else {
        loudFrames = 0;
        if (speaking && now - lastLoudAt >= SILENCE_MS) {
          finishUtterance();
          return;
        }
        if (!speaking && now - recorderStartedAt > IDLE_RESTART_MS) {
          void cutRecording();
        }
      }

      if (speaking && now - speechStartedAt > MAX_UTTERANCE_MS) finishUtterance();
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
