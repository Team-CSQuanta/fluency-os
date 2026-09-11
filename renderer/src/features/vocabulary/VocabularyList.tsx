import { useEffect, useMemo, useState } from 'react';
import { AddWordModal } from '@/features/vocabulary/AddWordModal';
import { useShellStore } from '@/store/shellStore';
import { useVocabularyStore } from '@/store/vocabularyStore';

export function VocabularyList() {
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const goWord = useShellStore((s) => s.goWord);
  const selectedWord = useShellStore((s) => s.selectedWord);
  const words = useVocabularyStore((s) => s.words);
  const wordsStatus = useVocabularyStore((s) => s.wordsStatus);
  const fetchWords = useVocabularyStore((s) => s.fetchWords);

  useEffect(() => {
    void fetchWords();
  }, [fetchWords]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return words;
    return words.filter(
      (w) => w.word.toLowerCase().includes(q) || (w.pos ?? '').toLowerCase().includes(q) || w.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [words, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line2 px-[var(--pad)] py-[14px]">
        <label className="flex min-w-[210px] items-center gap-[7px] rounded-field border border-line2 px-[11px] py-[7px] font-sans text-[11.5px] text-tx3 focus-within:border-acc">
          <span aria-hidden>⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search word, POS, or tag"
            aria-label="Search vocabulary"
            className="w-[170px] bg-transparent text-tx placeholder:text-tx3 focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="text-tx3 hover:text-acc">
              ✕
            </button>
          )}
        </label>
        <span className="font-mono text-[10.5px] text-tx3">
          {words.length} {words.length === 1 ? 'entry' : 'entries'}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-field border border-accLine bg-accSoft px-3 py-[7px] font-mono text-[11px] font-medium text-acc"
        >
          ＋ add word
        </button>
        <button className="rounded-field border border-line px-3 py-[7px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc">
          export APKG
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {wordsStatus === 'loading' && (
          <div className="p-[var(--pad)] font-mono text-[11px] text-tx3">loading…</div>
        )}
        {wordsStatus === 'error' && (
          <div className="p-[var(--pad)] font-mono text-[11px] text-tx3">couldn't load your vocabulary</div>
        )}
        {wordsStatus === 'idle' && words.length === 0 && (
          <div className="p-[var(--pad)] font-sans text-[12px] leading-[1.6] text-tx2">
            Nothing saved yet — look up a word while reading and save it to build your list.
          </div>
        )}
        {rows.length > 0 && (
          <>
            <div
              className="sticky top-0 grid gap-3 border-b border-line2 bg-bg px-[var(--pad)] py-[9px] font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-tx3"
              style={{ gridTemplateColumns: '1.6fr .6fr 1.3fr .8fr' }}
            >
              <span>Headword</span>
              <span>CEFR</span>
              <span>Tags</span>
              <span>Added</span>
            </div>
            {rows.map((w) => (
              <button
                key={w.id}
                onClick={() => goWord(w.word)}
                className="grid w-full items-center gap-3 border-b border-line2 px-[var(--pad)] py-[11px] text-left hover:bg-panel2"
                style={{
                  gridTemplateColumns: '1.6fr .6fr 1.3fr .8fr',
                  background: selectedWord === w.word ? 'var(--panel2)' : 'transparent',
                }}
              >
                <span className="min-w-0">
                  <span className="block font-sans text-[13px] font-semibold text-tx">{w.word}</span>
                  <span className="font-mono text-[10px] text-tx3">
                    {w.pos ?? '—'} · {w.context_count} {w.context_count === 1 ? 'context' : 'contexts'}
                  </span>
                </span>
                <span>
                  {w.cefr ? (
                    <span className="rounded-[4px] border border-accLine px-[7px] py-[3px] font-mono text-[9.5px] font-medium text-acc">
                      {w.cefr}
                    </span>
                  ) : (
                    <span className="font-mono text-[10.5px] text-tx3">—</span>
                  )}
                </span>
                <span className="flex flex-wrap gap-[5px]">
                  {w.tags.length === 0 ? (
                    <span className="font-mono text-[10.5px] text-tx3">—</span>
                  ) : (
                    w.tags.map((t) => (
                      <span key={t} className="rounded-full bg-line2 px-[8px] py-[2px] font-mono text-[9.5px] text-tx2">
                        {t}
                      </span>
                    ))
                  )}
                </span>
                <span className="font-mono text-[10.5px] text-tx3">
                  {new Date(w.created_at).toLocaleDateString()}
                </span>
              </button>
            ))}
          </>
        )}
        {wordsStatus === 'idle' && words.length > 0 && rows.length === 0 && (
          <div className="p-[var(--pad)] font-mono text-[11px] text-tx3">no matches for "{query}"</div>
        )}
      </div>

      {addOpen && <AddWordModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}
