import { useCallback, useEffect, useRef, useState } from 'react';

type RecorderStatus = 'idle' | 'recording' | 'error';

/** Real push-to-talk mic capture via the standard Web Audio APIs — Electron's
 * renderer is a full Chromium context, so no native module is needed. */
export function useMicRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  /** Resolves to null on success, or the failure message — returned rather
   * than only stored in state because a caller awaiting start() still holds
   * its own render's closure, where a just-set error state is not yet
   * visible (that read silently showed "Recording…" after a denied mic). */
  const start = useCallback(async (): Promise<string | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus('recording');
      return null;
    } catch (err) {
      setStatus('error');
      return err instanceof Error ? err.message : 'Microphone access was denied';
    }
  }, []);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        setStatus('idle');
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  /* Release the microphone if this unmounts mid-recording.
   *
   * There was no cleanup here at all, so navigating away while recording —
   * pressing "Give me another scene", or just leaving the screen — left the
   * getUserMedia tracks live for the rest of the session. The sibling
   * useVadRecorder has always stopped its tracks and closed its AudioContext
   * on cleanup; this one simply never did.
   *
   * It is not only a leak. getUserMedia({audio: true}) enables echo
   * cancellation by default, and on Linux that routes output through
   * PulseAudio's AEC module for as long as a capture stream is open — which is
   * a good way to end up wondering why the video you opened afterwards has no
   * sound.
   */
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        try {
          recorder.stop();
        } catch {
          // Already torn down by the browser; nothing to do.
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, []);

  return { status, start, stop };
}
