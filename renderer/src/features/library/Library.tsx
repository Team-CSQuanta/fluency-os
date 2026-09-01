import { useState, type ReactNode } from 'react';
import { AddContentModal } from '@/features/library/AddContentModal';
import { HISTORY, LIB_FILTERS, LIB_ITEMS, matchesFilter } from '@/features/library/libraryMockData';
import { useShellStore } from '@/store/shellStore';

const KIND_STYLE: Record<'local' | 'link', { label: string; bg: string; fg: string; bd: string }> = {
  local: { label: 'local file', bg: 'rgba(var(--accRGB),.2)', fg: 'var(--acc)', bd: 'var(--accLine)' },
  link: { label: 'link', bg: 'rgba(0,0,0,.5)', fg: 'rgba(255,255,255,.75)', bd: 'rgba(255,255,255,.2)' },
};

function Thumb({ children, height }: { children: ReactNode; height: number }) {
  return (
    <div
      className="relative grid place-items-center font-mono text-[8px] text-tx3"
      style={{ height, background: 'repeating-linear-gradient(135deg,var(--tile) 0 6px,var(--tileB) 6px 12px)' }}
    >
      {children}
    </div>
  );
}

export function Library() {
  const [filter, setFilter] = useState('All');
  const [addOpen, setAddOpen] = useState(false);
  const goPlayer = useShellStore((s) => s.goPlayer);

  const items = LIB_ITEMS.filter((item) => matchesFilter(item, filter));

  return (
    <div className="flex flex-col gap-[22px] p-[var(--pad)]">
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            Continue watching
          </div>
          <span className="font-mono text-[10.5px] text-tx3">last 7 days</span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {HISTORY.map((h) => (
            <button
              key={h.title}
              onClick={() => goPlayer(h.title)}
              className="overflow-hidden rounded-panel border border-line2 bg-panel text-left shadow-panel hover:border-acc"
            >
              <Thumb height={104}>
                thumbnail
                <span className="absolute bottom-[7px] right-2 rounded-[3px] bg-black/60 px-[5px] py-[2px] font-mono text-[9px] font-medium text-white">
                  {h.left}
                </span>
                <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/25">
                  <span className="block h-[3px] bg-acc" style={{ width: `${h.pct}%` }} />
                </span>
              </Thumb>
              <div className="px-[11px] pb-3 pt-[10px]">
                <div className="truncate font-sans text-[12.5px] font-semibold text-tx">{h.title}</div>
                <div className="mt-1 font-mono text-[9.5px] text-tx3">{h.meta}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-[14px] flex flex-wrap items-center gap-2">
          <div className="mr-[6px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            My library
          </div>
          {LIB_FILTERS.map((f) => {
            const on = filter === f.n;
            return (
              <button
                key={f.n}
                onClick={() => setFilter(f.n)}
                className="rounded-full border px-[11px] py-[6px] font-sans text-[11px] font-medium"
                style={{
                  borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                  background: on ? 'var(--accSoft)' : 'transparent',
                  color: on ? 'var(--acc)' : 'var(--tx2)',
                }}
              >
                {f.n} <span className="font-mono text-[9.5px] opacity-60">{f.c}</span>
              </button>
            );
          })}
          <div className="flex-1" />
          <div className="flex items-center gap-[7px] rounded-field border border-line2 px-[11px] py-[6px] font-sans text-[11px] text-tx3">
            ⌕ search titles
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="rounded-field bg-accSolid px-[14px] py-2 font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
          >
            + Add content
          </button>
        </div>

        <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(212px,1fr))' }}>
          {items.map((c) => {
            const ks = KIND_STYLE[c.kind];
            return (
              <button
                key={c.title}
                onClick={() => goPlayer(c.title)}
                className="overflow-hidden rounded-panel border border-line2 bg-panel text-left shadow-panel hover:-translate-y-[1px] hover:border-acc"
              >
                <Thumb height={120}>
                  {c.thumbLabel}
                  <span
                    className="absolute left-2 top-[7px] rounded-[3px] border px-[6px] py-[2px] font-mono text-[8.5px] font-medium uppercase tracking-[0.05em]"
                    style={{ color: ks.fg, background: ks.bg, borderColor: ks.bd }}
                  >
                    {ks.label}
                  </span>
                  <span className="absolute bottom-[7px] right-2 rounded-[3px] bg-black/60 px-[5px] py-[2px] font-mono text-[9px] font-medium text-white">
                    {c.dur}
                  </span>
                  {c.pct > 0 && (
                    <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/25">
                      <span className="block h-[3px] bg-acc" style={{ width: `${c.pct}%` }} />
                    </span>
                  )}
                </Thumb>
                <div className="px-3 pb-[13px] pt-[11px]">
                  <div className="truncate font-sans text-[12.5px] font-semibold leading-[1.35] text-tx">{c.title}</div>
                  <div className="mt-[5px] truncate font-mono text-[9.5px] text-tx3">{c.path}</div>
                  <div className="mt-[9px] flex flex-wrap items-center gap-[7px]">
                    <span className="rounded-[3px] bg-line2 px-[6px] py-[2px] font-mono text-[9px] font-medium text-tx2">
                      {c.subs}
                    </span>
                    <span className="font-mono text-[9.5px] text-tx3">{c.saves} saves</span>
                  </div>
                </div>
              </button>
            );
          })}
          <button
            onClick={() => setAddOpen(true)}
            className="flex min-h-[198px] flex-col items-center justify-center gap-[9px] rounded-panel border border-dashed border-line text-tx3 hover:border-acc hover:text-acc"
          >
            <span className="font-sans text-[26px] font-light leading-none">+</span>
            <span className="font-sans text-[11.5px] font-medium">Add content</span>
            <span className="max-w-[150px] text-center font-mono text-[9.5px] leading-[1.6]">
              local video file or a link to paste
            </span>
          </button>
        </div>
      </div>

      <div className="border-t border-line2 pt-[14px] font-mono text-[10px] leading-[1.7] text-tx3">
        nothing here is uploaded — local files are read in place, links are resolved by the embedded player and
        stored as a URL plus timecodes
      </div>

      {addOpen && <AddContentModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}
