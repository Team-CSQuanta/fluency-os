import { Pill, Row, Section, Toggle } from '@/features/settings/controls';
import { useSettingsStore } from '@/store/settingsStore';

/** The Scene Description Challenge.
 *
 * One real setting, and it is the one that matters: this is the only feature
 * in the app that contacts anyone else, so its switch belongs somewhere it
 * can be found and turned off, not only in the banner that asks for it once.
 */
export function ChallengePanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  if (!settings) return null;

  return (
    <>
      <Section
        title="Scene playback"
        note="VATEX publishes the ten descriptions but not the video, so a scene is a YouTube clip played in an embed."
      >
        <Row
          label="Play scenes from YouTube"
          sub={
            <>
              This is the only part of FluencyOS that contacts anyone else. Playing a scene tells{' '}
              <span className="font-mono text-[10.5px] text-tx2">youtube-nocookie.com</span> your IP address and
              which clip you watched. Nothing about you, your vocabulary or your recordings is sent.
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
          label="With this off"
          sub="The challenge still opens and the ten descriptions are still there, but there is no clip to describe — so there is nothing to play."
          control={<Pill>{settings.scene_embeds_enabled ? 'scenes play' : 'no video'}</Pill>}
        />
      </Section>

      <Section
        title="How a round is marked"
        note="Four parts, and two of them are arithmetic rather than opinion. Shown here because a score you cannot account for is not feedback."
      >
        <Row label="Accuracy" sub="judged by the model against what the ten describers collectively saw" control={<Pill>judged</Pill>} />
        <Row label="Detail noticed" sub="how much of their collective observation you reached" control={<Pill>judged</Pill>} />
        <Row label="Grammar" sub="judged on what you actually said" control={<Pill>judged</Pill>} />
        <Row
          label="Speaking time"
          sub="counted, not judged — a typed attempt scores nought here and is told so rather than having the component quietly dropped"
          control={<Pill tone="ok">counted</Pill>}
        />
        <Row
          label="Hints"
          sub="each one taken subtracts from the total, and the score card shows both numbers rather than one that absorbed the other"
          control={<Pill>subtracted</Pill>}
        />
      </Section>
    </>
  );
}
