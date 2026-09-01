-- Phase 5 — PDF and MOBI.
--
-- EPUB/TXT are reflowable and have no real pages, so their "page N / M" is
-- derived from cumulative word counts (275 words per page, see
-- services/pagination.py). A PDF genuinely does have pages, and throwing
-- them away in favour of a word-count estimate would make the reader
-- disagree with the page numbers printed in the document itself.
--
-- So blocks may now carry the page they came from, and a book records
-- whether its pages are authoritative. NULL page_number + uses_native_pages
-- = 0 is exactly the existing behaviour, which is why both columns are
-- nullable/defaulted rather than backfilled.

ALTER TABLE book_blocks ADD COLUMN page_number INTEGER;

ALTER TABLE books ADD COLUMN uses_native_pages INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_blocks_page ON book_blocks(book_id, page_number);
