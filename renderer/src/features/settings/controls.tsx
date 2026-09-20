import type { ReactNode } from 'react';

/** The settings page's vocabulary of controls.
 *
 * The page used to render every setting the same way: a label and a rounded
 * box with a value in it. That box looked like a control and was not one, so
 * a page of forty settings offered four things you could actually change and
 * gave no sign which four. These are the real ones, plus one — `Pill` — for
 * the genuinely read-only, drawn flat so it cannot be mistaken for a switch.
 */

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-[18px] first:mt-0">
      <h3 className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-tx3">{title}</h3>
      {note && <p className="mt-[5px] font-sans text-[11.5px] leading-[1.6] text-tx3">{note}</p>}
      <div className="mt-[8px] overflow-hidden rounded-panel border border-line2 bg-panel">{children}</div>
    </section>
  );
}

export function Row({
  label,
  sub,
  control,
  stacked,
}: {
  label: string;
  sub?: ReactNode;
  control?: ReactNode;
  /** Put the control on its own line — for sliders and anything else that
   * needs the full width to be usable. */
  stacked?: boolean;
}) {
  return (
    <div className="border-b border-line2 px-4 py-[13px] last:border-b-0">
      <div className={stacked ? '' : 'flex items-center justify-between gap-5'}>
        <div className="min-w-0">
          <div className="font-sans text-[12.5px] font-medium text-tx">{label}</div>
          {sub && <div className="mt-[3px] font-sans text-[11px] leading-[1.55] text-tx3">{sub}</div>}
        </div>
        {control && <div className={stacked ? 'mt-[10px]' : 'flex-none'}>{control}</div>}
      </div>
    </div>
  );
}

/** Read-only, and drawn to look it: no border, no fill, nothing to press. */
export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ok' | 'warn' }) {
  const colour = tone === 'ok' ? 'var(--acc)' : tone === 'warn' ? '#e0a76c' : 'var(--tx3)';
  return (
    <span className="font-mono text-[10.5px] font-medium" style={{ color: colour }}>
      {children}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-[20px] w-[34px] flex-none rounded-full border transition-colors duration-150 disabled:opacity-40"
      style={{
        borderColor: checked ? 'var(--accLine)' : 'var(--line)',
        background: checked ? 'var(--accSoft)' : 'transparent',
      }}
    >
      <span
        className="absolute top-[3px] h-[12px] w-[12px] rounded-full transition-all duration-150"
        style={{ left: checked ? 18 : 4, background: checked ? 'var(--acc)' : 'var(--tx3)' }}
      />
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-none gap-[4px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            title={o.title}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className="rounded-field border px-[9px] py-[5px] font-mono text-[10.5px] font-medium transition-colors disabled:opacity-40"
            style={{
              borderColor: on ? 'var(--accLine)' : 'var(--line2)',
              background: on ? 'var(--accSoft)' : 'transparent',
              color: on ? 'var(--acc)' : 'var(--tx2)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A slider that commits on release.
 *
 * `onInput` would fire a write per pixel dragged. The value shown follows the
 * thumb; only letting go saves. */
export function Slider({
  value,
  min,
  max,
  step,
  onCommit,
  format,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (next: number) => void;
  format: (v: number) => string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-[11px]">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        key={value}
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="fos-slider flex-1 cursor-pointer"
      />
      <span className="w-[54px] flex-none text-right font-mono text-[10.5px] tabular-nums text-tx2">
        {format(value)}
      </span>
    </div>
  );
}

/** For the things this page reports but does not own — the model, the voice,
 * the clip engine. Sends you to the screen that does own them. */
export function GoTo({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="font-mono text-[10.5px] text-acc hover:underline">
      {children}
    </button>
  );
}
