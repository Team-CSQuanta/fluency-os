// Maps a DOM Selection to one { blockIndex, startChar, endChar, quotedText }
// per paragraph it covers — spec §7.2. Uses a TreeWalker to sum text-node
// lengths up to the selection boundary, which gives the right absolute
// character offset regardless of whether the block renders as one text node or
// several highlight segments, so no data-char-start bookkeeping is needed on
// the segments themselves.

export interface BlockSelectionRange {
  blockIndex: number;
  startChar: number;
  endChar: number;
  quotedText: string;
}

function closestBlockEl(node: Node): HTMLElement | null {
  let el: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el instanceof HTMLElement && !el.hasAttribute('data-block-index')) {
    el = el.parentElement;
  }
  return el instanceof HTMLElement ? el : null;
}

function charOffsetWithin(root: HTMLElement, target: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === target) return total + targetOffset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return total;
}

/** Every paragraph the selection touches, in reading order, each clipped to
 * the part of itself that is actually selected.
 *
 * A highlight is stored against one block, so a selection spanning three
 * paragraphs becomes three highlights rather than being refused. It used to be
 * refused — silently, by returning null — and dragging across a paragraph
 * break simply did nothing, which reads as a broken feature rather than as a
 * limit. Sentences run across paragraph breaks often enough that this was the
 * case people hit first.
 *
 * Returns an empty array for a collapsed or non-text selection. */
export function getBlockSelectionRanges(): BlockSelectionRange[] {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return [];
  if (!sel.toString().trim()) return [];

  const range = sel.getRangeAt(0);
  const startBlock = closestBlockEl(range.startContainer);
  const endBlock = closestBlockEl(range.endContainer);
  if (!startBlock || !endBlock) return [];

  // querySelectorAll is in document order, which for the reader is reading
  // order, so the highlights come back in the order they were dragged over.
  const covered = Array.from(document.querySelectorAll<HTMLElement>('[data-block-index]')).filter(
    (el) => el === startBlock || el === endBlock || range.intersectsNode(el),
  );

  const out: BlockSelectionRange[] = [];
  for (const el of covered) {
    const blockIndex = Number(el.getAttribute('data-block-index'));
    if (Number.isNaN(blockIndex)) continue;

    const text = el.textContent ?? '';
    // A block in the middle of the selection is covered end to end; only the
    // first and last are clipped, and either may be both.
    const startChar = el.contains(range.startContainer)
      ? charOffsetWithin(el, range.startContainer, range.startOffset)
      : 0;
    const endChar = el.contains(range.endContainer)
      ? charOffsetWithin(el, range.endContainer, range.endOffset)
      : text.length;
    if (endChar <= startChar) continue;

    const quotedText = text.slice(startChar, endChar);
    if (!quotedText.trim()) continue;
    out.push({ blockIndex, startChar, endChar, quotedText });
  }
  return out;
}
