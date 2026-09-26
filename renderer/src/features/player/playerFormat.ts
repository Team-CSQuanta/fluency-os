/** Timecode helpers shared by the player chrome. */

export function timecode(ms: number, { withMillis = false } = {}): string {
  const clamped = Math.max(0, ms);
  const total = Math.floor(clamped / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const base =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  return withMillis ? `${base}.${String(Math.floor(clamped % 1000)).padStart(3, '0')}` : base;
}

export const SPEEDS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2] as const;
