import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useEngineStore } from '@/store/engineStore';
import type { DownloadStatusOut } from '@/types/api';
import { friendlyMessage } from '@/lib/friendlyError';

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${bytes} B`;
}

/** The providers the page offers. Gemini was a third; it is gone from the
 * interface, and the backend still understands the value only so that a
 * settings row left on it from an earlier version can be moved off rather
 * than leaving someone on a provider with no controls. */
type Provider = 'local' | 'openrouter';
const PROVIDERS = ['local', 'openrouter'] as const;

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

/** Where the text model runs. The tab is the setting, not a preview of it:
 * choosing one switches the provider, and only that provider's options are
 * shown underneath. They used to be listed all at once, so the page offered
 * three configurations when exactly one of them was in use. */
function ProviderToggle({
  provider,
  onChange,
  disabled,
}: {
  /** The stored provider, which may be one this page no longer offers — then
   * no tab is active and both stay clickable, which is the way out. */
  provider: string;
  onChange: (p: Provider) => void;
  disabled: boolean;
}) {
  const labels: Record<Provider, string> = {
    local: 'Local (this device)',
    openrouter: 'Cloud (OpenRouter)',
  };
  return (
    <div className="inline-flex overflow-hidden rounded-field border border-line2">
      {PROVIDERS.map((p) => (
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

function CloudProviderCard({ config }: { config: CloudProviderConfig }) {
  const setLlmProvider = useEngineStore((s) => s.setLlmProvider);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModelInput(config.model);
    // Only re-sync when the saved model changes — not on every store update,
    // which would stomp on in-progress typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.model]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await setLlmProvider('openrouter', {
        openrouterApiKey: apiKeyInput.trim() || undefined,
        openrouterModel: modelInput.trim() || undefined,
      });
      setApiKeyInput('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(friendlyMessage(err, 'Saving this'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-panel border border-accLine bg-panel p-4">
      <div className="mb-[10px] font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
        {config.title}
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
            {saving ? 'saving…' : 'save & use openrouter'}
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
  const downloadPocketTts = useEngineStore((s) => s.downloadPocketTts);
  const deletePocketTts = useEngineStore((s) => s.deletePocketTts);
  const selectTtsEngine = useEngineStore((s) => s.selectTtsEngine);
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
    catalog.tts_options.find((o) => o.download.status === 'error')?.download.error;

  // A settings row left on a provider this page no longer offers. Nothing in
  // the tab strip selects it, so without this the strip would show no active
  // tab and the AI would appear to be configured as nothing at all.
  const stranded = Boolean(llmProvider) && !(PROVIDERS as readonly string[]).includes(llmProvider!.provider);
  const showLocal = !llmProvider || llmProvider.provider === 'local' || stranded;

  const handleToggleProvider = async (p: Provider) => {
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
          <ProviderToggle
            provider={llmProvider.provider}
            onChange={(p) => void handleToggleProvider(p)}
            disabled={switchingProvider}
          />
          {/* Only reachable on a settings row left on a provider this page no
              longer offers. Better than a tab strip with nothing selected and
              no way to understand why the AI stopped working. */}
          {stranded && (
            <div className="mt-2 rounded-field border border-dashed border-line px-3 py-2 font-mono text-[10px] leading-[1.6] text-tx3">
              This account is set to a provider that is no longer offered here. Pick one above to move it.
            </div>
          )}
        </div>
      )}

      {llmProvider && llmProvider.provider === 'openrouter' && (
        <CloudProviderCard
          config={{
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

      {/* The downloadable models belong to the Local tab. Listed under a cloud
          provider they looked like a choice that changed nothing — while the
          radio buttons in fact DID change something, switching the provider
          back to local without the tab above saying so. */}
      {showLocal && (
      <div>
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
          Conversation model — pick one, download it, then it's used automatically
        </div>
        <div className="flex flex-col gap-[1px] overflow-hidden rounded-panel border border-accLine bg-panel">
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

      )}

      <div>
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-tx3">
          Speech-to-text and text-to-speech — needed for voice conversations · pick one voice
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
          {catalog.tts_options.map((o) => (
            <div key={o.key} className="flex items-center justify-between gap-4 border-b border-line2 px-4 py-[13px] last:border-b-0">
              <div className="flex min-w-0 items-center gap-[10px]">
                <input
                  type="radio"
                  name="tts-engine"
                  checked={o.selected}
                  onChange={() => void selectTtsEngine(o.key)}
                  disabled={!o.downloaded || !o.installed}
                  className="h-[13px] w-[13px] accent-[var(--acc)] disabled:opacity-40"
                  title={
                    !o.installed
                      ? 'this voice needs the optional "pocket" extra installed'
                      : o.downloaded
                        ? 'use this voice'
                        : 'download it first to select it'
                  }
                />
                <div className="min-w-0">
                  <div className="font-sans text-[12.5px] font-medium text-tx">
                    {o.label} <span className="font-mono text-[10px] text-tx3">· ~{o.approx_size_mb} MB</span>
                  </div>
                  <div className="mt-[3px] font-mono text-[10.5px] leading-[1.6] text-tx3">
                    {o.installed ? o.note : 'not installed — needs the optional "pocket" extra (PyTorch)'}
                  </div>
                </div>
              </div>
              <DownloadButton
                downloaded={o.downloaded}
                download={o.download}
                onDownload={() => void (o.key === 'pocket' ? downloadPocketTts() : downloadTts())}
                onDelete={o.key === 'pocket' ? deletePocketTts : deleteTts}
              />
            </div>
          ))}
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
