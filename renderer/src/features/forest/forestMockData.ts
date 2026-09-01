// Ported from claude-ui-mockup-files/FluencyOS.html's isForest section — no
// embedding-space projection exists yet (spec §8), so tile growth stages are
// generated from the same seeded LCG the mockup uses, keyed by biome, rather
// than a real 2D projection of each word's vector.

export interface Biome {
  key: string;
  n: string;
  c: string;
}

export const BIOME_DATA: Biome[] = [
  { key: 'meadow', n: 'Meadow', c: '188' },
  { key: 'cinema', n: 'Cinema Clearing', c: '412' },
  { key: 'library', n: 'Library Grove', c: '596' },
  { key: 'exam', n: 'Exam Highlands', c: '341' },
  { key: 'business', n: 'Business Gardens', c: '164' },
  { key: 'river', n: 'Conversation Riverbank', c: '146' },
];

export const DEFAULT_BIOME = 'cinema';

export const FOREST_WORDS = [
  'reticent', 'stark', 'mitigate', 'ostensibly', 'throttle', 'brackish', 'headway', 'contingent',
  'obfuscate', 'candid', 'wary', 'guarded', 'veiled', 'opaque', 'terse', 'curt', 'blunt', 'frank',
  'evasive', 'coy',
];

export const STAGE_CANOPY = [7, 10, 14, 19, 25, 32];
export const STAGE_STEM = [0, 5, 9, 15, 21, 28];
export const STAGE_COLOR_DAY = ['#8a8f8a', '#6f9a6a', '#5e9a5e', '#4c8f57', '#3f8352', '#357a4c'];
export const STAGE_COLOR_NIGHT = ['#4a4f4b', '#5e7a5e', '#6f9a6a', '#79ad74', '#86c07f', '#9ad48f'];

export const GROWTH_STAGES = [
  { n: 'Seed', dot: 7, count: '96' },
  { n: 'Sprout', dot: 9, count: '141' },
  { n: 'Seedling', dot: 12, count: '88' },
  { n: 'Sapling', dot: 15, count: '54' },
  { n: 'Young tree', dot: 19, count: '26' },
  { n: 'Ancient tree', dot: 23, count: '7' },
];

export const FOCUS_DURATIONS = ['15', '25', '45', '60'];
export const DEFAULT_FOCUS_DURATION = '25';

export const WEEKLY_CHALLENGE = {
  label: 'Use 20 target words spontaneously',
  done: 13,
  target: 20,
  xp: 200,
};

export const FOREST_LEVEL = { level: 14, xp: 18240, nextXp: 29300, sunlight: 640, streakFreezes: 2 };

// The mockup's exact LCG: x = (x*1103515245+12345) & 0x7fffffff; return (x>>>8)/8388608.
export function makeRng(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return (x >>> 8) / 8388608;
  };
}

export interface ForestTile {
  x: number;
  y: number;
  checker: boolean;
  stage: number;
  dormant: boolean;
  word: string;
  health: number;
  stability: number;
  spontaneousUses: number;
}

export function buildTiles(biomeKey: string): ForestTile[] {
  const rf = makeRng(biomeKey.length * 977 + 3);
  const tiles: ForestTile[] = [];
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const v = rf();
      const dist = Math.abs(i - 4) + Math.abs(j - 4);
      const stage = v < 0.16 ? 0 : dist <= 3 ? Math.min(5, 1 + Math.floor(v * 5)) : Math.max(0, Math.floor(v * 3));
      const dormant = v > 0.955;
      const word = FOREST_WORDS[(i * 9 + j) % FOREST_WORDS.length];
      tiles.push({
        x: j * 60,
        y: i * 60,
        checker: (i + j) % 2 === 1,
        stage,
        dormant,
        word,
        health: dormant ? 0 : 60 + Math.round(v * 40),
        stability: Math.round(3 + v * 190),
        spontaneousUses: stage >= 3 ? Math.max(1, stage - 2) : 0,
      });
    }
  }
  return tiles;
}
