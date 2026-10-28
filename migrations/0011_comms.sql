-- Outbound mail.
--
-- The thing this schema is shaped around: **a send is never made from
-- inside a request.** src/lib/membership/notify.ts explains why and it
-- is not about latency. The membership submission handler must not
-- leak whether a sponsor exists, and the time a request takes is a
-- channel like any other, so the handler does the same work and writes
-- the same row whether or not the message can ever be delivered. A
-- worker picks it up afterwards.
--
-- Two streams, kept apart at the schema level rather than by
-- convention. A member who unsubscribes from the newsletter must still
-- receive their dues receipt, and a suppression list that cannot tell
-- the difference is how a charity stops sending receipts.

CREATE TABLE outbound_message (
  id             TEXT PRIMARY KEY,
  -- TRANSACTIONAL is a consequence of something the recipient did:
  -- a receipt, an approval, a sign-in link. BULK is something we
  -- decided to send. The difference decides suppression, and it
  -- decides which sending identity is used.
  stream         TEXT NOT NULL CHECK (stream IN ('TRANSACTIONAL', 'BULK')),
  -- Which entity is speaking. A (c)(19) receipt must not arrive in a
  -- (c)(3) envelope: entity separation is a compliance control and the
  -- envelope is the one artifact a donor keeps.
  entity         TEXT CHECK (entity IN ('JSOA', 'JSOF')),
  -- The module's own name for it, e.g. VOUCH_REQUEST, AWARD_NOTICE.
  kind           TEXT NOT NULL,
  to_address     TEXT NOT NULL,
  to_name        TEXT,
  subject        TEXT NOT NULL,
  body_text      TEXT NOT NULL,
  -- QUEUED, SENT, FAILED, SUPPRESSED, UNDELIVERABLE.
  --
  -- SUPPRESSED and UNDELIVERABLE are outcomes, not errors. A message
  -- with nowhere to go is still written, because the alternative is a
  -- handler that behaves differently when a recipient is missing.
  state          TEXT NOT NULL,
  -- Why it ended up in that state, for the queue screen.
  state_reason   TEXT,
  queued_at      TEXT NOT NULL,
  sent_at        TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  -- The provider's id, once there is one. Never a credential.
  provider_ref   TEXT
);
CREATE INDEX outbound_pending ON outbound_message(state, queued_at);
CREATE INDEX outbound_address ON outbound_message(to_address, queued_at);
CREATE INDEX outbound_kind ON outbound_message(kind, queued_at);

-- Who must not be written to, and on which stream.
--
-- Keyed on the pair, so unsubscribing from the newsletter does not
-- stop a receipt. A hard bounce writes both rows; a complaint writes
-- BULK and raises something for a person to look at.
CREATE TABLE suppression (
  address    TEXT NOT NULL,
  stream     TEXT NOT NULL CHECK (stream IN ('TRANSACTIONAL', 'BULK')),
  -- UNSUBSCRIBED, HARD_BOUNCE, COMPLAINT, MANUAL.
  reason     TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (address, stream)
);

-- A suppression is never deleted, because "we removed them from the
-- list" is the single claim a regulator is most likely to test. Coming
-- off a list is a new row in the log below, and the suppression row
-- carries a lifted_at instead.
ALTER TABLE suppression ADD COLUMN lifted_at TEXT;
ALTER TABLE suppression ADD COLUMN lifted_by TEXT;

CREATE TRIGGER suppression_no_delete
BEFORE DELETE ON suppression
BEGIN
  SELECT RAISE(ABORT, 'a suppression is lifted, never deleted');
END;

-- Every send attempt, including the ones that did not happen.
CREATE TABLE delivery_event (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES outbound_message(id),
  -- ATTEMPTED, ACCEPTED, REJECTED, BOUNCED, COMPLAINED, SUPPRESSED.
  event      TEXT NOT NULL,
  detail     TEXT,
  at         TEXT NOT NULL
);
CREATE INDEX delivery_message ON delivery_event(message_id, at);

CREATE TRIGGER delivery_event_no_update
BEFORE UPDATE ON delivery_event
BEGIN
  SELECT RAISE(ABORT, 'delivery_event is append-only');
END;

CREATE TRIGGER delivery_event_no_delete
BEFORE DELETE ON delivery_event
BEGIN
  SELECT RAISE(ABORT, 'delivery_event is append-only');
END;
