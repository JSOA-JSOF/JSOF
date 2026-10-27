-- The Secretary's module: meetings, agendas, minutes, and the
-- compliance calendar.
--
-- The minute book is the record that outlives everyone involved, so
-- this schema is stricter than the rest. A minute entry can be edited
-- while it is a draft and not afterwards, and that is enforced by a
-- trigger rather than by the screen declining to show a button.

CREATE TABLE meeting (
  id                TEXT PRIMARY KEY,
  entity            TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  title             TEXT NOT NULL,
  scheduled_start   TEXT NOT NULL,
  scheduled_minutes INTEGER NOT NULL,
  location          TEXT NOT NULL DEFAULT '',
  -- Sessions are numbered within an entity and a year. Two entities
  -- that share a board still keep separate minute books.
  session           INTEGER NOT NULL,
  status            TEXT NOT NULL,
  quorum            INTEGER NOT NULL,
  agenda_adopted_at TEXT,
  notice_sent_at    TEXT
);
CREATE INDEX meeting_when ON meeting(entity, scheduled_start);

CREATE TABLE meeting_attendee (
  meeting_id   TEXT NOT NULL REFERENCES meeting(id),
  person_id    TEXT NOT NULL,
  -- Copied, not joined. Who attended under what title is a fact about
  -- that day, and an officer who later changes role must not silently
  -- change what the minutes say they were.
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL,
  present      INTEGER NOT NULL DEFAULT 0,
  presiding    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (meeting_id, person_id)
);

CREATE TABLE agenda_item (
  id                TEXT PRIMARY KEY,
  meeting_id        TEXT NOT NULL REFERENCES meeting(id),
  entity            TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  position          INTEGER NOT NULL,
  item_number       INTEGER NOT NULL,
  title             TEXT NOT NULL,
  owner_role        TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  type              TEXT NOT NULL,
  note              TEXT
);
CREATE INDEX agenda_meeting ON agenda_item(meeting_id, position);

CREATE TABLE agenda_item_keyword (
  agenda_item_id TEXT NOT NULL REFERENCES agenda_item(id),
  keyword        TEXT NOT NULL,
  PRIMARY KEY (agenda_item_id, keyword)
);

CREATE TABLE minute_entry (
  id             TEXT PRIMARY KEY,
  meeting_id     TEXT NOT NULL REFERENCES meeting(id),
  entity         TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  agenda_item_id TEXT NOT NULL REFERENCES agenda_item(id),
  item_number    INTEGER NOT NULL,
  -- The citable reference, e.g. 2026-03-04. What a later resolution
  -- points at.
  ref            TEXT NOT NULL,
  discussion     TEXT NOT NULL DEFAULT '',

  -- The motion, inline: there is at most one per entry, and a join for
  -- every line of a minute book is a join nobody needs.
  motion_text          TEXT,
  moved_by_person_id   TEXT,
  moved_by_name        TEXT,
  seconded_by_person_id TEXT,
  seconded_by_name     TEXT,
  votes_for            INTEGER,
  votes_against        INTEGER,
  votes_abstain        INTEGER,
  motion_outcome       TEXT,

  closed         INTEGER NOT NULL DEFAULT 0,
  -- Once false, the entry is part of the record. See the trigger.
  draft          INTEGER NOT NULL DEFAULT 1,
  source         TEXT NOT NULL,
  UNIQUE (entity, ref)
);
CREATE INDEX minute_meeting ON minute_entry(meeting_id, item_number);

CREATE TABLE minute_flag (
  minute_entry_id TEXT NOT NULL REFERENCES minute_entry(id),
  flag            TEXT NOT NULL,
  PRIMARY KEY (minute_entry_id, flag)
);

-- Who stood out of a decision, and why. Its own table because a single
-- item can have several, and because a recusal is the row an auditor
-- looks for first.
CREATE TABLE minute_recusal (
  minute_entry_id    TEXT NOT NULL REFERENCES minute_entry(id),
  person_id          TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  basis              TEXT NOT NULL,
  reason             TEXT NOT NULL DEFAULT '',
  withdrew_from_room INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (minute_entry_id, person_id)
);

-- Approved minutes are the record. Editing one is not a thing the
-- platform does; a correction is a new entry at the next meeting that
-- refers to the old one, which is how minute books have always worked.
CREATE TRIGGER minute_entry_no_edit_once_approved
BEFORE UPDATE ON minute_entry
WHEN OLD.draft = 0
BEGIN
  SELECT RAISE(ABORT, 'approved minutes are the record; correct them at the next meeting');
END;

CREATE TRIGGER minute_entry_no_delete
BEFORE DELETE ON minute_entry
BEGIN
  SELECT RAISE(ABORT, 'a minute entry is never deleted');
END;

-- The compliance calendar. One register, read by several roles.
CREATE TABLE compliance_item (
  id                    TEXT PRIMARY KEY,
  entity                TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  kind                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  due_date              TEXT NOT NULL,
  owner_role            TEXT NOT NULL,
  confirmation_store    TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL,
  cadence               TEXT NOT NULL,
  -- True where the deadline is one the organization sets for itself
  -- rather than one a regulator sets. Kept apart so a missed internal
  -- date is not reported as a missed filing.
  self_declaring        INTEGER NOT NULL DEFAULT 0,
  verified              INTEGER NOT NULL DEFAULT 0,
  source_note           TEXT NOT NULL DEFAULT '',
  shared_infrastructure INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX compliance_due ON compliance_item(entity, due_date);
