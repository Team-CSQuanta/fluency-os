import { useEffect, useState } from 'react';
import { useEngineStore } from '@/store/engineStore';
import { useVocabularyStore } from '@/store/vocabularyStore';
import type { AiEnrichOut, DictionarySenseOut } from '@/types/api';

/** Adding a word, with the dictionary and the local AI working on it
 * together rather than as two separate tabs you had to choose between.
 *
 * They answer different questions. A dictionary is authoritative about what
 * a word means and how it is pronounced; it defines the word for someone who
 * already speaks the language. What a learner needs on top — a definition at
 * their level, sentences they might really say, a hook to remember it by, a
 * note on register — is exactly what dictionaries leave out, and is what a
 * small local model is genuinely good at once the dictionary has grounded it.
 *
 * So: one search box. The dictionary answers immediately, and the AI enriches
 * what came back. Either half is optional — the dictionary can be offline and
 * the AI can be unlaunched, and the word is still savable.
 */
export function AddWordModal({ onClose }: { onClose: () => void }) {
  const searchResult = useVocabularyStore((s) => s.searchResult);
  const searchStatus = useVocabularyStore((s) => s.searchStatus);
  const searchError = useVocabularyStore((s) => s.searchError);
  const searchDictionary = useVocabularyStore((s) => s.searchDictionary);
  const clearSearch = useVocabularyStore((s) => s.clearSearch);
  const saveManualWord = useVocabularyStore((s) => s.saveManualWord);
  const aiEnrich = useVocabularyStore((s) => s.aiEnrich);
  const speakText = useVocabularyStore((s) => s.speakText);
  const fetchWords = useVocabularyStore((s) => s.fetchWords);
  const fetchOverview = useVocabularyStore((s) => s.fetchOverview);

  const engineStatus = useEngineStore((s) => s.status);
  const fetchEngineStatus = useEngineStore((s) => s.fetchStatus);
  const aiReady = engineStatus?.llm === 'ready';
  const voiceReady = engineStatus?.tts === 'ready';

  const [query, setQuery] = useState('');
  const [context, setContext] = useState('');
  const [senseIndex, setSenseIndex] = useState(0);
  const [note, setNote] = useState('');

  const [ai, setAi] = useState<AiEnrichOut | null>(null);
  // Which sense the enrichment describes. An entry for "our" has ten senses;
  // enrichment of sense 2 says nothing about sense 7, so showing it beside a
  // different one would be a quiet lie.
  const [aiSense, setAiSense] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [speaking, setSpeaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void fetchEngineStatus();
  }, [fetchEngineStatus]);

  const senses: DictionarySenseOut[] = searchResult?.senses ?? [];
  const sense = senses[senseIndex];
  // The word as typed is enough to save. A dictionary that is down, or has
  // never heard of the word, should not block adding it.
  const headword = searchResult?.word || query.trim();
  const dictDefinition = sense?.definition ?? '';

  // Enrichment generated for another sense is not about this one. Cleared
  // rather than left on screen, because a stale answer under a new heading is
  // worse than no answer.
  const staleForSense = Boolean(ai && aiSense !== null && aiSense !== dictDefinition);

  const runSearch = () => {
    const w = query.trim();
    if (!w) return;
    setAi(null);
    setAiSense(null);
    setAiError(null);
    setSaved(null);
    setSenseIndex(0);
    void searchDictionary(w);
  };

  const runEnrich = async () => {
    if (!headword) return;
    setAiBusy(true);
    setAiError(null);
    try {
      // The SELECTED sense is what gets sent, not the word alone — that is
      // what makes "our (determiner)" and "our (verb)" come back different.
      const forSense = dictDefinition;
      const result = await aiEnrich(headword, {
        dictionaryDefinition: forSense || undefined,
        context: context.trim() || undefined,
      });
      setAi(result);
      setAiSense(forSense || null);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Could not reach the local AI');
    } finally {
      setAiBusy(false);
    }
  };

  const hear = async (text: string) => {
    setSpeaking(true);
    let url: string | null = null;
    try {
      url = await speakText(text);
      await new Promise<void>((resolve) => {
        const audio = new Audio(url as string);
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        void audio.play().catch(() => resolve());
      });
    } catch {
      /* the button is a convenience; a failure here must not block saving */
    } finally {
      if (url) URL.revokeObjectURL(url);
      setSpeaking(false);
    }
  };

  const handleSave = async () => {
    if (!headword) return;
    setSaving(true);
    setSaveError(null);
    try {
      // The dictionary's definition is kept as THE definition and the AI's
      // is stored alongside it. Letting the model overwrite it lost the
      // authoritative wording, which is the half worth having a dictionary
      // for; keeping both means neither has to win.
      const keep = ai && !staleForSense ? ai : null;
      const synonyms = Array.from(
        new Set([...(searchResult?.synonyms ?? []), ...(keep?.synonyms ?? [])]),
      ).slice(0, 6);

      const { alreadySaved } = await saveManualWord({
        word: headword,
        pos: sense?.pos || 'unknown',
        definition: dictDefinition || keep?.definition || `(no definition yet — ${headword})`,
        example: sense?.example ?? undefined,
        synonyms,
        ipa: searchResult?.ipa ?? undefined,
        audioUrl: searchResult?.audio_url ?? undefined,
        note: [note.trim(), context.trim()].filter(Boolean).join('\n\n') || undefined,
        aiDefinition: keep?.definition || undefined,
        aiExamples: keep?.examples,
        aiMnemonic: keep?.mnemonic || undefined,
        aiUsageNote: keep?.usage_note || undefined,
        aiSenseDefinition: keep ? dictDefinition || undefined : undefined,
      });
      setSaved(alreadySaved ? 'already in your vocabulary' : 'saved');
      await Promise.all([fetchWords(), fetchOverview()]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this word');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    clearSearch();
    onClose();
  };

  const canSave = Boolean(headword) && !saving && !saved;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6"
      onClick={handleClose}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-[620px] flex-col overflow-hidden rounded-panel border border-line2 bg-panel shadow-panel"
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-line2 px-5 py-4">
          <div>
            <div className="font-sans text-[15px] font-semibold text-tx">Add a word</div>
            <div className="mt-1 font-mono text-[10.5px] leading-[1.6] text-tx3">
              dictionary for the meaning · local AI for how to actually use it
            </div>
          </div>
          <button onClick={handleClose} aria-label="Close" className="text-tx3 hover:text-acc">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* One search box, not two tabs. */}
          <div className="flex gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="type a word…"
              aria-label="Word to add"
              className="flex-1 rounded-field border border-line2 bg-transparent px-3 py-[9px] font-sans text-[13px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
            />
            <button
              onClick={runSearch}
              disabled={!query.trim() || searchStatus === 'loading'}
              className="rounded-field border border-accLine bg-accSoft px-4 py-[9px] font-mono text-[11px] font-medium text-acc disabled:opacity-50"
            >
              {searchStatus === 'loading' ? 'looking…' : 'look up'}
            </button>
          </div>

          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={2}
            placeholder="optional — the sentence you met it in (sharpens the AI's answer)"
            className="mt-2 w-full resize-none rounded-field border border-line2 bg-transparent px-3 py-[8px] font-sans text-[12px] leading-[1.6] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
          />

          {searchStatus === 'error' && (
            <div className="mt-3 rounded-field border border-dashed border-line px-3 py-2 font-mono text-[10.5px] leading-[1.6] text-tx3">
              {searchError ?? 'the dictionary is unreachable'} — you can still save the word and let
              the AI describe it.
            </div>
          )}
          {searchStatus === 'not-found' && (
            <div className="mt-3 rounded-field border border-dashed border-line px-3 py-2 font-mono text-[10.5px] text-tx3">
              no dictionary entry for “{query.trim()}” — it can still be saved.
            </div>
          )}

          {/* Dictionary half */}
          {searchResult && (
            <div className="mt-4 rounded-field border border-line2 px-3 py-[11px]">
              <div className="flex flex-wrap items-baseline gap-[8px]">
                <span className="font-sans text-[18px] font-semibold text-tx">{searchResult.word}</span>
                {searchResult.ipa && <span className="font-mono text-[11px] text-tx3">{searchResult.ipa}</span>}
                {searchResult.cefr && (
                  <span className="rounded-[4px] border border-accLine px-[6px] py-[1px] font-mono text-[9.5px] text-acc">
                    {searchResult.cefr}
                  </span>
                )}
                <div className="flex-1" />
                {voiceReady && (
                  <button
                    onClick={() => void hear(searchResult.word)}
                    disabled={speaking}
                    className="rounded-full border border-line px-[10px] py-[4px] font-mono text-[10px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
                  >
                    {speaking ? '▶ …' : '▶ hear it'}
                  </button>
                )}
              </div>

              {senses.length > 0 ? (
                <>
                  <div className="mt-[10px] font-sans text-[12.5px] leading-[1.65] text-tx2">
                    {sense.definition}
                  </div>
                  {sense.example && (
                    <div className="mt-[6px] font-sans text-[12px] italic leading-[1.6] text-tx3">
                      “{sense.example}”
                    </div>
                  )}
                  {senses.length > 1 && (
                    <div className="mt-[10px] flex flex-wrap items-center gap-[6px]">
                      <span className="font-mono text-[9.5px] text-tx3">sense</span>
                      {senses.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => setSenseIndex(i)}
                          className="rounded-full border px-[8px] py-[2px] font-mono text-[9.5px]"
                          style={{
                            borderColor: i === senseIndex ? 'var(--accLine)' : 'var(--line2)',
                            background: i === senseIndex ? 'var(--accSoft)' : 'transparent',
                            color: i === senseIndex ? 'var(--acc)' : 'var(--tx3)',
                          }}
                        >
                          {i + 1} · {s.pos}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-[8px] font-mono text-[10.5px] text-tx3">no definition from the dictionary</div>
              )}
            </div>
          )}

          {/* AI half */}
          {headword && (
            <div className="mt-3 rounded-field border border-line2 px-3 py-[11px]">
              <div className="flex items-center gap-[8px]">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  AI enrichment
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => void runEnrich()}
                  disabled={!aiReady || aiBusy}
                  title={aiReady ? undefined : 'Launch AI from the header first'}
                  className="rounded-full border px-[10px] py-[4px] font-mono text-[10px] disabled:opacity-40"
                  style={{
                    borderColor: staleForSense ? 'var(--accLine)' : 'var(--line)',
                    background: staleForSense ? 'var(--accSoft)' : 'transparent',
                    color: staleForSense ? 'var(--acc)' : 'var(--tx2)',
                  }}
                >
                  {aiBusy
                    ? 'thinking…'
                    : staleForSense
                      ? '✨ enrich this sense'
                      : ai
                        ? 'regenerate'
                        : '✨ enrich'}
                </button>
              </div>

              {!aiReady && (
                <div className="mt-[8px] font-mono text-[10px] leading-[1.6] text-tx3">
                  AI isn’t launched — use the AI button in the header to turn it on. Everything below
                  is optional; the word saves fine without it.
                </div>
              )}
              {aiError && <div className="mt-[8px] font-mono text-[10px] text-[#c0563f]">{aiError}</div>}

              {senses.length > 1 && !ai && aiReady && (
                <div className="mt-[8px] font-mono text-[10px] leading-[1.6] text-tx3">
                  describes sense {senseIndex + 1} — pick a different one above to enrich that
                  meaning instead
                </div>
              )}

              {ai && staleForSense && (
                <div className="mt-[8px] font-mono text-[10px] leading-[1.6] text-tx3">
                  this was generated for a different sense
                </div>
              )}

              {ai && !staleForSense && (
                <div className="mt-[10px] flex flex-col gap-[10px]">
                  {ai.definition && (
                    <Field label="in plain English">
                      <span className="font-sans text-[12.5px] leading-[1.65] text-tx2">{ai.definition}</span>
                    </Field>
                  )}
                  {ai.examples.length > 0 && (
                    <Field label="how you'd say it">
                      <div className="flex flex-col gap-[5px]">
                        {ai.examples.map((e) => (
                          <div key={e} className="flex items-start gap-[6px]">
                            <span className="flex-1 font-sans text-[12px] italic leading-[1.6] text-tx2">“{e}”</span>
                            {voiceReady && (
                              <button
                                onClick={() => void hear(e)}
                                disabled={speaking}
                                className="flex-none font-mono text-[10px] text-tx3 hover:text-acc disabled:opacity-40"
                              >
                                ▶
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </Field>
                  )}
                  {ai.mnemonic && (
                    <Field label="remember it by">
                      <span className="font-sans text-[12px] leading-[1.6] text-tx2">💡 {ai.mnemonic}</span>
                    </Field>
                  )}
                  {ai.usage_note && (
                    <Field label="when to use it">
                      <span className="font-mono text-[11px] text-tx2">{ai.usage_note}</span>
                    </Field>
                  )}
                  {ai.synonyms.length > 0 && (
                    <Field label="close to">
                      <span className="font-mono text-[11px] text-tx2">{ai.synonyms.join(' · ')}</span>
                    </Field>
                  )}
                </div>
              )}
            </div>
          )}

          {headword && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="your own note (optional)"
              className="mt-3 w-full rounded-field border border-line2 bg-transparent px-3 py-[8px] font-sans text-[12px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
            />
          )}
        </div>

        <div className="flex flex-none items-center gap-2 border-t border-line2 px-5 py-4">
          {saved ? (
            <>
              <span className="font-mono text-[11px] text-acc">✓ {saved}</span>
              <div className="flex-1" />
              <button
                onClick={() => { setQuery(''); setContext(''); setNote(''); setAi(null); setAiSense(null); setSaved(null); clearSearch(); }}
                className="rounded-field border border-line px-4 py-[9px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
              >
                add another
              </button>
              <button
                onClick={handleClose}
                className="rounded-field bg-accSolid px-4 py-[9px] font-sans text-[12px] font-semibold text-white hover:brightness-110"
              >
                done
              </button>
            </>
          ) : (
            <>
              {saveError && <span className="font-mono text-[10.5px] text-[#c0563f]">{saveError}</span>}
              <div className="flex-1" />
              <button onClick={handleClose} className="rounded-field border border-line px-4 py-[9px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc">
                cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={!canSave}
                className="rounded-field bg-accSolid px-4 py-[9px] font-sans text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
              >
                {saving ? 'saving…' : 'save word'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-[3px] font-mono text-[9px] uppercase tracking-[0.1em] text-tx3">{label}</div>
      {children}
    </div>
  );
}
