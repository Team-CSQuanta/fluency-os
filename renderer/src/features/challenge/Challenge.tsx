import { useEffect, useRef, useState } from 'react';
import { HintPanel } from '@/features/challenge/HintPanel';
import { SceneEmbed } from '@/features/challenge/SceneEmbed';
import { AiRequiredDialog } from '@/features/shell/AiRequiredDialog';
import { useMicRecorder } from '@/features/conversation/useMicRecorder';
import { SelectionLookup } from '@/features/vocabulary/SelectionLookup';
import { useChallengeStore } from '@/store/challengeStore';
import type { ChallengeRoundOut } from '@/types/api';

const CAP_SECONDS = 90;

function clock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function Challenge() {
  const {
    round, stats, hints, history, status, error,
    setEmbedsEnabled, reportUnavailable, skipScene, reportPlaybackError,
    aiNeededFor, aiNeededDetail, dismissAiNeeded,
    fetchStats, fetchHistory, startRound, askHints, submit,
  } = useChallengeStore();

  const recorder = useMicRecorder();
  /* The region whose words can be looked up by selecting them: the scene's
     instructions, the ten descriptions, the combined one and the learner's
     own transcript. Not the sidebar, where a selection is a score, not a
     word someone wants the meaning of. */
  const readable = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(false);
  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  useEffect(() => {
    void fetchStats();
    void fetchHistory();
  }, [fetchStats, fetchHistory]);

  /* Every per-round scrap of interface state, cleared when the round changes.
   *
   * These live in the component rather than the store, so nothing was clearing
   * them: starting a new round left the previous answer sitting in the textarea
   * and the panel still in typing mode, ready to be submitted against a scene
   * it was not written about. The stopwatch and the microphone error had the
   * same problem, just less visibly. */
  useEffect(() => {
    setTyped('');
    setTyping(false);
    setElapsed(0);
    setMicError(null);
  }, [round?.id]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((s) => Math.min(s + 1, CAP_SECONDS)), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const beginRecording = async () => {
    setMicError(null);
    setElapsed(0);
    const failure = await recorder.start();
    if (failure) {
      setMicError(failure);
      return;
    }
    setRecording(true);
  };

  const finishRecording = async () => {
    setRecording(false);
    const blob = await recorder.stop();
    if (!blob) {
      setMicError('Nothing was recorded.');
      return;
    }
    await submit({ audio: blob });
  };

  const scored = status === 'scored' && round?.status === 'scored';

  return (
    <div className="flex h-full min-h-0">
      {aiNeededFor && (
        <AiRequiredDialog
          what={aiNeededFor}
          detail={aiNeededDetail}
          onClose={dismissAiNeeded}
        />
      )}
      <div ref={readable} className="flex min-w-0 flex-1 flex-col overflow-y-auto p-[var(--pad)]">
        {stats && !stats.embeds_enabled && (
          <div className="mb-[14px] rounded-panel border border-line2 bg-panel p-[16px]">
            <div className="font-sans text-[13px] font-semibold text-tx">
              These scenes play from YouTube
            </div>
            <p className="mt-[6px] max-w-[560px] font-sans text-[12px] leading-[1.65] text-tx2">
              VATEX publishes the descriptions but not the video, so a scene is a YouTube clip played
              in an embed. This is the only part of FluencyOS that contacts anyone else: playing one
              tells <span className="font-mono text-[11.5px]">youtube-nocookie.com</span> your IP address
              and which clip you watched. Nothing about you, your vocabulary or your recordings is sent.
            </p>
            <div className="mt-[12px] flex items-center gap-3">
              <button
                onClick={() => void setEmbedsEnabled(true)}
                className="rounded-field bg-accSolid px-[14px] py-[8px] font-sans text-[11.5px] font-semibold text-white"
              >
                Turn on scene embeds
              </button>
            </div>
          </div>
        )}

        <div className="mb-[14px] flex flex-wrap items-baseline gap-[10px]">
          <span className="font-mono text-[10px] text-tx3">
            {stats
              ? `${stats.scene_pool.available.toLocaleString()} scenes ready · judged against 10 human descriptions`
              : ''}
          </span>
        </div>

        {error && (
          <div className="mb-3 rounded-panel border border-line2 bg-panel px-[14px] py-[11px] font-sans text-[11.5px] leading-[1.6] text-tx2">
            {error}
          </div>
        )}

        {!round && (
          <div className="rounded-panel border border-line2 bg-panel p-[20px]">
            <div className="font-sans text-[15px] font-semibold text-tx">Describe a scene</div>
            <p className="mt-[6px] max-w-[520px] font-sans text-[12.5px] leading-[1.65] text-tx2">
              A ten-second clip plays with <strong className="text-tx">captions off</strong>. Ten people
              have already described this exact clip, independently — you are marked against what they
              collectively saw, and then shown all ten.
            </p>
            <div className="mt-[14px] flex flex-wrap items-center gap-3">
              <button
                onClick={() => void startRound()}
                disabled={status === 'starting'}
                className="rounded-field bg-accSolid px-[16px] py-[9px] font-sans text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
              >
                {status === 'starting' ? 'finding a clip…' : 'Start a round'}
              </button>
              <span className="font-mono text-[10.5px] text-tx3">
                {stats
                  ? `${stats.scene_pool.available.toLocaleString()} scenes ready · ${stats.rounds_played} rounds played`
                  : ''}
              </span>
            </div>

            {stats && (
              <div className="mt-[18px] grid grid-cols-3 gap-[10px] border-t border-line2 pt-[16px]">
                <PoolStat
                  value={stats.scene_pool.total.toLocaleString()}
                  label="scenes in the corpus"
                  note="the whole public VATEX set"
                />
                <PoolStat
                  value={stats.scene_pool.resting.toLocaleString()}
                  label={`resting for ${stats.scene_pool.cooldown_days} days`}
                  note="scenes you have already described"
                />
                <PoolStat
                  value={stats.scene_pool.unavailable.toLocaleString()}
                  label="withdrawn"
                  note="videos that no longer play"
                />
              </div>
            )}
          </div>
        )}

        {round && (
          <div className="flex flex-col gap-[14px]">
            <div className="overflow-hidden rounded-panel border border-line2 bg-[#08090a]">
              {round.embed_url ? (
                <SceneEmbed
                  key={round.id}
                  src={round.embed_url}
                  startS={round.start_s ?? 0}
                  durationS={Math.max(1, (round.end_s ?? 0) - (round.start_s ?? 0))}
                  // The player knows within a second whether the video is gone.
                  // Letting it say so, and taking the next scene automatically,
                  // is the difference between a dead link costing a round and a
                  // dead link costing nothing.
                  onUnplayable={(reason) => void reportPlaybackError(reason)}
                />
              ) : (
                <div className="grid h-[200px] place-items-center font-mono text-[11px] text-white/40">
                  the clip for this moment is no longer on disk
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 px-[14px] py-[10px]">
                <span className="font-sans text-[12.5px] text-white/85">{round.prompt}</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-white/40">
                    {round.source === 'vatex'
                      ? `${round.media_title} · ${(round.end_s ?? 0) - (round.start_s ?? 0)}s of video`
                      : `${round.media_title} · ${round.target_word_count} target word${
                          round.target_word_count === 1 ? '' : 's'
                        }`}
                  </span>

                </span>
              </div>
            </div>

            {round.source === 'vatex' && round.status === 'open' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line2 bg-panel2 px-[14px] py-[10px]">
                <span className="min-w-[220px] flex-1 font-sans text-[11.5px] leading-[1.55] text-tx2">
                  Not a scene you can say much about, or nothing playing at all? Take another — these YouTube links
                  are years old and about one in eleven has gone.
                </span>
                <span className="flex flex-none items-center gap-2">
                  <button
                    onClick={() => void skipScene()}
                    className="rounded-field border border-line px-[13px] py-[7px] font-sans text-[11.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
                  >
                    Give me another scene
                  </button>
                  <button
                    onClick={() => void reportUnavailable()}
                    title="Retires this video for everyone, not just you"
                    className="rounded-field border border-line2 px-[11px] py-[7px] font-sans text-[11.5px] text-tx3 hover:border-acc hover:text-acc"
                  >
                    It won't play
                  </button>
                </span>
              </div>
            )}

            {!scored && (
              <div className="rounded-panel border border-line2 bg-panel p-[16px]">
                {micError && <p className="mb-2 font-sans text-[11.5px] text-[#e06c6c]">{micError}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  {!typing ? (
                    <>
                      <button
                        onClick={() => (recording ? void finishRecording() : void beginRecording())}
                        disabled={status === 'scoring'}
                        className="rounded-field px-[16px] py-[9px] font-sans text-[12px] font-semibold disabled:opacity-60"
                        style={{
                          background: recording ? 'transparent' : 'var(--acc)',
                          color: recording ? '#e0806a' : '#fff',
                          border: recording ? '1px solid #c0563f' : '1px solid transparent',
                        }}
                      >
                        {status === 'scoring'
                          ? 'scoring…'
                          : recording
                            ? `Stop · ${clock(elapsed)}`
                            : 'Start recording'}
                      </button>
                      <button
                        onClick={() => setTyping(true)}
                        className="font-mono text-[10.5px] text-tx3 hover:text-acc hover:underline"
                      >
                        type it instead
                      </button>
                    </>
                  ) : (
                    <div className="flex w-full flex-col gap-2">
                      <textarea
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        rows={4}
                        placeholder="Describe what you saw…"
                        className="w-full rounded-field border border-line2 bg-transparent p-[10px] font-sans text-[12.5px] text-tx outline-none focus:border-acc"
                      />
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => void submit({ text: typed })}
                          disabled={!typed.trim() || status === 'scoring'}
                          className="rounded-field bg-accSolid px-[14px] py-[8px] font-sans text-[11.5px] font-semibold text-white disabled:opacity-60"
                        >
                          {status === 'scoring' ? 'scoring…' : 'Submit'}
                        </button>
                        <button
                          onClick={() => setTyping(false)}
                          className="font-mono text-[10.5px] text-tx3 hover:text-acc"
                        >
                          back to recording
                        </button>
                        <span className="font-mono text-[9.5px] text-tx3">
                          typed answers score nothing for speaking time
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-[14px] border-t border-line2 pt-[12px]">
                  <HintPanel
                  hints={hints}
                  vatex={round.source === 'vatex'}
                  onAsk={(level) => void askHints(level)}
                />
                </div>
              </div>
            )}

            {scored && round.overall !== null && <ScoreCard round={round} onAgain={() => void startRound()} />}
          </div>
        )}
      </div>

      <SelectionLookup within={readable} source="the Scene Description Challenge" />

      <aside className="flex w-[260px] flex-none flex-col gap-[14px] overflow-y-auto border-l border-line2 p-[16px]">
        <div>
          <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Best score
          </div>
          <div className="mt-[6px] flex items-baseline gap-[7px]">
            <span className="font-mono text-[22px] tabular-nums text-tx">
              {stats?.personal_bests.describe ?? '—'}
            </span>
            <span className="font-sans text-[11px] text-tx3">
              {stats?.personal_bests.describe ? 'out of 100' : 'nothing scored yet'}
            </span>
          </div>
        </div>

        {history.length > 0 && (
          <div>
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
              Recent rounds
            </div>
            <div className="mt-[8px] flex flex-col gap-[6px]">
              {history.slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-field border border-line2 p-[8px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-sans text-[11px] font-medium capitalize text-tx">{entry.kind}</span>
                    <span className="font-mono text-[12px] tabular-nums text-acc">{entry.overall}</span>
                  </div>
                  <div className="mt-[2px] truncate font-mono text-[9px] text-tx3">{entry.media_title}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-auto font-mono text-[9px] leading-[1.7] text-tx3">
          scenes and descriptions from VATEX (Wang et al., ICCV 2019), CC BY 4.0
        </p>
      </aside>
    </div>
  );
}

/** The model's own description of the scene, built from the ten and drawing on
 * the learner's vocabulary where it genuinely fits.
 *
 * Offered rather than fetched. It spends a real model call, and it is only
 * useful once the learner has had their own go — handed over earlier it would
 * simply be the answer.
 */
function EnrichmentPanel() {
  const enrichment = useChallengeStore((s) => s.enrichment);
  const enriching = useChallengeStore((s) => s.enriching);
  const enrich = useChallengeStore((s) => s.enrich);

  if (!enrichment) {
    return (
      <div className="mt-[12px]">
        <button
        onClick={() => void enrich()}
        disabled={enriching}
        className="w-full rounded-field border border-line px-[13px] py-[9px] font-sans text-[11.5px] font-medium text-tx2 transition-colors hover:border-acc hover:text-acc disabled:opacity-60"
      >
          {enriching ? 'writing it…' : 'Show one richer version'}
        </button>
        <p className="mt-[5px] text-center font-mono text-[9.5px] leading-[1.6] text-tx3">
          the AI combines all ten narrations into one fuller description of the scene, working in
          words from your vocabulary where they genuinely fit
        </p>
      </div>
    );
  }

  return (
    <div className="mt-[14px] rounded-field border border-accLine bg-accSoft/40 p-[13px]">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-acc">
        all ten, combined
      </div>
      <p className="mt-[7px] font-sans text-[12.5px] leading-[1.7] text-tx">
        {enrichment.description}
      </p>

      {enrichment.used_words.length > 0 ? (
        <div className="mt-[11px] border-t border-accLine/50 pt-[10px]">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            your words that fitted this scene
          </div>
          <div className="mt-[7px] flex flex-col gap-[5px]">
            {enrichment.used_words.map((w) => (
              <div key={w.vocab_word_id} className="flex items-baseline gap-[8px]">
                <span className="rounded-full border border-accLine bg-accSoft px-[9px] py-[3px] font-sans text-[11px] font-medium text-acc">
                  {w.word}
                </span>
                {w.why && (
                  <span className="font-sans text-[11px] leading-[1.5] text-tx3">{w.why}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-[10px] font-mono text-[9.5px] leading-[1.6] text-tx3">
          none of your saved words fitted this scene — forcing one in would have taught the wrong
          context for it
        </p>
      )}
    </div>
  );
}

function PoolStat({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div>
      <div className="font-mono text-[17px] tabular-nums text-tx">{value}</div>
      <div className="mt-[2px] font-sans text-[11px] font-medium text-tx2">{label}</div>
      <div className="mt-[1px] font-mono text-[9px] leading-[1.5] text-tx3">{note}</div>
    </div>
  );
}

function ScoreCard({ round, onAgain }: { round: ChallengeRoundOut; onAgain: () => void }) {
  const vatex = round.source === 'vatex';
  const parts = [
    ...(vatex
      ? [
          { name: 'accuracy', value: String(round.relevance_score ?? 0), pct: round.relevance_score ?? 0, judged: true },
          { name: 'detail noticed', value: String(round.detail_score ?? 0), pct: round.detail_score ?? 0, judged: true },
        ]
      : [
          { name: 'target words', value: `${round.feedback?.target_words_used.length ?? 0} / ${round.target_words.length}`, pct: (round.target_coverage ?? 0) * 100, judged: false },
          { name: 'scene relevance', value: String(round.relevance_score ?? 0), pct: round.relevance_score ?? 0, judged: true },
        ]),
    { name: 'grammar', value: String(round.grammar_score ?? 0), pct: round.grammar_score ?? 0, judged: true },
    {
      name: 'speaking time',
      // Not "—". A typed attempt is scored, as nought, and loses this whole
      // component — saying "not measured" hides a real ten points.
      value: round.speech_seconds ? `${Math.round(round.speech_seconds)} s` : '0 s · typed',
      pct: (round.duration_score ?? 0) * 100,
      judged: false,
    },
  ];

  return (
    <div className="rounded-panel border border-line2 bg-panel p-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="font-sans text-[15px] font-semibold text-tx">
          You scored {round.overall}
          {/* Both numbers, never one that silently absorbed the other: the
              description was worth X, and the hints cost Y. */}
          {round.hint_penalty > 0 && (
            <span className="ml-[8px] font-mono text-[11px] font-normal text-tx3">
              {round.raw_overall} for the description, −{round.hint_penalty} for{' '}
              {round.hint_level} hint{round.hint_level === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <button
          onClick={onAgain}
          className="rounded-field bg-accSolid px-[14px] py-[7px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
        >
          Another round
        </button>
      </div>

      <div className="mt-[14px] flex flex-col gap-[9px]">
        {parts.map((part) => (
          <div key={part.name}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-sans text-[11.5px] text-tx2">
                {part.name}
                <span className="ml-[6px] font-mono text-[9px] text-tx3">
                  {part.judged ? 'judged' : 'counted'}
                </span>
              </span>
              <span className="font-mono text-[11px] tabular-nums text-tx">{part.value}</span>
            </div>
            <div className="mt-[3px] h-[3px] rounded-field bg-line2">
              <div className="h-[3px] rounded-field bg-acc" style={{ width: `${Math.min(100, part.pct)}%` }} />
            </div>
          </div>
        ))}
      </div>

      {round.feedback?.note && (
        <p className="mt-[14px] font-sans text-[12.5px] leading-[1.6] text-tx">{round.feedback.note}</p>
      )}

      {(round.feedback?.corrections.length ?? 0) > 0 && (
        <div className="mt-[12px] flex flex-col gap-[5px]">
          {round.feedback!.corrections.map((fix, i) => (
            <div key={i} className="font-sans text-[11.5px] leading-[1.6]">
              <span className="text-tx3 line-through">{fix.said}</span>
              <span className="mx-[6px] text-tx3">→</span>
              <span className="text-tx">{fix.better}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-[14px] border-t border-line2 pt-[12px]">
        {round.reference_captions.length > 0 ? (
          <>
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
              How {round.reference_captions.length} people described the same clip
            </div>
            <p className="mt-[4px] font-mono text-[9.5px] leading-[1.6] text-tx3">
              they wrote these independently — notice how differently they each said it
            </p>
            <ul className="mt-[8px] flex flex-col gap-[5px]">
              {round.reference_captions.map((caption, i) => (
                <li key={i} className="font-sans text-[12px] leading-[1.55] text-tx2">
                  <span className="mr-[7px] font-mono text-[9.5px] text-tx3">{i + 1}</span>
                  {caption}
                </li>
              ))}
            </ul>
            <EnrichmentPanel />
          </>
        ) : (
          <>
            <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
              What was actually said
            </div>
            <p className="mt-[6px] font-sans text-[12.5px] leading-[1.65] text-tx2">“{round.cue_text}”</p>
          </>
        )}
        {round.transcript && (
          <>
            <div className="mt-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
              What you said
            </div>
            <p className="mt-[6px] font-sans text-[12.5px] leading-[1.65] text-tx2">“{round.transcript}”</p>
          </>
        )}
      </div>
    </div>
  );
}
