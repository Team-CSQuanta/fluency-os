import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HIGHLIGHT_COLOURS,
  NO_COLOUR,
  PageSelectionToolbar,
} from '@/features/reader/PageSelectionToolbar';
import { matchingWordIndices } from '@/features/reader/pageFind';
import { sentenceAround, wordAt } from '@/features/reader/pageSentence';
import {
  coveredBy,
  createMeasurer,
  mergeRects,
  placeWords,
  stretchFor,
} from '@/features/reader/pageTextGeometry';
import { reportError } from '@/store/errorStore';
import { useReaderStore } from '@/store/readerStore';
import type {
  HighlightRect,
  HighlightStyle,
  PageHighlightOut,
  PageLabelOut,
  PageWordHeatOut,
} from '@/types/api';

/** The page as printed, with its words made selectable.
 *
 * A transparent span is laid over every word, sized to the box the PDF says
 * the ink occupies, so the browser's own selection works on the picture as
 * it does on prose. Coordinates arrive in the image's pixels and are drawn
 * as percentages, so the layer follows the page at any width.
 */
/** Stable empty list: a new [] from the selector would re-render forever. */
const NO_LABELS: PageLabelOut[] = [];

export function PageTextLayer({
  page,
  src,
  onSized,
}: {
  page: number;
  src: string;
  /** The shape of the page, as soon as the picture says what it is. Every
   * page not yet drawn holds its place at this shape. */
  onSized?: (ratio: number) => void;
}) {
  const layer = useReaderStore((s) => s.layers[page] ?? null);
  const allMarks = useReaderStore((s) => s.allPageHighlights);
  // This page's marks, out of the book's. Memoised because a fresh array
  // every render would redraw every mark on every keystroke elsewhere.
  const highlights = useMemo(() => allMarks.filter((h) => h.page === page), [allMarks, page]);
  const loadPageLayer = useReaderStore((s) => s.loadPageLayer);
  const addPageHighlight = useReaderStore((s) => s.addPageHighlight);
  const removePageHighlight = useReaderStore((s) => s.removePageHighlight);
  const recolour = useReaderStore((s) => s.recolourPageHighlight);
  const lookupWord = useReaderStore((s) => s.lookupWord);
  const labels = useReaderStore((s) => s.labelsByPage[page] ?? NO_LABELS);
  const simplifySelection = useReaderStore((s) => s.simplifySelection);
  const removePageLabel = useReaderStore((s) => s.removePageLabel);
  const setPrefs = useReaderStore((s) => s.setPrefs);
  const setPageSelection = useReaderStore((s) => s.setPageSelection);
  const find = useReaderStore((s) => s.find);
  const heat = useReaderStore((s) => s.pageHeat[page] ?? null);
  const heatOn = useReaderStore((s) => s.prefs.heat_on);
  const heatEnabled = useReaderStore((s) => s.heatEnabled);

  const hostRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{
    rects: HighlightRect[];
    text: string;
    anchor: { x: number; y: number };
  } | null>(null);
  const [openMark, setOpenMark] = useState<PageHighlightOut | null>(null);
  const [simplifying, setSimplifying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // `layer` is in the dependencies so that a page whose words were let go of
  // — only the pages near the one being read keep theirs — asks for them
  // again if it is still on screen. The store ignores a page that has them.
  useEffect(() => {
    void loadPageLayer(page);
  }, [page, layer, loadPageLayer]);

  /** How big the page is being drawn, against its own pixels. The layer is
   * laid out in page pixels and scaled by this, so one number keeps the whole
   * layer aligned at any window width. */
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !layer) return;
    const measureBox = () => setScale(host.clientWidth / layer.width);
    measureBox();
    const observer = new ResizeObserver(measureBox);
    observer.observe(host);
    return () => observer.disconnect();
  }, [layer]);

  // Both are pure functions of the page, and rebuilding two thousand spans'
  // worth of geometry on every selection would make dragging stutter.
  const placed = useMemo(() => (layer ? placeWords(layer.words) : []), [layer]);

  /* Which boxes are above the reader's level. The server judges the page's
   * own boxes and names them by index, so nothing is matched by spelling. */
  /* Every page on screen lights up its matches, not just the one jumped
   * to: the match you want is as often the next one down. */
  const findHits = useMemo(
    () => (layer && find ? matchingWordIndices(layer.words, find.terms) : []),
    [layer, find],
  );
  const showHeat = heatOn && heatEnabled && (heat?.enabled ?? false);
  const hotWords = useMemo(() => {
    if (!showHeat || !heat) return new Map<number, PageWordHeatOut>();
    return new Map(heat.words.map((w) => [w.i, w]));
  }, [showHeat, heat]);
  const measure = useMemo(() => createMeasurer(), []);

  /** What the reader has dragged across, in the layer's own coordinates.
   *
   * Client rects rather than the words themselves: the browser has already
   * worked out which glyphs are inside the selection, including the partial
   * first and last ones, and re-deriving that from the word boxes would get
   * a different answer at every edge. */
  const readSelection = useCallback(() => {
    const host = hostRef.current;
    const sel = window.getSelection();
    if (!host || !layer || !sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return null;
    const text = sel.toString().trim();
    if (!text) return null;

    const box = host.getBoundingClientRect();
    const scale = layer.width / box.width;
    const boxes = Array.from(range.getClientRects())
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({
        x: (r.left - box.left) * scale,
        y: (r.top - box.top) * scale,
        w: r.width * scale,
        h: r.height * scale,
      }));
    // A box per word, sometimes two — merged into one band per line, or a
    // highlight made from them is dozens of overlapping slabs.
    const rects = mergeRects(boxes);
    if (rects.length === 0) return null;

    // From the unmerged boxes: the last of those is where the drag ended,
    // where the hand already is. The last band is a whole line, whose middle
    // could be anywhere.
    const last = boxes[boxes.length - 1];
    return {
      rects,
      text,
      // Under the end of the selection, where the hand already is.
      anchor: { x: (last.x + last.w / 2) / layer.width, y: (last.y + last.h) / layer.height },
    };
  }, [layer]);

  /** The mark under a point on the page, in the layer's own coordinates. */
  const markAt = useCallback(
    (clientX: number, clientY: number) => {
      const host = hostRef.current;
      if (!host || !layer) return null;
      const box = host.getBoundingClientRect();
      const scale = layer.width / box.width;
      const x = (clientX - box.left) * scale;
      const y = (clientY - box.top) * scale;
      return (
        highlights.find((h) =>
          h.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h),
        ) ?? null
      );
    },
    [layer, highlights],
  );

  /* Published from one place rather than at each of the five points the
   * selection changes, so clearing it cannot be forgotten. */
  useEffect(() => {
    setPageSelection(selection?.text ?? null);
  }, [selection, setPageSelection]);

  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      // A click on the toolbar is not a new selection.
      if (e.target instanceof Element && e.target.closest('[data-page-toolbar]')) return;
      // Let the browser settle the selection first.
      requestAnimationFrame(() => {
        const dragged = readSelection();
        setSelection(dragged);
        if (dragged) return;
        /* A click, not a drag. Marks are painted under the invisible words,
         * so a click on one never reaches it — it is answered here instead. */
        setOpenMark(markAt(e.clientX, e.clientY));
      });
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, [readSelection, markAt]);

  // A new page is a new set of words; anything anchored to the old one is
  // pointing at nothing.
  useEffect(() => {
    setSelection(null);
    setOpenMark(null);
    setNote(null);
  }, [page]);

  /** The marks the current selection is asking about — see `coveredBy`. */
  const underSelection = useMemo(
    () => (selection ? highlights.filter((h) => coveredBy(h.rects, selection.rects)) : []),
    [selection, highlights],
  );

  /* Make, change or remove a mark on the selected words. A colour replaces
   * whatever was there rather than stacking a second mark on it; "none"
   * clears them; underline toggles. */
  const mark = async (colour: string, style: HighlightStyle) => {
    const current = selection;
    if (!current) return;
    const here = underSelection;
    setSelection(null);
    window.getSelection()?.removeAllRanges();

    const drop = async (marks: PageHighlightOut[]) => {
      await Promise.all(marks.map((h) => removePageHighlight(h.id)));
    };

    try {
      if (colour === NO_COLOUR) {
        await drop(here);
        return;
      }
      if (style === 'underline') {
        const already = here.filter((h) => h.style === 'underline');
        if (already.length > 0) {
          await drop(already);
          return;
        }
      } else {
        await drop(here.filter((h) => h.style === 'highlight'));
      }

      await addPageHighlight({
        page,
        rects: current.rects,
        colour,
        style,
        quotedText: current.text,
      });
    } catch (err) {
      // The mark has already come off the page under the cursor that asked
      // — the store puts it back — so this must say so rather than leave the
      // reader thinking it went and finding it again tomorrow.
      reportError(err, colour === NO_COLOUR ? 'Removing that mark' : 'Marking that passage');
    }
  };

  /** The plainer version, pinned where the original words are. */
  const simplify = async () => {
    const current = selection;
    if (!current || simplifying) return;
    setSimplifying(true);
    setNote(null);
    try {
      const said = await simplifySelection({ page, rects: current.rects, text: current.text });
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      if (said) setNote(said);
    } catch (err) {
      // With the retry, starting the AI from the dialog finishes the job the
      // reader asked for instead of returning them to the page to do it again.
      reportError(err, 'Putting this in simpler words', () => void simplify());
    } finally {
      setSimplifying(false);
    }
  };

  const look = () => {
    const current = selection;
    if (!current) return;
    setSelection(null);
    // Open the panel on the dictionary tab — the answer arrives where the
    // reader's lookups already live rather than in a second kind of popup.
    setPrefs({ panel_open: true, panel_tab: 'study' });
    /* The word goes off with the sentence it sits in: that is what the AI
     * explains and what the vocabulary entry keeps. */
    const word = current.text.split(/\s+/)[0];
    let sentence = current.text;
    if (layer && current.rects.length > 0) {
      const first = current.rects[0];
      const at = wordAt(layer.words, first.x + 1, first.y + first.h / 2);
      if (at >= 0) sentence = sentenceAround(layer.words, at) || current.text;
    }
    void lookupWord(word, sentence, undefined, page);
  };

  return (
    <div
      className="relative w-full select-text"
      ref={hostRef}
      // A container query unit lets a label's type scale with the page at any
      // width, which a px size cannot: the same page is drawn at 500px in a
      // narrow window and 1000px in a wide one.
      style={{ containerType: 'inline-size' }}
    >
      <img
        src={src}
        alt={`Page ${page} as printed`}
        className="pointer-events-none block w-full rounded-[4px] border border-line2"
        style={{ background: '#fff' }}
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0) onSized?.(img.naturalHeight / img.naturalWidth);
        }}
      />

      {/* Behind the words, so the ink stays readable through the colour. */}
      {highlights.map((h) => (
        <MarkRects key={h.id} mark={h} layer={layer} onOpen={() => setOpenMark(h)} />
      ))}

      {/* The difficulty tint, under the words and the marks: it must never
          compete with a highlight the reader put there themselves. */}
      {layer && showHeat && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
          {[...hotWords.keys()].map((i) => {
            const w = layer.words[i];
            if (!w) return null;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${(w.x / layer.width) * 100}%`,
                  top: `${(w.y / layer.height) * 100}%`,
                  width: `${(w.w / layer.width) * 100}%`,
                  height: `${(w.h / layer.height) * 100}%`,
                  background: 'rgba(var(--accRGB),.10)',
                  borderBottom: '1.5px solid var(--acc)',
                  borderRadius: '1px',
                }}
              />
            );
          })}
        </div>
      )}

      {/* Search matches, above the reader's own marks: this is temporary and
          theirs is not. */}
      {layer && findHits.length > 0 && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
          {findHits.map((i) => {
            const w = layer.words[i];
            if (!w) return null;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${(w.x / layer.width) * 100}%`,
                  top: `${(w.y / layer.height) * 100}%`,
                  width: `${(w.w / layer.width) * 100}%`,
                  height: `${(w.h / layer.height) * 100}%`,
                  background: 'rgba(255,145,0,.34)',
                  boxShadow: 'inset 0 0 0 1.5px rgba(214,120,0,.95)',
                  borderRadius: '2px',
                }}
              />
            );
          })}
        </div>
      )}

      {/* The selectable layer, drawn in the page's OWN pixels and then
          scaled to whatever width the page is displayed at. Working in the
          page's coordinates means font sizes are real sizes — which is what
          makes a selection band as tall as its line. */}
      {layer && scale > 0 && (
        <div
          className="fos-text-layer"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: layer.width,
            height: layer.height,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {placed.map((w, i) => {
            const hot = hotWords.get(i);
            return (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: w.x,
                top: w.y,
                // The font size IS the line height, and the line box is one
                // em tall. That is what makes the painted band the height of
                // the line — `height` on an inline span would do nothing.
                fontSize: w.fontSize,
                lineHeight: 1,
                // Stretched to fill its box, so the band is as wide as the
                // word it covers rather than as wide as a substitute font
                // happened to draw it.
                transform: `scaleX(${stretchFor(w.w, measure(w.text, w.fontSize))})`,
                transformOrigin: '0 0',
                whiteSpace: 'pre',
                color: 'transparent',
                cursor: hot ? 'help' : 'text',
                userSelect: 'text',
              }}
              title={
                hot
                  ? `${hot.word} · ${hot.cefr}${hot.simpler ? ` · simpler: ${hot.simpler}` : ''}`
                  : undefined
              }
            >
              {w.text}
            </span>
            );
          })}
        </div>
      )}

      {selection && (
        <PageSelectionToolbar
          at={selection.anchor}
          marksHere={underSelection.length}
          underlined={underSelection.some((h) => h.style === 'underline')}
          onPick={(colour, style) => void mark(colour, style)}
          onLookUp={look}
          onCopy={() => void navigator.clipboard.writeText(selection.text)}
          onSimplify={() => void simplify()}
          simplifying={simplifying}
        />
      )}

      {/* Plainer words, over the words they replace. */}
      {layer &&
        labels.map((l) => (
          <SimplerWords key={l.id} label={l} layer={layer} onRemove={() => void removePageLabel(l.id)} />
        ))}

      {/* When the engine had something to say — no model configured, or it
          ran a simpler mode than the one asked for — it says it once, here,
          rather than silently doing something other than what was asked. */}
      {note && (
        <div className="absolute inset-x-0 bottom-[8px] mx-auto w-fit max-w-[80%] rounded-field border border-line2 bg-panel px-[11px] py-[7px] shadow-panel">
          <span className="font-sans text-[11px] leading-[1.5] text-tx2">{note}</span>
          <button onClick={() => setNote(null)} className="ml-[10px] font-mono text-[10px] text-tx3 hover:text-acc">
            ok
          </button>
        </div>
      )}

      {openMark && layer && (
        <MarkMenu
          mark={openMark}
          layer={layer}
          onRecolour={(colour) => {
            void recolour(openMark.id, colour).catch((err) =>
              reportError(err, 'Changing that mark'),
            );
            setOpenMark(null);
          }}
          onRemove={() => {
            void removePageHighlight(openMark.id).catch((err) =>
              reportError(err, 'Removing that mark'),
            );
            setOpenMark(null);
          }}
          onClose={() => setOpenMark(null)}
        />
      )}
    </div>
  );
}

