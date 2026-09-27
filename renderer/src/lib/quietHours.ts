/** Whether `now` falls inside quiet hours, given as local "HH:MM" times.
 *
 * The window usually crosses midnight (22:00–08:00), so "after the start OR
 * before the end" — not AND. The end minute itself is outside: at 08:00 the
 * quiet is over. A start equal to the end means no quiet hours at all. */
export function inQuietHours(now: Date, start: string, end: string): boolean {
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const from = minutes(start);
  const to = minutes(end);
  if (Number.isNaN(from) || Number.isNaN(to) || from === to) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return from < to ? t >= from && t < to : t >= from || t < to;
}
