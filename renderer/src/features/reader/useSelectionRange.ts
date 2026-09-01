// Maps a DOM Selection to { blockIndex, startChar, endChar, quotedText } —
// spec §7.2. Uses a TreeWalker to sum text-node lengths up to the selection
// boundary, which gives the right absolute character offset regardless of
// whether the block renders as one text node or several highlight segments,
// so no data-char-start bookkeeping is needed on the segments themselves.

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

/** Returns null for a collapsed/empty selection, or one that spans more
 * than one block — v1 clamps to single-block selections only (spec §7.2). */
export function getBlockSelectionRange(): BlockSelectionRange | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const quotedText = sel.toString();
  if (!quotedText.trim()) return null;

  const range = sel.getRangeAt(0);
  const anchorBlockEl = closestBlockEl(range.startContainer);
  const focusBlockEl = closestBlockEl(range.endContainer);
  if (!anchorBlockEl || !focusBlockEl || anchorBlockEl !== focusBlockEl) return null;

  const blockIndex = Number(anchorBlockEl.getAttribute('data-block-index'));
  if (Number.isNaN(blockIndex)) return null;

  const a = charOffsetWithin(anchorBlockEl, range.startContainer, range.startOffset);
  const b = charOffsetWithin(anchorBlockEl, range.endContainer, range.endOffset);
  const startChar = Math.min(a, b);
  const endChar = Math.max(a, b);
  if (endChar <= startChar) return null;

  return { blockIndex, startChar, endChar, quotedText };
}
