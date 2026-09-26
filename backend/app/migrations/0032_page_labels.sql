-- Plainer words, pinned over the page where the hard ones are.
--
-- The reader selects a sentence on a rendered page and asks for it in simpler
-- language; the result is drawn over the original, in its place. This is the
-- one thing a paper book cannot do, and it is the reason a learner reads a
-- difficult text at all rather than an easy one.
--
-- Stored, rather than regenerated on every page turn, for two reasons. A
-- generation costs a real model call, and — more importantly — a label is a
-- mark the reader made. Losing it on a page turn would make the feature feel
-- like a preview rather than something that stays where it was put.
--
-- The simplification cache (leveling.cache) is a different thing and is not a
-- substitute: it remembers what a passage simplifies TO, keyed on the text.
-- This remembers that this reader asked for this passage, on this page, at
-- this position.
CREATE TABLE IF NOT EXISTS book_page_labels (
  id            TEXT PRIMARY KEY,
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page          INTEGER NOT NULL,
  -- The area the original words occupy, as JSON [{x, y, w, h}] in the page
  -- text layer's coordinates — the same shape page highlights use.
  rects         TEXT NOT NULL,
  -- Both halves are kept. The original is what makes the label reversible:
  -- covering text with a rewrite and having no way back to what was actually
  -- printed would be a poor thing to do to someone reading a source.
  original_text TEXT NOT NULL,
  simple_text   TEXT NOT NULL,
  -- Which simplification was asked for, so a label can say how it was made
  -- rather than presenting a rules-based substitution as the model's work.
  mode          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_label_book ON book_page_labels(book_id, page);
