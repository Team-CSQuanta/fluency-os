import type { BlockOut, HighlightOut } from '@/types/api';

const HIGHLIGHT_HEX: Record<string, string> = {
  yellow: '#E3C14A',
  green: '#7FA86B',
  blue: '#6E93C4',
  pink: '#C97BA0',
};

interface Segment {
  text: string;
  colour?: string;
}

// Sorted by created_at ascending so a later paint (a highlight created more
// recently) overwrites an earlier one at any overlapping character — "last
// created colour wins the overlap" (spec §7.2 rule 5). Segments are then
// flattened by run-length-encoding the per-character colour array, not
// merged in the data itself.
function buildSegments(text: string, highlights: HighlightOut[]): Segment[] {
  if (highlights.length === 0 || text.length === 0) return [{ text }];

  const ordered = [...highlights].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const colours: (string | undefined)[] = new Array(text.length).fill(undefined);
  for (const h of ordered) {
    const start = Math.max(0, h.start_char);
    const end = Math.min(text.length, h.end_char);
    for (let i = start; i < end; i++) colours[i] = h.colour;
  }

  const segments: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i + 1;
    while (j < text.length && colours[j] === colours[i]) j++;
    segments.push({ text: text.slice(i, j), colour: colours[i] });
    i = j;
  }
  return segments;
}

export function BlockText({
  block,
  highlights,
  selected,
  fontSize,
  textColor,
  onClick,
}: {
  block: BlockOut;
  highlights: HighlightOut[];
  selected: boolean;
  fontSize: number;
  textColor: string;
  onClick: (blockIndex: number) => void;
}) {
  const isHeading = block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3';
  const headingSize = block.kind === 'h1' ? 22 : block.kind === 'h2' ? 19 : 17;
  const segments = buildSegments(block.text, highlights);

  return (
    <div
      data-block-index={block.block_index}
      onClick={() => onClick(block.block_index)}
      className="relative mb-[18px] cursor-pointer rounded-[6px] px-3 py-2 transition-colors duration-200"
      style={{
        fontSize: isHeading ? `${headingSize}px` : `${fontSize}px`,
        fontWeight: isHeading ? 700 : 400,
        lineHeight: isHeading ? 1.35 : 1.85,
        color: textColor,
        background: selected ? 'var(--accSoft)' : 'transparent',
        borderLeft: `2px solid ${selected ? 'var(--acc)' : 'transparent'}`,
      }}
    >
      <span>
        {segments.map((seg, i) =>
          seg.colour ? (
            <span
              key={i}
              style={{
                background: `${HIGHLIGHT_HEX[seg.colour] ?? seg.colour}4d`,
                boxShadow: `inset 0 0 0 1px ${HIGHLIGHT_HEX[seg.colour] ?? seg.colour}8c`,
                borderRadius: '2px',
              }}
            >
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </span>
    </div>
  );
}
