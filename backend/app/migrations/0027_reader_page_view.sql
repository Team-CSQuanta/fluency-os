-- Whether the reader shows a PDF's own typeset page alongside the extracted
-- text. It belongs with the other reader display preferences rather than in
-- component state: the panel already remembers font size, theme and which
-- tab was open, and a reader who works from the original pages wants that
-- back on the next book, not just the next page.
--
-- Off by default. The text view is where lookup, highlighting and the
-- difficulty overlay live, so that is what a book should open in.
ALTER TABLE user_settings ADD COLUMN reader_page_view INTEGER NOT NULL DEFAULT 0;
