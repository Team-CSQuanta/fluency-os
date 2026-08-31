import { SUPPORTED_NATIVE_LANGUAGES, SUPPORTED_TARGET_LANGUAGES } from '@/features/onboarding/onboardingConfig';
import { useOnboardingStore } from '@/store/onboardingStore';

function TextField({
  label,
  sub,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  sub: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-panel border border-line2 bg-panel px-[14px] py-3">
      <div className="min-w-0">
        <div className="font-sans text-[12.5px] font-medium text-tx">{label}</div>
        <div className="mt-[2px] font-mono text-[10px] text-tx3">{sub}</div>
      </div>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-56 flex-none rounded-field border border-line2 bg-transparent px-[10px] py-[6px] text-right font-mono text-[11px] text-acc outline-none focus:border-acc"
      />
    </div>
  );
}

function SelectField({
  label,
  sub,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  sub: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-panel border border-line2 bg-panel px-[14px] py-3">
      <div className="min-w-0">
        <div className="font-sans text-[12.5px] font-medium text-tx">{label}</div>
        <div className="mt-[2px] font-mono text-[10px] text-tx3">{sub}</div>
      </div>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-56 flex-none rounded-field border border-line2 bg-panel2 px-[10px] py-[6px] text-right font-mono text-[11px] text-acc outline-none focus:border-acc disabled:opacity-60"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

export function StepProfile() {
  const profile = useOnboardingStore((s) => s.profile);
  const updateProfile = useOnboardingStore((s) => s.updateProfile);

  const browseDataFolder = async () => {
    const picked = await window.fluencyos.pickDataFolder();
    if (picked) {
      updateProfile({ dataFolder: picked });
    }
  };

  return (
    <div className="flex max-w-[520px] flex-col gap-[11px]">
      <TextField
        label="Display name"
        sub="shown in the app only"
        value={profile.displayName}
        onChange={(v) => updateProfile({ displayName: v })}
        placeholder="Enter your name"
      />
      <SelectField
        label="Native language"
        sub="Used to provide accurate translations and native-language subtitles."
        value={profile.nativeLanguage}
        options={SUPPORTED_NATIVE_LANGUAGES}
        onChange={(v) => updateProfile({ nativeLanguage: v })}
      />
      <SelectField
        label="Target language"
        sub="the language you're learning"
        value={profile.targetLanguage}
        options={SUPPORTED_TARGET_LANGUAGES}
        onChange={(v) => updateProfile({ targetLanguage: v })}
        disabled={SUPPORTED_TARGET_LANGUAGES.length === 1}
      />

      <div className="flex items-center justify-between gap-4 rounded-panel border border-line2 bg-panel px-[14px] py-3">
        <div className="min-w-0">
          <div className="font-sans text-[12.5px] font-medium text-tx">Data folder</div>
          <div className="mt-[2px] font-mono text-[10px] text-tx3">clips and database live here</div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="max-w-[160px] truncate font-mono text-[11px] text-acc" title={profile.dataFolder}>
            {profile.dataFolder}
          </span>
          <button
            onClick={browseDataFolder}
            className="rounded-field border border-line2 px-[10px] py-[6px] font-mono text-[11px] text-tx2 hover:border-acc hover:text-acc"
          >
            Browse…
          </button>
        </div>
      </div>
    </div>
  );
}
