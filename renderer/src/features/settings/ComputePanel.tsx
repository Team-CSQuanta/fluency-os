import { useCallback, useEffect, useState } from 'react';
import { Pill, Row, Section, Segmented } from '@/features/settings/controls';
import { api } from '@/lib/apiClient';
import { friendlyMessage } from '@/lib/friendlyError';
import { useAppStore } from '@/store/appStore';
import { useEngineStore } from '@/store/engineStore';
import type { ComputeMode, ComputeOut, EngineRuntimeOut } from '@/types/api';

const MODES: Array<{ value: ComputeMode; label: string; title: string }> = [
  { value: 'auto', label: 'Auto', title: 'Use the GPU when this computer has one a model can use, otherwise the CPU' },
  { value: 'gpu', label: 'GPU', title: 'Ask for the GPU; a model that cannot use it falls back to the CPU and says why' },
  { value: 'cpu', label: 'CPU', title: 'Keep every local model on the CPU' },
];

function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

/** Where one engine is running, in a line. */
function Where({ info }: { info: EngineRuntimeOut }) {
  if (!info.device) return <Pill>not loaded</Pill>;
  if (info.device === 'gpu') {
    return (
      <Pill tone="ok">
        GPU · {info.backend}
        {info.detail ? ` · ${info.detail}` : ''}
      </Pill>
    );
  }
  return <Pill tone={info.note ? 'warn' : 'muted'}>CPU</Pill>;
}

/** Settings → AI: whether local models run on the graphics chip or the CPU.
 *
 * Integrated graphics count — the Radeon or Intel chip built into most
 * processors. Cloud AI is untouched by this: it never runs here. */
export function ComputePanel() {
  const userId = useAppStore((s) => s.currentUserId);
  const fetchStatus = useEngineStore((s) => s.fetchStatus);
  const [state, setState] = useState<ComputeOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setState(await api.get<ComputeOut>(`/engine/compute?user_id=${encodeURIComponent(userId)}`));
    } catch (err) {
      setError(friendlyMessage(err, 'Checking where local AI runs'));
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Follows a download, and a model being loaded elsewhere (Launch AI).
  const downloading = state?.gpu_runtime.download.status === 'downloading';
  useEffect(() => {
    const id = window.setInterval(() => void load(), downloading ? 1000 : 5000);
    return () => window.clearInterval(id);
  }, [load, downloading]);

  const setMode = async (mode: ComputeMode) => {
    if (!userId || !state || mode === state.mode) return;
    setSaving(true);
    setError(null);
    try {
      setState(await api.put<ComputeOut>(`/engine/compute?user_id=${encodeURIComponent(userId)}`, { mode }));
      setChanged(true);
      // Models were unloaded; the header's AI badge should say so.
      void fetchStatus();
    } catch (err) {
      setError(friendlyMessage(err, 'Changing where local AI runs'));
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    try {
      await api.post('/engine/compute/gpu-runtime/download');
      void load();
    } catch (err) {
      setError(friendlyMessage(err, 'Downloading the GPU runtime'));
    }
  };

  if (!state) {
    return error ? <div className="font-mono text-[10.5px] text-[#c0563f]">{error}</div> : null;
  }

  const rt = state.gpu_runtime;
  const dl = rt.download;

  return (
    <Section
      title="Where local AI runs"
      note="Local models can run on your graphics chip — including the one built into most processors — or on the CPU. The GPU mostly speeds up how fast the model reads, and leaves the CPU free for speech. Cloud AI isn't affected."
    >
      <Row
        label="Run local models on"
        sub={
          state.mode === 'auto'
            ? 'Auto: the GPU when a model can use it, otherwise the CPU.'
            : state.mode === 'gpu'
              ? 'GPU: a model that cannot use it falls back to the CPU and says why below.'
              : 'CPU: every local model stays on the processor.'
        }
        control={<Segmented value={state.mode} options={MODES} onChange={(m) => void setMode(m)} disabled={saving} />}
      />
      {changed && (
        <div className="border-b border-line2 bg-accSoft px-4 py-[9px] font-sans text-[11px] leading-[1.55] text-acc">
          Loaded models were set aside — Launch AI (the AI button in the top bar) starts them in the new place.
        </div>
      )}

      {(
        [
          ['Chat model', state.chat_model, 'the local model that writes replies'],
          ['Speech to text', state.speech_to_text, 'turns your voice into text'],
          ['Voice', state.voice, 'reads replies aloud'],
        ] as const
      ).map(([label, info, what]) => (
        <Row key={label} label={label} sub={info.note ?? what} control={<Where info={info} />} />
      ))}

      <Row
        label={`GPU runtime · llama.cpp (${rt.backend})`}
        sub={
          !rt.available
            ? 'llama.cpp publishes no GPU build for this kind of computer, so the chat model runs on the CPU.'
            : rt.installed
              ? rt.devices.length > 0
                ? `Sees: ${rt.devices.join(', ')}`
                : `Installed, but found no GPU that ${rt.backend} can use — the chat model runs on the CPU.`
              : dl.status === 'error'
                ? `The download failed: ${dl.error ?? 'unknown error'}`
                : 'Lets the chat model use the GPU. Downloaded once (about 12–33 MB), on the first Launch AI that wants the GPU — or now.'
        }
        control={
          !rt.available ? (
            <Pill>not available</Pill>
          ) : rt.installed ? (
            <Pill tone="ok">installed</Pill>
          ) : dl.status === 'downloading' ? (
            <Pill>
              {dl.total_bytes > 0
                ? `${formatMb(dl.downloaded_bytes)} / ${formatMb(dl.total_bytes)}`
                : 'downloading…'}
            </Pill>
          ) : (
            <button
              onClick={() => void download()}
              className="rounded-field border border-line px-[10px] py-[5px] font-mono text-[10.5px] text-tx2 hover:border-acc hover:text-acc"
            >
              download
            </button>
          )
        }
      />
      {error && <div className="px-4 py-[9px] font-mono text-[10.5px] text-[#c0563f]">{error}</div>}
    </Section>
  );
}
