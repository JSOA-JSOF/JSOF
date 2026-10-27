-- Membership: applications, the vouch, dues handoff, and the roster.
--
-- Conventions as 0001. Text ids, ISO-8601 UTC in text, nothing deleted.
--
-- Two decisions here are not obvious from the types.
--
-- `application` carries the applicant's details inline rather than
-- pointing at a person row. An applicant is not an account: most never
-- become one, and a declined application should not leave a dormant
-- identity behind. The link to `person` is made on approval, through
-- `member.person_id`, and not before.
--
-- The flags are their own table rather than a JSON column. They are
-- queried as a set by the chair's queue, they come from a fixed list,
-- and a JSON array in SQLite cannot be indexed or counted without
-- unpacking every row.

CREATE TABLE application (
  id                      TEXT PRIMARY KEY,
  entity                  TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  state                   TEXT NOT NULL,
  -- What the acknowledgment shows. Random, and carries nothing derived
  -- from the input, so it cannot be used to guess another reference.
  reference               TEXT NOT NULL UNIQUE,

  applicant_name          TEXT NOT NULL DEFAULT '',
  email                   TEXT NOT NULL DEFAULT '',
  phone                   TEXT NOT NULL DEFAULT '',
  membership_category     TEXT,
  qualifying_relationship TEXT,
  -- ISO YYYY-MM-DD, attested. Null for a relative who never served.
  service_from            TEXT,
  service_to              TEXT,
  -- The applicant's own claim. Kept beside the derived value rather
  -- than replaced by it, so the composition report can count the
  -- disagreements instead of hiding them.
  attested_war_veteran    INTEGER NOT NULL DEFAULT 0,
  is_augmentee            INTEGER NOT NULL DEFAULT 0,
  sponsor_member_id       TEXT NOT NULL DEFAULT '',

  created_at              TEXT NOT NULL,
  submitted_at            TEXT,
  -- How far through the form a draft got. Draft bookkeeping only.
  step                    INTEGER NOT NULL DEFAULT 0,
  vouch_expires_at        TEXT,

  -- The chair's decision, inline: it is exactly one per application and
  -- a separate table would be a join for every queue row.
  decided_at              TEXT,
  decided_by              TEXT REFERENCES person(id),
  decision_outcome        TEXT CHECK (decision_outcome IN ('APPROVED', 'DENIED')),
  decision_reason         TEXT,

  converted_member_id     TEXT
);
CREATE INDEX application_state ON application(entity, state);
CREATE INDEX application_email ON application(email);
CREATE INDEX application_sponsor ON application(sponsor_member_id);

-- Notes the chair may see and the applicant never does.
CREATE TABLE application_flag (
  application_id TEXT NOT NULL REFERENCES application(id),
  flag           TEXT NOT NULL,
  PRIMARY KEY (application_id, flag)
);

-- The sponsor's confirmation.
--
-- A row is written for every submission whether or not there is an
-- address to send to, and `deliverable` records which it was. That is
-- not bookkeeping for its own sake: if a row were only written when a
-- sponsor existed, the time the submission took would tell an applicant
-- whether the sponsor ID they guessed was real.
CREATE TABLE vouch_request (
  token             TEXT PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES application(id),
  sponsor_member_id TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  answered_at       TEXT,
  outcome           TEXT CHECK (outcome IN ('CONFIRMED', 'DECLINED', 'DO_NOT_KNOW')),
  deliverable       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX vouch_application ON vouch_request(application_id);

CREATE TABLE checkout_handoff (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES application(id),
  entity         TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  amount_cents   INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  hosted_url     TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('CREATED', 'CLEARED'))
);
CREATE INDEX handoff_application ON checkout_handoff(application_id);

-- The roster.
CREATE TABLE member (
  id                      TEXT PRIMARY KEY,
  entity                  TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  -- JSOA-YYYY-NNNN. A lookup key and not a secret: the sponsor's click
  -- is the authentication, not knowledge of the number.
  member_id               TEXT NOT NULL UNIQUE,
  -- The account, once there is one. Null for a member who has never
  -- signed in, which is most of them.
  person_id               TEXT REFERENCES person(id),

  -- Roster tier. A test fails the build if any of this reaches a
  -- public page.
  display_name            TEXT NOT NULL,
  email                   TEXT NOT NULL,
  phone                   TEXT NOT NULL DEFAULT '',

  membership_category     TEXT NOT NULL,
  qualifying_relationship TEXT,
  service_from            TEXT,
  service_to              TEXT,
  -- Derived from the attested dates. Never taken from the checkbox,
  -- because the 501(c)(19) composition test is answered with this
  -- column and an organization cannot self-attest its way past it.
  is_war_veteran          INTEGER NOT NULL DEFAULT 0,
  attested_war_veteran    INTEGER NOT NULL DEFAULT 0,

  state                   TEXT NOT NULL,
  sponsor_member_id       TEXT,
  joined_at               TEXT NOT NULL,
  -- When dues cleared. The 30-day audit clock starts here, not at
  -- approval.
  payment_cleared_at      TEXT,
  last_audited_at         TEXT,
  application_id          TEXT REFERENCES application(id)
);
CREATE INDEX member_state ON member(entity, state);
CREATE INDEX member_email ON member(email);
CREATE INDEX member_person ON member(person_id);
CREATE INDEX member_sponsor ON member(sponsor_member_id);

-- Membership's own audit trail, kept beside the platform one because it
-- records row-level reads of the roster specifically: for this
-- organization, who opened the roster matters more than who edited it.
CREATE TABLE membership_audit (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  person_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  data_class  TEXT NOT NULL,
  entity      TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  row_level   INTEGER NOT NULL DEFAULT 0,
  -- An id or a count description. Never a name.
  subject_ref TEXT
);
CREATE INDEX membership_audit_at ON membership_audit(at);

CREATE TRIGGER membership_audit_no_update
BEFORE UPDATE ON membership_audit
BEGIN
  SELECT RAISE(ABORT, 'membership_audit is append-only');
END;

CREATE TRIGGER membership_audit_no_delete
BEFORE DELETE ON membership_audit
BEGIN
  SELECT RAISE(ABORT, 'membership_audit is append-only');
END;
