import { useEffect, useRef, useState } from 'react';
import { AddWordModal } from '@/features/vocabulary/AddWordModal';
import { MasteryDot, dueLabel } from '@/features/vocabulary/MasteryDot';
import { useAppStore } from '@/store/appStore';
import { useShellStore } from '@/store/shellStore';
import { useVocabularyStore } from '@/store/vocabularyStore';
import type { VocabSort, VocabStatusFilter } from '@/types/api';

const SORTS: Array<{ key: VocabSort; label: string }> = [
  { key: 'recent', label: 'recently added' },
  { key: 'oldest', label: 'oldest first' },
  { key: 'alphabetical', label: 'A–Z' },
  { key: 'due', label: 'due soonest' },
  { key: 'mastery', label: 'strongest' },
  { key: 'difficulty', label: 'hardest' },
];

const CEFR_BANDS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function VocabularyList() {
  const [addOpen, setAddOpen] = useState(false);
  const goWord = useShellStore((s) => s.goWord);
  const goScreen = useShellStore((s) => s.goScreen);
  const selectedWord = useShellStore((s) => s.selectedWord);
  const currentUser = useAppStore((s) => s.currentUser);

  const {
    words, wordsStatus, overview, query, cefr, tag, statusFilter, sort,
  } = useVocabularyStore();
  const fetchWords = useVocabularyStore((s) => s.fetchWords);
  const fetchOverview = useVocabularyStore((s) => s.fetchOverview);
  const setQuery = useVocabularyStore((s) => s.setQuery);
  const setStatusFilter = useVocabularyStore((s) => s.setStatusFilter);
  const setSort = useVocabularyStore((s) => s.setSort);
  const setCefr = useVocabularyStore((s) => s.setCefr);
  const setTag = useVocabularyStore((s) => s.setTag);
  const clearFilters = useVocabularyStore((s) => s.clearFilters);

  // Local mirror so typing stays instant while the request is debounced —
  // driving the input straight from the store would make every keystroke wait
  // on a round trip.
  const [draft, setDraft] = useState(query);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void fetchWords();
    void fetchOverview();
  }, [fetchWords, fetchOverview, currentUser]);

  const onType = (value: string) => {
    setDraft(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQuery(value), 180);
  };

  const filtersActive = Boolean(query || cefr || tag || statusFilter !== 'all');

  const chips: Array<{ key: VocabStatusFilter; label: string; count?: number }> = [
    { key: 'all', label: 'all', count: overview?.total },
    { key: 'due', label: 'due', count: overview?.due_now },
    { key: 'new', label: 'not started', count: overview?.new_count },
    { key: 'learning', label: 'learning', count: overview?.learning },
    { key: 'struggling', label: 'struggling', count: overview?.struggling },
    { key: 'suspended', label: 'suspended', count: overview?.suspended },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Summary. The list used to open on an undifferentiated wall of words
          with no sense of the collection or what needed attention. */}
      {overview && overview.total > 0 && (
        <div className="flex flex-none flex-wrap items-center gap-[10px] border-b border-line2 px-[var(--pad)] py-[12px]">
          <Stat value={overview.total} label="words" />
          <Stat value={overview.due_now} label="due now" accent={overview.due_now > 0} />
          <Stat value={overview.added_last_7_days} label="added · 7d" />
          {overview.struggling > 0 && <Stat value={overview.struggling} label="struggling" warn />}
          <div className="flex-1" />
          {overview.due_now > 0 && (
            <button
              onClick={() => goScreen('review')}
              className="rounded-field bg-accSolid px-3 py-[7px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
            >
              review {overview.due_now} due →
            </button>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line2 px-[var(--pad)] py-[11px]">
        <label className="flex min-w-[220px] items-center gap-[7px] rounded-field border border-line2 px-[11px] py-[7px] font-sans text-[11.5px] text-tx3 focus-within:border-acc">
          <span aria-hidden>⌕</span>
          <input
            value={draft}
            onChange={(e) => onType(e.target.value)}
            placeholder="search word, meaning, or tag"
            aria-label="Search vocabulary"
            className="w-[190px] bg-transparent text-tx placeholder:text-tx3 focus:outline-none"
          />
          {draft && (
            <button
              onClick={() => { setDraft(''); setQuery(''); }}
              aria-label="Clear search"
              className="text-tx3 hover:text-acc"
            >
              ✕
            </button>
          )}
        </label>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as VocabSort)}
          aria-label="Sort"
          className="rounded-field border border-line2 bg-transparent px-[9px] py-[7px] font-mono text-[10.5px] text-tx2 focus:border-acc focus:outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>

        <select
          value={cefr ?? ''}
          onChange={(e) => setCefr(e.target.value || null)}
          aria-label="Filter by CEFR level"
          className="rounded-field border border-line2 bg-transparent px-[9px] py-[7px] font-mono text-[10.5px] text-tx2 focus:border-acc focus:outline-none"
          style={{ borderColor: cefr ? 'var(--accLine)' : undefined, color: cefr ? 'var(--acc)' : undefined }}
        >
          <option value="">all levels</option>
          {CEFR_BANDS.map((b) => (
            <option key={b} value={b}>
              {b}{overview?.by_cefr[b] ? ` · ${overview.by_cefr[b]}` : ''}
            </option>
          ))}
        </select>

        {filtersActive && (
          <button onClick={() => { setDraft(''); clearFilters(); }} className="font-mono text-[10.5px] text-tx3 hover:text-acc">
            clear filters
          </button>
        )}

        <div className="flex-1" />
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-field border border-accLine bg-accSoft px-3 py-[7px] font-mono text-[11px] font-medium text-acc"
        >
          ＋ add word
        </button>
      </div>

      {/* Status chips — the dimension the old list could not express at all. */}
      <div className="flex flex-none flex-wrap items-center gap-[6px] border-b border-line2 px-[var(--pad)] py-[9px]">
        {chips.map((c) => {
          const on = statusFilter === c.key;
          if (c.count === 0 && c.key !== 'all' && !on) return null;
          return (
            <button
              key={c.key}
              onClick={() => setStatusFilter(c.key)}
              className="rounded-full border px-[9px] py-[3px] font-mono text-[10px]"
              style={{
                borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                background: on ? 'var(--accSoft)' : 'transparent',
                color: on ? 'var(--acc)' : 'var(--tx3)',
              }}
            >
              {c.label}
              {c.count !== undefined && <span className="ml-[5px] opacity-70">{c.count}</span>}
            </button>
          );
        })}
        {overview && overview.tags.length > 0 && (
          <>
            <span className="mx-[4px] h-[14px] w-px bg-line2" />
            {overview.tags.slice(0, 8).map((t) => (
              <button
                key={t.tag}
                onClick={() => setTag(tag === t.tag ? null : t.tag)}
                className="rounded-full border px-[9px] py-[3px] font-mono text-[10px]"
                style={{
                  borderColor: tag === t.tag ? 'var(--accLine)' : 'var(--line2)',
                  background: tag === t.tag ? 'var(--accSoft)' : 'transparent',
                  color: tag === t.tag ? 'var(--acc)' : 'var(--tx3)',
                }}
              >
                #{t.tag} <span className="opacity-70">{t.count}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {wordsStatus === 'loading' && words.length === 0 && (
          <div className="p-[var(--pad)] font-mono text-[11px] text-tx3">loading…</div>
        )}
        {wordsStatus === 'error' && (
          <div className="p-[var(--pad)] font-mono text-[11px] text-tx3">couldn't load your vocabulary</div>
        )}
        {wordsStatus === 'idle' && words.length === 0 && (
          <div className="p-[var(--pad)] font-sans text-[12.5px] leading-[1.7] text-tx2">
            {filtersActive ? (
              <>
                Nothing matches those filters.{' '}
                <button onClick={() => { setDraft(''); clearFilters(); }} className="text-acc hover:underline">
                  clear them
                </button>
              </>
            ) : (
              'Nothing saved yet — look up a word while reading and save it to build your list.'
            )}
          </div>
        )}

        {words.map((w) => {
          const due = dueLabel(w.due, w.card_state);
          const isDue = due === 'due now';
          return (
            <button
              key={w.id}
              onClick={() => goWord(w.word)}
              className="flex w-full items-start gap-[14px] border-b border-line2 px-[var(--pad)] py-[12px] text-left hover:bg-panel2"
              style={{ background: selectedWord === w.word ? 'var(--panel2)' : 'transparent' }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-[8px]">
                  <span className="font-sans text-[14px] font-semibold text-tx">{w.word}</span>
                  {w.ipa && <span className="font-mono text-[10px] text-tx3">{w.ipa}</span>}
                  {w.pos && <span className="font-mono text-[10px] text-tx3">{w.pos}</span>}
                  {w.cefr && (
                    <span className="rounded-[4px] border border-accLine px-[6px] py-[1px] font-mono text-[9px] font-medium text-acc">
                      {w.cefr}
                    </span>
                  )}
                  {w.suspended && (
                    <span className="rounded-full bg-line2 px-[7px] py-[1px] font-mono text-[9px] text-tx3">suspended</span>
                  )}
                  {w.lapses >= 3 && !w.suspended && (
                    <span className="rounded-full px-[7px] py-[1px] font-mono text-[9px]" style={{ color: '#c0563f', border: '1px solid #c0563f' }}>
                      {w.lapses} lapses
                    </span>
                  )}
                </div>
                {/* The definition, in the list. Previously you had to open
                    each word to remember what it meant, which is backwards
                    for a vocabulary you are trying to learn. */}
                {w.definition && (
                  <div className="mt-[3px] truncate font-sans text-[12px] leading-[1.5] text-tx2">
                    {w.definition}
                  </div>
                )}
                <div className="mt-[5px] flex flex-wrap items-center gap-[6px] font-mono text-[9.5px] text-tx3">
                  <MasteryDot level={w.mastery_level} label={w.mastery_label} />
                  <span>{w.mastery_label}</span>
                  {w.reps > 0 && <span>· {w.reps} reviews</span>}
                  {w.context_count > 0 && (
                    <span>· {w.context_count} {w.context_count === 1 ? 'context' : 'contexts'}</span>
                  )}
                  {w.tags.map((t) => (
                    <span key={t} className="rounded-full bg-line2 px-[7px] py-[1px] text-tx2">{t}</span>
                  ))}
                </div>
              </div>

              <div className="flex-none text-right font-mono text-[10px]">
                <div style={{ color: isDue ? 'var(--acc)' : 'var(--tx3)', fontWeight: isDue ? 600 : 400 }}>
                  {due}
                </div>
                <div className="mt-[3px] text-tx3">
                  {new Date(w.created_at).toLocaleDateString()}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {addOpen && <AddWordModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function Stat({ value, label, accent, warn }: { value: number; label: string; accent?: boolean; warn?: boolean }) {
  const color = warn ? '#c0563f' : accent ? 'var(--acc)' : 'var(--tx)';
  return (
    <div className="rounded-field border border-line2 px-[11px] py-[6px]">
      <span className="font-sans text-[15px] font-semibold" style={{ color }}>{value}</span>
      <span className="ml-[6px] font-mono text-[9.5px] uppercase tracking-[0.1em] text-tx3">{label}</span>
    </div>
  );
}
