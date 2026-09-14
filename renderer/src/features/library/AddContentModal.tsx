import { useState } from 'react';
import { useMediaStore } from '@/store/mediaStore';

/** Adding content to the watching library.
 *
 * Local files only, deliberately. The spec (§4.1.1) also asks for pasted
 * YouTube links, and the mock modal used to show a convincing two-step flow
 * for them — but there is no resolver behind it, so every field in that flow
 * was invented. A dialog that cannot do what it offers is worse than one that
 * says what it can do, so the link path states plainly what it would need.
 */
export function AddContentModal({ onClose }: { onClose: () => void }) {
  const { importMedia, importQueue, clearImportQueue, ffmpegAvailable } = useMediaStore();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (paths: string[]) => {
    if (paths.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await importMedia(paths);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const browse = async () => {
    const paths = await window.fluencyos.pickMediaFiles();
    await run(paths);
  };

  const onDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    // Electron exposes the real path through webUtils; File.path was removed
    // in Electron 32, which is why this goes through the preload bridge.
    const paths = Array.from(event.dataTransfer.files).map((file) => window.fluencyos.getPathForFile(file));
    await run(paths.filter(Boolean));
  };

  const done = importQueue.length > 0 && importQueue.every((q) => q.status === 'ready' || q.status === 'failed');

  const close = () => {
    clearImportQueue();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-6" onClick={close}>
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-panel border border-line bg-panel shadow-[0_24px_60px_rgba(0,0,0,.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line2 px-5 py-4">
          <div>
            <div className="font-sans text-[14px] font-semibold text-tx">Add content</div>
            <div className="mt-[3px] font-mono text-[10.5px] text-tx3">
              read in place · nothing is copied or uploaded
            </div>
          </div>
          <button
            onClick={close}
            className="grid h-7 w-7 place-items-center rounded-field border border-line2 font-mono text-[11px] text-tx2 hover:border-acc"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-[14px] p-5">
          {!ffmpegAvailable && (
            <div
              className="rounded-panel px-[13px] py-[10px] font-sans text-[11.5px] leading-[1.6]"
              style={{ background: 'rgba(220,140,60,.10)', color: 'var(--tx2)' }}
            >
              ffmpeg isn’t installed, so video files can’t be read yet. Install it and restart FluencyOS.
            </div>
          )}

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className="rounded-panel border border-dashed px-[26px] py-[26px] text-center"
            style={{ borderColor: dragging ? 'var(--acc)' : 'var(--line)' }}
          >
            <div className="font-sans text-[12.5px] font-medium text-tx">Drop video files here</div>
            <div className="mt-[6px] font-mono text-[10.5px] text-tx3">mp4 · mkv · avi · webm · mov</div>
            <button
              onClick={() => void browse()}
              disabled={busy || !ffmpegAvailable}
              className="mt-[14px] rounded-field border border-line px-[14px] py-2 font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc disabled:opacity-50"
            >
              {busy ? 'importing…' : 'browse…'}
            </button>
          </div>

          {error && <div className="font-sans text-[11.5px] text-[#e06c6c]">{error}</div>}

          {importQueue.length > 0 && (
            <div className="flex flex-col overflow-hidden rounded-panel border border-line2">
              {importQueue.map((q, i) => (
                <div
                  key={q.path + i}
                  className="flex items-center justify-between gap-4 px-[14px] py-3"
                  style={{ borderBottom: i < importQueue.length - 1 ? '1px solid var(--line2)' : 'none' }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-sans text-[12px] font-medium text-tx">{q.name}</span>
                    <span className="mt-[2px] block truncate font-mono text-[10px] text-tx3">
                      {q.error ?? q.path}
                    </span>
                  </span>
                  <span
                    className="flex-none rounded-field border px-[10px] py-[5px] font-mono text-[10.5px]"
                    style={{
                      borderColor: q.status === 'failed' ? 'rgba(224,108,108,.45)' : 'var(--line2)',
                      color: q.status === 'failed' ? '#e06c6c' : q.status === 'ready' ? 'var(--acc)' : 'var(--tx3)',
                    }}
                  >
                    {q.status === 'ready'
                      ? 'ready'
                      : q.status === 'failed'
                        ? 'failed'
                        : q.status === 'probing'
                          ? 'reading tracks…'
                          : 'queued'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-panel border border-line2 bg-panel2 p-4">
            <div className="font-sans text-[12.5px] font-semibold text-tx">Pasting a link</div>
            <div className="mt-[6px] font-sans text-[11.5px] leading-[1.6] text-tx2">
              Streaming from YouTube and similar isn’t wired up yet. It needs a URL resolver that FluencyOS doesn’t
              ship, so the option is left out rather than shown as a step that quietly does nothing.
            </div>
            <div className="mt-[8px] font-mono text-[10px] leading-[1.6] text-tx3">
              a file you already have on disk works today, with subtitles, lookups and clips
            </div>
          </div>
        </div>

        <div className="flex justify-between gap-2 border-t border-line2 px-5 py-[14px]">
          <button
            onClick={close}
            className="rounded-field border border-line px-[14px] py-[9px] font-sans text-[11.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
          >
            {done ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={() => void browse()}
            disabled={busy || !ffmpegAvailable}
            className="rounded-field bg-accSolid px-[18px] py-[9px] font-sans text-[11.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            Choose files…
          </button>
        </div>
      </div>
    </div>
  );
}
