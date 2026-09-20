import type { PageWordOut } from '@/types/api';

/** Turning a page's word boxes into spans a browser will select cleanly.
 *
 * The naive version — one absolutely-positioned span per word, at a fixed
 * small font size — selects badly, and the reason is worth writing down. A
 * browser paints the selection over the *text's* own extent, not over the
 * box the span was given. So 8px text sitting in a 20px-tall word box paints
 * an 8px mark floating in the middle of it, and because the glyphs are far
 * narrower than the box, the marks do not reach each other. The result is a
 * row of ragged ticks instead of the continuous band every PDF viewer draws.
 *
 * Three things fix it, and all three are needed:
 *
 *   1. the span's font size and line height are the LINE's height, so the
 *      painted band is as tall as the line;
 *   2. the glyphs are stretched horizontally to exactly fill the box, so the
 *      band is as wide as the word (see `stretchFor`);
 *   3. each word's box runs to where the NEXT word starts, and carries the
 *      space between them, so consecutive bands touch instead of leaving a
 *      gap at every space.
 *
 * This is what pdf.js does, and why text in Zotero selects the way it does.
 */

/** A word, placed and sized so the browser will paint it as part of a band. */
export interface PlacedWord {
  /** What the span contains — the word, plus the space that follows it. */
  text: string;
  /** Layer pixels. `w` runs to the next word on the line, not just this one. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Set from the line, not the word: a comma and a capital letter on the
   * same line must produce the same band height. */
  fontSize: number;
}

/** The word without the hyphen the typesetter added to break it. */
function deHyphenate(text: string): string {
  return text.slice(0, -1);
}

/** Does this word end a line by being broken across one? */
function hyphenated(text: string): boolean {
  return /[-‐‑]$/.test(text);
}

/** How far apart two words can sit and still be one line.
 *
 * As a multiple of the type size, because the answer differs for a footnote
 * and a chapter heading. Wide enough to carry the gap in a running head like
 * "7.6   Additional reading"; far too narrow to reach across the gutter
 * between two columns, which is the thing that must never be joined. */
const SAME_LINE_GAP = 2.5;

/** How much two words' vertical extents must overlap to be the same line. */
const SAME_LINE_OVERLAP = 0.5;

/** Do these two words sit on the same line of the page, as a reader sees it?
 *
 * Geometry, rather than the PDF's own block and line numbering. A running
 * head is typically three separate blocks — section number, title, folio —
 * and trusting the numbering there breaks the band in the middle of a line a
 * reader sees as one. Columns are rejected by distance instead: two columns
 * at the same height are exactly the case that must not merge, and the
 * gutter between them is many times the type size. */
function sameLine(prev: PageWordOut, next: PageWordOut): boolean {
  const overlap = Math.min(prev.y + prev.h, next.y + next.h) - Math.max(prev.y, next.y);
  if (overlap < SAME_LINE_OVERLAP * Math.min(prev.h, next.h)) return false;
  // Reading order runs left to right; a word starting back at the left is the
  // next line, or the next column.
  if (next.x < prev.x) return false;
  return next.x - (prev.x + prev.w) <= SAME_LINE_GAP * Math.max(prev.h, next.h);
}

/**
 * Words in reading order become spans that tile each line.
 *
 * Line ends join with a space rather than a newline: within a paragraph a PDF
 * line break is not a break in the prose, so copying two lines should give
 * one sentence. A word broken across the line join with nothing, keeping
 * "photo-" and "mosaics" together as one word rather than two.
 */
export function placeWords(words: PageWordOut[]): PlacedWord[] {
  const out: PlacedWord[] = [];
  let i = 0;
  while (i < words.length) {
    // One line, as a reader sees it — not as the PDF numbers it.
    let end = i;
    while (end + 1 < words.length && sameLine(words[end], words[end + 1])) end += 1;

    const line = words.slice(i, end + 1);
    const top = Math.min(...line.map((w) => w.y));
    const bottom = Math.max(...line.map((w) => w.y + w.h));
    const height = Math.max(1, bottom - top);

    for (let k = 0; k < line.length; k += 1) {
      const w = line[k];
      const next = line[k + 1];
      out.push({
        // The trailing space belongs to this span, so the selection band
        // covers the gap rather than stopping at the last glyph.
        // A word left hanging on a hyphen at a line end is one the
        // typesetter cut in half, so the hyphen goes with it: "Com-" and
        // "prehensive" are one word, and "Com-prehensive" is one no
        // dictionary can find and the AI is asked to simplify without it
        // being a word. The cost is a real compound that happens to break at
        // a line end — "bottom-up" — losing its hyphen. Syllable breaks
        // vastly outnumber those, and this is what copying does in Zotero.
        text: next ? `${w.t} ` : hyphenated(w.t) ? deHyphenate(w.t) : `${w.t} `,
        x: w.x,
        y: top,
        // Up to the next word's left edge — bands that touch, not boxes that
        // merely sit near each other.
        w: Math.max(1, next ? next.x - w.x : w.w),
        h: height,
        fontSize: height,
      });
    }
    i = end + 1;
  }
  return out;
}

/**
 * How much to stretch a span horizontally so its glyphs fill its box.
 *
 * Without this the band is as wide as whatever the substitute font happened
 * to draw, which is never the width the PDF's own font occupied. Clamped
 * because a measurement of zero (a space-only span, a font that has not
 * loaded) would otherwise collapse the span to nothing or blow it up.
 */
