-- The shared inbox.
--
-- Two public addresses were published, support@ and connect@, and the
-- board review found the obvious problem: an office is named on the
-- contact page, somebody writes to it, and nothing says who picks it
-- up. This is the thing that picks it up.
--
-- A message is routed, not filed. The route is a separate row from the
-- message because how a message was routed is as interesting as where
-- it went: a rule that keeps misfiring and a model that keeps being
-- overruled both show up as a pattern in this table, and neither is
-- visible if the office is just a column.

CREATE TABLE inbound_message (
  id              TEXT PRIMARY KEY,
  received_at     TEXT NOT NULL,
  -- Which published address it arrived at: 'support' or 'connect'.
  mailbox         TEXT NOT NULL,
  from_address    TEXT NOT NULL,
  from_name       TEXT,
  subject         TEXT,
  -- Plain text only. Nothing renders sender-supplied HTML, so nothing
  -- stores it: an inbox is the single most attractive place to put a
  -- payload and wait for a volunteer to open it.
  body_text       TEXT NOT NULL,
  -- The full original in R2, for the rare case somebody needs the
  -- headers or an attachment. Null while attachments are not accepted.
  raw_key         TEXT,
  -- Set when a message is judged to be junk. It stays in the table.
  spam_at         TEXT
);
CREATE INDEX inbound_received ON inbound_message(received_at);
CREATE INDEX inbound_mailbox ON inbound_message(mailbox, received_at);

-- Where a message was sent, and on whose say-so.
--
-- More than one row per message is normal and correct: the rules place
-- it, a human moves it, and both are kept. The live route is the most
-- recent one.
CREATE TABLE message_route (
  id            TEXT PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES inbound_message(id),
  -- The office, as a role from src/lib/authz/model.ts, or 'UNPLACED'.
  role          TEXT NOT NULL,
  entity        TEXT CHECK (entity IN ('JSOA', 'JSOF')),
  -- 'RULE', 'MODEL', or 'HUMAN'. A model never gets the last word: a
  -- MODEL route is a suggestion and the queue shows it as one until a
  -- HUMAN route supersedes it.
  decided_by    TEXT NOT NULL CHECK (decided_by IN ('RULE', 'MODEL', 'HUMAN')),
  -- Which rule fired, or which model answered. Free text, so a bad
  -- route can be traced to the thing that made it.
  basis         TEXT,
  -- 0 to 100 for a model, null for a rule or a human. A rule either
  -- matched or it did not, and a human is not guessing.
  confidence    INTEGER,
  decided_by_id TEXT REFERENCES person(id),
  decided_at    TEXT NOT NULL
);
CREATE INDEX route_message ON message_route(message_id, decided_at);
CREATE INDEX route_role ON message_route(role, decided_at);

-- What happened after it landed somewhere.
CREATE TABLE message_action (
  id            TEXT PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES inbound_message(id),
  -- 'CLAIMED', 'REPLIED', 'CLOSED', 'REOPENED', 'ESCALATED'.
  action        TEXT NOT NULL,
  actor_id      TEXT NOT NULL REFERENCES person(id),
  note          TEXT,
  at            TEXT NOT NULL
);
CREATE INDEX action_message ON message_action(message_id, at);

-- The same append-only rule as the audit log, for the same reason. A
-- record of who was asked to deal with something, and when, is worth
-- nothing if it can be tidied up afterwards.
CREATE TRIGGER message_route_no_update
BEFORE UPDATE ON message_route
BEGIN
  SELECT RAISE(ABORT, 'message_route is append-only; add a new route');
END;

CREATE TRIGGER message_route_no_delete
BEFORE DELETE ON message_route
BEGIN
  SELECT RAISE(ABORT, 'message_route is append-only');
END;

CREATE TRIGGER message_action_no_update
BEFORE UPDATE ON message_action
BEGIN
  SELECT RAISE(ABORT, 'message_action is append-only');
END;

CREATE TRIGGER message_action_no_delete
BEFORE DELETE ON message_action
BEGIN
  SELECT RAISE(ABORT, 'message_action is append-only');
END;
