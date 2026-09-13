import { useCallback, useRef, useState } from 'react';

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

  return { status, start, stop };
}
