-- Identity, role grants, and the audit log.
--
-- Conventions, once, for every migration after this one:
--
--   * Ids are text. SQLite has no uuid type and an autoincrementing
--     integer leaks how many members there are to anybody who sees one.
--   * Timestamps are TEXT holding ISO-8601 in UTC, never local time and
--     never an integer. docs/ARCHITECTURE.md: UTC in the database,
--     rendered in America/New_York. A string sorts correctly and is
--     readable in a console at three in the morning.
--   * Nothing is deleted. Things are revoked, closed, or superseded,
--     and the row stays. Where that matters it is enforced by a trigger
--     rather than by everyone remembering.

-- A human. One row per person, whatever roles they hold and whichever
-- entity they hold them in.
CREATE TABLE person (
  id            TEXT PRIMARY KEY,
  -- Lowercased on the way in. Uniqueness is the whole identity model:
  -- there is no username and no password.
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  -- Set when somebody leaves. Their rows stay, their access does not.
  disabled_at   TEXT
);

-- The second factor. docs/ARCHITECTURE.md requires MFA for every
-- non-public tier, so this is not optional for anybody with a role.
CREATE TABLE credential (
  person_id     TEXT PRIMARY KEY REFERENCES person(id),
  -- Encrypted at rest with a key held as a Worker secret, never the raw
  -- base32. A dump of this table must not be a set of working tokens.
  totp_secret   TEXT NOT NULL,
  confirmed_at  TEXT,
  created_at    TEXT NOT NULL
);

-- A single-use link, emailed. Short lived, and consumed rather than
-- checked: `used_at` is what stops the same link working twice from two
-- different places.
CREATE TABLE login_token (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES person(id),
  -- A hash, not the token. Somebody reading this table should not be
  -- able to sign in as anybody.
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TEXT NOT NULL,
  used_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX login_token_person ON login_token(person_id);

CREATE TABLE session (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES person(id),
  token_hash      TEXT NOT NULL UNIQUE,
  -- Null until the second factor is presented. A session that has only
  -- proved the email is not a session that may read anything.
  mfa_passed_at   TEXT,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT
);
CREATE INDEX session_person ON session(person_id);

-- Who holds which office, in which entity.
--
-- Not a column on person, because the same human is often an officer of
-- both entities and occasionally holds two offices in one. Revoking
-- sets revoked_at; the row is the record that they once held it, which
-- is what makes an old audit entry readable.
CREATE TABLE role_grant (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES person(id),
  -- One of ROLES in src/lib/authz/model.ts. Not a foreign key: the role
  -- table is code, reviewed in a pull request, and must not be editable
  -- by anybody with database access.
  role          TEXT NOT NULL,
  entity        TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  granted_by    TEXT NOT NULL REFERENCES person(id),
  granted_at    TEXT NOT NULL,
  revoked_by    TEXT REFERENCES person(id),
  revoked_at    TEXT
);
CREATE INDEX role_grant_person ON role_grant(person_id);
-- One live grant of a role per person per entity. Partial index, so a
-- revoked grant does not block regranting the same office later.
CREATE UNIQUE INDEX role_grant_live
  ON role_grant(person_id, role, entity)
  WHERE revoked_at IS NULL;

-- The audit log.
--
-- Append only, and that is enforced below rather than promised. For
-- this organization who opened the roster matters more than who edited
-- it, so reads are logged too.
CREATE TABLE audit_entry (
  id            TEXT PRIMARY KEY,
  at            TEXT NOT NULL,
  -- Null for an unauthenticated action, which is itself worth recording.
  actor_id      TEXT REFERENCES person(id),
  actor_role    TEXT,
  entity        TEXT CHECK (entity IN ('JSOA', 'JSOF')),
  -- READ, WRITE, GRANT, REVOKE, BREAK_GLASS, SIGN_IN, SIGN_IN_FAILED.
  action        TEXT NOT NULL,
  -- The data class touched, from DataClass in src/lib/authz/model.ts.
  data_class    TEXT,
  -- What was touched, as table:id. Free text on purpose: the audit log
  -- outlives the schema of the thing it describes.
  subject       TEXT,
  detail        TEXT
);
CREATE INDEX audit_at ON audit_entry(at);
CREATE INDEX audit_actor ON audit_entry(actor_id, at);

-- Append only, mechanically. An audit log that the application can
-- rewrite is a log that proves nothing, and "we do not call update" is
-- not a control, it is a habit.
CREATE TRIGGER audit_entry_no_update
BEFORE UPDATE ON audit_entry
BEGIN
  SELECT RAISE(ABORT, 'audit_entry is append-only');
END;

CREATE TRIGGER audit_entry_no_delete
BEFORE DELETE ON audit_entry
BEGIN
  SELECT RAISE(ABORT, 'audit_entry is append-only');
END;
