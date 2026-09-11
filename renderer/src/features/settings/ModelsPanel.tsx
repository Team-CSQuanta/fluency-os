import { useEffect, useRef, useState } from 'react';
import { useEngineStore } from '@/store/engineStore';
import type { DownloadStatusOut } from '@/types/api';

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${bytes} B`;
}

// A second click within this window commits the delete — no native
// confirm() dialog, but an accidental single click can't nuke a multi-GB
// download that'd have to be re-fetched from scratch.
const DELETE_CONFIRM_WINDOW_MS = 3000;

function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const handleClick = () => {
    if (deleting) return;
    if (!confirming) {
      setConfirming(true);
      timeoutRef.current = setTimeout(() => setConfirming(false), DELETE_CONFIRM_WINDOW_MS);
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setConfirming(false);
    setDeleting(true);
    void onDelete().finally(() => setDeleting(false));
  };

  return (
    <button
      onClick={handleClick}
      disabled={deleting}
      title={confirming ? 'click again to confirm — frees the disk space, re-download to use it again' : 'delete this model from disk'}
      className="rounded-field border px-[9px] py-[6px] font-mono text-[10px] font-medium disabled:opacity-50"
      style={{
        borderColor: confirming ? '#c0563f' : 'var(--line2)',
        color: confirming ? '#c0563f' : 'var(--tx3)',
      }}
    >
      {deleting ? 'deleting…' : confirming ? 'confirm?' : 'delete'}
    </button>
  );
}

function DownloadButton({
  downloaded,
  download,
  onDownload,
  onDelete,
}: {
  downloaded: boolean;
  download: DownloadStatusOut;
  onDownload: () => void;
  onDelete: () => Promise<void>;
}) {
  if (downloaded) {
    return (
      <div className="flex items-center gap-[8px]">
        <span className="font-mono text-[10.5px] font-medium text-acc">✓ downloaded</span>
        <DeleteButton onDelete={onDelete} />
      </div>
    );
  }
  if (download.status === 'downloading') {
    const pct = download.total_bytes > 0 ? Math.round((100 * download.downloaded_bytes) / download.total_bytes) : 0;
    return (
      <div className="flex min-w-[140px] items-center gap-[8px]">
        <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-line2">
          <div className="h-full rounded-full bg-acc" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-mono text-[9.5px] text-tx3">
          {download.total_bytes > 0 ? `${pct}%` : formatMb(download.downloaded_bytes)}
        </span>
      </div>
    );
  }
  return (
    <button
      onClick={onDownload}
      className="rounded-field border border-accLine bg-accSoft px-[11px] py-[6px] font-mono text-[10.5px] font-medium text-acc hover:brightness-105"
    >
      download
    </button>
  );
}

export function ModelsPanel() {
  const catalog = useEngineStore((s) => s.catalog);
  const catalogStatus = useEngineStore((s) => s.catalogStatus);
  const fetchCatalog = useEngineStore((s) => s.fetchCatalog);
  const downloadLlm = useEngineStore((s) => s.downloadLlm);
  const downloadStt = useEngineStore((s) => s.downloadStt);
  const downloadTts = useEngineStore((s) => s.downloadTts);
  const deleteLlm = useEngineStore((s) => s.deleteLlm);
  const deleteStt = useEngineStore((s) => s.deleteStt);
  const deleteTts = useEngineStore((s) => s.deleteTts);
  const selectModel = useEngineStore((s) => s.selectModel);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  if (catalogStatus === 'loading' && !catalog) {
    return <div className="mt-5 font-mono text-[11px] text-tx3">loading…</div>;
  }
  if (!catalog) {
    return <div className="mt-5 font-mono text-[11px] text-tx3">couldn't load model status</div>;
  }

  const downloadError =
    catalog.llm.find((o) => o.download.status === 'error')?.download.error ||
    catalog.stt.download.error ||
    catalog.tts.download.error;

  return (
    <div className="mt-5 flex max-w-[660px] flex-col gap-5">
      <div>
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
          Conversation model — pick one, download it, then it's used automatically
        </div>
        <div className="flex flex-col gap-[1px] overflow-hidden rounded-panel border border-line2 bg-panel">
          {catalog.llm.map((o) => (
            <div key={o.key} className="flex items-center justify-between gap-4 border-b border-line2 px-4 py-[13px] last:border-b-0">
              <div className="flex min-w-0 items-center gap-[10px]">
                <input
                  type="radio"
                  name="llm-model"
                  checked={o.selected}
                  onChange={() => void selectModel(o.key)}
                  disabled={!o.downloaded}
                  className="h-[13px] w-[13px] accent-[var(--acc)] disabled:opacity-40"
                  title={o.downloaded ? 'use this model' : 'download it first to select it'}
                />
                <div className="min-w-0">
                  <div className="font-sans text-[12.5px] font-medium text-tx">
                    {o.label} <span className="font-mono text-[10px] text-tx3">· ~{o.approx_size_mb} MB</span>
                  </div>
                  <div className="mt-[3px] font-mono text-[10.5px] leading-[1.6] text-tx3">{o.note}</div>
                </div>
              </div>
              <DownloadButton
                downloaded={o.downloaded}
                download={o.download}
                onDownload={() => void downloadLlm(o.key)}
                onDelete={() => deleteLlm(o.key)}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
          Speech-to-text and text-to-speech — needed for voice conversations
        </div>
        <div className="flex flex-col gap-[1px] overflow-hidden rounded-panel border border-line2 bg-panel">
          <div className="flex items-center justify-between gap-4 border-b border-line2 px-4 py-[13px]">
            <div className="font-sans text-[12.5px] font-medium text-tx">{catalog.stt.label}</div>
            <DownloadButton
              downloaded={catalog.stt.downloaded}
              download={catalog.stt.download}
              onDownload={() => void downloadStt()}
              onDelete={deleteStt}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-[13px]">
            <div className="font-sans text-[12.5px] font-medium text-tx">{catalog.tts.label}</div>
            <DownloadButton
              downloaded={catalog.tts.downloaded}
              download={catalog.tts.download}
              onDownload={() => void downloadTts()}
              onDelete={deleteTts}
            />
          </div>
        </div>
      </div>

      {downloadError && (
        <div className="rounded-field border border-dashed border-[#c0563f] px-3 py-2 font-mono text-[10.5px] text-[#c0563f]">
          {downloadError}
        </div>
      )}

      <div className="rounded-field border border-line2 bg-panel px-3 py-[10px]">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">Stored at</div>
        <div className="mt-1 break-all font-mono text-[10.5px] text-tx2">{catalog.models_dir}</div>
        <div className="mt-1 font-mono text-[9.5px] text-tx3">{formatBytes(catalog.disk_usage_bytes)} on disk</div>
      </div>

      <div className="font-mono text-[9.5px] leading-[1.7] text-tx3">
        models download once and are cached locally · a slow or interrupted download can just be retried
      </div>
    </div>
  );
}
