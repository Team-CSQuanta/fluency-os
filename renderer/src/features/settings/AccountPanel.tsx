import { useEffect, useState } from 'react';
import {
  SUPPORTED_NATIVE_LANGUAGES,
  SUPPORTED_TARGET_LANGUAGES,
} from '@/features/onboarding/onboardingConfig';
import { avatarUrl } from '@/lib/avatar';
import { Choice, EditableText, Pill, Row, Section } from '@/features/settings/controls';
import { reportError } from '@/store/errorStore';
import { useAppStore } from '@/store/appStore';
import type { SystemInfo } from '@/types/window';

/* Onboarding stores a language by name — "Bengali", not "bn" — and the
 * sidebar prints what is stored, so these have to match it. */
const NATIVE_OPTIONS = SUPPORTED_NATIVE_LANGUAGES.map((l) => ({ value: l, label: l }));
const TARGET_OPTIONS = SUPPORTED_TARGET_LANGUAGES.map((l) => ({ value: l, label: l }));
const CEFR_OPTIONS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((v) => ({ value: v, label: v }));

export function AccountPanel() {
  const user = useAppStore((s) => s.currentUser);
  const updateProfile = useAppStore((s) => s.updateProfile);
  const setAvatar = useAppStore((s) => s.setAvatar);
  const clearAvatar = useAppStore((s) => s.clearAvatar);
  const avatarVersion = useAppStore((s) => s.avatarVersion);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void window.fluencyos.getSystemInfo().then(setSystem);
  }, []);


  const save = (patch: Parameters<typeof updateProfile>[0], what: string) => {
    void updateProfile(patch).catch((err) => reportError(err, what));
  };

  const pickPicture = async () => {
    const path = await window.fluencyos.pickImageFile();
    if (!path) return;
    try {
      await setAvatar(path);
    } catch (err) {
      reportError(err, 'Setting your profile picture');
    }
  };

  return (
    <>
      <Section
        title="Profile"
        note="Kept in the database on this machine. There is no account, no server and nothing to sign in to."
      >
        <Row
          label="Picture"
          sub="copied into your data folder, so tidying the folder you picked it from cannot break it"
          control={
            <div className="flex items-center gap-[10px]">
              <div className="grid h-[44px] w-[44px] flex-none place-items-center overflow-hidden rounded-full border border-line2 bg-panel2 font-mono text-[8px] text-tx3">
                {user?.has_avatar ? (
                  <img
                    src={avatarUrl(user.id, avatarVersion)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  'none'
                )}
              </div>
              <button
                onClick={() => void pickPicture()}
                className="rounded-field border border-line px-[11px] py-[6px] font-sans text-[11.5px] text-tx2 hover:border-acc hover:text-acc"
              >
                {user?.has_avatar ? 'Change…' : 'Choose…'}
              </button>
              {user?.has_avatar && (
                <button
                  onClick={() => void clearAvatar().catch((err) => reportError(err, 'Removing your picture'))}
                  className="font-mono text-[10px] text-tx3 hover:text-acc"
                >
                  remove
                </button>
              )}
            </div>
          }
        />
        <Row
          label="Display name"
          sub="what the app calls you"
          control={
            <EditableText
              value={user?.display_name ?? ''}
              placeholder="your name"
              onSave={(next) => save({ display_name: next }, 'Saving your name')}
            />
          }
        />
        <Row
          label="Native language"
          sub="what glosses and the second subtitle track are written in"
          control={
            <Choice
              value={user?.native_language ?? null}
              options={NATIVE_OPTIONS}
              onChange={(next) => save({ native_language: next }, 'Saving your native language')}
            />
          }
        />
        <Row
          label="Learning"
          sub="what everything is graded against"
          control={
            <Choice
              value={user?.target_language ?? null}
              options={TARGET_OPTIONS}
              onChange={(next) => save({ target_language: next }, 'Saving the language you are learning')}
            />
          }
        />
        <Row
          label="Level"
          sub="what difficulty is measured against — the placement test sets it, and you can change it here"
          control={
            <Choice
              value={user?.cefr_level ?? null}
              options={CEFR_OPTIONS}
              onChange={(next) => save({ cefr_level: next }, 'Saving your level')}
              width={110}
            />
          }
        />
      </Section>

      <Section title="Where your data lives">
        <Row
          label="Data folder"
          sub="the database, saved clips, downloaded models and page images"
          control={
            // A path is no use as a label you cannot take anywhere. Copying it
            // is the one thing anyone wants to do with it.
            <button
              onClick={() => {
                if (!system) return;
                void navigator.clipboard.writeText(system.dataFolder).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                });
              }}
              title={system?.dataFolder}
              className="max-w-[260px] truncate font-mono text-[10.5px] text-tx2 hover:text-acc"
            >
              {copied ? 'copied ✓' : (system?.dataFolder ?? '…')}
            </button>
          }
        />
        <Row
          label="Your video and book files"
          sub="read where you keep them — FluencyOS never copies or moves the originals"
          control={<Pill>left in place</Pill>}
        />
        <Row
          label="This machine"
          sub="what the local models have to work with"
          control={
            <Pill>
              {system ? `${system.cpuCores} cores · ${Math.round(system.totalRamBytes / 1024 ** 3)} GB` : '…'}
            </Pill>
          }
        />
      </Section>
    </>
  );
}
