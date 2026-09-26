/** When a run of microphone frames counts as someone speaking.
 *
 * Split out of useVadRecorder so the decision can be reasoned about — and
 * exercised — on its own, without a microphone, an AudioContext or a browser.
 * Everything here is arithmetic over a sequence of loudness readings.
 *
 * The central idea is that "has the learner started talking?" and "is the
 * learner talking over the reply?" are different questions and deserve
 * different answers. The first is asked into silence and should be answered
 * fast. The second is asked while the AI's own voice is coming back through
 * the speakers, and answering it wrongly throws away the rest of the reply —
 * so it takes more evidence, sustained for longer, before it is believed.
 */

export const FRAME_MS = 50;

/** Two consecutive loud frames before believing it's speech — one is too easy
 * to trip with a keyboard clack or a chair creak. */
export const SPEECH_FRAMES = 2;

/** Interrupting the AI takes six: a third of a second of continuous sound.
 *
 * At two frames, a hundred milliseconds of anything cut the reply off — a
 * cough, a chair, a door, a key press. Those are all brief, which is exactly
 * what separates them from someone actually starting to speak, so the cheapest
 * reliable filter is to insist the sound lasts. It costs a third of a second
 * before a genuine interruption registers, which is about the pause a person
 * leaves before talking over someone anyway. */
export const BARGE_IN_FRAMES = 6;

/** How loud, as a multiple of the measured room. */
export const NOISE_FLOOR_MULTIPLE = 3;
export const BARGE_IN_MULTIPLE = 6;

/** A room this quiet still needs an absolute floor, or the threshold collapses
 * towards zero and everything reads as speech. The barge-in floor is the one
 * that stops a fan or a distant voice from being able to reach the bar at all. */
export const ABS_MIN_THRESHOLD = 0.012;
export const BARGE_IN_ABS_MIN = 0.035;

/** Nothing counts for the first moments of a reply: echo cancellation needs a
 * beat to adapt to the AI's voice arriving in the microphone, and until it has,
 * the reply's own opening syllable is the loudest thing in the room. */
export const BARGE_IN_GRACE_MS = 350;

/** Frames of ambient measured before any judgement is made — one second.
 *
 * The QUIETEST of them is taken as the floor, not the average. A floor is by
 * definition the quiet part, and averaging lets whatever happened to be
 * audible during calibration set it: start hands-free while already talking,
 * or while a door closes, and the average lands far above the room. The bar is
 * then out of reach and the gate is deaf for as long as it takes the running
 * adaptation to walk it back down. */
export const NOISE_FLOOR_FRAMES = 20;
/** Judgement begins here, half a second in, while the floor keeps refining to
 * the end of the window above. Waiting the full second before listening at all
 * would leave the learner unheard if they start talking straight away. */
export const MIN_FLOOR_FRAMES = 10;

/** How fast the ambient level follows the room, per frame — about two and a
 * half seconds to settle.
 *
 * The floor used to be measured once, over the first half second of the
 * session, and then never again. A session that began in a quiet room kept a
 * quiet room's threshold for as long as it ran, so a fan starting up, traffic,
 * or someone talking next door sat permanently above the bar and read as the
 * learner speaking. */
export const FLOOR_ALPHA = 0.02;
/** Falling is four times faster than rising.
 *
 * A room that genuinely got louder can be followed at leisure — the absolute
 * minimums hold the line meanwhile. A floor that has been pushed up by a burst
 * must come back down promptly, because every moment it stays up is a moment
 * the learner cannot be heard. */
export const FLOOR_ALPHA_FALLING = 0.08;

/** How long a pause has to last before a turn counts as finished.
 *
 * This was 400ms, which is shorter than an ordinary mid-sentence breath and
 * far shorter than the pauses a learner leaves while assembling a sentence in
 * a language they are still learning. The effect was that "I think… that one
 * is better" was cut after "I think", sent on its own, and answered — while
 * the rest of the sentence arrived as a second turn.
 *
 * A second of silence is roughly where a listener starts to suspect you have
 * finished. It costs a little dead air before the reply, which is the price of
 * not being interrupted mid-thought. */
export const SILENCE_MS = 1000;

/** Longer still, for someone who has barely started.
 *
 * A short burst followed by a pause is almost always a thought being
 * assembled — "I…", "It's…", "Maybe…" — and cutting there produces a fragment
 * that is both a poor turn and a poor thing to be answered. Once a full
 * sentence is under way, a pause is much more likely to be the end of it. */
export const HESITATION_SILENCE_MS = 1600;
/** Below this much actual speech, a pause is treated as hesitation. */
export const SHORT_UTTERANCE_MS = 1500;

/** The two things about listening that a constant cannot know.
 *
 * Both of these were tuned to fix a real complaint — the gate cutting the
 * reply off on background noise, and the turn being sent while its author was
 * still assembling it — and both fixes were a better number. But the right
 * number depends on the room and on the speaker. A headset in a quiet study
 * and a laptop microphone in a shared kitchen want opposite settings, and no
 * amount of looking at the signal tells you which one you are in.
 *
 * So the tuned values stay as `balanced`/`natural`, and the two other steps
 * either side are for the rooms and the people the default is wrong for.
 */
