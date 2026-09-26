-- How the reader lays out a book's own printed pages, and how big.
--
-- The reader used to turn one page at a time with a previous/next pager, so
-- there was only ever one page on screen and it was always drawn at the width
-- of the text column. A reader looking at a figure could not get closer to it,
-- and a reader skimming for one had to click through a 938-page book a page at
-- a time.
--
-- Both settings live here rather than in the browser, for the same reason the
-- rest of the panel does: someone who reads a large-print book at 160% on
-- Monday should not have to set it again on Tuesday.
ALTER TABLE user_settings ADD COLUMN reader_page_scroll TEXT NOT NULL DEFAULT 'vertical';
-- A multiple of the width that fits the window, so 1.0 means "the whole page,
-- as large as it will go" on any screen — not a percentage of some fixed size
-- that would mean something different on every monitor.
ALTER TABLE user_settings ADD COLUMN reader_page_zoom REAL NOT NULL DEFAULT 1.0;