function MarkRects({
  mark,
  layer,
  onOpen,
}: {
  mark: PageHighlightOut;
  layer: { width: number; height: number } | null;
  onOpen: () => void;
}) {
  if (!layer) return null;
  const colour = HIGHLIGHT_COLOURS.find((c) => c.key === mark.colour)?.value ?? '#ffd84d';
  const highlight = mark.style === 'highlight';
  return (
    // The blending belongs to the MARK, not to each piece of it. Multiply
    // keeps the print legible through the colour, but done piece by piece it
    // also multiplies the pieces with each other, so every place two of them
    // touched came out darker — a grid of deeper patches over the words.
    // Grouped, the pieces cover each other first and the pen colour is laid
    // on the page once.
    <div
      className="pointer-events-none absolute inset-0"
      style={{ mixBlendMode: highlight ? 'multiply' : 'normal' }}
    >
      {mark.rects.map((r, i) => (
        <button
          key={i}
          onClick={onOpen}
          title={`“${mark.quoted_text.slice(0, 80)}” — click to change or remove`}
          style={{
            position: 'absolute',
            left: `${(r.x / layer.width) * 100}%`,
            top: `${(r.y / layer.height) * 100}%`,
            width: `${(r.w / layer.width) * 100}%`,
            height: `${(r.h / layer.height) * 100}%`,
            background: highlight ? colour : 'transparent',
            borderBottom: highlight ? undefined : `2px solid ${colour}`,
            cursor: 'pointer',
            pointerEvents: 'auto',
          }}
        />
      ))}
    </div>
  );
}

