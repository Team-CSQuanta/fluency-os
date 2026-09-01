-- Phase 2 step 5, finally landed: the Text panel stops forgetting.
--
-- Font size, page theme and the heat toggle were renderer-local useState, so
-- every reader preference reset on each book open. They belong to the reader,
-- not to a session, hence user_settings rather than localStorage — the same
-- place the rest of the app's per-user configuration already lives.
--
-- Defaults mirror the values the reader was hard-coded to, so an existing
-- install sees no visible change on upgrade.

ALTER TABLE user_settings ADD COLUMN reader_font_size REAL NOT NULL DEFAULT 15.5;
ALTER TABLE user_settings ADD COLUMN reader_page_theme TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE user_settings ADD COLUMN reader_heat_on INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_settings ADD COLUMN reader_panel_open INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_settings ADD COLUMN reader_panel_tab TEXT NOT NULL DEFAULT 'toc';
