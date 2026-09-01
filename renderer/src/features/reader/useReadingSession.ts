import { useEffect, useRef } from 'react';
import { useReaderStore } from '@/store/readerStore';

const HEARTBEAT_MS = 30_000;
// A book left open on a second monitor overnight is not twelve hours of
// reading, so the beat stops once nothing has happened for this long.
const IDLE_TIMEOUT_MS = 3 * 60_000;

const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'wheel', 'scroll'] as const;

/**
 * Opens a reading session for the book and heartbeats time-on-page into it
 * (spec Phase 7). Words read are credited separately by position updates —
 * this only owns the clock.
 *
 * Counts wall-clock time between beats rather than incrementing a fixed 30,
 * so a backgrounded tab whose timer is throttled reports what really elapsed.
 */
export function useReadingSession(bookId: string | null): void {
  const openSession = useReaderStore((s) => s.openSession);
  const heartbeat = useReaderStore((s) => s.heartbeat);

  const lastBeatRef = useRef(Date.now());
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (!bookId) return;

    void openSession();
    lastBeatRef.current = Date.now();
    lastActivityRef.current = Date.now();

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }

    const flush = () => {
      const now = Date.now();
      const elapsed = now - lastBeatRef.current;
      lastBeatRef.current = now;

      const idleFor = now - lastActivityRef.current;
      if (idleFor > IDLE_TIMEOUT_MS || document.hidden) return;

      const seconds = Math.round(elapsed / 1000);
      if (seconds > 0) void heartbeat(seconds);
    };

    const timer = setInterval(flush, HEARTBEAT_MS);

    return () => {
      clearInterval(timer);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
      // Final partial interval, so closing a book after 40 s doesn't record 30.
      flush();
    };
  }, [bookId, openSession, heartbeat]);
}
