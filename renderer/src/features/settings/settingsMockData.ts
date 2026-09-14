// Ported from claude-ui-mockup-files/FluencyOS.html's isSettings section
// (setDefs). Most groups have no backend yet (spec §9-11), so their values
// are static mock data — Account and Appearance are filled from real state
// in Settings.tsx since a real user profile and theme already exist.

export interface SettingField {
  n: string;
  sub: string;
  v: string;
}

export interface SettingGroup {
  sub: string;
  fields: SettingField[];
}

export const SETTINGS_GROUP_ORDER = [
  'Account',
  'Learning',
  'AI',
  'Speech',
  'Media',
  'Appearance',
  'Data',
  'Privacy',
] as const;

export type SettingsGroupName = (typeof SETTINGS_GROUP_ORDER)[number];

export const SETTINGS_GROUPS: Record<SettingsGroupName, SettingGroup> = {
  Account: {
    sub: 'Profile, language and data folder',
    fields: [
      { n: 'Display name', sub: 'local only', v: '—' },
      { n: 'Native language', sub: 'glosses and dual subs', v: '—' },
      { n: 'CEFR estimate', sub: 'recalculated weekly', v: '—' },
      { n: 'Data folder', sub: '18.4 GB used', v: '~/FluencyOS' },
    ],
  },
  Learning: {
    sub: 'Queue shape, retention and card types',
    fields: [
      { n: 'Target retention', sub: 'FSRS v4 · higher means more reviews', v: '0.90' },
      { n: 'New cards per day', sub: 'load smoothing on', v: '15' },
      { n: 'Card types enabled', sub: 'interleaved in the queue', v: 'all 4' },
      { n: 'Leech threshold', sub: 'lapses before rework', v: '8' },
      { n: 'Load smoothing', sub: 'levels the 30-day forecast', v: 'on' },
    ],
  },
  AI: {
    // Rendered by ModelsPanel.tsx instead of this generic field list — real
    // download status/selection from the backend, not mock data. `fields`
    // stays empty since it's unused for this group.
    sub: 'Local models — pick one, download it, then start a conversation',
    fields: [],
  },
  Speech: {
    sub: 'Input, VAD, voice and rate',
    fields: [
      { n: 'Input device', sub: 'system default', v: 'MacBook Mic' },
      { n: 'VAD sensitivity', sub: 'segments your speech', v: 'medium' },
      { n: 'STT model', sub: 'faster-whisper CTranslate2', v: 'small.en' },
      { n: 'TTS voice', sub: 'Kokoro ONNX', v: 'af_heart' },
      { n: 'Speaking rate', sub: '', v: '1.0×' },
    ],
  },
  // Rendered by MediaSettingsPanel against the real clip engine, so the
  // fields here are unused — only `sub` is still read, for the group heading.
  Media: {
    sub: 'Clip extraction and storage',
    fields: [],
  },
  Appearance: {
    sub: 'Theme, subtitle and reader defaults',
    fields: [
      { n: 'Theme', sub: '', v: 'dark' },
      { n: 'Reader theme', sub: '', v: 'sepia' },
      { n: 'Text scale', sub: 'accessibility', v: '100%' },
    ],
  },
  Data: {
    sub: 'Backup, restore and export',
    fields: [
      { n: 'Backup now', sub: 'ZIP: SQLite + manifest + clips', v: 'run' },
      { n: 'Automatic backups', sub: 'rolling window of 4', v: 'weekly' },
      { n: 'Export', sub: 'never locked in', v: 'CSV · APKG' },
      { n: 'Restore', sub: 'validates schema version', v: 'choose file' },
      { n: 'Wipe', sub: 'irreversible', v: '—' },
    ],
  },
  Privacy: {
    sub: 'What stays on this machine',
    fields: [
      { n: 'Telemetry', sub: 'permanently off, not a toggle', v: 'off' },
      { n: 'Outbound requests', sub: 'model download, or a dictionary search you explicitly run', v: 'only when you ask' },
      { n: 'Voice recordings', sub: 'never uploaded', v: 'local' },
      { n: 'Leaderboards', sub: 'opt-in, code-shared group', v: 'off' },
      { n: 'Clip redistribution', sub: 'from your own files only', v: 'never' },
    ],
  },
};
