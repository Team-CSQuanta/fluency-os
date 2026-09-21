// The scenarios the conversation picker offers: label, key and rough length.

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
