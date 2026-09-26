import type { ReviewStatsOut } from '@/types/api';

export type ReviewEmptyState =
  | 'cleared-all'
  | 'cleared-more'
  | 'empty'
  | 'ready'
  | 'nothing-due';

export interface EmptyStateCopy {
  state: ReviewEmptyState;
  heading: string;
  body: string;
  /** Cards available to start a (further) sitting with. */
  waiting: number;
  canStart: boolean;
  startLabel: string;
}

/** What the Review screen says when there is no card on screen.
 *
 * One decision, deliberately. The heading and the body used to be computed
 * separately and disagreed: with three cards due the heading read "Ready when
 * you are" while the body underneath read "Nothing is due right now", because
 * the body's only other branch was "no cards at all". Two sources of truth
 * for one question is what allowed that.
 */
export function reviewEmptyState(
  stats: ReviewStatsOut | null,
  { done, answered }: { done: boolean; answered: number },
): EmptyStateCopy {
  const due = stats?.due_now ?? 0;
  const fresh = stats?.new_available ?? 0;
  // Work still waiting after a finished session is real: a sitting is capped
  // (spec §5.5 load smoothing), so clearing 20 of 40 due cards is progress
  // rather than completion, and the screen has to offer a way to continue.
  const waiting = due + fresh;
  const answeredLabel = `${answered} card${answered === 1 ? '' : 's'}`;

  let state: ReviewEmptyState;
  if (done) state = waiting > 0 ? 'cleared-more' : 'cleared-all';
  else if (stats && stats.total_cards === 0) state = 'empty';
  else state = waiting > 0 ? 'ready' : 'nothing-due';

  const heading = {
    'cleared-all': 'Queue cleared',
    'cleared-more': 'Session done',
    empty: 'Nothing saved yet',
    ready: 'Ready when you are',
    'nothing-due': 'Nothing due',
  }[state];

  const body = {
    'cleared-all': `You answered ${answeredLabel}. They'll come back when the scheduler says they're worth your time.`,
    'cleared-more': `You answered ${answeredLabel}. ${waiting} more ${waiting === 1 ? 'is' : 'are'} waiting whenever you want them — a sitting is capped so a backlog stays workable.`,
    empty: 'Save words while reading or watching and they will appear here on a schedule.',
    ready: `${waiting} card${waiting === 1 ? '' : 's'} waiting — ${due} due, ${fresh} new.`,
    'nothing-due': 'Nothing is due right now — coming back before a card is due mostly wastes the review.',
  }[state];

  const canStart = state === 'ready' || state === 'cleared-more';
  return {
    state,
    heading,
    body,
    waiting,
    canStart,
    startLabel: state === 'cleared-more' ? 'keep going' : 'start reviewing',
  };
}
