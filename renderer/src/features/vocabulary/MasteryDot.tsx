/** Mastery as five filled segments.
 *
 * A number ("L3") means nothing on first sight; a bar you can compare across
 * rows at a glance does. Colour carries the same information as length so it
 * survives being small, and the title spells it out for anyone who needs the
 * exact value.
 *
 * The gap after segment 2 is deliberate and is the whole point: levels 3-5
 * are unreachable through flashcards alone (spec §6.3), so the bar shows
 * where recognition stops and production begins.
 */
const LEVEL_COLOR = ['var(--line)', '#c0563f', '#d9a441', '#5b8dd9', '#3f9d5c', '#3f9d5c'];

export function MasteryDot({ level, label }: { level: number; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-[3px]"
      title={`L${level} · ${label}${level <= 2 ? ' — flashcards alone stop at L2' : ''}`}
    >
      {[1, 2, 3, 4, 5].map((seg) => (
        <span
          key={seg}
          className="h-[4px] rounded-full"
          style={{
            width: seg === 3 ? '7px' : '5px',
            marginLeft: seg === 3 ? '2px' : undefined,
            background: seg <= level ? LEVEL_COLOR[level] : 'var(--line2)',
          }}
        />
      ))}
    </span>
  );
}

/** "due now", "in 3 d", "—". The list is mostly a question of what needs
 * attention, and a raw ISO timestamp answers that for nobody. */
export function dueLabel(due: string | null, state: string | null): string {
  if (state === 'new' || !due) return 'new';
  const ms = new Date(due).getTime() - Date.now();
  if (Number.isNaN(ms)) return '—';
  if (ms <= 0) return 'due now';
  const days = ms / 86400000;
  if (days < 1) return `in ${Math.max(1, Math.round(ms / 3600000))} h`;
  if (days < 30) return `in ${Math.round(days)} d`;
  if (days < 365) return `in ${(days / 30).toFixed(1)} mo`;
  return `in ${(days / 365).toFixed(1)} y`;
}
