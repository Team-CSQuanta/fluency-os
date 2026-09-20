import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PageTextLayer } from '@/features/reader/PageTextLayer';
import { fetchBlobUrl } from '@/lib/apiClient';
import { useReaderStore } from '@/store/readerStore';
import type { PageScroll } from '@/types/api';

/** A book's printed pages, one after another.
 *
 * The reader used to show one page with a previous/next pager under it, which
 * is how a slideshow works and not how a book does: finding a figure three
 * pages on meant three round trips and three clicks, and there was no way to
 * look at a page more closely than the width of the text column allowed.
 *
 * So every page in the book has a place here from the start, and each one
 * fetches its own picture when it comes near the window and lets go of it
 * when it leaves. A 938-page book is 938 empty frames until you scroll to
 * them, which costs a few hundred kilobytes of layout and nothing else.
 */

const GAP = 18;
const PAD = 22;
/** How far outside the window a page starts loading, and keeps its picture. */
const REACH = '900px';

/** The stops the buttons and the wheel move between. Steps rather than a
 * continuous scale so that clicking + twice from a whole page lands on the
 * same size every time, and so 100% is always exactly a whole page. */
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4] as const;
const FIRST = ZOOM_STEPS[0];
const LAST = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((s) => s > zoom + 0.001) ?? LAST;
}
export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.001) ?? FIRST;
}

