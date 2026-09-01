import { useState } from 'react';
import {
  CONTEXT_META,
  dueLabelsFor,
  POS_FULL,
  TAG_SUGGESTIONS,
  VOCAB_ROWS,
  WORD_DETAILS,
} from '@/features/vocabulary/vocabMockData';
import { useShellStore } from '@/store/shellStore';

const DUE_FG = ['var(--acc)', 'var(--acc)', 'var(--tx2)', 'var(--tx3)'];

export function VocabularyEntry() {
  const word = useShellStore((s) => s.selectedWord);
  const goScreen = useShellStore((s) => s.goScreen);
  const goForest = () => goScreen('forest');

  const row = VOCAB_ROWS.find((r) => r.word === word) ?? VOCAB_ROWS[0];
  const detail = WORD_DETAILS[row.word] ?? WORD_DETAILS.reticent;
  const hasAudio = row.ipa !== '—';

  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(detail.notes);
  const [tags, setTags] = useState(detail.tags);
  const [voice, setVoice] = useState<'us' | 'uk'>('us');
  const [slow, setSlow] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState('');

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  };

  const play = (v: 'us' | 'uk') => {
    setVoice(v);
    setPlaying(true);
    setTimeout(() => setPlaying(false), 900);
  };

  const suggestions = TAG_SUGGESTIONS.filter((t) => !tags.includes(t)).slice(0, 4);
  const cards = dueLabelsFor(row);

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
          <span className="font-mono text-[10px] text-tx3">1,847 entries · entry {detail.entryNo}</span>
          <div className="flex-1" />
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-[7px] rounded-field border border-accLine bg-accSoft px-3 py-[7px] font-sans text-[11px] font-medium text-acc"
            >
              Edit entry
            </button>
          ) : (
            <span className="flex items-center gap-[7px]">
              <span className="rounded-full bg-accSoft px-[9px] py-1 font-mono text-[9.5px] font-medium text-acc">editing</span>
              <button
                onClick={() => setEditing(false)}
                className="rounded-field border border-line px-3 py-[7px] font-mono text-[11px] text-tx3 hover:border-acc hover:text-acc"
              >
                cancel
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  flashToast(`"${row.word}" updated`);
                }}
                className="rounded-field bg-accSolid px-[14px] py-[7px] font-sans text-[11px] font-semibold text-white"
              >
                Save changes
              </button>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-[22px] border-b border-line2 pb-5">
          <div className="min-w-[260px] flex-1">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-sans text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-tx">{row.word}</span>
              <span className="font-mono text-[15px] text-tx3">{row.ipa}</span>
            </div>
            {!hasAudio ? (
              <div className="mt-[14px] rounded-field border border-dashed border-line px-[11px] py-2 font-mono text-[10.5px] text-tx3">
                no single pronunciation — multi-word phrase · say it in context
              </div>
            ) : (
              <div className="mt-[14px] flex flex-wrap items-center gap-[6px]">
                {(['us', 'uk'] as const).map((v) => {
                  const on = voice === v;
                  return (
                    <button
                      key={v}
                      onClick={() => play(v)}
                      className="flex items-center gap-[7px] rounded-full border px-3 py-[7px] font-sans text-[11px] font-medium"
                      style={{ borderColor: on ? 'var(--accLine)' : 'var(--line)', background: on ? 'var(--accSoft)' : 'transparent', color: on ? 'var(--acc)' : 'var(--tx2)' }}
                    >
                      {v === 'us' ? 'US · Kokoro' : 'UK · Piper'}
                    </button>
                  );
                })}
                <button
                  onClick={() => setSlow((s) => !s)}
                  className="rounded-full border px-[11px] py-[7px] font-mono text-[10.5px] font-medium"
                  style={{ borderColor: slow ? 'var(--accLine)' : 'var(--line)', background: slow ? 'var(--accSoft)' : 'transparent', color: slow ? 'var(--acc)' : 'var(--tx3)' }}
                >
                  0.6× slow
                </button>
                <span className="flex h-[22px] items-center gap-[3px] pl-1">
                  {Array.from({ length: 14 }, (_, i) => (
                    <span key={i} className="w-[2px] rounded-[2px]" style={{ height: 4 + ((i * 5) % 7) * 2.4, background: playing ? 'var(--acc)' : 'var(--line)' }} />
                  ))}
                </span>
                <span className="font-mono text-[9.5px] text-tx3">
                  {playing ? `playing · ${voice === 'us' ? 'en-US' : 'en-GB'}${slow ? ' · 0.6×' : ''}` : 'tap a voice to hear it'}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { k: 'CEFR', v: detail.cefr, fg: 'var(--acc)' },
              { k: 'POS', v: POS_FULL[row.pos] ?? row.pos, fg: 'var(--tx)' },
              { k: 'Freq rank', v: detail.rank, fg: 'var(--tx)' },
              { k: 'Retention', v: detail.retention, fg: parseFloat(detail.retention) < 0.7 ? '#c0563f' : 'var(--acc)' },
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
              <div className="mb-[10px] flex items-center gap-2">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">Definitions</span>
                {editing && <span className="font-mono text-[9px] text-acc">editable</span>}
              </div>
              <div className="rounded-field border px-[14px] py-[13px]" style={{ borderColor: editing ? 'var(--accLine)' : 'var(--line2)', background: 'var(--panel)' }}>
                <div className="mb-[6px] font-mono text-[9px] font-medium text-acc">PRIMARY · llm_contextual</div>
                <div className="font-sans text-[13px] leading-[1.7] text-tx">
                  {detail.def1}
                  {editing && <span className="animate-pulse text-acc">▌</span>}
                </div>
              </div>
              <div className="mt-2 rounded-field border border-line2 px-[14px] py-[13px]">
                <div className="mb-[6px] font-mono text-[9px] font-medium text-tx3">DICTIONARY · read-only</div>
                <div className="font-sans text-[12.5px] leading-[1.7] text-tx2">{detail.def2}</div>
              </div>
            </div>

            <div>
              <div className="mb-[10px] flex items-center justify-between gap-[10px]">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">My notes · {notes.length}</span>
                <button
                  onClick={() => {
                    setNotes((n) => [...n, { text: 'New note — written while reviewing this entry.', meta: 'added just now' }]);
                    setEditing(true);
                    flashToast('Note added');
                  }}
                  className="rounded-[5px] border border-accLine px-[9px] py-1 font-mono text-[10px] font-medium text-acc"
                >
                  ＋ add note
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {notes.map((n, i) => (
                  <div key={i} className="flex gap-[10px] rounded-field border border-line2 bg-panel px-3 py-[11px]">
                    <span className="w-[2px] flex-none rounded-[2px] bg-acc" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-sans text-[12.5px] leading-[1.7] text-tx">{n.text}</span>
                      <span className="mt-[5px] block font-mono text-[9px] text-tx3">{n.meta}</span>
                    </span>
                    {editing && (
                      <button
                        onClick={() => {
                          setNotes((list) => list.filter((_, j) => j !== i));
                          flashToast('Note deleted');
                        }}
                        title="Delete note"
                        className="h-[22px] w-[22px] flex-none rounded-[5px] border border-line2 font-mono text-[11px] text-tx3 hover:border-acc hover:text-acc"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <div className="rounded-field border border-dashed border-line px-3 py-[11px] font-sans text-[12px] text-tx3">
                  add your own note…<span className="animate-pulse">▌</span>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-[10px] flex items-center justify-between gap-[10px]">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">Contexts · {detail.contexts.length}</span>
                <span className="font-mono text-[9.5px] text-tx3">clip or passage where you met it</span>
              </div>
              <div className="flex flex-col gap-[9px]">
                {detail.contexts.map((c, i) => {
                  const meta = CONTEXT_META[c.kind];
                  return (
                    <div key={i} className="flex gap-3 rounded-field border border-line2 bg-panel p-[11px]">
                      <button
                        onClick={() => flashToast(`${meta.action} · ${c.src}`)}
                        className="relative grid h-[62px] w-[104px] flex-none place-items-center rounded-[6px] border border-line2"
                        style={{ background: 'repeating-linear-gradient(135deg,var(--tile) 0 6px,var(--tileB) 6px 12px)' }}
                      >
                        <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-black/50 font-mono text-[9px] text-white">
                          {meta.icon}
                        </span>
                        <span className="absolute bottom-1 right-[5px] rounded-[3px] bg-black/55 px-1 font-mono text-[8px] font-medium text-white">
                          {c.src.split(' · ')[1] ?? c.kind}
                        </span>
                      </button>
                      <span className="min-w-0 flex-1">
                        <span className="block font-sans text-[12.5px] leading-[1.7] text-tx">"{c.snippet}"</span>
                        <span className="mt-[7px] flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[9.5px] text-tx3">{c.src}</span>
                          <button
                            onClick={() => flashToast(`${meta.action} · ${c.src}`)}
                            className="rounded-[5px] border border-accLine px-2 py-[3px] font-mono text-[9.5px] font-medium text-acc"
                          >
                            {meta.action}
                          </button>
                          {i === 0 && <span className="font-mono text-[9px] font-medium text-acc">card sentence</span>}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <div className="rounded-panel border border-line2 bg-panel p-[14px]">
              <div className="mb-[10px] flex items-center justify-between gap-[10px]">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">Tags</span>
                <span className="font-mono text-[9px] text-tx3">{tags.length} tags</span>
              </div>
              <div className="flex flex-wrap gap-[6px]">
                {tags.map((t) => (
                  <span key={t} className="flex items-center gap-[6px] rounded-full border border-accLine bg-accSoft px-[10px] py-[5px] font-sans text-[10.5px] font-medium text-acc">
                    {t}
                    {editing && (
                      <button
                        onClick={() => {
                          setTags((list) => list.filter((x) => x !== t));
                          flashToast('Tag removed');
                        }}
                        title="Remove tag"
                        className="font-mono text-[11px] leading-none text-acc/70 hover:text-acc"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <div className="mt-3 border-t border-line2 pt-[11px]">
                <div className="mb-[7px] font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Add a tag</div>
                <div className="flex flex-wrap gap-[6px]">
                  {suggestions.map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTags((list) => [...list, t]);
                        setEditing(true);
                        flashToast(`Tagged "${t}"`);
                      }}
                      className="rounded-full border border-dashed border-line px-[10px] py-[5px] font-sans text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
                    >
                      ＋ {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-panel border border-line2 p-[14px]">
              <div className="mb-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">Scheduling · FSRS</div>
              <div className="grid grid-cols-2 gap-[6px]">
                {cards.map((c, i) => (
                  <span key={c.n} className="rounded-field border border-line2 px-[10px] py-[9px]">
                    <span className="block font-mono text-[10px] font-medium" style={{ color: DUE_FG[i] }}>
                      {c.n}
                    </span>
                    <span className="mt-[3px] block font-mono text-[9.5px] text-tx3">{c.due}</span>
                  </span>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-[9px]">
                <span className="h-1 flex-1 rounded-field bg-line2">
                  <span className="block h-1 rounded-field bg-acc" style={{ width: `${row.mastery * 20}%` }} />
                </span>
                <span className="font-mono text-[10px] font-medium text-tx3">mastery L{row.mastery}</span>
              </div>
            </div>

            <div className="rounded-panel border border-line2 p-[14px]">
              <div className="mb-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">Collocations</div>
              <div className="flex flex-wrap gap-[6px]">
                {detail.colls.map((c) => (
                  <span key={c.p} className="rounded-[5px] border border-line2 px-2 py-1 font-mono text-[10.5px] text-tx2">
                    {c.p} <span className="text-tx3">×{c.n}</span>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-[6px]">
              <button
                onClick={() => flashToast('Entry suspended')}
                className="min-w-[92px] flex-1 rounded-field border border-line py-[9px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
              >
                suspend
              </button>
              <button
                onClick={goForest}
                className="min-w-[92px] flex-1 rounded-field border border-accLine bg-accSoft py-[9px] font-mono text-[11px] text-acc"
              >
                see plant
              </button>
            </div>
            <div className="font-mono text-[9.5px] leading-[1.7] text-tx3">
              edits stay local · card sentence and audio are regenerated on save
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
