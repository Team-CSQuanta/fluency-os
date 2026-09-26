-- Highlights made on the page as printed.
--
-- The existing book_highlights table anchors a highlight to a block of
-- extracted text and a character range within it. That is the right anchor
-- for reflowable text, where there is no page and the same paragraph lands
-- in a different place at every font size.
--
-- It is the wrong anchor for a highlight drawn on a rendered PDF page. There
-- the reader is marking ink at a position, across a region that may cover
-- several lines and need not correspond to any block the extractor found —
-- and often does not, because the extractor drops figure captions, equations
-- and marginalia that a reader still wants to mark.
--
-- The two are kept apart rather than forced together. Making block_index
-- nullable would mean a table where half the columns are meaningless for
-- half the rows, and mapping a page selection back onto block offsets means
-- aligning two different text streams — which fails silently and exactly on
-- the pages where the extractor already struggled.
CREATE TABLE IF NOT EXISTS book_page_highlights (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page        INTEGER NOT NULL,
  -- The boxes to paint, as JSON [{x, y, w, h}] in the text layer's own
  -- coordinates — the rendered image's pixels. Stored rather than recomputed
  -- because re-deriving them needs the PDF, and a highlight should survive
  -- the file being moved.
  rects       TEXT NOT NULL,
  colour      TEXT NOT NULL,
  -- Filled behind the words, or a line under them. Both are ways of marking
  -- a passage and readers use them to mean different things.
  style       TEXT NOT NULL DEFAULT 'highlight'
              CHECK (style IN ('highlight', 'underline')),
  -- What it says, so the highlights list can show the passage without
  -- re-rendering the page it came from.
  quoted_text TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_hl_book ON book_page_highlights(book_id, page);

-- The eight colours the toolbar offers. The original four were a CHECK
-- constraint on the older table; this one stays open deliberately, because a
-- colour is a label the reader assigns meaning to and the set will grow.