export function PageScroller({
  bookId,
  total,
  page,
  zoom,
  scroll,
  onPage,
  onZoom,
  tail,
}: {
  bookId: string;
  total: number;
  page: number;
  zoom: number;
  scroll: PageScroll;
  onPage: (page: number) => void;
  onZoom: (zoom: number) => void;
  tail?: ReactNode;
}) {
  // A state, not a ref: the slots need the scroll box as their observers'
  // root, and a ref would still be null on the render that creates them.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const ratio = useReaderStore((s) => s.pageRatio);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const across = scroll === 'horizontal';

  useEffect(() => {
    if (!root) return;
    const measure = () => setBox({ w: root.clientWidth, h: root.clientHeight });
    measure();
    // The arrows and Page Up/Down scroll whatever has the keyboard, and
    // nothing here has it until something is clicked. Without this the keys
    // do nothing on a freshly opened book, which reads as broken.
    root.focus({ preventScroll: true });
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [root]);

  /* What "100%" means. A whole page: as wide as the window when the pages
   * run down it, as tall as the window when they run across it. A percentage
   * of some fixed size would mean a different thing on every monitor. */
  const whole = across
    ? Math.max(120, (box.h - PAD * 2) / ratio)
    : Math.max(120, box.w - PAD * 2);
  const width = Math.round(whole * zoom);

  /* Which page the reader is on, and which page they asked for, are the same
   * number arriving from two directions. This holds the last value that
   * passed through, so scrolling does not fight a jump from the contents. */
  const settled = useRef(page);
  /* Until the book has been opened AT the page it was left on, nothing the
   * pages say about where the reader is can be believed. The list starts at
   * the top, so the first page would otherwise announce itself as where the
   * reader is — and that announcement is written down as their place. */
  const placed = useRef(false);
  /* Scrolling the reader somewhere is not the reader scrolling. Moving to a
   * page makes the pages either side of it cross the middle of the window on
   * the way past, and each of those crossings looks exactly like the reader
   * having gone there. */
  const quietUntil = useRef(0);

  const reachFor = useCallback(
    (target: number) => {
      const slot = root?.querySelector(`[data-page-slot="${target}"]`);
      if (!slot) return;
      quietUntil.current = performance.now() + 500;
      slot.scrollIntoView({ block: 'start', inline: 'start' });
    },
    [root],
  );

  /* Open the book where it was left.
   *
   * Once the width is known, and not before: the pages are laid out against
   * it, so scrolling to page 400 while every page is still 120px tall lands
   * somewhere around page 40 once they are their real size. */
  useEffect(() => {
    if (placed.current || !root || total <= 0 || box.w === 0) return;
    settled.current = page;
    reachFor(page);
    placed.current = true;
  }, [root, total, box.w, page, reachFor]);

  useEffect(() => {
    if (!placed.current || !root || page === settled.current) return;
    settled.current = page;
    reachFor(page);
  }, [page, root, reachFor]);

  const onVisible = useCallback(
    (n: number) => {
      if (!placed.current || performance.now() < quietUntil.current) return;
      if (settled.current === n) return;
      settled.current = n;
      onPage(n);
    },
    [onPage],
  );

  // Zooming should leave you looking at the page you were looking at.
  const lastZoom = useRef(zoom);
  useEffect(() => {
    if (!root || lastZoom.current === zoom) return;
    lastZoom.current = zoom;
    reachFor(settled.current);
  }, [zoom, root, reachFor]);

  /* The wheel, bound by hand because React's is passive and a passive
   * listener may not call preventDefault — without which ctrl+wheel zooms the
   * whole application instead of the page. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        onZoom(e.deltaY < 0 ? zoomIn(zoomRef.current) : zoomOut(zoomRef.current));
        return;
      }
      // A mouse with one wheel still has to be able to move along a row of
      // pages, so a plain wheel scrolls the way the pages run.
      if (across && !e.shiftKey && e.deltaX === 0 && e.deltaY !== 0) {
        e.preventDefault();
        root.scrollLeft += e.deltaY;
      }
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [root, across, onZoom]);

  const pages = Array.from({ length: Math.max(total, 0) }, (_, i) => i + 1);

  return (
    <div
      ref={setRoot}
      // Focusable so the arrow keys and Page Up/Down scroll it, which is what
      // they do in every other document, now that they no longer turn pages.
      tabIndex={0}
      className={`min-h-0 flex-1 overflow-auto outline-none ${
        across ? 'flex flex-row items-start' : 'block'
      }`}
      style={{ padding: PAD, gap: across ? GAP : undefined }}
    >
      {pages.map((n) => (
        <PageSlot
          key={n}
          bookId={bookId}
          page={n}
          width={width}
          ratio={ratio}
          root={root}
          across={across}
          onVisible={onVisible}
        />
      ))}
      {tail}
    </div>
  );
}

function PageSlot({
  bookId,
  page,
  width,
  ratio,
  root,
  across,
  onVisible,
}: {
  bookId: string;
  page: number;
  width: number;
  ratio: number;
  root: HTMLDivElement | null;
  across: boolean;
  onVisible: (page: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const loadPageLayer = useReaderStore((s) => s.loadPageLayer);
  const setPageRatio = useReaderStore((s) => s.setPageRatio);
  const [near, setNear] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Near the window: worth drawing.
  useEffect(() => {
    const el = ref.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root,
      rootMargin: across ? `0px ${REACH}` : `${REACH} 0px`,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root, across]);

  /* Across the middle of the window: this is the page being read. A band
   * rather than a count of pixels, so exactly one page can claim it however
   * many are on screen at once.
   *
   * Checked again against where things are NOW, because a jump of three
   * hundred pages drags every page in between across the middle on the way,
   * and each of those crossings arrives here looking exactly like the reader
   * having stopped there. Without the second look, which page gets written
   * down as their place comes down to the order of a batch of callbacks. */
  useEffect(() => {
    const el = ref.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        const mine = el.getBoundingClientRect();
        const box = root.getBoundingClientRect();
        const middle = across ? box.left + box.width / 2 : box.top + box.height / 2;
        const holds = across
          ? mine.left <= middle && mine.right >= middle
          : mine.top <= middle && mine.bottom >= middle;
        if (holds) onVisible(page);
      },
      { root, rootMargin: across ? '0px -49.5%' : '-49.5% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [root, across, onVisible, page]);

  useEffect(() => {
    if (!near) {
      setSrc(null);
      return;
    }
    let made: string | null = null;
    let cancelled = false;
    setFailed(false);
    void fetchBlobUrl(`/books/${bookId}/page/${page}/image`)
      .then((url) => {
        made = url;
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    void loadPageLayer(page);
    return () => {
      cancelled = true;
      // Object URLs live until revoked by hand. Scrolling a long book
      // without this keeps every page the reader has passed.
      if (made) URL.revokeObjectURL(made);
    };
  }, [near, bookId, page, loadPageLayer]);

  return (
    <div
      ref={ref}
      data-page-slot={page}
      className={across ? 'flex-none' : 'mx-auto'}
      style={{ width, marginBottom: across ? undefined : GAP }}
    >
      {src ? (
        <PageTextLayer page={page} src={src} onSized={setPageRatio} />
      ) : (
        <div
          className="grid place-items-center rounded-[4px] border border-line2"
          style={{ height: Math.round(width * ratio), background: 'var(--panel)' }}
        >
          <span className="font-mono text-[10px] text-tx3">
            {failed ? `page ${page} couldn't be drawn` : `page ${page}`}
          </span>
        </div>
      )}
      <div className="pt-[5px] text-center font-mono text-[9.5px] text-tx3">{page}</div>
    </div>
  );
}
