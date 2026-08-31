import { useState } from 'react';
import { ADD_LINK_FIELDS, ADD_LOCAL_FIELDS } from '@/features/library/libraryMockData';

type Step = 'source' | 'local' | 'link';

const SOURCES: Array<{ key: Step; n: string; desc: string; meta: string }> = [
  {
    key: 'local',
    n: 'Local video file',
    desc: 'Read in place from your disk. Nothing is copied or uploaded.',
    meta: 'mp4 · mkv · avi · webm · mov',
  },
  {
    key: 'link',
    n: 'Paste a link',
    desc: 'YouTube and similar. Streamed by the embedded player; only the URL and timecodes are stored.',
    meta: 'youtube.com · vimeo.com · direct URL',
  },
];

export function AddContentModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step | 'source'>('source');

  const stepLabel =
    step === 'source' ? 'step 1 of 2 · where is it coming from?' : step === 'local' ? 'step 2 of 2 · local file' : 'step 2 of 2 · from a link';
  const backLabel = step === 'source' ? 'Cancel' : 'Back';
  const confirmLabel = step === 'source' ? 'Pick a source above' : 'Add to library';

  const handleBack = () => {
    if (step === 'source') onClose();
    else setStep('source');
  };

  const handleConfirm = () => {
    if (step !== 'source') onClose(); // no real ingestion backend yet — closes as a demo action
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-6" onClick={onClose}>
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-panel border border-line bg-panel shadow-[0_24px_60px_rgba(0,0,0,.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line2 px-5 py-4">
          <div>
            <div className="font-sans text-[14px] font-semibold text-tx">Add content</div>
            <div className="mt-[3px] font-mono text-[10.5px] text-tx3">{stepLabel}</div>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-field border border-line2 font-mono text-[11px] text-tx2 hover:border-acc"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          {step === 'source' && (
            <div className="flex flex-col gap-[10px]">
              {SOURCES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setStep(s.key)}
                  className="rounded-panel border border-line2 bg-panel2 p-4 text-left hover:border-acc"
                >
                  <span className="block font-sans text-[13px] font-semibold text-tx">{s.n}</span>
                  <span className="mt-1 block font-sans text-[11.5px] leading-[1.6] text-tx2">{s.desc}</span>
                  <span className="mt-[6px] block font-mono text-[9.5px] text-tx3">{s.meta}</span>
                </button>
              ))}
            </div>
          )}

          {step === 'local' && (
            <div className="flex flex-col gap-[14px]">
              <div className="rounded-panel border border-dashed border-line px-[26px] py-[26px] text-center">
                <div className="font-sans text-[12.5px] font-medium text-tx">Drop video files here</div>
                <div className="mt-[6px] font-mono text-[10.5px] text-tx3">mp4 · mkv · avi · webm · mov</div>
                <button className="mt-[14px] rounded-field border border-line px-[14px] py-2 font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc">
                  browse…
                </button>
              </div>
              <div className="flex flex-col overflow-hidden rounded-panel border border-line2">
                {ADD_LOCAL_FIELDS.map((f, i) => (
                  <div
                    key={f.n}
                    className="flex items-center justify-between gap-4 px-[14px] py-3"
                    style={{ borderBottom: i < ADD_LOCAL_FIELDS.length - 1 ? '1px solid var(--line2)' : 'none' }}
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
          )}

          {step === 'link' && (
            <div className="flex flex-col gap-[14px]">
              <div>
                <div className="mb-[7px] font-mono text-[11px] text-tx3">paste a link</div>
                <div className="flex items-center rounded-field border border-accLine bg-accSoft px-[13px] py-[11px] font-mono text-[12px] text-tx">
                  youtube.com/watch?v=…
                  <span className="ml-[2px] animate-pulse">▌</span>
                </div>
                <div className="mt-[7px] font-mono text-[10px] text-tx3">
                  resolved: "The Immune System Explained" · 09:41 · captions available (en)
                </div>
              </div>
              <div className="flex flex-col overflow-hidden rounded-panel border border-line2">
                {ADD_LINK_FIELDS.map((f, i) => (
                  <div
                    key={f.n}
                    className="flex items-center justify-between gap-4 px-[14px] py-3"
                    style={{ borderBottom: i < ADD_LINK_FIELDS.length - 1 ? '1px solid var(--line2)' : 'none' }}
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
              <div className="font-mono text-[10px] leading-[1.7] text-tx3">
                links are never downloaded — the embedded player streams them and only the URL plus timecodes are
                stored, so a clip is reconstructed on demand
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-line2 px-5 py-[14px]">
          <button
            onClick={handleBack}
            className="rounded-field border border-line px-[14px] py-[9px] font-sans text-[11.5px] font-medium text-tx2 hover:border-acc hover:text-acc"
          >
            {backLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={step === 'source'}
            className="rounded-field px-[18px] py-[9px] font-sans text-[11.5px] font-semibold"
            style={{
              background: step === 'source' ? 'transparent' : 'var(--acc)',
              color: step === 'source' ? 'var(--tx3)' : '#fff',
              border: step === 'source' ? '1px solid var(--line2)' : '1px solid transparent',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