export type MicSensitivity = 'sensitive' | 'balanced' | 'robust';
export type TurnPace = 'quick' | 'natural' | 'patient';

/** Multiplies every threshold, relative and absolute alike. Below 1 the gate
 * hears more of the room; above 1 it needs a clear, close voice. */
export const SENSITIVITY_SCALE: Record<MicSensitivity, number> = {
  sensitive: 0.7,
  balanced: 1,
  robust: 1.5,
};

/** How much silence ends a turn, and how much when barely anything has been
 * said yet. `natural` is the pair the gate was tuned to. */
export const PACE_MS: Record<TurnPace, { silence: number; hesitation: number }> = {
  quick: { silence: 500, hesitation: 900 },
  natural: { silence: SILENCE_MS, hesitation: HESITATION_SILENCE_MS },
  patient: { silence: 1500, hesitation: 2200 },
};

export interface ListeningProfile {
  sensitivity: MicSensitivity;
  pace: TurnPace;
}

export const DEFAULT_PROFILE: ListeningProfile = { sensitivity: 'balanced', pace: 'natural' };

export type GateEvent = 'none' | 'calibrating' | 'start' | 'end';

export interface Frame {
  rms: number;
  now: number;
  /** The AI's reply is audible right now. */
  aiSpeaking: boolean;
}

export class SpeechGate {
  private profile: ListeningProfile;
  private noiseFloor = 0;
  private floorFrames = 0;
  private loudFrames = 0;
  private lastLoudAt = 0;
  private aiSpeakingSince = 0;
  private wasAiSpeaking = false;

  /** True between a `start` and its `end`. */
  speaking = false;
  speechStartedAt = 0;

  constructor(profile: ListeningProfile = DEFAULT_PROFILE) {
    this.profile = profile;
  }

  /** Change how it listens without forgetting what the room sounds like.
   *
   * Applied live rather than by rebuilding the gate: rebuilding would mean
   * releasing and re-acquiring the microphone, which drops whatever is being
   * said at that moment and throws away a calibration that took a second to
   * measure. Someone adjusting this in settings is usually doing it BECAUSE
   * the current conversation is going badly. */
  setProfile(profile: ListeningProfile): void {
    this.profile = profile;
  }

  /** How much silence should end the turn, given how much has been said so
   * far. Exposed so the reason a turn ended can be reasoned about. */
  silenceNeeded(): number {
    const { silence, hesitation } = PACE_MS[this.profile.pace];
    const voiced = this.lastLoudAt - this.speechStartedAt;
    return voiced < SHORT_UTTERANCE_MS ? hesitation : silence;
  }

  /** The measured ambient level, exposed for diagnostics. */
  get floor(): number {
    return this.noiseFloor;
  }

  /** The bar this frame had to clear. */
  threshold(aiSpeaking: boolean): number {
    // The scale moves the absolute minimum with the relative one. Scaling only
    // the multiple would leave a quiet room pinned to the same floor at every
    // setting, so "robust" would change nothing where it is needed most.
    const k = SENSITIVITY_SCALE[this.profile.sensitivity];
    return aiSpeaking
      ? Math.max(BARGE_IN_ABS_MIN * k, this.noiseFloor * BARGE_IN_MULTIPLE * k)
      : Math.max(ABS_MIN_THRESHOLD * k, this.noiseFloor * NOISE_FLOOR_MULTIPLE * k);
  }

  observe({ rms, now, aiSpeaking }: Frame): GateEvent {
    if (aiSpeaking && !this.wasAiSpeaking) this.aiSpeakingSince = now;
    this.wasAiSpeaking = aiSpeaking;

    if (this.floorFrames < NOISE_FLOOR_FRAMES) {
      this.floorFrames += 1;
      this.noiseFloor = this.floorFrames === 1 ? rms : Math.min(this.noiseFloor, rms);
      if (this.floorFrames < MIN_FLOOR_FRAMES) return 'calibrating';
    }

    if (rms > this.threshold(aiSpeaking)) {
      this.loudFrames += 1;
      this.lastLoudAt = now;
      const needed = aiSpeaking ? BARGE_IN_FRAMES : SPEECH_FRAMES;
      const settled = !aiSpeaking || now - this.aiSpeakingSince >= BARGE_IN_GRACE_MS;
      if (!this.speaking && settled && this.loudFrames >= needed) {
        this.speaking = true;
        this.speechStartedAt = now;
        return 'start';
      }
      return 'none';
    }

    this.loudFrames = 0;
    // The room, measured between utterances and only while the AI is quiet,
    // so that neither voice can drag it upward.
    if (!this.speaking && !aiSpeaking) {
      const alpha = rms < this.noiseFloor ? FLOOR_ALPHA_FALLING : FLOOR_ALPHA;
      this.noiseFloor += (rms - this.noiseFloor) * alpha;
    }
    if (this.speaking && now - this.lastLoudAt >= this.silenceNeeded()) {
      this.speaking = false;
      return 'end';
    }
    return 'none';
  }

  /** A turn was submitted, or capture was dropped: forget the run in progress
   * without forgetting what the room sounds like. */
  reset(): void {
    this.speaking = false;
    this.loudFrames = 0;
  }
}
