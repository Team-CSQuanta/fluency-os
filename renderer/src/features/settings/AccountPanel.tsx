import { useEffect, useState } from 'react';
import { Pill, Row, Section } from '@/features/settings/controls';
import { useAppStore } from '@/store/appStore';
import type { SystemInfo } from '@/types/window';

const LANGUAGES: Record<string, string> = {
  bn: 'Bengali', en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  hi: 'Hindi', ja: 'Japanese', ko: 'Korean', pt: 'Portuguese', ru: 'Russian',
  ar: 'Arabic', zh: 'Chinese', it: 'Italian', tr: 'Turkish', ur: 'Urdu',
};

function language(code: string | null | undefined): string {
  if (!code) return 'not set';
  return LANGUAGES[code] ?? code;
}

export function AccountPanel() {
  const user = useAppStore((s) => s.currentUser);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void window.fluencyos.getSystemInfo().then(setSystem);
  }, []);

  return (
    <>
      <Section
        title="Profile"
        note="Kept in the database on this machine. There is no account, no server and nothing to sign in to."
      >
        <Row label="Display name" sub="what the app calls you" control={<Pill>{user?.display_name || 'not set'}</Pill>} />
        <Row
          label="Native language"
          sub="what glosses and the second subtitle track are written in"
          control={<Pill>{language(user?.native_language)}</Pill>}
        />
        <Row
          label="Learning"
          sub="what everything is graded against"
          control={<Pill>{language(user?.target_language)}</Pill>}
        />
        <Row
          label="Level"
          sub="set by the placement test — retake it any time from the dashboard"
          control={<Pill tone={user?.cefr_level ? 'ok' : 'muted'}>{user?.cefr_level ?? 'not placed'}</Pill>}
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
