import { useState } from 'react';
import {
  BOOKMARKS,
  EXISTING_HIGHLIGHTS,
  HIGHLIGHT_COLORS,
  LEVEL_MODES,
  MODE_HEADLINES,
  PARAGRAPH_AI,
  PARAGRAPH_LEVELS,
  PARAGRAPHS,
  SEARCH_HITS,
  TOC,
  type LevelMode,
} from '@/features/reader/readerMockData';
import { useShellStore } from '@/store/shellStore';

type Tab = 'toc' | 'search' | 'marks' | 'text' | 'ai' | 'level';

const TAB_ICONS: Record<Tab, string> = {
  toc: 'M2.5 4h11 M2.5 8h11 M2.5 12h7',
  search: 'M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z M10.4 10.4L13.5 13.5',
  marks: 'M4 2.5h8v11l-4-3-4 3z',
  text: 'M2 12l3.2-8h1.6L10 12 M3.4 9.2h5.2 M11 5.5h3.5 M11 8.5h3.5 M11 11.5h3.5',
  ai: 'M8 2.6a3 3 0 013 3c0 1.6-1.4 2.2-2.2 3-.4.4-.5.9-.5 1.4 M8 12.6v.8',
  level: 'M3 13h3l7.2-7.2-3-3L3 10z M10.2 2.8l3 3',
};

const TAB_META: Record<Tab, { label: string; title: string; hint: string }> = {
  toc: { label: 'Contents', title: 'Table of contents', hint: 'Jump to any chapter. Current chapter is marked.' },
  search: { label: 'Search', title: 'Search in book', hint: 'Full-text search across all 342 pages.' },
  marks: { label: 'Bookmarks', title: 'Highlights & bookmarks', hint: 'Colour, note, and every highlight in this book.' },
  text: { label: 'Text', title: 'Text size & display', hint: 'Size, theme, difficulty tint and read-aloud.' },
  ai: { label: 'AI', title: 'AI explanation', hint: 'Meaning, pronunciation and sense in context.' },
  level: { label: 'Level', title: 'Adaptive text label', hint: 'Rewrites of the selection at your target level.' },
};

const READER_BG: Record<string, string> = { light: '#fbfbf9', sepia: '#f4ecdd', dark: '#111312' };
const READER_TX: Record<string, string> = { light: 'var(--tx)', sepia: '#3a3227', dark: '#e6e8e6' };

function TabIcon({ tab, color }: { tab: Tab; color: string }) {
  return (
    <svg viewBox="0 0 16 16" className="h-[13px] w-[13px] flex-none" fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d={TAB_ICONS[tab]} />
    </svg>
  );
}

