-- Changing the address you sign in with.
--
-- A member correcting their own email is not a field update. The
-- address is the credential: writing the new one immediately means a
-- typo locks somebody out of their own account permanently, and an
-- attacker holding a session can quietly move the account to an
-- address they control and the owner finds out when they cannot sign
-- in.
--
-- So it is a pending change proved by a link sent to the NEW address,
-- while the OLD one keeps working until that happens, and the old
-- address is told. The same hashed-single-use shape as login_token
-- and for the same reason: a dump of this table must not be a set of
-- working account takeovers.
CREATE TABLE member_email_change (
  id          TEXT PRIMARY KEY,
  member_id   TEXT NOT NULL REFERENCES member(id),
  -- Where the account is moving to. Stored in the clear because the
  -- confirmation has to be sent there; it is not the secret.
  new_email   TEXT NOT NULL,
  -- The secret is this. A hash, never the token.
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  -- Set when the owner says it was not them. A cancelled request is
  -- kept, because "somebody tried to move my account" is exactly the
  -- thing an officer needs to see a pattern of.
  cancelled_at TEXT
);
CREATE INDEX email_change_member ON member_email_change(member_id, created_at);
