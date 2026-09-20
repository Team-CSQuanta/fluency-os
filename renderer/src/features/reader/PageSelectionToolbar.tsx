import type { HighlightStyle } from '@/types/api';

/** The colours a passage can be marked in.
 *
 * Eight, because a colour on a page is a label the reader assigns their own
 * meaning to — a claim, a source, a word to look up, a thing to argue with —
 * and four is not enough to keep those apart in a book you are working
 * through. Chosen at a lightness that stays legible with black text through
 * `mix-blend-mode: multiply`, which is how they are painted.
 */
export const HIGHLIGHT_COLOURS = [
  { key: 'yellow', value: '#ffe066' },
  { key: 'red', value: '#ff9a9a' },
  { key: 'green', value: '#9ee3a8' },
  { key: 'blue', value: '#8fd0f5' },
  { key: 'purple', value: '#c3aef2' },
  { key: 'pink', value: '#f5a8d8' },
  { key: 'orange', value: '#ffc078' },
  { key: 'grey', value: '#cfd4d3' },
] as const;

/** Not a colour: the swatch that takes the marks off these words again. */
export const NO_COLOUR = 'none';

/** The little window that arrives under a selection on the page.
 *
 * It follows the selection rather than living in the side panel, because the
 * hand is already there and the decision being made — mark this, look this
 * up — is about the words under the cursor. This is the one interaction that
 * makes a page feel like a document rather than a picture of one.
 */
export function PageSelectionToolbar({
  at,
  marksHere,
  underlined,
  onPick,
  onLookUp,
  onCopy,
  onSimplify,
  simplifying,
}: {
  /** Where the selection ended, as a fraction of the page. */
  at: { x: number; y: number };
  /** How many marks these words already carry — what "none" would remove. */
  marksHere: number;
  /** Whether they are already underlined, which makes the button a toggle. */
  underlined: boolean;
  onPick: (colour: string, style: HighlightStyle) => void;
  onLookUp: () => void;
  onCopy: () => void;
  /** Put this passage in plainer words, over the words themselves. */
  onSimplify: () => void;
  simplifying: boolean;
}) {
  return (
    <div
      data-page-toolbar
      className="absolute z-[42] rounded-panel border border-line2 bg-panel px-[9px] py-[7px] shadow-panel"
      style={{
        left: `${at.x * 100}%`,
        top: `${at.y * 100}%`,
        // Centred under the end of the selection, and nudged clear of it.
        transform: 'translate(-50%, 8px)',
      }}
      // The toolbar must not take the selection away from the page while it
      // is being clicked, or there would be nothing left to act on.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-[5px]">
        {HIGHLIGHT_COLOURS.map((c) => (
          <button
            key={c.key}
            title={`Highlight in ${c.key}`}
            aria-label={`Highlight in ${c.key}`}
            onClick={() => onPick(c.key, 'highlight')}
            className="h-[17px] w-[17px] rounded-[4px] border border-line2 transition-transform hover:scale-110"
            style={{ background: c.value }}
          />
        ))}
        {/* Last in the row, where a "no colour" swatch sits in every other
            program that has one. Dimmed rather than hidden when there is
            nothing to take off, so the way to undo a mark is visible before
            you need it rather than appearing only once you do. */}
        <button
          title={
            marksHere > 0
              ? 'Take the marks off these words'
              : 'Nothing is marked here — select words you have marked to remove them'
          }
          aria-label="Remove the marks on this text"
          onClick={() => onPick(NO_COLOUR, 'highlight')}
          disabled={marksHere === 0}
          className="grid h-[17px] w-[17px] place-items-center rounded-[4px] border border-line2 transition-transform hover:scale-110 disabled:cursor-default disabled:opacity-35 disabled:hover:scale-100"
        >
          <svg viewBox="0 0 16 16" className="h-[13px] w-[13px]" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="8" cy="8" r="5.5" className="text-tx3" />
            <path d="M4.2 11.8L11.8 4.2" className="text-tx3" />
          </svg>
        </button>
      </div>

      <div className="mt-[6px] flex items-center gap-[5px] border-t border-line2 pt-[6px]">
        {/* Underline is the same eight colours in a different shape, so it
            takes whatever colour was last obvious: yellow reads oddly as a
            rule, so underline defaults to the strongest of the set. Pressed
            again on text that already carries one, it takes it off — the
            button shows which of the two it is about to do. */}
        <ToolButton
          label={underlined ? 'Remove the underline' : 'Underline'}
          onClick={() => onPick('blue', 'underline')}
          accent={underlined}
        >
          <span
            className="border-b-2 px-[2px] font-sans text-[12px] font-semibold"
            style={{ borderColor: 'var(--acc)', color: underlined ? 'var(--acc)' : 'var(--tx)' }}
          >
            A
          </span>
        </ToolButton>
        <ToolButton label="Look this up" onClick={onLookUp}>
          <span className="font-mono text-[10px] text-tx2">look up</span>
        </ToolButton>
        <ToolButton label="Copy" onClick={onCopy}>
          <span className="font-mono text-[10px] text-tx2">copy</span>
        </ToolButton>
        {/* The one thing a paper book cannot do: the same sentence, in words
            you already know, in the place the hard one was. */}
        <ToolButton
          label="Ask the AI for this in simpler words, over the original"
          onClick={onSimplify}
          accent
        >
          <span className="font-mono text-[10px]">{simplifying ? 'writing…' : 'simpler'}</span>
        </ToolButton>
      </div>
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  children,
  accent,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid h-[22px] min-w-[26px] place-items-center rounded-field border px-[7px] hover:border-acc"
      style={{
        borderColor: accent ? 'var(--accLine)' : 'var(--line2)',
        background: accent ? 'var(--accSoft)' : 'transparent',
        color: accent ? 'var(--acc)' : 'var(--tx2)',
      }}
    >
      {children}
    </button>
  );
}
