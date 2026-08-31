import { useEffect } from 'react';
import { API_PROVIDERS, MODEL_TIERS } from '@/features/onboarding/onboardingConfig';
import { useOnboardingStore } from '@/store/onboardingStore';

function formatRam(bytes: number | null): string {
  if (bytes === null) return '…';
  return `${Math.round(bytes / 1024 / 1024 / 1024)} GB RAM`;
}

export function StepEngine() {
  const hardware = useOnboardingStore((s) => s.hardware);
  const engineAssessment = useOnboardingStore((s) => s.engineAssessment);
  const engine = useOnboardingStore((s) => s.engine);
  const loadHardwareInfo = useOnboardingStore((s) => s.loadHardwareInfo);
  const updateEngine = useOnboardingStore((s) => s.updateEngine);

  useEffect(() => {
    if (hardware.cpuCores === null) {
      void loadHardwareInfo();
    }
  }, [hardware.cpuCores, loadHardwareInfo]);

  const capabilityFor = (tierKey: string) => engineAssessment?.tiers.find((t) => t.tier === tierKey);

  return (
    <div>
      <div className="mb-3 font-mono text-[11px] text-tx3">
        detected · {hardware.cpuCores ?? '…'} cores · {formatRam(hardware.totalRamBytes)} · {hardware.platform ?? '…'}
      </div>

      {engineAssessment && !engineAssessment.any_local_capable && (
        <div className="mb-3 rounded-panel border border-accLine bg-accSoft px-4 py-3">
          <div className="font-sans text-[12.5px] font-semibold text-acc">
            This machine doesn't meet the minimum for smooth local inference
          </div>
          <div className="mt-1 font-sans text-[11.5px] leading-[1.6] text-tx2">
            Even the lightest model needs more headroom once speech recognition and voice synthesis are running
            alongside it. We've switched you to API-key mode — you can still pick a local tier below if you'd
            rather try it anyway.
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {MODEL_TIERS.map((tier) => {
          const capability = capabilityFor(tier.key);
          const capable = capability?.capable ?? true; // unknown yet = don't grey out prematurely
          const on = engine.mode === 'local' && engine.modelTier === tier.key;
          const recommended = engineAssessment?.recommended_tier === tier.key;
          return (
            <button
              key={tier.key}
              onClick={() => updateEngine({ mode: 'local', modelTier: tier.key })}
              className="rounded-panel border px-4 py-4 text-left"
              style={{
                borderColor: on ? 'var(--accLine)' : 'var(--line2)',
                background: on ? 'var(--accSoft)' : 'var(--panel)',
                opacity: capable ? 1 : 0.55,
              }}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-sans text-[13px] font-semibold" style={{ color: on ? 'var(--acc)' : 'var(--tx)' }}>
                  {tier.name}
                </span>
                {recommended && <span className="font-mono text-[9.5px] text-acc">recommended</span>}
              </div>
              <div className="mt-2 font-mono text-[11px] leading-[1.6] text-tx3">
                {tier.size} · {tier.meta}
              </div>
              {capability && !capability.capable ? (
                <div className="mt-[9px] font-mono text-[11px] leading-[1.6] text-tx3">
                  needs ≥{capability.min_ram_gb}GB RAM · {capability.min_cores}+ cores
                </div>
              ) : (
                <div className="mt-[9px] font-sans text-[11.5px] leading-[1.6] text-tx2">{tier.desc}</div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 font-sans text-[11.5px] text-tx3">
        Low-spec machine?{' '}
        <button
          onClick={() => updateEngine({ mode: 'api', modelTier: null })}
          className="text-acc hover:underline"
        >
          Use an API key instead
        </button>
      </div>

      {engine.mode === 'api' && (
        <div className="mt-3 rounded-panel border border-line2 bg-panel px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-sans text-[12.5px] font-medium text-tx">API provider</div>
              <div className="mt-[2px] font-mono text-[10px] text-tx3">only STT and TTS are downloaded locally</div>
            </div>
            <select
              value={engine.apiProvider}
              onChange={(e) => updateEngine({ apiProvider: e.target.value })}
              className="rounded-field border border-line2 bg-panel2 px-[10px] py-[6px] font-mono text-[11px] text-acc outline-none focus:border-acc"
            >
              {API_PROVIDERS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <label className="font-sans text-[12.5px] font-medium text-tx">API key</label>
            <input
              type="password"
              autoComplete="off"
              value={engine.apiKey}
              onChange={(e) => updateEngine({ apiKey: e.target.value })}
              placeholder="sk-…"
              className="mt-[6px] w-full rounded-field border border-line2 bg-panel2 px-[10px] py-[8px] font-mono text-[12px] text-tx outline-none focus:border-acc"
            />
            <div className="mt-[6px] font-mono text-[10px] leading-[1.6] text-tx3">
              kept on this device only for now, never sent anywhere — secure OS-keychain storage lands with
              Settings, so you can also paste this in later instead
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