export function stretchFor(targetWidth: number, naturalWidth: number): number {
  if (!Number.isFinite(naturalWidth) || naturalWidth <= 0) return 1;
  return Math.min(8, Math.max(0.05, targetWidth / naturalWidth));
}

/** The font the invisible layer is measured and drawn in.
 *
 * Its shapes never appear — the page image underneath has the real ones — so
 * the only thing that matters is that measuring and drawing use the same one.
 */
export const LAYER_FONT = 'sans-serif';

/** Natural text widths, measured on a canvas rather than by laying out the
 * DOM and reading it back.
 *
 * A dense page carries two or three thousand words, and asking the browser
 * for each span's width after it is placed forces a layout per word. Canvas
 * measurement costs no layout at all, and because width scales linearly with
 * font size for a given font, every string can be measured once at a
 * reference size and scaled from there — so a page of English, where a few
 * hundred words repeat, mostly hits the cache.
 */
const REFERENCE_PX = 100;

export function createMeasurer(): (text: string, fontSize: number) => number {
  const cache = new Map<string, number>();
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = `${REFERENCE_PX}px ${LAYER_FONT}`;
  } catch {
    ctx = null;
  }

  return (text: string, fontSize: number) => {
    if (!ctx) return 0; // no canvas: stretchFor falls back to 1
    let at100 = cache.get(text);
    if (at100 === undefined) {
      at100 = ctx.measureText(text).width;
      cache.set(text, at100);
    }
    return (at100 * fontSize) / REFERENCE_PX;
  };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One band per line, from the browser's box-per-word.
 *
 * Asking the browser which boxes a selection covers gives a box per word —
 * and, because a selection is painted over the height the font can reach
 * rather than the line box, two boxes for some of them, one a few pixels
 * taller than the other. Kept as they come, a highlight is dozens of
 * overlapping slabs of colour: it seams between every word and goes darker
 * wherever two of them meet.
 *
 * So the boxes on a line are gathered into one band, and neighbours on that
 * band are joined into one run. A gap wider than a space ends the run, which
 * is what keeps the two halves of a two-column page — or the two ends of a
 * running head — from being bridged by a stripe of colour across the middle
 * of the page.
 *
 * The band is the middling box of the line rather than the tallest one. The
 * tallest is the one the font could reach, which is a fifth taller than the
 * line it belongs to; a band that size runs into the line below, and a pen
 * that marks the line under the one you meant looks like a mistake.
 */
const LINE_OVERLAP = 0.5;
const JOIN_GAP = 0.6;

function middle(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function mergeRects(rects: Box[]): Box[] {
  const usable = rects.filter((r) => r.w > 0 && r.h > 0);
  if (usable.length === 0) return [];

  const lines: { top: number; bottom: number; items: Box[] }[] = [];
  for (const r of [...usable].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const bottom = r.y + r.h;
    const line = lines.find((l) => {
      const shared = Math.min(l.bottom, bottom) - Math.max(l.top, r.y);
      return shared >= LINE_OVERLAP * Math.min(l.bottom - l.top, r.h);
    });
    if (line) {
      line.top = Math.min(line.top, r.y);
      line.bottom = Math.max(line.bottom, bottom);
      line.items.push(r);
    } else {
      lines.push({ top: r.y, bottom, items: [r] });
    }
  }

  const out: Box[] = [];
  for (const line of lines) {
    // The boxes arrive in two sets of almost equal size: the line each word
    // sits on, and the taller box the font could reach. The shorter set is
    // the line, so the band is built from that one — a band built from the
    // taller set runs a fifth of a line into the line below. Every box on a
    // line comes from a span of the same size, so "shortest" means the set
    // and not some odd box.
    const h = line.items.reduce((least, r) => Math.min(least, r.h), Infinity);
    const kin = line.items.filter((r) => r.h <= h * 1.05);
    const top = middle(kin.map((r) => r.y));
    const items = line.items.sort((a, b) => a.x - b.x);
    let run: Box = { x: items[0].x, y: top, w: items[0].w, h };
    for (const r of items.slice(1)) {
      if (r.x <= run.x + run.w + JOIN_GAP * h) {
        run.w = Math.max(run.w, r.x + r.w - run.x);
      } else {
        out.push(run);
        run = { x: r.x, y: top, w: r.w, h };
      }
    }
    out.push(run);
  }
  return out;
}

/** Is this mark the thing the reader has just selected?
 *
 * Asked when they select a passage and pick "none", or press underline on
 * text that is already underlined: the marks they mean are the ones under
 * the selection. Nothing on the page knows which words a mark covers — a
 * mark is a set of boxes — so the answer is how much of the two overlap.
 *
 * The share is taken against the SMALLER of the two, which is what makes
 * both readings work: selecting the whole of a highlighted sentence matches
 * it, and so does selecting two words inside a highlight that runs for three
 * lines. Measuring against the mark alone would fail the second, which is
 * the more likely way to ask.
 */
const COVERED_SHARE = 0.3;

function boxArea(rects: Box[]): number {
  return rects.reduce((sum, r) => sum + Math.max(0, r.w) * Math.max(0, r.h), 0);
}

function shared(a: Box, b: Box): number {
  const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

export function coveredBy(mark: Box[], selection: Box[]): boolean {
  const smaller = Math.min(boxArea(mark), boxArea(selection));
  if (smaller <= 0) return false;
  let both = 0;
  for (const m of mark) for (const s of selection) both += shared(m, s);
  return both / smaller >= COVERED_SHARE;
}
