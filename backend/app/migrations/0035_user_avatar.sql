-- A profile picture, copied into the data folder.
--
-- Stored as a path rather than as bytes in the row: the picture sits beside
-- the rest of the reader's data, where they can see it and delete it, and the
-- database stays small enough to copy.
ALTER TABLE users ADD COLUMN avatar_path TEXT;
