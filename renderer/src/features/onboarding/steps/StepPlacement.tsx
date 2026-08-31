import { CEFR_LEVELS } from '@/features/onboarding/onboardingConfig';
import { useOnboardingStore } from '@/store/onboardingStore';

function SelfAssessRow() {
  const selfAssessedCefr = useOnboardingStore((s) => s.placement.selfAssessedCefr);
  const status = useOnboardingStore((s) => s.placement.placementCheckStatus);
  const updatePlacement = useOnboardingStore((s) => s.updatePlacement);

  return (
    <div className="flex items-center justify-between gap-4 rounded-panel border border-line2 bg-panel px-[14px] py-3">
      <div>
        <div className="font-sans text-[12.5px] font-medium text-tx">Self-assessed level</div>
        <div className="mt-[2px] font-mono text-[10px] text-tx3">
          your starting guess — the check below can confirm or correct it
        </div>
      </div>
      <select
        value={selfAssessedCefr}
        disabled={status !== 'not_started'}
        onChange={(e) => updatePlacement({ selfAssessedCefr: e.target.value })}
        className="rounded-field border border-line2 bg-panel2 px-[10px] py-[6px] font-mono text-[11px] text-acc outline-none focus:border-acc disabled:opacity-50"
      >
        {CEFR_LEVELS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

function IntroCard() {
  const startPlacementQuiz = useOnboardingStore((s) => s.startPlacementQuiz);

  return (
    <div className="rounded-panel border border-line2 bg-panel px-[14px] py-4">
      <div className="font-sans text-[12.5px] font-medium text-tx">Placement check</div>
      <div className="mt-[6px] font-mono text-[10px] leading-[1.7] text-tx3">
        20 quick grammar &amp; vocabulary questions, ordered from easy to hard — about four minutes. This is a
        lightweight screener, not a certified CEFR exam, and you can redo it any time from Settings → Learning.
      </div>
      <button
        onClick={startPlacementQuiz}
        className="mt-3 rounded-field border border-line2 px-3 py-[6px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
      >
        start →
      </button>
    </div>
  );
}

function QuizCard() {
  const questions = useOnboardingStore((s) => s.placement.questions);
  const currentIndex = useOnboardingStore((s) => s.placement.currentIndex);
  const answers = useOnboardingStore((s) => s.placement.answers);
  const answerPlacementQuestion = useOnboardingStore((s) => s.answerPlacementQuestion);
  const goToPlacementQuestion = useOnboardingStore((s) => s.goToPlacementQuestion);
  const submitPlacementQuiz = useOnboardingStore((s) => s.submitPlacementQuiz);

  if (!questions) {
    return (
      <div className="rounded-panel border border-line2 bg-panel px-[14px] py-6 text-center font-mono text-[11px] text-tx3">
        loading questions…
      </div>
    );
  }

  const question = questions[currentIndex];
  const selected = answers[question.id];
  const isLast = currentIndex === questions.length - 1;
  const answeredCount = Object.keys(answers).length;

  return (
    <div className="rounded-panel border border-line2 bg-panel px-[14px] py-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-tx3">
          Question {currentIndex + 1} of {questions.length}
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-tx3">{question.category}</span>
      </div>

      <div className="mt-2 h-[3px] rounded-field bg-line2">
        <div
          className="h-[3px] rounded-field bg-acc transition-[width]"
          style={{ width: `${(answeredCount / questions.length) * 100}%` }}
        />
      </div>

      <div className="mt-4 font-sans text-[15px] leading-[1.5] text-tx">{question.prompt}</div>

      <div className="mt-3 flex flex-col gap-2">
        {question.options.map((opt, i) => {
          const on = selected === i;
          return (
            <button
              key={i}
              onClick={() => answerPlacementQuestion(question.id, i)}
              className="rounded-field border px-3 py-[9px] text-left font-sans text-[12.5px]"
              style={{
                borderColor: on ? 'var(--acc)' : 'var(--line2)',
                background: on ? 'var(--accSoft)' : 'transparent',
                color: on ? 'var(--acc)' : 'var(--tx2)',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => goToPlacementQuestion(currentIndex - 1)}
          disabled={currentIndex === 0}
          className="rounded-field border border-line2 px-3 py-[6px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-40"
        >
          ← back
        </button>
        {isLast ? (
          <button
            onClick={submitPlacementQuiz}
            disabled={selected === undefined}
            className="rounded-field bg-acc px-4 py-[6px] font-mono text-[11px] font-semibold text-white disabled:opacity-40"
          >
            finish
          </button>
        ) : (
          <button
            onClick={() => goToPlacementQuestion(currentIndex + 1)}
            disabled={selected === undefined}
            className="rounded-field border border-accLine bg-accSoft px-3 py-[6px] font-mono text-[11px] text-acc disabled:opacity-40"
          >
            next →
          </button>
        )}
      </div>
    </div>
  );
}

function ResultCard() {
  const result = useOnboardingStore((s) => s.placement.result);
  const selfAssessedCefr = useOnboardingStore((s) => s.placement.selfAssessedCefr);
  const retakePlacementQuiz = useOnboardingStore((s) => s.retakePlacementQuiz);

  if (!result) return null;

  return (
    <div className="rounded-panel border border-accLine bg-accSoft px-[14px] py-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-tx3">Estimated level</div>
          <div className="mt-1 font-sans text-[26px] font-light leading-none text-acc">{result.estimated_cefr}</div>
        </div>
        <div className="text-right font-mono text-[10px] text-tx3">
          {result.raw_score} / {result.total_questions} correct
          {selfAssessedCefr !== result.estimated_cefr && (
            <div className="mt-[2px]">self-assessed was {selfAssessedCefr}</div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-[6px]">
        {result.breakdown.map((b) => (
          <div key={b.level} className="flex items-center gap-2">
            <span className="w-6 font-mono text-[10px] text-tx3">{b.level}</span>
            <div className="h-[6px] flex-1 overflow-hidden rounded-field bg-line2">
              <div
                className="h-[6px] rounded-field bg-acc"
                style={{ width: `${Math.round(b.accuracy * 100)}%` }}
              />
            </div>
            <span className="w-10 text-right font-mono text-[10px] text-tx3">
              {b.correct}/{b.total}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 font-mono text-[10px] leading-[1.6] text-tx3">
        heuristic screener, not a certified CEFR exam — redo any time from Settings → Learning
      </div>

      <button
        onClick={retakePlacementQuiz}
        className="mt-3 rounded-field border border-line2 px-3 py-[6px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
      >
        retake
      </button>
    </div>
  );
}

export function StepPlacement() {
  const status = useOnboardingStore((s) => s.placement.placementCheckStatus);

  return (
    <div className="flex max-w-[560px] flex-col gap-[11px]">
      <SelfAssessRow />
      {status === 'not_started' && <IntroCard />}
      {status === 'in_progress' && <QuizCard />}
      {status === 'scored' && <ResultCard />}
    </div>
  );
}
