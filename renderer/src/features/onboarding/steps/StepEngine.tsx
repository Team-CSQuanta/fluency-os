import { useEffect } from 'react';
import { CLOUD_PROVIDERS } from '@/features/onboarding/onboardingConfig';
import { useOnboardingStore } from '@/store/onboardingStore';
import type { ModelFit } from '@/types/api';

const AMBER = '#d9a441';

const FIT: Record<ModelFit['fit'], { label: string; color: string }> = {
  good: { label: 'fits well', color: 'var(--acc)' },
  tight: { label: 'tight fit', color: AMBER },
  too_big: { label: "won't fit", color: 'var(--tx3)' },
};

const SPEED: Record<ModelFit['speed'], string> = {
  quick: 'quick replies',
  steady: 'steady replies',
  slow: 'slow replies',
};

function gb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

/** Which model runs the AI — chosen from the models the app actually ships,
 * rated for this computer by the backend (services/hardware_capability.py),
 * and saved exactly as Settings → AI saves it. */
export function StepEngine() {
  const hardware = useOnboardingStore((s) => s.hardware);
  const recommendation = useOnboardingStore((s) => s.recommendation);
  const engine = useOnboardingStore((s) => s.engine);
  const loadHardwareInfo = useOnboardingStore((s) => s.loadHardwareInfo);
  const updateEngine = useOnboardingStore((s) => s.updateEngine);

  useEffect(() => {
    if (hardware.cpuCores === null) void loadHardwareInfo();
  }, [hardware.cpuCores, loadHardwareInfo]);

  const detected = [
    `${hardware.cpuCores ?? '…'} cores`,
    hardware.totalRamBytes === null ? '… RAM' : `${Math.round(hardware.totalRamBytes / 1024 ** 3)} GB RAM`,
    recommendation?.gpu ? `${recommendation.gpu} GPU${recommendation.gpu_used ? '' : ' (not usable here)'}` : 'no GPU found',
    hardware.platform ?? '…',
  ].join(' · ');

  const chosen = recommendation?.models.find((m) => m.key === engine.modelKey);
  const best = recommendation?.models.find((m) => m.recommended);
  const provider = CLOUD_PROVIDERS.find((p) => p.key === engine.cloudProvider) ?? CLOUD_PROVIDERS[0];

  return (
    <div className="max-w-[640px]">
      <div className="mb-3 font-mono text-[11px] text-tx3">detected · {detected}</div>

      {!recommendation ? (
        <div className="rounded-panel border border-line2 bg-panel px-4 py-6 text-center font-mono text-[11px] text-tx3">
          checking this computer…
        </div>
      ) : engine.mode === 'local' ? (
        <>
          {/* the recommendation, and why */}
          {best && (
            <div className="rounded-panel border border-accLine bg-accSoft px-4 py-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-tx3">Recommended for this computer</div>
              <div className="mt-1 font-sans text-[15px] font-semibold text-acc">{best.label}</div>
              <div className="mt-1 font-sans text-[12px] leading-[1.6] text-tx2">{recommendation.reason}</div>
              {recommendation.cloud_suggested && (
                <button
                  onClick={() => updateEngine({ mode: 'api' })}
                  className="mt-2 font-sans text-[11.5px] text-acc hover:underline"
                >
                  Use a cloud model instead →
                </button>
              )}
            </div>
          )}

          {/* every model the app ships */}
          <div
            role="radiogroup"
            aria-label="Local model"
            className="mt-3 overflow-hidden rounded-panel border border-line2 bg-panel"
          >
            {recommendation.models.map((m) => {
              const on = engine.modelKey === m.key;
              const blocked = m.fit === 'too_big';
              return (
                <button
                  key={m.key}
                  role="radio"
                  aria-checked={on}
                  disabled={blocked}
                  onClick={() => updateEngine({ mode: 'local', modelKey: m.key })}
                  className="flex w-full items-start gap-3 border-b border-line2 px-4 py-[11px] text-left last:border-b-0 disabled:cursor-not-allowed"
                  style={{ background: on ? 'var(--accSoft)' : 'transparent', opacity: blocked ? 0.5 : 1 }}
                >
                  <span
                    className="mt-[3px] grid h-[14px] w-[14px] flex-none place-items-center rounded-full border"
                    style={{ borderColor: on ? 'var(--acc)' : 'var(--line)' }}
                  >
                    {on && <span className="h-[6px] w-[6px] rounded-full bg-acc" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-[2px]">
                      <span className="font-sans text-[13px] font-semibold" style={{ color: on ? 'var(--acc)' : 'var(--tx)' }}>
                        {m.label}
                      </span>
                      <span className="font-mono text-[10.5px] text-tx3">{gb(m.size_mb)}</span>
                      {m.recommended && <span className="font-mono text-[9.5px] text-acc">recommended</span>}
                      <span className="ml-auto font-mono text-[10px]" style={{ color: FIT[m.fit].color }}>
                        {FIT[m.fit].label}
                        {!blocked && <span className="text-tx3"> · {SPEED[m.speed]}</span>}
                      </span>
                    </span>
                    <span className="mt-[2px] block font-sans text-[11.5px] leading-[1.5] text-tx3">
                      {blocked
                        ? `Needs about ${m.needs_gb} GB while running; this computer has about ${recommendation.available_gb} GB left for a model.`
                        : m.note}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 font-sans text-[11.5px] leading-[1.6] text-tx3">
            {chosen && (
              <>
                Continue starts downloading {chosen.label} ({gb(chosen.size_mb)}) in the background. You can change
                models any time in Settings → AI.{' '}
              </>
            )}
            <button onClick={() => updateEngine({ mode: 'api' })} className="text-acc hover:underline">
              Use a cloud model instead
            </button>
          </div>
        </>
      ) : (
        /* a cloud model, with the learner's own key */
        <div className="rounded-panel border border-line2 bg-panel px-4 py-4">
          <div className="font-sans text-[13px] font-semibold text-tx">Cloud model</div>
          <div className="mt-1 font-sans text-[11.5px] leading-[1.6] text-tx3">
            Replies come from a model online instead of this computer — usually faster and more capable, but it
            needs the internet, and what you write is sent to the provider. Speech is still handled on this computer.
          </div>

          <div className="mt-3 flex gap-2">
            {CLOUD_PROVIDERS.map((p) => {
              const on = p.key === engine.cloudProvider;
              return (
                <button
                  key={p.key}
                  onClick={() => updateEngine({ cloudProvider: p.key })}
                  className="flex-1 rounded-field border px-3 py-[8px] text-left"
                  style={{
                    borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                    background: on ? 'var(--accSoft)' : 'transparent',
                  }}
                >
                  <span className="block font-sans text-[12.5px] font-medium" style={{ color: on ? 'var(--acc)' : 'var(--tx)' }}>
                    {p.label}
                  </span>
                  <span className="block font-mono text-[10px] text-tx3">{p.hint}</span>
                </button>
              );
            })}
          </div>

          <label className="mt-3 block font-sans text-[12.5px] font-medium text-tx" htmlFor="onboarding-api-key">
            {provider.label} API key
          </label>
          <input
            id="onboarding-api-key"
            type="password"
            autoComplete="off"
            value={engine.apiKey}
            onChange={(e) => updateEngine({ apiKey: e.target.value })}
            placeholder={provider.placeholder}
            className="mt-[6px] w-full rounded-field border border-line2 bg-panel2 px-[10px] py-[8px] font-mono text-[12px] text-tx outline-none focus:border-acc"
          />
          <div className="mt-[6px] font-mono text-[10px] leading-[1.6] text-tx3">
            stored on this computer and sent only to {provider.label} · you can add or change it later in Settings →
            AI{engine.apiKey.trim() ? '' : ' — until then the AI features will not answer'}
          </div>

          <button
            onClick={() => updateEngine({ mode: 'local' })}
            className="mt-3 font-sans text-[11.5px] text-acc hover:underline"
          >
            ← run it on this computer instead
          </button>
        </div>
      )}
    </div>
  );
}