export function Reader() {
  const initialChapter = useShellStore((s) => s.readerChapter);
  const initialPos = useShellStore((s) => s.readerPos);
  const goScreen = useShellStore((s) => s.goScreen);

  const [chapter, setChapter] = useState(initialChapter);
  const [pos, setPos] = useState(initialPos);
  const [tab, setTab] = useState<Tab>('toc');
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedPara, setSelectedPara] = useState(2);
  const [fontSize, setFontSize] = useState(15.5);
  const [pageTheme, setPageTheme] = useState<'light' | 'sepia' | 'dark'>('sepia');
  const [heatOn, setHeatOn] = useState(true);
  const [levelMode, setLevelMode] = useState<LevelMode>('contextual');
  const [showOriginal, setShowOriginal] = useState(false);
  const [highlights, setHighlights] = useState<Record<number, string>>({ 1: 'green' });
  const [highlighterColor, setHighlighterColor] = useState<string | null>(null);

  const ai = PARAGRAPH_AI[selectedPara] ?? PARAGRAPH_AI[2];
  const level = PARAGRAPH_LEVELS[selectedPara]?.[levelMode] ?? PARAGRAPH_LEVELS[2][levelMode];
  const fsPct = Math.round(((fontSize - 12) / 10) * 100);

  const handleParaClick = (i: number) => {
    if (highlighterColor) {
      setHighlights((h) => ({ ...h, [i]: highlighterColor }));
    } else {
      setSelectedPara(i);
    }
  };

  const tabs: Tab[] = ['toc', 'search', 'marks', 'text', 'ai', 'level'];

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-9" style={{ background: READER_BG[pageTheme] }}>
        <div className="sticky top-0 z-[12] mb-[30px] flex w-full justify-center border-b border-line2 py-[10px]" style={{ background: READER_BG[pageTheme] }}>
          <div className="flex w-full max-w-[760px] flex-wrap items-center gap-[6px]">
            <button
              onClick={() => goScreen('bookshelf')}
              className="flex-none rounded-[5px] border border-line2 px-[9px] py-1 font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
            >
              ‹ bookshelf
            </button>
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-tx3">{chapter}</span>
            {highlighterColor && (
              <div className="flex items-center gap-[5px] rounded-full border border-accLine bg-accSoft px-2 py-1">
                {Object.entries(HIGHLIGHT_COLORS).map(([name, hex]) => (
                  <button
                    key={name}
                    onClick={() => setHighlighterColor(name)}
                    title={name}
                    className="h-4 w-4 rounded-full"
                    style={{ background: `${hex}8c`, border: `2px solid ${highlighterColor === name ? 'var(--tx)' : 'transparent'}` }}
                  />
                ))}
                <span className="ml-[3px] font-mono text-[9.5px] font-medium text-acc">click a line to mark</span>
              </div>
            )}
          </div>
        </div>

        <div className="w-full max-w-[640px]">
          <div className="mb-[26px] flex items-center justify-between gap-3 font-mono text-[10.5px] text-tx3">
            <span className="flex-1 truncate">page {pos}</span>
            <span>14 of 20 pages today</span>
          </div>
          <h2 className="mb-5 font-sans text-[26px] font-semibold leading-[1.25] tracking-[-0.02em]" style={{ color: READER_TX[pageTheme] }}>
            {chapter.split(' · ')[1] ?? chapter}
          </h2>
          {PARAGRAPHS.map((body, i) => {
            const on = selectedPara === i;
            const mark = highlights[i];
            const hard = heatOn && (i === 2 || i === 3);
            return (
              <div
                key={i}
                onClick={() => handleParaClick(i)}
                className="relative mb-[18px] cursor-pointer rounded-[6px] px-3 py-2"
                style={{
                  fontSize: `${fontSize}px`,
                  lineHeight: 1.85,
                  color: hard ? '#8a6a2e' : READER_TX[pageTheme],
                  background: mark ? `${HIGHLIGHT_COLORS[mark]}4d` : on ? 'var(--accSoft)' : 'transparent',
                  borderLeft: `2px solid ${on ? 'var(--acc)' : 'transparent'}`,
                  boxShadow: mark ? `inset 0 0 0 1px ${HIGHLIGHT_COLORS[mark]}8c` : 'none',
                }}
              >
                <span>{body}</span>
                {mark && (
                  <span
                    className="absolute right-[-16px] top-2 h-2 w-2 rounded-full"
                    style={{ background: HIGHLIGHT_COLORS[mark] }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!panelOpen && (
        <aside className="flex min-h-0 w-[46px] flex-none flex-col items-center gap-[3px] border-l border-line2 bg-panel py-[9px]">
          <button
            onClick={() => setPanelOpen(true)}
            title="Expand panel"
            className="grid h-[30px] w-[30px] place-items-center rounded-field border border-line2 text-tx2 hover:border-acc hover:text-acc"
          >
            ‹
          </button>
          <div className="my-[5px] h-px w-[22px] bg-line2" />
          {tabs.map((t) => {
            const on = tab === t;
            return (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setPanelOpen(true);
                }}
                title={TAB_META[t].label}
                className="grid h-[30px] w-[30px] place-items-center rounded-field border hover:border-acc"
                style={{ borderColor: on ? 'var(--accLine)' : 'var(--line2)', background: on ? 'var(--accSoft)' : 'transparent' }}
              >
                <TabIcon tab={t} color={on ? 'var(--acc)' : 'var(--tx2)'} />
              </button>
            );
          })}
        </aside>
      )}

      {panelOpen && (
        <aside className="flex min-h-0 w-[308px] flex-none flex-col border-l border-line2 bg-panel">
          <div className="grid flex-none grid-cols-3 gap-[2px] px-[9px] pt-[9px]">
            {tabs.map((t) => {
              const on = tab === t;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="flex items-center justify-center gap-[5px] rounded-field border py-[7px] font-sans text-[10px] font-medium"
                  style={{
                    borderColor: on ? 'var(--accLine)' : 'transparent',
                    background: on ? 'var(--accSoft)' : 'transparent',
                    color: on ? 'var(--acc)' : 'var(--tx3)',
                  }}
                >
                  <TabIcon tab={t} color={on ? 'var(--acc)' : 'var(--tx3)'} />
                  {TAB_META[t].label}
                </button>
              );
            })}
          </div>

          <div className="mt-[9px] flex flex-none items-start gap-[10px] border-y border-line2 px-[13px] py-[10px]">
            <div className="min-w-0 flex-1">
              <div className="mb-[5px] font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                {TAB_META[tab].title}
              </div>
              <div className="font-sans text-[10.5px] leading-[1.6] text-tx2">{TAB_META[tab].hint}</div>
            </div>
            <button
              onClick={() => setPanelOpen(false)}
              title="Collapse panel"
              className="grid h-[26px] w-[26px] flex-none place-items-center rounded-field border border-line2 text-tx3 hover:border-acc hover:text-acc"
            >
              ›
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-[13px] pb-5 pt-[13px]">
            {tab === 'toc' && (
              <div className="flex flex-col gap-[1px]">
                {TOC.map((c) => {
                  const on = chapter.includes(c.label.split(' · ')[1] ?? '');
                  return (
                    <button
                      key={c.label}
                      onClick={() => {
                        setChapter('Chapter ' + c.label);
                        setPos(c.page + ' / 342');
                      }}
                      className="flex items-baseline justify-between gap-[10px] rounded-field px-[9px] py-2 text-left hover:bg-line2"
                      style={{ background: on ? 'var(--accSoft)' : 'transparent', borderLeft: `2px solid ${on ? 'var(--acc)' : 'transparent'}` }}
                    >
                      <span className="min-w-0 font-sans text-[11.5px] leading-[1.5]" style={{ color: on ? 'var(--acc)' : 'var(--tx2)', fontWeight: on ? 600 : 400 }}>
                        {c.label}
                      </span>
                      <span className="flex-none font-mono text-[9.5px] text-tx3">{c.page}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {tab === 'search' && (
              <div>
                <div className="flex items-center gap-[7px] rounded-field border border-accLine bg-accSoft px-[10px] py-2 font-mono text-[11.5px] text-tx">
                  reticent<span className="animate-pulse">▌</span>
                </div>
                <div className="my-2 font-mono text-[9.5px] text-tx3">{SEARCH_HITS.length} matches in this book</div>
                <div className="flex flex-col gap-[7px]">
                  {SEARCH_HITS.map((h) => (
                    <button
                      key={h.snippet}
                      onClick={() => setTab('toc')}
                      className="rounded-field border border-line2 px-[10px] py-[9px] text-left hover:border-acc"
                    >
                      <div className="font-sans text-[11px] leading-[1.6] text-tx2">{h.snippet}</div>
                      <div className="mt-1 font-mono text-[9px] text-tx3">{h.loc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === 'marks' && (
              <div className="flex flex-col gap-[13px]">
                <div>
                  <div className="mb-[7px] font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Colour</div>
                  <div className="flex gap-[6px]">
                    {Object.entries(HIGHLIGHT_COLORS).map(([name, hex]) => (
                      <button
                        key={name}
                        onClick={() => setHighlighterColor(highlighterColor === name ? null : name)}
                        title={name}
                        className="h-[30px] flex-1 rounded-field"
                        style={{ background: `${hex}8c`, border: `2px solid ${highlighterColor === name ? 'var(--tx)' : 'transparent'}` }}
                      />
                    ))}
                  </div>
                  <div className="mt-[7px] font-mono text-[10px] text-tx3">
                    {highlighterColor ? `highlighter on · click a paragraph to mark it ${highlighterColor}` : 'pick a colour, then click a paragraph'}
                  </div>
                </div>
                <div className="border-t border-line2 pt-3">
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                    Bookmarks
                  </div>
                  <div className="flex flex-col gap-[7px]">
                    {BOOKMARKS.map((b) => (
                      <button
                        key={b.label}
                        onClick={() => setTab('toc')}
                        className="flex gap-[9px] rounded-field border border-line2 px-[10px] py-[9px] text-left hover:border-acc"
                      >
                        <span className="min-w-0">
                          <span className="block font-sans text-[11.5px] font-medium text-tx">{b.label}</span>
                          <span className="mt-[3px] block font-mono text-[9px] text-tx3">{b.loc}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border-t border-line2 pt-3">
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                    All highlights · {EXISTING_HIGHLIGHTS.length}
                  </div>
                  <div className="flex flex-col gap-2">
                    {EXISTING_HIGHLIGHTS.map((n) => (
                      <div key={n.text} className="rounded-field border border-line2 px-[10px] py-[10px]" style={{ borderLeft: `3px solid ${n.color}` }}>
                        <div className="font-sans text-[11px] leading-[1.6] text-tx2">"{n.text}"</div>
                        {n.note && (
                          <div className="mt-[6px] border-t border-line2 pt-[6px] font-sans text-[10.5px] leading-[1.6] text-tx3">{n.note}</div>
                        )}
                        <div className="mt-[6px] font-mono text-[9px] text-tx3">{n.loc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'ai' && (
              <div className="flex flex-col gap-[14px]">
                <div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-sans text-[21px] font-semibold leading-[1.2] tracking-[-0.02em] text-tx">{ai.w}</span>
                    <span className="font-mono text-[11.5px] text-tx3">{ai.ipa}</span>
                  </div>
                  <div className="mt-[9px] flex items-center gap-[6px]">
                    <button className="flex items-center gap-[6px] rounded-full border border-line px-[10px] py-[6px] font-mono text-[10.5px] font-medium text-tx2 hover:border-acc hover:text-acc">
                      hear it
                    </button>
                    <span className="rounded-[4px] bg-line2 px-2 py-1 font-mono text-[9.5px] font-medium text-tx3">{ai.pos}</span>
                    <span className="rounded-[4px] border border-accLine px-2 py-1 font-mono text-[9.5px] font-medium text-acc">{ai.cefr}</span>
                  </div>
                </div>
                <div className="rounded-field border border-accLine bg-accSoft px-[10px] py-[9px] font-sans text-[11px] leading-[1.6] text-tx2">
                  selection · "{PARAGRAPHS[selectedPara].slice(0, 58)}…"
                </div>
                <div className="border-t border-line2 pt-3">
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Dictionary</div>
                  <div className="flex flex-col gap-[9px]">
                    {ai.senses.map((s, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="mt-[2px] flex-none font-mono text-[10px] font-medium text-acc">{i + 1}.</span>
                        <span className="min-w-0">
                          <span className="block font-sans text-[12px] leading-[1.65] text-tx">{s.def}</span>
                          <span className="mt-[3px] block font-sans text-[11px] leading-[1.6] text-tx3">"{s.ex}"</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-line2 pt-3">
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">In this sentence</div>
                  <div className="font-sans text-[12px] leading-[1.7] text-tx2">{ai.ctx}</div>
                </div>
                <div className="border-t border-line2 pt-3">
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Near synonyms</div>
                  <div className="flex flex-wrap gap-[5px]">
                    {ai.syns.map((s) => (
                      <span key={s} className="rounded-full border border-line2 px-[9px] py-1 font-sans text-[10.5px] text-tx2">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <button className="rounded-field border border-accLine bg-accSoft py-[10px] font-sans text-[11.5px] font-medium text-acc">
                  ＋ Save to vocabulary with this sentence
                </button>
                <div className="font-mono text-[9.5px] leading-[1.7] text-tx3">
                  offline stub — a local model would generate this in ≈2 s once configured
                </div>
              </div>
            )}

            {tab === 'level' && (
              <div className="flex flex-col gap-[13px]">
                <div className="rounded-field border border-line2 p-[11px]">
                  <div className="mb-[6px] font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">
                    Selection · B1 target
                  </div>
                  <div className="font-sans text-[11.5px] leading-[1.7] text-tx3">"{PARAGRAPHS[selectedPara]}"</div>
                </div>
                <div className="flex flex-col gap-[5px]">
                  {LEVEL_MODES.map((m) => {
                    const on = levelMode === m.key;
                    return (
                      <button
                        key={m.key}
                        onClick={() => setLevelMode(m.key)}
                        className="flex items-center justify-between gap-2 rounded-field border px-[10px] py-2 text-left font-sans text-[11px] font-medium"
                        style={{ borderColor: on ? 'var(--accLine)' : 'var(--line)', background: on ? 'var(--accSoft)' : 'transparent', color: on ? 'var(--acc)' : 'var(--tx2)' }}
                      >
                        <span>{m.label}</span>
                        <span className="font-mono text-[9px] text-tx3">{m.tag}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="border-t border-line2 pt-3">
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em] text-acc">
                    {MODE_HEADLINES[levelMode]}
                  </div>
                  <div className="font-sans text-[12.5px] leading-[1.8] text-tx">
                    {showOriginal ? (
                      <span>{PARAGRAPHS[selectedPara]}</span>
                    ) : (
                      <>
                        <span>{level.before}</span>
                        {level.sub1 && <span className="cursor-help border-b border-dashed border-acc" title={level.origSub1}>{level.sub1}</span>}
                        <span>{level.mid}</span>
                        {level.sub2 && <span className="cursor-help border-b border-dashed border-acc" title={level.origSub2}>{level.sub2}</span>}
                        <span>{level.after}</span>
                      </>
                    )}
                  </div>
                </div>
                {(level.origSub1 || level.origSub2) && (
                  <div className="border-t border-line2 pt-3">
                    <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Substitutions</div>
                    <div className="flex flex-col gap-[6px]">
                      {level.origSub1 && level.sub1 && (
                        <div className="flex items-center gap-2 rounded-field border border-line2 px-[9px] py-[7px]">
                          <span className="font-mono text-[11px] text-tx3 line-through">{level.origSub1}</span>
                          <span className="font-mono text-[10px] text-tx3">→</span>
                          <span className="font-sans text-[11px] font-medium text-tx">{level.sub1}</span>
                        </div>
                      )}
                      {level.origSub2 && level.sub2 && (
                        <div className="flex items-center gap-2 rounded-field border border-line2 px-[9px] py-[7px]">
                          <span className="font-mono text-[11px] text-tx3 line-through">{level.origSub2}</span>
                          <span className="font-mono text-[10px] text-tx3">→</span>
                          <span className="font-sans text-[11px] font-medium text-tx">{level.sub2}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <button
                  onClick={() => setShowOriginal((v) => !v)}
                  className="rounded-field border border-line py-2 font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
                >
                  {showOriginal ? 'show simplified' : 'show original'}
                </button>
                <div className="font-mono text-[9.5px] leading-[1.7] text-tx3">
                  applies to the selection only · cached by paragraph hash
                </div>
              </div>
            )}

            {tab === 'text' && (
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Text size</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setFontSize((v) => Math.max(12, v - 1))}
                      className="grid h-[34px] w-[34px] place-items-center rounded-field border border-line font-sans text-[13px] text-tx2 hover:border-acc hover:text-acc"
                    >
                      A−
                    </button>
                    <div className="h-[3px] flex-1 rounded-field bg-line2">
                      <div className="h-[3px] rounded-field bg-acc" style={{ width: `${fsPct}%` }} />
                    </div>
                    <button
                      onClick={() => setFontSize((v) => Math.min(22, v + 1))}
                      className="grid h-[34px] w-[34px] place-items-center rounded-field border border-line font-sans text-[15px] font-semibold text-tx2 hover:border-acc hover:text-acc"
                    >
                      A+
                    </button>
                  </div>
                  <div className="mt-[7px] font-mono text-[10px] text-tx3">{fontSize.toFixed(1)}px · line height 1.85 · column 640px</div>
                </div>
                <div>
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Page theme</div>
                  <div className="flex gap-[6px]">
                    {(['light', 'sepia', 'dark'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setPageTheme(t)}
                        className="flex-1 rounded-field border py-[9px] font-mono text-[10px] font-medium"
                        style={{
                          borderColor: pageTheme === t ? 'var(--accLine)' : 'var(--line2)',
                          background: READER_BG[t],
                          color: t === 'dark' ? '#e6e8e6' : '#3a3227',
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Difficulty heat</div>
                  <button
                    onClick={() => setHeatOn((v) => !v)}
                    className="flex w-full items-center justify-between rounded-field border px-[10px] py-[9px] font-sans text-[11px] font-medium text-tx2"
                    style={{ borderColor: heatOn ? 'var(--accLine)' : 'var(--line)' }}
                  >
                    <span>Tint above-level words</span>
                    <span className="font-mono text-[10px] font-medium" style={{ color: heatOn ? 'var(--acc)' : 'var(--tx3)' }}>
                      {heatOn ? 'on' : 'off'}
                    </span>
                  </button>
                  <div className="mt-[7px] font-mono text-[10px] leading-[1.6] text-tx3">14 words above B2 on this page</div>
                </div>
                <div>
                  <div className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-tx3">Read aloud</div>
                  <button className="w-full rounded-field border border-line py-2 font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc">
                    ▶ Kokoro TTS · sentence highlighting
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
