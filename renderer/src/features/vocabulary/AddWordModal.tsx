import { useState } from 'react';
import { useVocabularyStore } from '@/store/vocabularyStore';
import type { AiExplainOut, DictionarySenseOut } from '@/types/api';

type Mode = 'dictionary' | 'ai';

export function AddWordModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('dictionary');
  const [query, setQuery] = useState('');
  const [senseIndex, setSenseIndex] = useState(0);
  const [note, setNote] = useState('');
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [aiWord, setAiWord] = useState('');
  const [aiContext, setAiContext] = useState('');
  const [aiResult, setAiResult] = useState<AiExplainOut | null>(null);
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [aiError, setAiError] = useState<string | null>(null);

  const searchResult = useVocabularyStore((s) => s.searchResult);
  const searchStatus = useVocabularyStore((s) => s.searchStatus);
  const searchError = useVocabularyStore((s) => s.searchError);
  const searchDictionary = useVocabularyStore((s) => s.searchDictionary);
  const clearSearch = useVocabularyStore((s) => s.clearSearch);
  const saveManualWord = useVocabularyStore((s) => s.saveManualWord);
  const aiExplain = useVocabularyStore((s) => s.aiExplain);

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSenseIndex(0);
    setSaved(null);
    void searchDictionary(query);
  };

  const runAiExplain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiWord.trim() || !aiContext.trim()) return;
    setSaved(null);
    setAiStatus('loading');
    setAiError(null);
    setAiResult(null);
    try {
      const result = await aiExplain(aiWord.trim(), aiContext.trim());
      setAiResult(result);
      setAiStatus('idle');
    } catch (err) {
      setAiStatus('error');
      setAiError(err instanceof Error ? err.message : 'Could not reach the local AI');
    }
  };

  const handleSaveAi = async () => {
    if (!aiResult) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { alreadySaved } = await saveManualWord({
        word: aiResult.word,
        pos: aiResult.pos,
        definition: aiResult.definition,
        example: aiResult.example || undefined,
        synonyms: aiResult.synonyms,
        note: note.trim() || undefined,
      });
      setSaved(alreadySaved ? 'already in your vocabulary' : 'saved');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this word');
    } finally {
      setSaving(false);
    }
  };

  const playAudio = () => {
    if (!searchResult?.audio_url) return;
    setPlaying(true);
    const audio = new Audio(searchResult.audio_url);
    audio.play().catch(() => {});
    audio.onended = () => setPlaying(false);
    setTimeout(() => setPlaying(false), 3000);
  };

  const handleSave = async (sense: DictionarySenseOut) => {
    if (!searchResult) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { alreadySaved } = await saveManualWord({
        word: searchResult.word,
        pos: sense.pos,
        definition: sense.definition,
        example: sense.example ?? undefined,
        synonyms: searchResult.synonyms,
        ipa: searchResult.ipa ?? undefined,
        audioUrl: searchResult.audio_url ?? undefined,
        note: note.trim() || undefined,
      });
      setSaved(alreadySaved ? 'already in your vocabulary' : 'saved');
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

  const switchMode = (next: Mode) => {
    setMode(next);
    setSaved(null);
    setSaveError(null);
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-6" onClick={handleClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col overflow-hidden rounded-panel border border-line bg-panel shadow-[0_24px_60px_rgba(0,0,0,.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line2 px-5 py-4">
          <div>
            <div className="font-sans text-[14px] font-semibold text-tx">Add a word</div>
            <div className="mt-[3px] font-mono text-[10.5px] text-tx3">
              {mode === 'dictionary'
                ? 'searches an online dictionary (falls back to a second source if one is down) · a live request, only when you search'
                : 'asks the local AI to define the word as used in a sentence you paste — useful for slang, jargon, or a specific sense a dictionary would miss'}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="grid h-7 w-7 place-items-center rounded-field border border-line2 font-mono text-[11px] text-tx2 hover:border-acc"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-none gap-[6px] border-b border-line2 px-5 pt-[12px]">
          <button
            onClick={() => switchMode('dictionary')}
            className="rounded-t-field px-[12px] py-[8px] font-mono text-[10.5px] font-semibold"
            style={{
              color: mode === 'dictionary' ? 'var(--acc)' : 'var(--tx3)',
              borderBottom: mode === 'dictionary' ? '2px solid var(--acc)' : '2px solid transparent',
            }}
          >
            Dictionary search
          </button>
          <button
            onClick={() => switchMode('ai')}
            className="rounded-t-field px-[12px] py-[8px] font-mono text-[10.5px] font-semibold"
            style={{
              color: mode === 'ai' ? 'var(--acc)' : 'var(--tx3)',
              borderBottom: mode === 'ai' ? '2px solid var(--acc)' : '2px solid transparent',
            }}
          >
            AI: explain from context
          </button>
        </div>

        {mode === 'dictionary' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto p-5">
          <form onSubmit={runSearch} className="flex gap-[8px]">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="type a word…"
              autoFocus
              className="min-w-0 flex-1 rounded-field border border-line2 bg-panel2 px-3 py-[9px] font-sans text-[12.5px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
            />
            <button
              type="submit"
              disabled={!query.trim() || searchStatus === 'loading'}
              className="rounded-field bg-accSolid px-[16px] py-[9px] font-sans text-[11.5px] font-semibold text-white disabled:opacity-50"
            >
              Search
            </button>
          </form>

          {searchStatus === 'loading' && <div className="font-mono text-[11px] text-tx3">searching…</div>}
          {searchStatus === 'not-found' && (
            <div className="rounded-field border border-line2 px-[12px] py-[10px] font-sans text-[12px] leading-[1.6] text-tx2">
              "{query.trim()}" wasn't found in the online dictionary — it may be misspelled, or too rare/new for it to know.
            </div>
          )}
          {searchStatus === 'error' && (
            <div className="rounded-field border border-dashed border-[#c0563f] px-[12px] py-[10px] font-mono text-[11px] leading-[1.6] text-[#c0563f]">
              couldn't reach the online dictionary — check your internet connection
              {searchError ? <div className="mt-1 opacity-70">{searchError}</div> : null}
            </div>
          )}

          {searchResult && searchResult.found && (
            <div className="flex flex-col gap-[12px]">
              <div className="flex flex-wrap items-center gap-[10px]">
                <span className="font-sans text-[22px] font-semibold text-tx">{searchResult.word}</span>
                {searchResult.ipa && <span className="font-mono text-[13px] text-tx3">{searchResult.ipa}</span>}
                {searchResult.audio_url && (
                  <button
                    onClick={playAudio}
                    className="rounded-full border border-line2 px-3 py-1 font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
                  >
                    {playing ? '▶ playing…' : '▶ play'}
                  </button>
                )}
                {searchResult.cefr && (
                  <span className="rounded-[4px] border border-accLine px-2 py-1 font-mono text-[9.5px] font-medium text-acc">
                    {searchResult.cefr} · from your offline lexicon
                  </span>
                )}
              </div>
              {searchResult.simpler && (
                <div className="-mt-2 font-mono text-[10px] text-tx3">simpler: {searchResult.simpler}</div>
              )}

              <div>
                <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  Pick a sense to save · {searchResult.senses.length} found
                </div>
                <div className="flex flex-col gap-[7px]">
                  {searchResult.senses.map((sense, i) => (
                    <button
                      key={i}
                      onClick={() => setSenseIndex(i)}
                      className="rounded-field border px-[12px] py-[10px] text-left"
                      style={{
                        borderColor: senseIndex === i ? 'var(--accLine)' : 'var(--line2)',
                        background: senseIndex === i ? 'var(--accSoft)' : 'transparent',
                      }}
                    >
                      <span className="rounded-[4px] bg-line2 px-[6px] py-[2px] font-mono text-[9px] font-medium text-tx2">
                        {sense.pos}
                      </span>
                      <span className="ml-2 font-sans text-[12.5px] leading-[1.6] text-tx">{sense.definition}</span>
                      {sense.example && (
                        <div className="mt-1 font-sans text-[11.5px] italic leading-[1.5] text-tx3">"{sense.example}"</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {searchResult.synonyms.length > 0 && (
                <div className="flex flex-wrap gap-[6px]">
                  {searchResult.synonyms.slice(0, 8).map((s) => (
                    <span key={s} className="rounded-full border border-line2 px-[9px] py-1 font-sans text-[10.5px] text-tx2">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <div>
                <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  Note (optional)
                </div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="why you're adding this, or where you saw it…"
                  rows={2}
                  className="w-full resize-none rounded-field border border-line2 bg-panel2 px-3 py-[9px] font-sans text-[12px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>
        ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto p-5">
          <form onSubmit={(e) => void runAiExplain(e)} className="flex flex-col gap-[8px]">
            <input
              value={aiWord}
              onChange={(e) => setAiWord(e.target.value)}
              placeholder="the word you don't know…"
              autoFocus
              className="min-w-0 rounded-field border border-line2 bg-panel2 px-3 py-[9px] font-sans text-[12.5px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
            />
            <textarea
              value={aiContext}
              onChange={(e) => setAiContext(e.target.value)}
              placeholder="paste the sentence or paragraph it appeared in…"
              rows={3}
              className="w-full resize-none rounded-field border border-line2 bg-panel2 px-3 py-[9px] font-sans text-[12px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
            />
            <button
              type="submit"
              disabled={!aiWord.trim() || !aiContext.trim() || aiStatus === 'loading'}
              className="self-start rounded-field bg-accSolid px-[16px] py-[9px] font-sans text-[11.5px] font-semibold text-white disabled:opacity-50"
            >
              {aiStatus === 'loading' ? 'Asking the local AI…' : 'Explain with AI'}
            </button>
          </form>

          {aiStatus === 'error' && (
            <div className="rounded-field border border-dashed border-[#c0563f] px-[12px] py-[10px] font-mono text-[11px] leading-[1.6] text-[#c0563f]">
              {aiError}
            </div>
          )}

          {aiResult && (
            <div className="flex flex-col gap-[12px]">
              <div className="flex flex-wrap items-center gap-[10px]">
                <span className="font-sans text-[22px] font-semibold text-tx">{aiResult.word}</span>
                <span className="rounded-[4px] bg-line2 px-[6px] py-[2px] font-mono text-[9px] font-medium text-tx2">
                  {aiResult.pos}
                </span>
                <span className="rounded-[4px] border border-accLine px-2 py-1 font-mono text-[9.5px] font-medium text-acc">
                  AI-generated, in your context
                </span>
              </div>
              <div className="font-sans text-[12.5px] leading-[1.6] text-tx">{aiResult.definition}</div>
              {aiResult.example && (
                <div className="font-sans text-[11.5px] italic leading-[1.5] text-tx3">"{aiResult.example}"</div>
              )}
              {aiResult.synonyms.length > 0 && (
                <div className="flex flex-wrap gap-[6px]">
                  {aiResult.synonyms.slice(0, 8).map((s) => (
                    <span key={s} className="rounded-full border border-line2 px-[9px] py-1 font-sans text-[10.5px] text-tx2">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <div>
                <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
                  Note (optional)
                </div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="why you're adding this, or where you saw it…"
                  rows={2}
                  className="w-full resize-none rounded-field border border-line2 bg-panel2 px-3 py-[9px] font-sans text-[12px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line2 px-5 py-[14px]">
          {saveError ? (
            <span className="min-w-0 flex-1 font-mono text-[10.5px] leading-[1.5] text-[#c0563f]">{saveError}</span>
          ) : (
            <span className="font-mono text-[10.5px] text-tx3">{saved && `✓ ${saved}`}</span>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="rounded-field border border-line px-[14px] py-[9px] font-sans text-[11.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
            >
              {saved ? 'Done' : 'Cancel'}
            </button>
            {mode === 'dictionary' && searchResult?.found && !saved && (
              <button
                onClick={() => void handleSave(searchResult.senses[senseIndex])}
                disabled={saving}
                className="rounded-field bg-accSolid px-[18px] py-[9px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save to vocabulary'}
              </button>
            )}
            {mode === 'ai' && aiResult && !saved && (
              <button
                onClick={() => void handleSaveAi()}
                disabled={saving}
                className="rounded-field bg-accSolid px-[18px] py-[9px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save to vocabulary'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
