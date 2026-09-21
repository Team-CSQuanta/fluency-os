import type { ChapterOut } from '@/types/api';

export interface TocRow {
  chapter: ChapterOut;
  /** Whether anything nests under this entry, i.e. whether it opens at all. */
  hasChildren: boolean;
  /** Outermost-first is not needed; membership is all this is asked for. */
  ancestors: string[];
}

/* The list arrives flat with only a depth per entry: an entry owns
 * everything after it that is deeper, up to the next entry at its own level.
 * Depths are taken as they come — scanned books jump levels, and a row must
 * never end up unreachable. */
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
