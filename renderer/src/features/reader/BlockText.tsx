import type { BlockOut, HeatSpanOut, HighlightOut } from '@/types/api';

const HIGHLIGHT_HEX: Record<string, string> = {
  yellow: '#E3C14A',
  green: '#7FA86B',
  blue: '#6E93C4',
  pink: '#C97BA0',
};

interface Segment {
  text: string;
  colour?: string;
  /** Above the reader's CEFR level — tinted by the difficulty heat overlay. */
  heat?: HeatSpanOut;
}

// Sorted by created_at ascending so a later paint (a highlight created more
// recently) overwrites an earlier one at any overlapping character — "last
// created colour wins the overlap" (spec §7.2 rule 5). Segments are then
// flattened by run-length-encoding the per-character colour array, not
// merged in the data itself.
function buildSegments(
  text: string,
  highlights: HighlightOut[],
  heatSpans: HeatSpanOut[],
): Segment[] {
  if ((highlights.length === 0 && heatSpans.length === 0) || text.length === 0) return [{ text }];

  const ordered = [...highlights].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const colours: (string | undefined)[] = new Array(text.length).fill(undefined);
  for (const h of ordered) {
    const start = Math.max(0, h.start_char);
    const end = Math.min(text.length, h.end_char);
    for (let i = start; i < end; i++) colours[i] = h.colour;
  }

  // Heat is painted into a parallel array rather than the colour array: a
  // word can be both highlighted and above-level, and the two must not
  // overwrite each other.
  const heat: (HeatSpanOut | undefined)[] = new Array(text.length).fill(undefined);
  for (const span of heatSpans) {
    const start = Math.max(0, span.start_char);
    const end = Math.min(text.length, span.end_char);
    for (let i = start; i < end; i++) heat[i] = span;
  }

  const segments: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i + 1;
    while (j < text.length && colours[j] === colours[i] && heat[j] === heat[i]) j++;
    segments.push({ text: text.slice(i, j), colour: colours[i], heat: heat[i] });
    i = j;
  }
  return segments;
}

export function BlockText({
  block,
  highlights,
  heatSpans = [],
  selected,
  fontSize,
  textColor,
  onClick,
  onWordClick,
}: {
  block: BlockOut;
  highlights: HighlightOut[];
  heatSpans?: HeatSpanOut[];
  selected: boolean;
  fontSize: number;
  textColor: string;
  onClick: (blockIndex: number) => void;
  onWordClick?: (word: string, sentence: string, blockIndex: number) => void;
}) {
  const isHeading = block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3';
  const headingSize = block.kind === 'h1' ? 22 : block.kind === 'h2' ? 19 : 17;
  /* Set apart rather than hidden.
   *
   * `caption` is what a PDF's footnotes come through as. On paper the eye
   * skips them because they are small and ruled off from the body; flattened
   * into the same paragraph stream at the same size they read as part of the
   * sentence they interrupt, which is the whole problem. Smaller, indented
   * behind a rule and dimmed, they go back to being skippable — and are still
   * there, still searchable, still clickable for a lookup. */
  const isNote = block.kind === 'caption';
  /* A row of a table, rebuilt by the parser. Monospaced so the columns of
   * successive rows line up, which is most of what a table was doing. */
  const isRow = block.kind === 'list';
  const segments = buildSegments(block.text, highlights, heatSpans);

  return (
    <div
      data-block-index={block.block_index}
      onClick={() => onClick(block.block_index)}
      className={`relative cursor-pointer rounded-[6px] px-3 transition-colors duration-200 ${
        isRow ? 'mb-0 py-[3px] font-mono' : 'mb-[18px] py-2'
      }`}
      style={{
        fontSize: isHeading
          ? `${headingSize}px`
          : isNote || isRow
            ? `${Math.max(11, fontSize - 3)}px`
            : `${fontSize}px`,
        fontWeight: isHeading ? 700 : 400,
        lineHeight: isHeading ? 1.35 : isNote || isRow ? 1.6 : 1.85,
        color: textColor,
        opacity: isNote ? 0.72 : 1,
        marginLeft: isNote ? '14px' : undefined,
        background: selected ? 'var(--accSoft)' : 'transparent',
        borderLeft: selected
          ? '2px solid var(--acc)'
          : isNote
            ? '2px solid var(--line2)'
            : '2px solid transparent',
      }}
    >
      <span>
        {segments.map((seg, i) => {
          // A heat span is a whole word, so it doubles as the click target
          // for the AI panel's lookup — no extra tokenising in the DOM.
          const heatStyle = seg.heat
            ? {
                borderBottom: '1.5px solid var(--acc)',
                background: 'rgba(var(--accRGB),.09)',
                cursor: 'help' as const,
              }
            : undefined;

          const style = {
            ...(seg.colour
              ? {
                  background: `${HIGHLIGHT_HEX[seg.colour] ?? seg.colour}4d`,
                  boxShadow: `inset 0 0 0 1px ${HIGHLIGHT_HEX[seg.colour] ?? seg.colour}8c`,
                  borderRadius: '2px',
                }
              : {}),
            ...(heatStyle ?? {}),
          };

          if (!seg.colour && !seg.heat) return <span key={i}>{seg.text}</span>;

          return (
            <span
              key={i}
              style={style}
              title={
                seg.heat
                  ? `${seg.heat.cefr}${seg.heat.simpler ? ` · simpler: ${seg.heat.simpler}` : ''}`
                  : undefined
              }
              onClick={
                seg.heat && onWordClick
                  ? (e) => {
                      e.stopPropagation();
                      onWordClick(seg.heat!.word, block.text, block.block_index);
                    }
                  : undefined
              }
            >
              {seg.text}
            </span>
          );
        })}
      </span>
    </div>
  );
}
