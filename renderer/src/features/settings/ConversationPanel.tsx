import { Pill, Row, Section, Segmented } from '@/features/settings/controls';
import { useSettingsStore } from '@/store/settingsStore';
import { useShellStore } from '@/store/shellStore';
import type { MicSensitivity, TurnPace } from '@/types/api';

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

export function ConversationPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const goSettings = useShellStore((s) => s.goSettings);
  if (!settings) return null;

  const local = settings.llm_mode === 'local';

  return (
    <>
      <Section
        title="Hands-free listening"
        note="In hands-free mode the microphone is always open and the app decides when you have started and stopped talking. These two settings are that decision."
      >
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
        <Row
          label="Interrupting the reply"
          sub="Talking over the AI stops it — but only after a third of a second of unbroken sound. That is what separates a person from a cough, a keyboard or a door, and none of those interrupt at any sensitivity. The setting above changes how loud you have to be, not how long."
          control={<Pill>needs 0.3 s of speech</Pill>}
        />
      </Section>

      <Section
        title="Voice"
        note="What the replies are spoken with. Chosen and downloaded on the AI screen, where the sizes and licences are."
      >
        <Row
          label="Speech engine"
          sub="turns the reply into audio, on this machine"
          control={<Pill tone="ok">{settings.tts_engine}</Pill>}
        />
        <Row
          label="Speech-to-text"
          sub="turns what you say into text, on this machine"
          control={
            settings.stt_model_id ? (
              <Pill tone="ok">{settings.stt_model_id}</Pill>
            ) : (
              <Pill>not downloaded</Pill>
            )
          }
        />
        <Row
          label="Change either"
          sub="downloads, sizes and licences all live together"
          control={
            <button onClick={() => goSettings('AI')} className="font-mono text-[10.5px] text-acc hover:underline">
              open AI settings →
            </button>
          }
        />
      </Section>

      <Section
        title="What happens to what you say"
        note="Two different answers, because the recording and the words in it take different paths."
      >
        <Row
          label="The recording"
          sub="Transcribed by a model on this machine, then dropped. It is never written to disk and never uploaded — there is no setting for it because there is no other behaviour."
          control={<Pill tone="ok">never leaves</Pill>}
        />
        <Row
          label="The transcript"
          sub={
            local
              ? 'Answered by a model running on this machine, so the conversation stays here too.'
              : `Sent to ${settings.api_provider ?? 'the API provider'} to be answered, like any message you type. Switch the AI to a local model if you would rather it did not.`
          }
          control={<Pill tone={local ? 'ok' : 'warn'}>{local ? 'stays local' : 'sent to the API'}</Pill>}
        />
      </Section>
    </>
  );
}
