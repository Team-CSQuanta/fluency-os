import { useEffect } from 'react';
import { Pill, Row, Section, Segmented, Toggle } from '@/features/settings/controls';
import { useEngineStore } from '@/store/engineStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
import type { Corrections, MicSensitivity, ReplyLength, TurnPace } from '@/types/api';

/** How hands-free listening behaves.
 *
 * Both settings here started life as constants, and both were changed because
 * of a bug report about the same feature: the gate cut the reply off on a
 * cough, and the end-of-turn timer sent half a sentence the moment its author
 * paused for breath. Better numbers fixed both — but the right number depends
 * on the room and on the person, which is exactly what a constant cannot know.
 */

const SENSITIVITY: Array<{ value: MicSensitivity; label: string; title: string }> = [
  { value: 'sensitive', label: 'sensitive', title: 'A quiet room, or a headset. Picks up a soft voice — and more of the room.' },
  { value: 'balanced', label: 'balanced', title: 'The default the gate was tuned to.' },
  { value: 'robust', label: 'robust', title: 'A shared or noisy room. Needs a clear, close voice, and ignores almost everything else.' },
];

const PACE: Array<{ value: TurnPace; label: string; title: string }> = [
  { value: 'quick', label: 'quick', title: 'Replies come back fast. Pause mid-sentence and you will be cut off.' },
  { value: 'natural', label: 'natural', title: 'About a second of silence, and longer when you have barely started.' },
  { value: 'patient', label: 'patient', title: 'Room to think mid-sentence, at the cost of a slower reply.' },
];

// Each of these describes a measured outcome, not an intention. The numbers
// behind them are in vadGate.ts and the behaviour was simulated at all three
// settings before these sentences were written.
const SENSITIVITY_NOTE: Record<MicSensitivity, string> = {
  sensitive:
    'Hears a soft or slightly distant voice. The cost is that a sustained sound can too — a television, or a conversation across the room — and that can interrupt the reply.',
  balanced:
    'Needs an ordinary speaking voice near the microphone. A conversation across the room will not register, and neither will a fan.',
  robust:
    'Needs a clear, close voice; a soft one will not register at all. For a shared or noisy room, where the problem is everything except you.',
};

const PACE_NOTE: Record<TurnPace, string> = {
  quick: 'Your turn is sent after about half a second of silence. Fastest replies, and the easiest to be cut off by.',
  natural: 'A second of silence ends your turn — but if you have only said a word or two, it waits longer, because a short burst followed by a pause is usually a thought being assembled.',
  patient: 'A second and a half, and longer still when you have barely started. Best if you are composing sentences as you go.',
};

const LENGTH: Array<{ value: ReplyLength; label: string; title: string }> = [
  { value: 'short', label: 'short', title: 'One sentence — you do most of the talking' },
  { value: 'normal', label: 'natural', title: 'One or two sentences, like real conversation' },
  { value: 'long', label: 'detailed', title: 'Two to four sentences — more to listen to' },
];

const CORRECTIONS: Array<{ value: Corrections; label: string; title: string }> = [
  { value: 'recast', label: 'gentle', title: 'The partner says it back correctly, without pointing it out' },
  { value: 'explicit', label: 'point them out', title: 'Plus a short [Small fix: …] note after its reply' },
];

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25].map((v) => ({ value: v, label: `${v}×` }));

/** Conversation: how listening works, how the partner talks back, and the
 * voice it talks in. Every row here changes something; what cannot be
 * changed is said in a note, not dressed up as a setting. */
