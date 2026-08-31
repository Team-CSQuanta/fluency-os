import { ADD_BOOK_FIELDS, BOOK_FORMATS, BOOK_QUEUE } from '@/features/bookshelf/bookshelfMockData';

export function AddBookModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-6" onClick={onClose}>
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-panel border border-line bg-panel shadow-[0_24px_60px_rgba(0,0,0,.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line2 px-5 py-4">
          <div>
            <div className="font-sans text-[14px] font-semibold text-tx">Add books</div>
            <div className="mt-[3px] font-mono text-[10.5px] text-tx3">from this computer · nothing is uploaded</div>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-field border border-line2 font-mono text-[11px] text-tx2 hover:border-acc"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-[14px] p-5">
          <div className="rounded-panel border border-dashed border-line px-[26px] py-[26px] text-center">
            <div className="font-sans text-[12.5px] font-medium text-tx">Drop book files or a folder here</div>
            <div className="mt-[10px] flex flex-wrap justify-center gap-[5px]">
              {BOOK_FORMATS.map((f) => (
                <span key={f} className="rounded-[4px] border border-line2 px-2 py-[3px] font-mono text-[9.5px] font-medium text-tx2">
                  {f}
                </span>
              ))}
            </div>
            <button className="mt-[14px] rounded-field border border-line px-[14px] py-2 font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc">
              browse…
            </button>
          </div>

          <div className="overflow-hidden rounded-panel border border-line2">
            <div className="border-b border-line2 px-[14px] py-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-tx3">
              {BOOK_QUEUE.length} files queued
            </div>
            {BOOK_QUEUE.map((q, i) => (
              <div
                key={q.n}
                className="flex items-center justify-between gap-4 px-[14px] py-[11px]"
                style={{ borderBottom: i < BOOK_QUEUE.length - 1 ? '1px solid var(--line2)' : 'none' }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-sans text-[12px] font-medium text-tx">{q.n}</span>
                  <span className="mt-[2px] block font-mono text-[9.5px] text-tx3">{q.sub}</span>
                </span>
                <span className="flex-none font-mono text-[10px] font-medium" style={{ color: q.ready ? 'var(--acc)' : 'var(--tx3)' }}>
                  {q.v}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col overflow-hidden rounded-panel border border-line2">
            {ADD_BOOK_FIELDS.map((f, i) => (
              <div
                key={f.n}
                className="flex items-center justify-between gap-4 px-[14px] py-3"
                style={{ borderBottom: i < ADD_BOOK_FIELDS.length - 1 ? '1px solid var(--line2)' : 'none' }}
              >
                <span className="min-w-0">
                  <span className="block font-sans text-[12px] font-medium text-tx">{f.n}</span>
                  <span className="mt-[2px] block font-mono text-[10px] text-tx3">{f.sub}</span>
                </span>
                <span className="flex-none rounded-field border border-line2 px-[10px] py-[5px] font-mono text-[11px] text-tx2">
                  {f.v}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-between gap-2 border-t border-line2 px-5 py-[14px]">
          <button
            onClick={onClose}
            className="rounded-field border border-line px-[14px] py-[9px] font-sans text-[11.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="rounded-field bg-acc px-[18px] py-[9px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
          >
            Import {BOOK_QUEUE.length} books
          </button>
        </div>
      </div>
    </div>
  );
}
