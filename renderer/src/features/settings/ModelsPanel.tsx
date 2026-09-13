import { type ReactNode, useEffect, useRef, useState } from 'react';
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

function ProviderToggle({
  provider,
  onChange,
  disabled,
}: {
  provider: 'local' | 'openrouter' | 'gemini';
  onChange: (p: 'local' | 'openrouter' | 'gemini') => void;
  disabled: boolean;
}) {
  const labels: Record<'local' | 'openrouter' | 'gemini', string> = {
    local: 'Local (this device)',
    openrouter: 'Cloud (OpenRouter)',
    gemini: 'Cloud (Gemini)',
  };
  return (
    <div className="inline-flex overflow-hidden rounded-field border border-line2">
      {(['local', 'openrouter', 'gemini'] as const).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          disabled={disabled || provider === p}
          className="px-[13px] py-[7px] font-mono text-[10.5px] font-medium disabled:cursor-default"
          style={{
            background: provider === p ? 'var(--accSoft)' : 'transparent',
            color: provider === p ? 'var(--acc)' : 'var(--tx2)',
          }}
        >
          {labels[p]}
        </button>
      ))}
    </div>
  );
}

interface CloudProviderConfig {
  provider: 'openrouter' | 'gemini';
  title: string;
  description: ReactNode;
  keyLabel: string;
  keyPlaceholder: string;
  modelPlaceholder: string;
  modelHint: string;
  hasKey: boolean;
  keyPreview: string | null;
  model: string;
}

function CloudProviderCard({ active, config }: { active: boolean; config: CloudProviderConfig }) {
  const setLlmProvider = useEngineStore((s) => s.setLlmProvider);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModelInput(config.model);
    // Only re-sync when the provider identity or its saved model changes —
    // not on every store update, which would stomp on in-progress typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.provider, config.model]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await setLlmProvider(
        config.provider,
        config.provider === 'gemini'
          ? { geminiApiKey: apiKeyInput.trim() || undefined, geminiModel: modelInput.trim() || undefined }
          : { openrouterApiKey: apiKeyInput.trim() || undefined, openrouterModel: modelInput.trim() || undefined },
      );
      setApiKeyInput('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-panel border p-4"
      style={{ borderColor: active ? 'var(--accLine)' : 'var(--line2)', background: active ? 'var(--accSoft)' : 'var(--panel)' }}
    >
      <div className="mb-[10px] flex items-center gap-[8px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
        {config.title}
        {active && (
          <span className="rounded-full bg-accSoft px-[7px] py-[2px] font-mono text-[8.5px] font-semibold normal-case tracking-normal text-acc">
            active
          </span>
        )}
      </div>
      <div className="mb-[10px] font-sans text-[12px] leading-[1.6] text-tx2">{config.description}</div>
      <div className="flex flex-col gap-[8px]">
        <div>
          <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-tx3">{config.keyLabel}</div>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={config.hasKey ? `saved (${config.keyPreview}) — enter a new key to replace` : config.keyPlaceholder}
            className="w-full rounded-field border border-line2 bg-panel2 px-3 py-[8px] font-mono text-[11.5px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
          />
        </div>
        <div>
          <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-tx3">Model</div>
          <input
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            placeholder={config.modelPlaceholder}
            className="w-full rounded-field border border-line2 bg-panel2 px-3 py-[8px] font-mono text-[11.5px] text-tx placeholder:text-tx3 focus:border-acc focus:outline-none"
          />
          <div className="mt-1 font-mono text-[9.5px] text-tx3">{config.modelHint}</div>
        </div>
        <div className="mt-1 flex items-center gap-[10px]">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-field bg-accSolid px-[14px] py-[8px] font-sans text-[11px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'saving…' : `save & use ${config.provider === 'gemini' ? 'gemini' : 'openrouter'}`}
          </button>
          {saved && <span className="font-mono text-[10.5px] font-medium text-acc">✓ saved</span>}
          {error && <span className="font-mono text-[10.5px] text-[#c0563f]">{error}</span>}
        </div>
      </div>
    </div>
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
  const llmProvider = useEngineStore((s) => s.llmProvider);
  const fetchLlmProvider = useEngineStore((s) => s.fetchLlmProvider);
  const setLlmProvider = useEngineStore((s) => s.setLlmProvider);
  const [switchingProvider, setSwitchingProvider] = useState(false);

  useEffect(() => {
    void fetchCatalog();
    void fetchLlmProvider();
  }, [fetchCatalog, fetchLlmProvider]);

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

  const handleToggleProvider = async (p: 'local' | 'openrouter' | 'gemini') => {
    setSwitchingProvider(true);
    try {
      await setLlmProvider(p);
    } finally {
      setSwitchingProvider(false);
    }
  };

  return (
    <div className="mt-5 flex max-w-[660px] flex-col gap-5">
      {llmProvider && (
        <div>
          <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
            AI provider — which engine Conversation and Vocabulary's AI features actually use
          </div>
          <ProviderToggle provider={llmProvider.provider} onChange={(p) => void handleToggleProvider(p)} disabled={switchingProvider} />
        </div>
      )}

      {llmProvider && (
        <CloudProviderCard
          active={llmProvider.provider === 'openrouter'}
          config={{
            provider: 'openrouter',
            title: 'Cloud (OpenRouter)',
            description: (
              <>
                Uses any model available on <span className="font-medium text-tx">openrouter.ai</span> instead of a
                local download — real API calls leave the machine, unlike the local option. Nothing here is stored
                anywhere but this device's own local database.
              </>
            ),
            keyLabel: 'OpenRouter API key',
            keyPlaceholder: 'sk-or-v1-…',
            modelPlaceholder: 'openai/gpt-4o-mini',
            modelHint:
              'any OpenRouter model id — e.g. openai/gpt-4o-mini, anthropic/claude-3.5-haiku, meta-llama/llama-3.1-8b-instruct:free',
            hasKey: llmProvider.has_openrouter_key,
            keyPreview: llmProvider.openrouter_key_preview,
            model: llmProvider.openrouter_model,
          }}
        />
      )}

      {llmProvider && (
        <CloudProviderCard
          active={llmProvider.provider === 'gemini'}
          config={{
            provider: 'gemini',
            title: 'Cloud (Gemini)',
            description: (
              <>
                Uses Google's Gemini API (<span className="font-medium text-tx">ai.google.dev</span>) instead of a
                local download — a free API key with its own generous free-tier quota, separate from OpenRouter's
                shared one. Nothing here is stored anywhere but this device's own local database.
              </>
            ),
            keyLabel: 'Gemini API key',
            keyPlaceholder: 'AIza…',
            modelPlaceholder: 'gemini-2.0-flash',
            modelHint: 'any Gemini model id — e.g. gemini-2.0-flash, gemini-1.5-flash, gemini-1.5-pro',
            hasKey: llmProvider.has_gemini_key,
            keyPreview: llmProvider.gemini_key_preview,
            model: llmProvider.gemini_model,
          }}
        />
      )}

      <div>
        <div className="mb-2 flex items-center gap-[8px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
          Conversation model — pick one, download it, then it's used automatically
          {llmProvider?.provider === 'local' && (
            <span className="rounded-full bg-accSoft px-[7px] py-[2px] font-mono text-[8.5px] font-semibold normal-case tracking-normal text-acc">
              active
            </span>
          )}
        </div>
        <div
          className="flex flex-col gap-[1px] overflow-hidden rounded-panel border bg-panel"
          style={{ borderColor: llmProvider?.provider === 'local' ? 'var(--accLine)' : 'var(--line2)' }}
        >
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
