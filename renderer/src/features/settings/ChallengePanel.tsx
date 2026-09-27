import { Row, Section, Segmented, Toggle } from '@/features/settings/controls';
import { useAppStore } from '@/store/appStore';
import { useSettingsStore } from '@/store/settingsStore';

const ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

const DIFFICULTY: Array<{ value: -1 | 0 | 1; label: string; title: string }> = [
  { value: -1, label: 'Easier', title: 'Scenes a band below your level' },
  { value: 0, label: 'My level', title: 'Scenes around your own level' },
  { value: 1, label: 'Harder', title: 'Scenes a band above your level' },
];

/** The scene levels a round is picked from: the learner's band, moved by
 * the setting, and one band either side of it (see vatex_scenes.band_window). */
function sceneRange(level: string | null | undefined, shift: number): string | null {
  const i = ORDER.indexOf(level as (typeof ORDER)[number]);
  if (i < 0) return null;
  const centre = Math.max(0, Math.min(ORDER.length - 1, i + shift));
  const lo = ORDER[Math.max(0, centre - 1)];
  const hi = ORDER[Math.min(ORDER.length - 1, centre + 1)];
  return lo === hi ? lo : `${lo}–${hi}`;
}

/** The Scene Description Challenge: the three things that change how a round
 * plays. How a round is scored is summed up in the note rather than laid out
 * as rows — rows that cannot be changed read as settings that are broken. */
export function ChallengePanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const level = useAppStore((s) => s.currentUser?.cefr_level);
  if (!settings) return null;

  const range = sceneRange(level, settings.challenge_difficulty);

  return (
    <>
      <Section
        title="Scenes"
        note="Each round is a short clip from the VATEX dataset, described by ten people, which you describe in your own words."
      >
        <Row
          label="Play scenes from YouTube"
          sub={
            <>
              VATEX publishes the descriptions but not the videos, so scenes play from{' '}
              <span className="font-mono text-[10.5px] text-tx2">youtube-nocookie.com</span> — the only part of
              FluencyOS that goes online. It learns your IP address and which clip played, nothing else. Off, the
              challenge has no clip to describe.
            </>
          }
          control={
            <Toggle
              label="Play scenes from YouTube"
              checked={settings.scene_embeds_enabled}
              onChange={(v) => void update({ scene_embeds_enabled: v })}
            />
          }
        />
        <Row
          label="Scene difficulty"
          sub={
            range
              ? `Scenes rated ${range}${level ? ` — your level is ${level}` : ''}. A scene you have played rests for 60 days.`
              : 'Scenes are picked around your level once it is set.'
          }
          control={
            <Segmented
              value={settings.challenge_difficulty}
              options={DIFFICULTY}
              onChange={(v) => void update({ challenge_difficulty: v })}
            />
          }
        />
      </Section>

      <Section
        title="Scoring"
        note="A round is marked on accuracy, detail noticed and grammar — judged by the AI against the ten descriptions — plus how long you spoke. Typed answers score nothing for speaking time."
      >
        <Row
          label="Hints"
          sub={
            settings.challenge_hints_enabled
              ? 'Three levels of help while you describe, each taking points off: 4, then 8, then 15 in all.'
              : 'Off: every round is played on your own, for the whole score.'
          }
          control={
            <Toggle
              label="Hints"
              checked={settings.challenge_hints_enabled}
              onChange={(v) => void update({ challenge_hints_enabled: v })}
            />
          }
        />
      </Section>
    </>
  );
}
