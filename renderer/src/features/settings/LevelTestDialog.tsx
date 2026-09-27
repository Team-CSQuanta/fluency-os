import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/lib/apiClient';
import { friendlyMessage } from '@/lib/friendlyError';
import { useAppStore } from '@/store/appStore';
import type {
  CefrLevel,
  LevelAttemptOut,
  LevelTestOverviewOut,
  LevelTestResultOut,
} from '@/types/api';

/** What each level means, in a line — so choosing one is an informed choice. */
export const LEVEL_INFO: Record<CefrLevel, { name: string; can: string }> = {
  A1: { name: 'Beginner', can: 'Basic phrases and simple everyday expressions.' },
  A2: { name: 'Elementary', can: 'Simple, routine exchanges about familiar things.' },
  B1: { name: 'Intermediate', can: 'Most everyday situations; describing experiences and plans.' },
  B2: { name: 'Upper-intermediate', can: 'Fluent talk with native speakers; following complex arguments.' },
  C1: { name: 'Advanced', can: 'Flexible use for work and study; understanding what is implied.' },
  C2: { name: 'Proficient', can: 'Understanding virtually everything; expressing yourself precisely.' },
};

const LETTERS = ['A', 'B', 'C', 'D'];
const ORDER: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const rank = (level: CefrLevel | null) => (level ? ORDER.indexOf(level) : -1);

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function remaining(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

/** The level test, from choosing a level to the result. A dialog over the
 * whole window: it is timed, and nothing else should compete with it.
 *
 * Also onboarding's placement: a learner with no level yet takes the test at
 * the level they think they are at, then climbs (or steps down) from the
 * result. A1 is the floor and needs no test. */
export function LevelTestDialog({
  overview,
  onClose,
  onChanged,
}: {
  overview: LevelTestOverviewOut;
  onClose: () => void;
  /** After a result, so the page and the profile can catch up. */
  onChanged: () => void;
}) {
  const userId = useAppStore((s) => s.currentUserId);
  const [attempt, setAttempt] = useState<LevelAttemptOut | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<LevelTestResultOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [leaving, setLeaving] = useState(false);

  const begin = async (level: CefrLevel) => {
    if (!userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api.post<LevelAttemptOut>('/level-test/attempts', { user_id: userId, level });
      setResult(null);
      setAttempt(made);
      setAnswers(made.questions.map(() => null));
      setIndex(0);
    } catch (err) {
      setError(friendlyMessage(err, 'Starting the level test'));
    } finally {
      setBusy(false);
    }
  };

  /** A1 is the floor: starting there is a choice, not a claim to prove. */
  const startAtA1 = async () => {
    if (!userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/users/${userId}/placement`, { cefr_level: 'A1' });
      onChanged();
      onClose();
    } catch (err) {
      setError(friendlyMessage(err, 'Starting at A1'));
    } finally {
      setBusy(false);
    }
  };

  const submit = useCallback(async () => {
    if (!userId || !attempt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const marked = await api.post<LevelTestResultOut>(`/level-test/attempts/${attempt.id}/submit`, {
        user_id: userId,
        answers,
      });
      setResult(marked);
      onChanged();
    } catch (err) {
      setError(friendlyMessage(err, 'Marking your test'));
    } finally {
      setBusy(false);
      setLeaving(false);
    }
  }, [userId, attempt, answers, busy, onChanged]);

  // The clock, and marking whatever is answered when it runs out.
  const testing = attempt !== null && result === null;
  useEffect(() => {
    if (!testing) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [testing]);
  const secondsLeft = attempt ? remaining(attempt.expires_at, now) : 0;
  useEffect(() => {
    if (testing && secondsLeft === 0) void submit();
  }, [testing, secondsLeft, submit]);

  const choose = (option: number) =>
    setAnswers((prev) => prev.map((a, i) => (i === index ? option : a)));

  // 1-4 or A-D answers; Enter or → goes on; ← goes back.
  useEffect(() => {
    if (!testing || leaving) return;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      const pick = '1234'.indexOf(key) >= 0 ? '1234'.indexOf(key) : LETTERS.indexOf(key);
      if (pick >= 0 && attempt && pick < attempt.questions[index].options.length) {
        e.preventDefault();
        choose(pick);
      } else if ((e.key === 'Enter' || e.key === 'ArrowRight') && attempt && index < attempt.questions.length - 1) {
        e.preventDefault();
        setIndex(index + 1);
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        setIndex(index - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testing, leaving, attempt, index]);

  // Where to go from a result: up after a pass, down after a failure — as
  // long as that is a level the learner has not already got.
  const unplaced = !overview.current;
  const levelNow: CefrLevel | null = result?.new_level ?? overview.current;
  const tried = result ? rank(result.level) : -1;
  const followOn: CefrLevel | null = !result
    ? null
    : result.passed
      ? (ORDER[tried + 1] ?? null)
      : tried > 0 && rank(ORDER[tried - 1]) > rank(levelNow)
        ? ORDER[tried - 1]
        : null;

  const answered = answers.filter((a) => a !== null).length;
  const question = attempt?.questions[index];
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  // Leaving mid-test marks what is there — otherwise walking out would be a
  // free look at the questions.
  const requestClose = () => {
    if (testing) setLeaving(true);
    else onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/60 p-6" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Level test"
        className="flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-panel border border-line2 bg-panel shadow-xl"
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-line2 px-5 py-[13px]">
          <div className="font-sans text-[14px] font-semibold text-tx">
            {attempt
              ? `Level test · ${attempt.level} ${LEVEL_INFO[attempt.level].name}`
              : unplaced
                ? 'Find your level'
                : 'Take a level test'}
          </div>
          <div className="flex items-center gap-3">
            {testing && (
              <span
                className="font-mono text-[12px] tabular-nums"
                style={{ color: secondsLeft < 120 ? '#e0806a' : 'var(--tx2)' }}
                title="Time left — the test is marked when it runs out"
              >
                ⏱ {minutes}:{seconds}
              </span>
            )}
            <button onClick={requestClose} className="font-mono text-[12px] text-tx3 hover:text-acc" aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* choose a level */}
          {!attempt && (
            <>
              <p className="font-sans text-[12.5px] leading-[1.65] text-tx2">
                {unplaced
                  ? 'Choose the level you think you are at. Pass its test and that is your level — then you can try the next one up straight away. '
                  : 'Moving up a level takes a test at that level. '}
                {overview.questions} questions, {overview.minutes}{' '}
                minutes, pass with {Math.ceil(overview.questions * overview.pass_share)} right. Most questions are at
                the level you choose and a few come from the one below. They are drawn at random and the choices
                shuffled, so every test is different. After a failed attempt, that level can be tried again in{' '}
                {overview.retry_hours} hours.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-[8px]">
                {overview.levels.map((l) => {
                  const info = LEVEL_INFO[l.level];
                  const waiting = l.retry_after && new Date(l.retry_after).getTime() > now;
                  const canTake = l.relation === 'above' && !waiting;
                  // With no level yet, A1 is a starting point rather than a test.
                  const floor = l.level === 'A1' && l.relation === 'above';
                  return (
                    <button
                      key={l.level}
                      disabled={!canTake || busy}
                      onClick={() => void (floor ? startAtA1() : begin(l.level))}
                      className="flex flex-col rounded-field border px-[13px] py-[11px] text-left disabled:cursor-default"
                      style={{
                        borderColor: l.relation === 'current' ? 'var(--accLine)' : 'var(--line2)',
                        background: l.relation === 'current' ? 'var(--accSoft)' : 'transparent',
                        opacity: l.relation === 'below' ? 0.55 : 1,
                      }}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-sans text-[13px] font-semibold text-tx">
                          {l.level} · {info.name}
                        </span>
                        <span className="font-mono text-[9.5px] text-acc">
                          {l.relation === 'current'
                            ? 'your level'
                            : l.relation === 'below'
                              ? 'below yours'
                              : waiting
                                ? `again after ${clockTime(l.retry_after!)}`
                                : busy
                                  ? 'preparing…'
                                  : floor
                                    ? 'start here — no test'
                                    : 'take the test →'}
                        </span>
                      </span>
                      <span className="mt-[4px] font-sans text-[11px] leading-[1.5] text-tx3">{info.can}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 font-mono text-[9.5px] leading-[1.6] text-tx3">
                {unplaced
                  ? 'a practical check, not an official CEFR exam · the same test moves you up later, from Settings → Account'
                  : 'a practical check, not an official CEFR exam · moving down needs no test — use Move down on the Account page'}
              </p>
            </>
          )}

          {/* the test */}
          {testing && question && (
            <>
              <div className="flex items-center gap-3">
                <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-line2">
                  <div
                    className="h-full bg-acc transition-[width] duration-200"
                    style={{ width: `${((index + 1) / attempt.questions.length) * 100}%` }}
                  />
                </div>
                <span className="font-mono text-[10.5px] text-tx3">
                  {index + 1} / {attempt.questions.length} · {answered} answered
                </span>
              </div>

              <div className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-tx3">{question.skill}</div>
              {question.passage && (
                <blockquote className="mt-3 rounded-field border-l-2 border-acc bg-panel2 px-4 py-3 font-sans text-[13px] leading-[1.7] text-tx2">
                  {question.passage}
                </blockquote>
              )}
              <div className="mt-4 font-sans text-[17px] leading-[1.55] text-tx">{question.prompt}</div>

              <div className="mt-4 flex flex-col gap-[7px]">
                {question.options.map((option, i) => {
                  const picked = answers[index] === i;
                  return (
                    <button
                      key={i}
                      onClick={() => choose(i)}
                      className="flex items-center gap-3 rounded-field border px-[13px] py-[10px] text-left font-sans text-[13px] text-tx hover:border-acc"
                      style={{
                        borderColor: picked ? 'var(--acc)' : 'var(--line2)',
                        background: picked ? 'var(--accSoft)' : 'transparent',
                      }}
                    >
                      <span
                        className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full border font-mono text-[10.5px]"
                        style={{
                          borderColor: picked ? 'var(--acc)' : 'var(--line)',
                          color: picked ? 'var(--acc)' : 'var(--tx3)',
                        }}
                      >
                        {LETTERS[i]}
                      </span>
                      {option}
                    </button>
                  );
                })}
              </div>

              {/* jump to any question; answered ones are filled */}
              <div className="mt-5 flex flex-wrap gap-[5px]">
                {attempt.questions.map((q, i) => (
                  <button
                    key={q.id}
                    onClick={() => setIndex(i)}
                    title={`Question ${i + 1}${answers[i] === null ? ' — not answered' : ''}`}
                    className="h-[22px] w-[22px] rounded-[5px] border font-mono text-[9.5px]"
                    style={{
                      borderColor: i === index ? 'var(--acc)' : 'var(--line2)',
                      background: answers[i] !== null ? 'var(--accSoft)' : 'transparent',
                      color: answers[i] !== null ? 'var(--acc)' : 'var(--tx3)',
                    }}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* the result */}
          {result && (
            <div className="text-center">
              <div className="font-sans text-[22px] font-semibold text-tx">
                {result.passed ? `Passed — you're now ${result.level}` : 'Not this time'}
              </div>
              <div className="mt-2 font-sans text-[13px] text-tx2">
                {result.correct} of {result.total} right · you needed {result.pass_mark}
              </div>
              <div className="mx-auto mt-5 flex max-w-[380px] flex-col gap-[9px] text-left">
                {result.by_skill.map((s) => (
                  <div key={s.skill}>
                    <div className="flex justify-between font-mono text-[10.5px] text-tx3">
                      <span>{s.name}</span>
                      <span>
                        {s.correct} / {s.total}
                      </span>
                    </div>
                    <div className="mt-[4px] h-[5px] overflow-hidden rounded-full bg-line2">
                      <div className="h-full bg-acc" style={{ width: `${(s.correct / Math.max(1, s.total)) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mx-auto mt-5 max-w-[440px] font-sans text-[12px] leading-[1.65] text-tx3">
                {result.passed
                  ? 'Reading tints, target words and your conversation partner now work at this level.'
                  : `${levelNow ? 'Your level stays as it was.' : 'No level is set yet.'} You can try ${result.level} again after ${clockTime(result.retry_after!)} — the questions will be different.`}
              </p>
            </div>
          )}

          {error && <div className="mt-4 font-mono text-[10.5px] text-[#c0563f]">{error}</div>}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-3 border-t border-line2 px-5 py-[12px]">
          {leaving ? (
            <>
              <span className="font-sans text-[12px] text-tx2">
                Leave the test? What you have answered will be marked now.
              </span>
              <span className="flex gap-2">
                <button
                  onClick={() => setLeaving(false)}
                  className="rounded-field border border-line px-3 py-[7px] font-sans text-[11.5px] text-tx2 hover:border-acc"
                >
                  keep going
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={busy}
                  className="rounded-field bg-accSolid px-3 py-[7px] font-sans text-[11.5px] font-semibold text-white disabled:opacity-60"
                >
                  {busy ? 'marking…' : 'mark and leave'}
                </button>
              </span>
            </>
          ) : testing ? (
            <>
              <button
                onClick={() => setIndex(Math.max(0, index - 1))}
                disabled={index === 0}
                className="rounded-field border border-line px-3 py-[7px] font-sans text-[11.5px] text-tx2 hover:border-acc disabled:opacity-40"
              >
                ← back
              </button>
              <span className="font-mono text-[9.5px] text-tx3">1–4 to answer · enter for next</span>
              {index < attempt.questions.length - 1 ? (
                <button
                  onClick={() => setIndex(index + 1)}
                  className="rounded-field border border-line px-3 py-[7px] font-sans text-[11.5px] text-tx2 hover:border-acc"
                >
                  next →
                </button>
              ) : (
                <button
                  onClick={() => void submit()}
                  disabled={busy}
                  className="rounded-field bg-accSolid px-4 py-[7px] font-sans text-[11.5px] font-semibold text-white disabled:opacity-60"
                  title={answered < attempt.questions.length ? 'Unanswered questions count as wrong' : undefined}
                >
                  {busy
                    ? 'marking…'
                    : answered < attempt.questions.length
                      ? `Submit (${attempt.questions.length - answered} unanswered)`
                      : 'Submit'}
                </button>
              )}
            </>
          ) : (
            <>
              <span />
              <span className="flex gap-2">
                {followOn && (
                  <button
                    onClick={() => void (followOn === 'A1' ? startAtA1() : begin(followOn))}
                    disabled={busy}
                    className="rounded-field border border-accLine bg-accSoft px-3 py-[7px] font-sans text-[11.5px] font-semibold text-acc disabled:opacity-60"
                  >
                    {busy
                      ? 'preparing…'
                      : followOn === 'A1'
                        ? 'Start at A1'
                        : result?.passed
                          ? `Try ${followOn} too →`
                          : `Try ${followOn} instead →`}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="rounded-field bg-accSolid px-4 py-[7px] font-sans text-[11.5px] font-semibold text-white"
                >
                  {result ? 'Done' : 'Close'}
                </button>
              </span>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
