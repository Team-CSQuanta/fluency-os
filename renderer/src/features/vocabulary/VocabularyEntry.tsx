import { useEffect, useState } from 'react';
import { MasteryDot, dueLabel } from '@/features/vocabulary/MasteryDot';

// Conversation outcomes and flashcard ratings read better with the same
// colour language as the Review screen: only failure is coloured as a
// warning, success is quiet.
const USAGE_COLOR: Record<string, string> = {
  spontaneous: '#3f9d5c',
  prompted: 'var(--acc)',
  incorrect: '#c0563f',
  avoided: '#d9a441',
};
const RATING_COLOR: Record<string, string> = {
  again: '#c0563f',
  hard: '#d9a441',
  good: 'var(--acc)',
  easy: '#3f9d5c',
};
import { POS_FULL } from '@/features/vocabulary/vocabMockData';
import { useShellStore } from '@/store/shellStore';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { ClipContext } from '@/features/vocabulary/ClipContext';

export function VocabularyEntry() {
  const word = useShellStore((s) => s.selectedWord);
  const goScreen = useShellStore((s) => s.goScreen);
  const goForest = () => goScreen('forest');

  const selectedDetail = useVocabularyStore((s) => s.selectedDetail);
  const detailStatus = useVocabularyStore((s) => s.detailStatus);
  const fetchWordDetail = useVocabularyStore((s) => s.fetchWordDetail);
  const addNote = useVocabularyStore((s) => s.addNote);
  const deleteNote = useVocabularyStore((s) => s.deleteNote);
  const addTag = useVocabularyStore((s) => s.addTag);
  const removeTag = useVocabularyStore((s) => s.removeTag);
  const deleteWord = useVocabularyStore((s) => s.deleteWord);
  const generateMnemonic = useVocabularyStore((s) => s.generateMnemonic);
  const fetchAiExamples = useVocabularyStore((s) => s.fetchAiExamples);
  const fetchAiPractice = useVocabularyStore((s) => s.fetchAiPractice);
  const pronunciationUrl = useVocabularyStore((s) => s.pronunciationUrl);
  const speakText = useVocabularyStore((s) => s.speakText);

  const [playing, setPlaying] = useState<null | 'dict' | 'word' | 'sentence'>(null);
  const [speakError, setSpeakError] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const playDictionary = () => {
    if (!detail?.audio_url) return;
    setPlaying('dict');
    const audio = new Audio(detail.audio_url);
    const stop = () => setPlaying(null);
    audio.onended = stop;
    audio.onerror = stop;
    void audio.play().catch(stop);
  };

  /** Speaks any short text — the AI's example sentences are not the stored
   * `example`, so the per-word endpoint cannot reach them. */
  const speakArbitrary = async (text: string) => {
    setSpeakError(null);
    setPlaying('sentence');
    let url: string | null = null;
    try {
      url = await speakText(text);
      await new Promise<void>((resolve) => {
        const audio = new Audio(url as string);
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        void audio.play().catch(() => resolve());
      });
    } catch (err) {
      setSpeakError(err instanceof Error ? err.message : 'Could not speak this — is the AI launched?');
    } finally {
      if (url) URL.revokeObjectURL(url);
      setPlaying(null);
    }
  };

  /** Speaks with the app's own TTS engine. The first call for a word is real
   * synthesis and takes a moment; every one after it is served from disk. */
  const speak = async (part: 'word' | 'sentence') => {
    if (!detail) return;
    setSpeakError(null);
    setPlaying(part);
    let url: string | null = null;
    try {
      url = await pronunciationUrl(detail.id, part);
      await new Promise<void>((resolve) => {
        const audio = new Audio(url as string);
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        void audio.play().catch(() => resolve());
      });
    } catch (err) {
      setSpeakError(
        err instanceof Error ? err.message : 'Could not speak this — is the AI launched?',
      );
    } finally {
      // The clip is a blob the browser holds until it is explicitly released;
      // without this every press leaks one for as long as the app is open.
      if (url) URL.revokeObjectURL(url);
      setPlaying(null);
    }
  };

  const [noteDraft, setNoteDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');

  const [mnemonicLoading, setMnemonicLoading] = useState(false);
  const [mnemonicError, setMnemonicError] = useState<string | null>(null);

  const [examples, setExamples] = useState<string[] | null>(null);
  const [examplesLoading, setExamplesLoading] = useState(false);
  const [examplesError, setExamplesError] = useState<string | null>(null);

  const [practiceQuestion, setPracticeQuestion] = useState<string | null>(null);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [practiceAnswer, setPracticeAnswer] = useState('');
  const [practiceResult, setPracticeResult] = useState<'correct' | 'incorrect' | null>(null);

  useEffect(() => {
    void fetchWordDetail(word);
    setExamples(null);
    setPracticeQuestion(null);
    setPracticeAnswer('');
    setPracticeResult(null);
  }, [word, fetchWordDetail]);

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  };

  const handleGenerateMnemonic = async (vocabWordId: string) => {
    setMnemonicLoading(true);
    setMnemonicError(null);
    try {
      await generateMnemonic(vocabWordId);
    } catch (err) {
      setMnemonicError(err instanceof Error ? err.message : 'Could not reach the local AI');
    } finally {
      setMnemonicLoading(false);
    }
  };

  const handleGenerateExamples = async (vocabWordId: string) => {
    setExamplesLoading(true);
    setExamplesError(null);
    try {
      setExamples(await fetchAiExamples(vocabWordId));
    } catch (err) {
      setExamplesError(err instanceof Error ? err.message : 'Could not reach the local AI');
    } finally {
      setExamplesLoading(false);
    }
  };

  const handleNewPracticeQuestion = async (vocabWordId: string) => {
    setPracticeLoading(true);
    setPracticeError(null);
    setPracticeAnswer('');
    setPracticeResult(null);
    try {
      setPracticeQuestion(await fetchAiPractice(vocabWordId));
    } catch (err) {
      setPracticeError(err instanceof Error ? err.message : 'Could not reach the local AI');
    } finally {
      setPracticeLoading(false);
    }
  };

  const checkPracticeAnswer = (correctWord: string, lemma: string) => {
    const given = practiceAnswer.trim().toLowerCase();
    const correct = given === correctWord.trim().toLowerCase() || given === lemma.trim().toLowerCase();
    setPracticeResult(correct ? 'correct' : 'incorrect');
  };

  // 'idle' is reused by the store for both "haven't fetched yet" and
  // "fetch succeeded" — so the loading gate can't key off status alone,
  // it has to key off whether we actually have data yet.
  if (!selectedDetail && detailStatus !== 'error') {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[11px] text-tx3">loading…</div>
    );
  }

  if (detailStatus === 'error' || !selectedDetail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-[var(--pad)] text-center">
        <div className="font-sans text-[14px] font-medium text-tx">"{word}" isn't in your vocabulary yet.</div>
        <div className="max-w-[360px] font-sans text-[12px] leading-[1.6] text-tx2">
          Look it up while reading a book and use "Save to vocabulary" to add it.
        </div>
        <button
          onClick={() => goScreen('vocab')}
          className="mt-1 rounded-field border border-line2 px-4 py-[9px] font-mono text-[11px] font-medium text-tx2 hover:border-acc hover:text-acc"
        >
          ‹ back to vocabulary
        </button>
      </div>
    );
  }

  const detail = selectedDetail;

  return (
    <div className="relative h-full overflow-y-auto bg-bg">
      <div className="mx-auto max-w-[1080px] px-[var(--pad)] pb-11 pt-4">
        <div className="mb-[18px] flex flex-wrap items-center gap-[10px]">
          <button
            onClick={() => goScreen('vocab')}
            className="flex items-center gap-[7px] rounded-field border border-line2 px-[10px] py-[6px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
          >
            ‹ vocabulary
          </button>
          <span className="font-mono text-[10px] text-tx3">
            saved {new Date(detail.created_at).toLocaleDateString()}
          </span>
          <div className="flex-1" />
          <button
            onClick={async () => {
              await deleteWord(detail.id);
              goScreen('vocab');
            }}
            className="rounded-field border border-line px-3 py-[7px] font-mono text-[11px] text-tx2 hover:border-[#c0563f] hover:text-[#c0563f]"
          >
            remove from vocabulary
          </button>
        </div>

        <div className="flex flex-wrap items-start gap-[22px] border-b border-line2 pb-5">
          <div className="min-w-[260px] flex-1">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-sans text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-tx">
                {detail.word}
              </span>
              {detail.ipa && <span className="font-mono text-[15px] text-tx3">{detail.ipa}</span>}
            </div>
            {/* Two ways to hear a word, and the local engine covers both.
                Previously this offered only whatever recording happened to
                ship with a dictionary entry, so a manually added word — or
                any word the dictionary had no audio for — had no
                pronunciation at all. Spec §5.3 asks for the word and the
                sentence; the engine that speaks in Conversation can say
                either. */}
            <div className="mt-[14px] flex flex-wrap items-center gap-[8px]">
              {detail.audio_url && (
                <button
                  onClick={() => playDictionary()}
                  className="flex items-center gap-[7px] rounded-full border border-accLine bg-accSoft px-3 py-[7px] font-sans text-[11px] font-medium text-acc"
                >
                  {playing === 'dict' ? '▶ playing…' : '▶ pronunciation'}
                </button>
              )}
              <button
                onClick={() => void speak('word')}
                disabled={playing === 'word'}
                className="flex items-center gap-[7px] rounded-full border border-line px-3 py-[7px] font-sans text-[11px] font-medium text-tx2 hover:border-acc hover:text-acc disabled:opacity-60"
              >
                {playing === 'word' ? '▶ speaking…' : detail.audio_url ? '▶ say it' : '▶ say the word'}
              </button>
              {detail.example && (
                <button
                  onClick={() => void speak('sentence')}
                  disabled={playing === 'sentence'}
                  className="flex items-center gap-[7px] rounded-full border border-line px-3 py-[7px] font-sans text-[11px] font-medium text-tx2 hover:border-acc hover:text-acc disabled:opacity-60"
                >
                  {playing === 'sentence' ? '▶ speaking…' : '▶ say the sentence'}
                </button>
              )}
              <span className="font-mono text-[9.5px] text-tx3">
                {detail.audio_url ? 'dictionaryapi.dev · local voice' : 'local voice'}
              </span>
            </div>
            {speakError && (
              <div className="mt-[8px] font-mono text-[10px] text-[#c0563f]">{speakError}</div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { k: 'CEFR', v: detail.cefr ?? '—', fg: 'var(--acc)' },
              { k: 'POS', v: (detail.pos && POS_FULL[detail.pos]) ?? detail.pos ?? '—', fg: 'var(--tx)' },
            ].map((s) => (
              <div key={s.k} className="min-w-[96px] rounded-field border border-line2 bg-panel px-3 py-[10px]">
                <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">{s.k}</div>
                <div className="mt-[5px] font-sans text-[15px] font-semibold" style={{ color: s.fg }}>
                  {s.v}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-[22px] grid grid-cols-[1.55fr_1fr] items-start gap-[22px]">
          <div className="flex min-w-0 flex-col gap-5">
            <div>
              <div className="mb-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                Definition
              </div>
              <div className="rounded-field border border-line2 bg-panel px-[14px] py-[13px]">
                <div className="font-sans text-[13px] leading-[1.7] text-tx">{detail.definition ?? '—'}</div>
                {detail.example && (
                  <div className="mt-[8px] font-sans text-[12px] italic leading-[1.6] text-tx2">"{detail.example}"</div>
                )}
              </div>
              {detail.synonyms.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-[6px]">
                  {detail.synonyms.map((s) => (
                    <span key={s} className="rounded-full border border-line2 px-[9px] py-1 font-sans text-[10.5px] text-tx2">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* AI enrichment, in its own right rather than merged into the
                dictionary's fields above. The dictionary is authoritative
                about what a word means; the model is better at saying it in
                words a learner already has. Neither has to win. */}
            {(detail.ai_definition || detail.ai_examples.length > 0 || detail.ai_usage_note) && (
              <div>
                <div className="mb-[10px] flex items-baseline gap-[8px]">
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                    AI enrichment
                  </span>
                  {detail.ai_sense_definition &&
                    detail.ai_sense_definition !== detail.definition && (
                      <span
                        className="font-mono text-[9.5px] text-tx3"
                        title={detail.ai_sense_definition}
                      >
                        · for the sense “{detail.ai_sense_definition.slice(0, 48)}
                        {detail.ai_sense_definition.length > 48 ? '…' : ''}”
                      </span>
                    )}
                </div>
                <div className="rounded-field border border-accLine bg-accSoft px-[14px] py-[13px]">
                  {detail.ai_definition && (
                    <div className="font-sans text-[13px] leading-[1.7] text-tx">
                      {detail.ai_definition}
                    </div>
                  )}
                  {detail.ai_examples.length > 0 && (
                    <div className="mt-[10px] flex flex-col gap-[6px]">
                      {detail.ai_examples.map((e) => (
                        <div key={e} className="flex items-start gap-[8px]">
                          <span className="flex-1 font-sans text-[12px] italic leading-[1.6] text-tx2">
                            “{e}”
                          </span>
                          <button
                            onClick={() => void speakArbitrary(e)}
                            disabled={playing !== null}
                            title="hear this sentence"
                            className="flex-none font-mono text-[10px] text-tx3 hover:text-acc disabled:opacity-40"
                          >
                            ▶
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {detail.ai_usage_note && (
                    <div className="mt-[10px] border-t border-accLine pt-[8px] font-mono text-[10.5px] leading-[1.6] text-tx2">
                      when to use it · {detail.ai_usage_note}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="mb-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                My notes · {detail.notes.length}
              </div>
              <div className="flex flex-col gap-2">
                {detail.notes.map((n) => (
                  <div key={n.id} className="flex gap-[10px] rounded-field border border-line2 bg-panel px-3 py-[11px]">
                    <span className="w-[2px] flex-none rounded-[2px] bg-acc" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-sans text-[12.5px] leading-[1.7] text-tx">{n.text}</span>
                      <span className="mt-[5px] block font-mono text-[9px] text-tx3">
                        added {new Date(n.created_at).toLocaleDateString()}
                      </span>
                    </span>
                    <button
                      onClick={async () => {
                        await deleteNote(n.id);
                        flashToast('Note deleted');
                      }}
                      title="Delete note"
                      className="h-[22px] w-[22px] flex-none rounded-[5px] border border-line2 font-mono text-[11px] text-tx3 hover:border-acc hover:text-acc"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const text = noteDraft.trim();
                    if (!text) return;
                    await addNote(text);
                    setNoteDraft('');
                    flashToast('Note added');
                  }}
                  className="flex gap-[8px]"
                >
                  <input
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="add your own note…"
                    className="min-w-0 flex-1 rounded-field border border-dashed border-line bg-transparent px-3 py-[11px] font-sans text-[12px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!noteDraft.trim()}
                    className="rounded-field border border-accLine bg-accSoft px-[13px] py-[9px] font-mono text-[10.5px] font-medium text-acc disabled:opacity-50"
                  >
                    add
                  </button>
                </form>
              </div>
            </div>

            <div>
              <div className="mb-[10px] flex items-center justify-between gap-[10px]">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  Contexts · {detail.contexts.length}
                </span>
                <span className="font-mono text-[9.5px] text-tx3">where you met it</span>
              </div>
              <div className="flex flex-col gap-[9px]">
                {detail.contexts.length === 0 && (
                  <div className="font-mono text-[10.5px] text-tx3">no captured context yet</div>
                )}
                {detail.contexts.map((c) =>
                  c.kind === 'clip' ? (
                    <ClipContext key={c.id} context={c} />
                  ) : (
                    <div key={c.id} className="rounded-field border border-line2 bg-panel p-[11px]">
                      <div className="font-sans text-[12.5px] leading-[1.7] text-tx">"{c.snippet}"</div>
                      <div className="mt-[7px] font-mono text-[9.5px] text-tx3">{c.source_label}</div>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <div className="rounded-panel border border-line2 bg-panel p-[14px]">
              <div className="mb-[10px] flex items-center justify-between gap-[10px]">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">Tags</span>
                <span className="font-mono text-[9px] text-tx3">{detail.tags.length} tags</span>
              </div>
              <div className="flex flex-wrap gap-[6px]">
                {detail.tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-[6px] rounded-full border border-accLine bg-accSoft px-[10px] py-[5px] font-sans text-[10.5px] font-medium text-acc"
                  >
                    {t}
                    <button
                      onClick={async () => {
                        await removeTag(t);
                        flashToast('Tag removed');
                      }}
                      title="Remove tag"
                      className="font-mono text-[11px] leading-none text-acc/70 hover:text-acc"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const tag = tagDraft.trim();
                  if (!tag) return;
                  await addTag(tag);
                  setTagDraft('');
                  flashToast(`Tagged "${tag}"`);
                }}
                className="mt-3 flex gap-[8px] border-t border-line2 pt-[11px]"
              >
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="add a tag…"
                  className="min-w-0 flex-1 rounded-field border border-line2 bg-transparent px-[10px] py-[7px] font-sans text-[11px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!tagDraft.trim()}
                  className="rounded-field border border-line2 px-[11px] py-[7px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
                >
                  ＋ add
                </button>
              </form>
            </div>

            <div className="rounded-panel border border-line2 p-[14px]">
              <div className="mb-[8px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                Scheduling
              </div>
              {detail.card_state === 'new' || detail.reps === 0 ? (
                <div className="font-sans text-[12px] leading-[1.6] text-tx2">
                  Not reviewed yet — this word is waiting in the review queue.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-[8px]">
                    <MasteryDot level={detail.mastery_level} label={detail.mastery_label} />
                    <span className="font-sans text-[12.5px] font-medium text-tx">
                      L{detail.mastery_level} · {detail.mastery_label}
                    </span>
                  </div>
                  <div className="mt-[8px] font-mono text-[10.5px] leading-[1.8] text-tx3">
                    next review {dueLabel(detail.due, detail.card_state)}
                    <br />
                    stability {detail.stability_days ?? 0} d · difficulty {detail.difficulty ?? 0}
                    <br />
                    {detail.reps} review{detail.reps === 1 ? '' : 's'} · {detail.lapses} lapse
                    {detail.lapses === 1 ? '' : 's'}
                    {detail.suspended && <> · suspended</>}
                  </div>
                  {/* The project's central claim, stated where it applies to
                      this specific word rather than only in the spec. */}
                  {detail.mastery_level <= 2 && (
                    <div className="mt-[10px] border-t border-line2 pt-[8px] font-mono text-[9.5px] leading-[1.6] text-tx3">
                      flashcards alone stop at L2 — this word only goes further by being used
                      unprompted in conversation
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="rounded-panel border border-line2 p-[14px]">
              <div className="mb-[8px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                Conversation usage
              </div>
              {Object.keys(detail.conversation_usage).length === 0 ? (
                <div className="font-sans text-[12px] leading-[1.6] text-tx2">
                  Not used in a conversation yet — it may come up as a target word next session.
                </div>
              ) : (
                <div className="flex flex-col gap-[6px]">
                  {Object.entries(detail.conversation_usage).map(([outcome, count]) => (
                    <div key={outcome} className="flex items-center justify-between font-mono text-[11px]">
                      <span style={{ color: USAGE_COLOR[outcome] ?? 'var(--tx2)' }}>{outcome}</span>
                      <span className="font-medium text-tx">{count}×</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-[10px] border-t border-line2 pt-[8px] font-mono text-[9.5px] leading-[1.6] text-tx3">
                each of these reschedules the word, the same way a flashcard answer does
              </div>
            </div>

            {/* Kept separate from conversation usage above. They are different
                kinds of evidence — recognising a word and producing it are not
                the same claim — and merging them was a real bug: a word only
                ever answered on a flashcard reported "conversation usage:
                again", which is not something anyone can do in a
                conversation. */}
            {Object.keys(detail.flashcard_reviews).length > 0 && (
              <div className="rounded-panel border border-line2 p-[14px]">
                <div className="mb-[8px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  Flashcard answers
                </div>
                <div className="flex flex-col gap-[6px]">
                  {['again', 'hard', 'good', 'easy']
                    .filter((r) => detail.flashcard_reviews[r])
                    .map((r) => (
                      <div key={r} className="flex items-center justify-between font-mono text-[11px]">
                        <span style={{ color: RATING_COLOR[r] ?? 'var(--tx2)' }}>{r}</span>
                        <span className="font-medium text-tx">{detail.flashcard_reviews[r]}×</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="rounded-panel border border-line2 p-[14px]">
              <div className="mb-[8px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                AI memory aid
              </div>
              {detail.ai_mnemonic && (
                <div className="mb-[10px] rounded-field border border-accLine bg-accSoft px-3 py-[10px] font-sans text-[12px] leading-[1.6] text-tx">
                  {detail.ai_mnemonic}
                </div>
              )}
              {mnemonicError && (
                <div className="mb-[8px] font-mono text-[10px] text-[#c0563f]">{mnemonicError}</div>
              )}
              <button
                onClick={() => void handleGenerateMnemonic(detail.id)}
                disabled={mnemonicLoading}
                className="rounded-field border border-line2 px-3 py-[7px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
              >
                {mnemonicLoading ? 'thinking…' : detail.ai_mnemonic ? 'regenerate' : 'generate a mnemonic'}
              </button>
            </div>

            <div className="rounded-panel border border-line2 p-[14px]">
              <div className="mb-[8px] flex items-center justify-between gap-[10px]">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  AI example sentences
                </span>
                <button
                  onClick={() => void handleGenerateExamples(detail.id)}
                  disabled={examplesLoading}
                  className="rounded-field border border-line2 px-[9px] py-[5px] font-mono text-[10px] font-medium text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
                >
                  {examplesLoading ? 'thinking…' : examples ? 'more' : 'generate'}
                </button>
              </div>
              {examplesError && <div className="font-mono text-[10px] text-[#c0563f]">{examplesError}</div>}
              {examples && (
                <div className="flex flex-col gap-[7px]">
                  {examples.map((ex, i) => (
                    <div key={i} className="font-sans text-[12px] italic leading-[1.6] text-tx2">
                      "{ex}"
                    </div>
                  ))}
                </div>
              )}
              {!examples && !examplesLoading && !examplesError && (
                <div className="font-sans text-[11.5px] leading-[1.6] text-tx3">
                  fresh, AI-generated sentences using this word
                </div>
              )}
            </div>

            <div className="rounded-panel border border-line2 p-[14px]">
              <div className="mb-[8px] flex items-center justify-between gap-[10px]">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  AI practice
                </span>
                <button
                  onClick={() => void handleNewPracticeQuestion(detail.id)}
                  disabled={practiceLoading}
                  className="rounded-field border border-line2 px-[9px] py-[5px] font-mono text-[10px] font-medium text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
                >
                  {practiceLoading ? 'thinking…' : practiceQuestion ? 'new question' : 'start'}
                </button>
              </div>
              {practiceError && <div className="font-mono text-[10px] text-[#c0563f]">{practiceError}</div>}
              {practiceQuestion && (
                <div className="flex flex-col gap-[8px]">
                  <div className="font-sans text-[12.5px] leading-[1.6] text-tx">{practiceQuestion}</div>
                  <div className="flex gap-[8px]">
                    <input
                      value={practiceAnswer}
                      onChange={(e) => {
                        setPracticeAnswer(e.target.value);
                        setPracticeResult(null);
                      }}
                      placeholder="your answer…"
                      className="min-w-0 flex-1 rounded-field border border-line2 bg-panel2 px-3 py-[7px] font-sans text-[11.5px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
                    />
                    <button
                      onClick={() => checkPracticeAnswer(detail.word, detail.lemma)}
                      disabled={!practiceAnswer.trim()}
                      className="rounded-field border border-accLine bg-accSoft px-[13px] py-[7px] font-mono text-[10.5px] font-medium text-acc disabled:opacity-50"
                    >
                      check
                    </button>
                  </div>
                  {practiceResult && (
                    <div
                      className="font-mono text-[10.5px] font-medium"
                      style={{ color: practiceResult === 'correct' ? 'var(--acc)' : '#c0563f' }}
                    >
                      {practiceResult === 'correct' ? `✓ correct — "${detail.word}"` : `✗ not quite — it was "${detail.word}"`}
                    </div>
                  )}
                </div>
              )}
              {!practiceQuestion && !practiceLoading && !practiceError && (
                <div className="font-sans text-[11.5px] leading-[1.6] text-tx3">
                  a quick AI-generated fill-in-the-blank check
                </div>
              )}
            </div>

            <button
              onClick={goForest}
              className="rounded-field border border-accLine bg-accSoft py-[9px] font-mono text-[11px] text-acc"
            >
              see plant
            </button>
            <div className="font-mono text-[9.5px] leading-[1.7] text-tx3">
              changes save immediately to your local vocabulary database
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-field border border-accLine bg-panel2 px-[14px] py-[10px] font-mono text-[11.5px] font-medium text-tx shadow-panel">
          {toast}
        </div>
      )}
    </div>
  );
}
