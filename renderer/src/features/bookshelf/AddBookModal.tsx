import { useState } from 'react';
import { BOOK_FORMATS } from '@/features/bookshelf/bookshelfConstants';
import { useBookshelfStore } from '@/store/bookshelfStore';

export function AddBookModal({ onClose }: { onClose: () => void }) {
  const importQueue = useBookshelfStore((s) => s.importQueue);
  const importBooks = useBookshelfStore((s) => s.importBooks);
  const clearImportQueue = useBookshelfStore((s) => s.clearImportQueue);
  const [dragOver, setDragOver] = useState(false);
  const [countTowardGoal, setCountTowardGoal] = useState(true);
  const [heatOverlay, setHeatOverlay] = useState(true);

  const startImport = (paths: string[]) => {
    const real = paths.filter(Boolean);
    if (real.length === 0) return;
    void importBooks(real, { countTowardGoal, heatOverlay });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files).map((f) => window.fluencyos.getPathForFile(f));
    startImport(paths);
  };

  const handleBrowse = async () => {
    const paths = await window.fluencyos.pickBookFiles();
    startImport(paths);
  };

  const handleClose = () => {
    clearImportQueue();
    onClose();
  };

  const statusLabel: Record<string, string> = {
    queued: 'queued…',
    parsing: 'parsing…',
    ready: 'ready',
    failed: 'failed',
  };
  const statusColor = (status: string) =>
    status === 'ready' ? 'var(--acc)' : status === 'failed' ? '#c0563f' : 'var(--tx3)';

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-6" onClick={handleClose}>
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
            onClick={handleClose}
            className="grid h-7 w-7 place-items-center rounded-field border border-line2 font-mono text-[11px] text-tx2 hover:border-acc"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-[14px] p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className="rounded-panel border border-dashed px-[26px] py-[26px] text-center"
            style={{ borderColor: dragOver ? 'var(--acc)' : 'var(--line)' }}
          >
            <div className="font-sans text-[12.5px] font-medium text-tx">Drop book files or a folder here</div>
            <div className="mt-[10px] flex flex-wrap justify-center gap-[5px]">
              {BOOK_FORMATS.map((f) => (
                <span key={f} className="rounded-[4px] border border-line2 px-2 py-[3px] font-mono text-[9.5px] font-medium text-tx2">
                  {f}
                </span>
              ))}
            </div>
            <button
              onClick={handleBrowse}
              className="mt-[14px] rounded-field border border-line px-[14px] py-2 font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
            >
              browse…
            </button>
          </div>

          {importQueue.length > 0 && (
            <div className="overflow-hidden rounded-panel border border-line2">
              <div className="border-b border-line2 px-[14px] py-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-tx3">
                {importQueue.length} file{importQueue.length === 1 ? '' : 's'} queued
              </div>
              {importQueue.map((q, i) => (
                <div
                  key={q.path + i}
                  className="flex items-center justify-between gap-4 px-[14px] py-[11px]"
                  style={{ borderBottom: i < importQueue.length - 1 ? '1px solid var(--line2)' : 'none' }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-sans text-[12px] font-medium text-tx">{q.name}</span>
                    <span className="mt-[2px] block truncate font-mono text-[9.5px] text-tx3">
                      {q.error ?? q.path}
                    </span>
                  </span>
                  <span
                    className="flex-none font-mono text-[10px] font-medium"
                    style={{ color: statusColor(q.status) }}
                  >
                    {statusLabel[q.status] ?? q.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col overflow-hidden rounded-panel border border-line2">
            <div className="flex items-center justify-between gap-4 border-b border-line2 px-[14px] py-3">
              <span className="min-w-0">
                <span className="block font-sans text-[12px] font-medium text-tx">Difficulty heat overlay</span>
                <span className="mt-[2px] block font-mono text-[10px] text-tx3">tint words above your level</span>
              </span>
              <button
                onClick={() => setHeatOverlay((v) => !v)}
                className="flex-none rounded-field border border-line2 px-[10px] py-[5px] font-mono text-[11px] text-tx2"
              >
                {heatOverlay ? 'on' : 'off'}
              </button>
            </div>
            <div className="flex items-center justify-between gap-4 px-[14px] py-3">
              <span className="min-w-0">
                <span className="block font-sans text-[12px] font-medium text-tx">Count toward reading goal</span>
                <span className="mt-[2px] block font-mono text-[10px] text-tx3">included in your daily pages</span>
              </span>
              <button
                onClick={() => setCountTowardGoal((v) => !v)}
                className="flex-none rounded-field border border-line2 px-[10px] py-[5px] font-mono text-[11px] text-tx2"
              >
                {countTowardGoal ? 'yes' : 'no'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-between gap-2 border-t border-line2 px-5 py-[14px]">
          <button
            onClick={handleClose}
            className="rounded-field border border-line px-[14px] py-[9px] font-sans text-[11.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
          >
            Cancel
          </button>
          <button
            onClick={handleClose}
            className="rounded-field bg-accSolid px-[18px] py-[9px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110"
          >
            {importQueue.length > 0 ? 'Done' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
