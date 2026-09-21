import type { ChapterOut } from '@/types/api';

export interface TocRow {
  chapter: ChapterOut;
  /** Whether anything nests under this entry, i.e. whether it opens at all. */
  hasChildren: boolean;
  /** Outermost-first is not needed; membership is all this is asked for. */
  ancestors: string[];
}

/* The chapter list arrives flat, with nothing but a depth on each entry, so
 * the nesting has to be read back out of it: an entry owns everything that
 * follows it at a greater depth, up to the next entry at its own level or
 * shallower. Each row carries its ancestors, which is what decides whether
 * it is currently visible.
 *
 * Depths are taken as they come rather than assumed to step by one. A book
 * whose contents jump from a chapter straight to a depth-3 heading, or that
 * starts at a depth other than zero, still nests correctly — malformed
 * outlines are common in scanned books and must not drop rows. */
export function buildTocRows(toc: readonly ChapterOut[]): TocRow[] {
  return toc.map((chapter, i) => {
    const ancestors: string[] = [];
    let depth = chapter.depth;
    for (let j = i - 1; j >= 0 && depth > 0; j--) {
      if (toc[j].depth < depth) {
        ancestors.push(toc[j].id);
        depth = toc[j].depth;
      }
    }
    return {
      chapter,
      hasChildren: (toc[i + 1]?.depth ?? chapter.depth) > chapter.depth,
      ancestors,
    };
  });
}

/** A row is on screen only while every chapter above it is open. */
export function isTocRowVisible(row: TocRow, open: ReadonlySet<string>): boolean {
  return row.ancestors.every((id) => open.has(id));
}
