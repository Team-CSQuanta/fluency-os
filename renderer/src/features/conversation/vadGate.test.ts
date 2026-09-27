import { describe, expect, it } from 'vitest';
import {
  BARGE_IN_FRAMES,
  BARGE_IN_GRACE_MS,
  FRAME_MS,
  HESITATION_SILENCE_MS,
  MIN_FLOOR_FRAMES,
  SILENCE_MS,
  SpeechGate,
  type GateEvent,
  type ListeningProfile,
} from '@/features/conversation/vadGate';

const QUIET = 0.004;
const VOICE = 0.08;

/** Feeds frames 50ms apart and records every event the gate reports. */
function run(gate: SpeechGate, frames: Array<{ rms: number; aiSpeaking?: boolean }>, startAt = 0) {
  const events: Array<{ at: number; event: GateEvent }> = [];
  frames.forEach((f, i) => {
    const at = startAt + i * FRAME_MS;
    const event = gate.observe({ rms: f.rms, now: at, aiSpeaking: f.aiSpeaking ?? false });
    if (event !== 'none' && event !== 'calibrating') events.push({ at, event });
  });
  return { events, endsAt: startAt + frames.length * FRAME_MS };
}

const repeat = (n: number, rms: number, aiSpeaking = false) => Array.from({ length: n }, () => ({ rms, aiSpeaking }));

/** A gate that has measured a quiet room for one second. */
function calibrated(profile?: ListeningProfile) {
  const gate = new SpeechGate(profile);
  const { endsAt } = run(gate, repeat(20, QUIET));
  return { gate, now: endsAt };
}

describe('SpeechGate — hands-free turn detection', () => {
  it('makes no judgement while it is still measuring the room', () => {
    const gate = new SpeechGate();
    const results = repeat(MIN_FLOOR_FRAMES - 1, VOICE).map((f, i) =>
      gate.observe({ rms: f.rms, now: i * FRAME_MS, aiSpeaking: false }),
    );
    expect(results.every((r) => r === 'calibrating')).toBe(true);
  });

  it('takes the quietest calibration frame as the floor, so talking during calibration cannot deafen it', () => {
    const gate = new SpeechGate();
    run(gate, [...repeat(5, VOICE), ...repeat(15, QUIET)]);
    expect(gate.floor).toBeLessThan(0.01);
  });

  it('starts a turn after two loud frames in a row', () => {
    const { gate, now } = calibrated();
    const { events } = run(gate, repeat(2, VOICE), now);
    expect(events).toEqual([{ at: now + FRAME_MS, event: 'start' }]);
    expect(gate.speaking).toBe(true);
  });

  it('ignores a single loud frame, like a keyboard click', () => {
    const { gate, now } = calibrated();
    const { events } = run(gate, [{ rms: VOICE }, ...repeat(10, QUIET)], now);
    expect(events).toEqual([]);
  });

  it('ends a long turn after one second of silence', () => {
    const { gate, now } = calibrated();
    // 2 seconds of speech, then silence.
    const { events } = run(gate, [...repeat(40, VOICE), ...repeat(40, QUIET)], now);
    const start = events.find((e) => e.event === 'start')!;
    const end = events.find((e) => e.event === 'end')!;
    const lastLoud = now + 39 * FRAME_MS;
    expect(start).toBeDefined();
    expect(end.at - lastLoud).toBe(SILENCE_MS);
  });

  it('waits longer after only a word or two, because that pause is usually hesitation', () => {
    const { gate, now } = calibrated();
    // Half a second of speech: "I think…"
    const { events } = run(gate, [...repeat(10, VOICE), ...repeat(50, QUIET)], now);
    const end = events.find((e) => e.event === 'end')!;
    const lastLoud = now + 9 * FRAME_MS;
    expect(end.at - lastLoud).toBe(HESITATION_SILENCE_MS);
  });

  it('honours the "quick" and "patient" turn pace settings', () => {
    const pauseFor = (pace: ListeningProfile['pace']) => {
      const { gate, now } = calibrated({ sensitivity: 'balanced', pace });
      const { events } = run(gate, [...repeat(40, VOICE), ...repeat(60, QUIET)], now);
      return events.find((e) => e.event === 'end')!.at - (now + 39 * FRAME_MS);
    };
    expect(pauseFor('quick')).toBeLessThan(pauseFor('natural'));
    expect(pauseFor('patient')).toBeGreaterThan(pauseFor('natural'));
  });

  it("does not let the AI's own opening syllable count as the learner interrupting", () => {
    const { gate, now } = calibrated();
    // Loud from the moment the reply starts, but only for the grace period.
    const graceFrames = BARGE_IN_GRACE_MS / FRAME_MS - 1;
    const { events } = run(gate, repeat(graceFrames, 0.2, true), now);
    expect(events).toEqual([]);
  });

  it('needs a third of a second of sustained sound to interrupt the AI', () => {
    const { gate, now } = calibrated();
    const settle = BARGE_IN_GRACE_MS / FRAME_MS;
    // Let the grace period pass quietly, then a burst one frame too short…
    run(gate, repeat(settle, QUIET, true), now);
    const short = run(gate, repeat(BARGE_IN_FRAMES - 1, 0.2, true), now + settle * FRAME_MS);
    expect(short.events).toEqual([]);
    // …and one that lasts long enough.
    run(gate, repeat(3, QUIET, true), short.endsAt);
    const long = run(gate, repeat(BARGE_IN_FRAMES, 0.2, true), short.endsAt + 3 * FRAME_MS);
    expect(long.events.map((e) => e.event)).toEqual(['start']);
  });

  it('asks for a louder voice when set to "robust" than when set to "sensitive"', () => {
    const sensitive = calibrated({ sensitivity: 'sensitive', pace: 'natural' }).gate;
    const robust = calibrated({ sensitivity: 'robust', pace: 'natural' }).gate;
    expect(robust.threshold(false)).toBeGreaterThan(sensitive.threshold(false));
    expect(robust.threshold(true)).toBeGreaterThan(sensitive.threshold(true));
  });

  it('keeps what it learned about the room across a reset', () => {
    const { gate } = calibrated();
    const floor = gate.floor;
    gate.reset();
    expect(gate.speaking).toBe(false);
    expect(gate.floor).toBe(floor);
  });
});
