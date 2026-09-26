-- A profile picture, copied into the data folder. A path rather than bytes,
-- so the database stays small enough to copy.
ALTER TABLE users ADD COLUMN avatar_path TEXT;
