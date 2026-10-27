-- Sequence counters.
--
-- Several modules mint a human-facing reference that counts up: a
-- member number, a receipt number, a minute reference. Reading the
-- highest and adding one is a race that two concurrent requests both
-- win, and the duplicate only shows up later as two members with the
-- same number and no way to tell which record is which.
--
-- One row per counter, incremented in a single statement. See
-- nextInSequence in src/lib/db.
CREATE TABLE counter (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
