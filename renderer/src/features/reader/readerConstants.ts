// Design constants, not sample data — these are the four highlight colours and
// the four leveling modes the reader is actually built around, so they outlived
// the deleted reader sample-data module (spec §6.3).
import type { LevelMode } from '@/types/api';

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#E3C14A',
  green: '#7FA86B',
  blue: '#6E93C4',
  pink: '#C97BA0',
};

export const LEVEL_MODES: Array<{ key: LevelMode; label: string; tag: string }> = [
  { key: 'inline', label: 'Inline simplification', tag: 'light' },
  { key: 'lexical', label: 'Lexical substitution', tag: 'idioms' },
  { key: 'contextual', label: 'Contextual rewrite', tag: 'needs model' },
  { key: 'semantic', label: 'Semantic filter', tag: 'needs model' },
];

/** The two modes that run with no model installed (backend RULES_MODES). */
export const OFFLINE_MODES: LevelMode[] = ['inline', 'lexical'];

export const MODE_LABELS: Record<LevelMode, string> = {
  inline: 'Inline simplification',
  lexical: 'Lexical substitution',
  contextual: 'Contextual rewrite',
  semantic: 'Semantic filter',
};
