import { useEffect, useRef, useState } from 'react';

/** What a model call looks like while it runs.
 *
 * The answer arrives whole, not streamed, so there is no true percentage to
 * show. What can be shown honestly is that work is happening (a moving bar),
 * where the answer will land (placeholder lines the size of one), and how
 * long it has taken — a counter that stops a slow cloud call or a cold local
 * model from looking frozen.
 */
export function AiThinking({ label = 'the AI is thinking' }: { label?: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const id = window.setInterval(() => setSeconds(Math.floor((performance.now() - started) / 1000)), 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="mt-[8px] flex flex-col gap-[7px]" role="status" aria-live="polite">
      <style>{`@keyframes ai-sweep { from { transform: translateX(-100%); } to { transform: translateX(250%); } }`}</style>
      <div className="flex items-baseline justify-between font-mono text-[9.5px] text-acc">
        <span>{label}…</span>
        <span className="text-tx3">{seconds}s</span>
      </div>
      <div className="relative h-[2px] overflow-hidden rounded-full bg-line2">
        <div
          className="absolute inset-y-0 w-[40%] rounded-full bg-acc"
          style={{ animation: 'ai-sweep 1.1s ease-in-out infinite' }}
        />
      </div>
      <div className="flex animate-pulse flex-col gap-[6px] pt-[2px]">
        <div className="h-[9px] w-[92%] rounded-[3px] bg-line2" />
        <div className="h-[9px] w-[78%] rounded-[3px] bg-line2" />
        <div className="h-[9px] w-[55%] rounded-[3px] bg-line2" />
      </div>
    </div>
  );
}

/** Points at a section when something new lands in it: an outline and a tint
 * that fade after a moment, and the section scrolled into view. The same
 * signal the reader gives when a lookup arrives in the side panel.
 *
 * `token` is anything that changes when the new thing arrives — typically
 * the answer object itself. */
export function useArrivalFlash<T extends HTMLElement>(token: unknown) {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  // Compared with the last token seen, not a "first run" flag: React's
  // StrictMode runs every effect twice on mount in development, and a flag
  // flips on the first run and lets the second one flash an old answer.
  const seen = useRef(token);
  useEffect(() => {
    // Only a new answer — not the one already there on mount, not a clear.
    if (token === seen.current) return;
    seen.current = token;
    if (!token) return;
    setOn(true);
    const frame = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    const timer = window.setTimeout(() => setOn(false), 2200);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      // Its timer is gone, so end the flash here — otherwise a token that
      // changes mid-flash to nothing leaves the outline on for good.
      setOn(false);
    };
  }, [token]);

  return {
    ref,
    className: '-mx-[8px] rounded-field px-[8px] py-[6px] transition-[box-shadow,background-color] duration-500',
    style: {
      boxShadow: on ? '0 0 0 2px var(--acc)' : '0 0 0 2px transparent',
      background: on ? 'var(--accSoft)' : 'transparent',
    },
  };
}
