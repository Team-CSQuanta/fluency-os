import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { friendlyMessage } from '@/lib/friendlyError';
import { LEVEL_INFO, LevelTestDialog } from '@/features/settings/LevelTestDialog';
import { useOnboardingStore } from '@/store/onboardingStore';
import type { LevelTestOverviewOut } from '@/types/api';

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Placement is the level test — the same one Settings → Account uses to move
 * up, with the same questions, marking and rules. A level above A1 is earned
 * by passing its test; A1 needs none. The level is saved on the server the
 * moment it is earned, so this step only reads it back. */
export function StepPlacement() {
  const userId = useOnboardingStore((s) => s.userId);
  const level = useOnboardingStore((s) => s.placement.level);
  const updatePlacement = useOnboardingStore((s) => s.updatePlacement);
  const [overview, setOverview] = useState<LevelTestOverviewOut | null>(null);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const next = await api.get<LevelTestOverviewOut>(`/level-test?user_id=${encodeURIComponent(userId)}`);
      setOverview(next);
      updatePlacement({ level: next.current });
    } catch (err) {
      setError(friendlyMessage(err, 'Loading the level test'));
    }
  }, [userId, updatePlacement]);

  useEffect(() => {
    void load();
  }, [load]);

  const startAtA1 = async () => {
    if (!userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/users/${userId}/placement`, { cefr_level: 'A1' });
      await load();
    } catch (err) {
      setError(friendlyMessage(err, 'Starting at A1'));
    } finally {
      setBusy(false);
    }
  };

  if (!overview) {
    return (
      <div className="max-w-[560px] rounded-panel border border-line2 bg-panel px-[14px] py-6 text-center font-mono text-[11px] text-tx3">
        {error ?? 'loading…'}
      </div>
    );
  }

  const info = level ? LEVEL_INFO[level] : null;
  const passedAt = level ? overview.history.find((h) => h.passed && h.level === level) : undefined;
  const top = level === 'C2';
  const waitFor = (lvl: string) => {
    const until = overview.levels.find((l) => l.level === lvl)?.retry_after;
    return until && new Date(until).getTime() > Date.now() ? until : null;
  };

  return (
    <div className="flex max-w-[560px] flex-col gap-[11px]">
      {/* where the learner stands */}
      <div
        className="rounded-panel border px-[16px] py-4"
        style={{
          borderColor: level ? 'var(--accLine)' : 'var(--line2)',
          background: level ? 'var(--accSoft)' : 'var(--panel)',
        }}
      >
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-tx3">Your level</div>
        {level && info ? (
          <>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-sans text-[28px] font-light leading-none text-acc">{level}</span>
              <span className="font-sans text-[14px] font-medium text-tx">{info.name}</span>
              <span className="ml-auto font-mono text-[10px] text-tx3">
                {passedAt ? `passed · ${passedAt.correct}/${passedAt.total}` : 'starting point'}
              </span>
            </div>
            <p className="mt-2 font-sans text-[12px] leading-[1.6] text-tx2">{info.can}</p>
            {!top && (
              <button
                onClick={() => setTesting(true)}
                className="mt-3 rounded-field border border-line2 px-3 py-[6px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
              >
                try a higher level →
              </button>
            )}
          </>
        ) : (
          <>
            <div className="mt-1 font-sans text-[15px] text-tx">Not set yet</div>
            <p className="mt-2 font-sans text-[12px] leading-[1.6] text-tx2">
              Take the level test at the level you think you are at. Pass it and that is your level — and you can go
              straight on to the next one. New to English? Start at A1; that needs no test.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => setTesting(true)}
                className="rounded-field bg-accSolid px-4 py-[7px] font-sans text-[12px] font-semibold text-white"
              >
                Take the level test
              </button>
              <button
                onClick={() => void startAtA1()}
                disabled={busy}
                className="rounded-field border border-line2 px-3 py-[7px] font-sans text-[12px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
              >
                {busy ? 'setting…' : "I'm a beginner — start at A1"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* what the test is */}
      <div className="rounded-panel border border-line2 bg-panel px-[14px] py-3 font-mono text-[10px] leading-[1.7] text-tx3">
        The same level test as Settings → Account: {overview.questions} questions, {overview.minutes} minutes, pass
        with {Math.ceil(overview.questions * overview.pass_share)} right. Questions are drawn at random from a large
        bank and marked on the server. A failed level can be tried again after {overview.retry_hours} hours — the
        level below can be tried at once. A practical check, not an official CEFR exam.
      </div>

      {/* attempts so far */}
      {overview.history.length > 0 && (
        <div className="rounded-panel border border-line2 bg-panel px-[14px] py-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-tx3">Your tests</div>
          <div className="mt-2 flex flex-col gap-[5px]">
            {overview.history.map((h) => {
              const wait = !h.passed ? waitFor(h.level) : null;
              return (
                <div key={h.id} className="flex items-baseline justify-between gap-3 font-mono text-[10.5px]">
                  <span className="text-tx2">
                    {h.level} · {LEVEL_INFO[h.level as keyof typeof LEVEL_INFO]?.name}
                  </span>
                  <span style={{ color: h.passed ? 'var(--acc)' : 'var(--tx3)' }}>
                    {h.passed ? 'passed' : 'not yet'} · {h.correct}/{h.total}
                    {wait && ` · again after ${clockTime(wait)}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && <div className="font-mono text-[10.5px] text-[#c0563f]">{error}</div>}

      {testing && (
        <LevelTestDialog overview={overview} onClose={() => setTesting(false)} onChanged={() => void load()} />
      )}
    </div>
  );
}