/** What to do with a mark already on the page. */
function MarkMenu({
  mark,
  layer,
  onRecolour,
  onRemove,
  onClose,
}: {
  mark: PageHighlightOut;
  layer: { width: number; height: number };
  onRecolour: (colour: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const first = mark.rects[0];
  return (
    <>
      <div className="fixed inset-0 z-[40]" onClick={onClose} role="presentation" />
      <div
        data-page-toolbar
        className="absolute z-[41] flex items-center gap-[6px] rounded-panel border border-line2 bg-panel px-[8px] py-[6px] shadow-panel"
        style={{
          left: `${(first.x / layer.width) * 100}%`,
          top: `${((first.y + first.h) / layer.height) * 100}%`,
          transform: 'translateY(6px)',
        }}
      >
        {HIGHLIGHT_COLOURS.map((c) => (
          <button
            key={c.key}
            title={c.key}
            onClick={() => onRecolour(c.key)}
            className="h-[15px] w-[15px] rounded-[4px] border"
            style={{ background: c.value, borderColor: c.key === mark.colour ? 'var(--tx2)' : 'var(--line2)' }}
          />
        ))}
        <span className="mx-[2px] h-[15px] w-px bg-line2" />
        <button onClick={onRemove} className="font-mono text-[10px] text-[#c0563f] hover:underline">
          remove
        </button>
      </div>
    </>
  );
}

/** A passage of the page, replaced in place by plainer words.
 *
 * Drawn over the original with the page's colour behind it, sized from the
 * original's line height, and free to grow downward since plainer words run
 * longer. The original is one click away and never thrown away.
 */
function SimplerWords({
  label,
  layer,
  onRemove,
}: {
  label: PageLabelOut;
  layer: { width: number; height: number };
  onRemove: () => void;
}) {
  const [showingOriginal, setShowingOriginal] = useState(false);

  const left = Math.min(...label.rects.map((r) => r.x));
  const right = Math.max(...label.rects.map((r) => r.x + r.w));
  const top = Math.min(...label.rects.map((r) => r.y));
  const bottom = Math.max(...label.rects.map((r) => r.y + r.h));
  // The tallest line in the selection is a good proxy for the type size.
  const lineHeight = Math.max(...label.rects.map((r) => r.h));

  return (
    <div
      className="absolute"
      style={{
        left: `${(left / layer.width) * 100}%`,
        top: `${(top / layer.height) * 100}%`,
        width: `${((right - left) / layer.width) * 100}%`,
        minHeight: `${((bottom - top) / layer.height) * 100}%`,
        // Above the marks and the picture, below the toolbar.
        zIndex: 20,
      }}
    >
      <div
        className="rounded-[3px] border-l-[3px] px-[4px] py-[1px]"
        style={{
          background: '#fff',
          borderLeftColor: 'var(--acc)',
          boxShadow: '0 1px 4px rgba(0,0,0,.14)',
          // Matched to the type it covers rather than fixed, using the
          // rendered page's own scale.
          fontSize: `${(lineHeight / layer.width) * 100 * 0.62}cqw`,
          lineHeight: 1.28,
          color: '#171a19',
        }}
      >
        <span className="font-sans">{showingOriginal ? label.original_text : label.simple_text}</span>
        <span className="ml-[6px] whitespace-nowrap">
          <button
            onClick={() => setShowingOriginal((v) => !v)}
            title={showingOriginal ? 'back to the simpler words' : 'show what was actually printed'}
            className="font-mono text-[0.72em] text-[#6f51a6] hover:underline"
          >
            {showingOriginal ? 'simpler' : 'original'}
          </button>
          <button
            onClick={onRemove}
            title="remove this and leave the page as printed"
            className="ml-[6px] font-mono text-[0.72em] text-[#9a6b6b] hover:underline"
          >
            ✕
          </button>
        </span>
      </div>
    </div>
  );
}
