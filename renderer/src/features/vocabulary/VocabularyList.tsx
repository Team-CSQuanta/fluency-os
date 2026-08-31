import { useState } from 'react';
import { MASTERY_COLORS, matchesVocabFilter, VOCAB_FILTERS, VOCAB_ROWS } from '@/features/vocabulary/vocabMockData';
import { useShellStore } from '@/store/shellStore';

export function VocabularyList() {
  const [filter, setFilter] = useState<string>('All');
  const goWord = useShellStore((s) => s.goWord);
  const selectedWord = useShellStore((s) => s.selectedWord);

  const rows = VOCAB_ROWS.filter((r) => matchesVocabFilter(r, filter));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line2 px-[var(--pad)] py-[14px]">
        <div className="flex min-w-[210px] items-center gap-[7px] rounded-field border border-line2 px-[11px] py-[7px] font-sans text-[11.5px] text-tx3">
          ⌕ search 1,847 entries
        </div>
        {VOCAB_FILTERS.map((f) => {
          const on = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="rounded-full border px-[11px] py-[6px] font-sans text-[11px] font-medium"
              style={{
                borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                background: on ? 'var(--accSoft)' : 'transparent',
                color: on ? 'var(--acc)' : 'var(--tx2)',
              }}
            >
              {f}
            </button>
          );
        })}
        <div className="flex-1" />
        <button className="rounded-field border border-line px-3 py-[7px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc">
          export APKG
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="sticky top-0 grid gap-3 border-b border-line2 bg-bg px-[var(--pad)] py-[9px] font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-tx3"
          style={{ gridTemplateColumns: '1.5fr .6fr .8fr 1.1fr .7fr .6fr' }}
        >
          <span>Headword</span>
          <span>POS</span>
          <span>Source</span>
          <span>Mastery</span>
          <span>Due</span>
          <span>Status</span>
        </div>
        {rows.map((r) => (
          <button
            key={r.word}
            onClick={() => goWord(r.word)}
            className="grid w-full items-center gap-3 border-b border-line2 px-[var(--pad)] py-[11px] text-left hover:bg-panel2"
            style={{
              gridTemplateColumns: '1.5fr .6fr .8fr 1.1fr .7fr .6fr',
              background: selectedWord === r.word ? 'var(--panel2)' : 'transparent',
            }}
          >
            <span className="min-w-0">
              <span className="block font-sans text-[13px] font-semibold text-tx">{r.word}</span>
              <span className="font-mono text-[10px] text-tx3">
                {r.ipa} · {r.ctx} contexts
              </span>
            </span>
            <span className="font-mono text-[11px] text-tx2">{r.pos}</span>
            <span className="font-mono text-[10.5px] text-tx3">{r.src}</span>
            <span className="flex items-center gap-2">
              <span className="h-1 max-w-[88px] flex-1 rounded-field bg-line2">
                <span className="block h-1 rounded-field" style={{ width: `${r.mastery * 20}%`, background: MASTERY_COLORS[r.mastery] }} />
              </span>
              <span className="font-mono text-[10px] font-medium text-tx3">L{r.mastery}</span>
            </span>
            <span className="font-mono text-[10.5px]" style={{ color: r.due === 'today' ? 'var(--acc)' : 'var(--tx3)' }}>
              {r.due}
            </span>
            <span className="justify-self-start rounded-[4px] bg-line2 px-[7px] py-[3px] font-mono text-[9.5px] font-medium text-tx2">
              {r.status}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
