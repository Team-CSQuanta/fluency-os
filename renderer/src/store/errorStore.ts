import { create } from 'zustand';
import { friendlyError, type FriendlyError } from '@/lib/friendlyError';

/** One place for failures the reader has to be told about.
 *
 * Before this there was no such place: every screen kept its own `error`
 * string and printed it in its own corner, so a failure was a line of grey
 * text somewhere on the page — easy to miss when it mattered and impossible
 * to act on when it did not name an action.
 *
 * Not everything belongs here. A dialog interrupts, so it is for failures
 * that stopped something the reader asked for. A background refresh that did
 * not land, a preference write that can be retried on the next keystroke, a
 * thumbnail that would not load — those stay quiet or stay inline.
 */
interface ErrorState {
  current: FriendlyError | null;
  /** Retries the thing that failed, when the caller gave us a way to. */
  retry: (() => void) | null;
  report: (err: unknown, doing: string, retry?: () => void) => void;
  dismiss: () => void;
}

export const useErrorStore = create<ErrorState>((set) => ({
  current: null,
  retry: null,
  report: (err, doing, retry) => set({ current: friendlyError(err, doing), retry: retry ?? null }),
  dismiss: () => set({ current: null, retry: null }),
}));

/** Callable from anywhere, including outside React. */
export function reportError(err: unknown, doing: string, retry?: () => void): void {
  useErrorStore.getState().report(err, doing, retry);
}
