// Ported from claude-ui-mockup-files/FluencyOS.html's isChallenge section — no
// STT/scoring pipeline exists yet (spec §7), so the recorded clip, transcript
// coverage, and scores below are static mock data for a completed attempt.

export type ChallengeType = 'Describe' | 'Predict' | 'Roleplay' | 'Interrogate' | 'Reword';

export const CHALLENGE_TYPES: ChallengeType[] = ['Describe', 'Predict', 'Roleplay', 'Interrogate', 'Reword'];

export type ChallengePhase = 'idle' | 'recording' | 'scored';

export const CHALLENGE_PROMPTS: Record<ChallengePhase, string> = {
  idle: 'Describe what happened in 30–60 seconds. Use as many target words as you can.',
  recording: 'listening · faster-whisper streaming partials',
  scored: 'scored against a reference description + your target coverage',
};

export type TargetTag = 'spontaneous' | 'prompted' | 'avoided';

export const CHALLENGE_TARGETS: Array<{ w: string; tag: TargetTag }> = [
  { w: 'reticent', tag: 'spontaneous' },
  { w: 'stark', tag: 'spontaneous' },
  { w: 'throttle', tag: 'prompted' },
  { w: 'brackish', tag: 'avoided' },
];

export interface ChallengeScore {
  n: string;
  v: string;
  pct: number;
}

export const CHALLENGE_SCORES: ChallengeScore[] = [
  { n: 'target coverage', v: '3 / 4', pct: 75 },
  { n: 'semantic overlap', v: '0.79', pct: 79 },
  { n: 'grammatical precision', v: '88', pct: 88 },
  { n: 'speaking duration', v: '41 s', pct: 68 },
];

export const CHALLENGE_OVERALL_SCORE = 82;
export const CHALLENGE_PERSONAL_BESTS: Record<ChallengeType, number> = {
  Describe: 78,
  Predict: 71,
  Roleplay: 66,
  Interrogate: 58,
  Reword: 84,
};
