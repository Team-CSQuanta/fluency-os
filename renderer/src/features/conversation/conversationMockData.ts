// Scenario config for the Conversation feature. Session history, live
// transcripts, and reports are all real now (conversationStore.ts, backed by
// a local LLM/STT/TTS pipeline) — this file only keeps the scenario picker's
// labels/keys/estimated-length, which is legitimately static configuration,
// not mock data standing in for something unbuilt.

import type { ScenarioKey } from '@/types/api';

export interface ConvScenario {
  key: ScenarioKey;
  n: string;
  k: string;
}

export const CONV_SCENARIOS: ConvScenario[] = [
  { key: 'free', n: 'Free talk', k: '~10 m' },
  { key: 'coffee', n: 'Order coffee', k: '~3 m' },
  { key: 'job', n: 'Job interview', k: '~8 m' },
  { key: 'debate', n: 'Debate a topic', k: '~12 m' },
];
