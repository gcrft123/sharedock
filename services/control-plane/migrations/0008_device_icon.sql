-- A host picks an icon on its name+icon screen; persist it on the device row so the chosen
-- glyph shows wherever the host appears (the owner's dashboard, onboarding host cards).
-- SQLite/D1 `ALTER TABLE ADD COLUMN` is a cheap metadata-only change.
ALTER TABLE devices ADD COLUMN icon TEXT;