export function ConversationPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const goSettings = useShellStore((s) => s.goSettings);
  const catalog = useEngineStore((s) => s.catalog);
  const fetchCatalog = useEngineStore((s) => s.fetchCatalog);
  const selectTtsEngine = useEngineStore((s) => s.selectTtsEngine);
  useEffect(() => {
    if (!catalog) void fetchCatalog();
  }, [catalog, fetchCatalog]);
  if (!settings) return null;

  const voices = catalog?.tts_options ?? [];
  const selected = voices.find((v) => v.selected);

  return (
    <>
      <Section
        title="Listening"
        note="With hands-free on, the microphone stays open and the app decides when you start and stop talking. Talking over a reply stops it once you have spoken for about a third of a second."
      >
        <Row
          label="Start in hands-free"
          sub="New conversations open with the microphone listening. Off, you tap to talk."
          control={
            <Toggle
              label="Start in hands-free"
              checked={settings.conversation_hands_free}
              onChange={(v) => void update({ conversation_hands_free: v })}
            />
          }
        />
        <Row
          label="Microphone sensitivity"
          sub={SENSITIVITY_NOTE[settings.conversation_mic_sensitivity]}
          stacked
          control={
            <Segmented
              value={settings.conversation_mic_sensitivity}
              options={SENSITIVITY}
              onChange={(v) => void update({ conversation_mic_sensitivity: v })}
            />
          }
        />
        <Row
          label="End of turn"
          sub={PACE_NOTE[settings.conversation_turn_pace]}
          stacked
          control={
            <Segmented
              value={settings.conversation_turn_pace}
              options={PACE}
              onChange={(v) => void update({ conversation_turn_pace: v })}
            />
          }
        />
      </Section>

      <Section title="How the partner talks">
        <Row
          label="Reply length"
          sub="How much the partner says each turn. Shorter replies leave more of the talking to you."
          control={
            <Segmented
              value={settings.conversation_reply_length}
              options={LENGTH}
              onChange={(v) => void update({ conversation_reply_length: v })}
            />
          }
        />
        <Row
          label="Corrections"
          sub={
            settings.conversation_corrections === 'recast'
              ? 'Your mistakes are said back correctly in the reply ("I goed" → "Oh, you went?"), without breaking the flow.'
              : 'As well as saying it back correctly, the partner adds one short note for the most useful fix: [Small fix: "I went", not "I goed".]'
          }
          control={
            <Segmented
              value={settings.conversation_corrections}
              options={CORRECTIONS}
              onChange={(v) => void update({ conversation_corrections: v })}
            />
          }
        />
        <Row
          label="Listening practice"
          sub="In voice conversations, each reply's text stays hidden until you have heard it — so you listen rather than read. Click to reveal it early."
          control={
            <Toggle
              label="Listening practice"
              checked={settings.conversation_hide_text}
              onChange={(v) => void update({ conversation_hide_text: v })}
            />
          }
        />
      </Section>

      <Section title="Voice">
        <Row
          label="Voice"
          sub={
            selected
              ? selected.downloaded
                ? `${selected.note}`
                : 'Not downloaded yet — download it in AI settings.'
              : 'Speaks the replies, on this machine.'
          }
          control={
            voices.length > 0 ? (
              <Segmented
                value={selected?.key ?? voices[0].key}
                options={voices.map((v) => ({
                  value: v.key,
                  label: v.downloaded ? v.label : `${v.label} ↓`,
                  title: v.downloaded ? v.note : 'Not downloaded — AI settings',
                }))}
                onChange={(key) => void selectTtsEngine(key)}
              />
            ) : (
              <Pill>…</Pill>
            )
          }
        />
        <Row
          label="Voice speed"
          sub="Slower makes a reply easier to follow; faster is closer to how people really talk."
          control={
            <Segmented
              value={settings.conversation_voice_speed}
              options={SPEEDS}
              onChange={(v) => void update({ conversation_voice_speed: v })}
            />
          }
        />
        <Row
          label="Downloads"
          sub="Voices and the speech-to-text model are downloaded, and removed, on the AI page."
          control={
            <button onClick={() => goSettings('AI')} className="font-mono text-[10.5px] text-acc hover:underline">
              open AI settings →
            </button>
          }
        />
      </Section>
    </>
  );
}
