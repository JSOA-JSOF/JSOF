import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { Entity, Role } from "../authz/model";
import type { RoleAssignment } from "../authz/policy";
import { encryptionConfigured, openSecret, sealSecret } from "./secretbox";
import {
  LOGIN_TOKEN_MINUTES,
  SESSION_HOURS,
  hashToken,
  hoursFromNow,
  minutesFromNow,
  newToken,
  normaliseEmail,
} from "./tokens";

/**
 * Everything auth reads and writes, against D1.
 *
 * Kept apart from the route handlers so the rules live in one file
 * rather than being spread across five endpoints that each remember
 * four fifths of them.
 *
 * Two of those rules are worth stating out loud because they are easy
 * to lose later:
 *
 *   * A login token is **consumed**, not checked. The update that marks
 *     it used is the same statement that reads it, and it only matches
 *     a row that is unused and unexpired. Checking first and marking
 *     second is a race: two requests with the same link both pass the
 *     check, and a forwarded email signs in twice.
 *
 *   * The session is created unauthenticated. `mfa_passed_at` is null
 *     until a TOTP code is presented, and `getCurrentSubject` reports
 *     `mfaSatisfied: false` until then. Proving an email is not proving
 *     identity, and the policy layer already refuses almost everything
 *     without the second factor.
 */

function db(): D1Database {
  const { env } = getCloudflareContext();
  const database = env.DB;
  if (!database) throw new Error("no database binding");
  return database;
}

function id(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

export type PersonRow = {
  id: string;
  email: string;
  display_name: string;
  disabled_at: string | null;
};

/** A person by email, or null. Never creates: see `invite`. */
export async function personByEmail(email: string): Promise<PersonRow | null> {
  return db()
    .prepare("SELECT id, email, display_name, disabled_at FROM person WHERE email = ?")
    .bind(normaliseEmail(email))
    .first<PersonRow>();
}

/**
 * Add a person. The only way an account comes into existence.
 *
 * There is no self-registration, deliberately. Board accounts are
 * created by somebody who already holds one, and a member account is
 * created by the membership workflow on approval. An open sign-up form
 * on a platform whose roster is the sensitive thing would be a way to
 * enumerate it.
 */
export async function invite(
  email: string,
  displayName: string,
): Promise<PersonRow> {
  const existing = await personByEmail(email);
  if (existing) return existing;
  const row: PersonRow = {
    id: id(),
    email: normaliseEmail(email),
    display_name: displayName.trim(),
    disabled_at: null,
  };
  await db()
    .prepare(
      "INSERT INTO person (id, email, display_name, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(row.id, row.email, row.display_name, nowIso())
    .run();
  return row;
}

/**
 * Issue a sign-in link for a known person.
 *
 * Returns the raw token, which is the only moment it exists in plain
 * form. The caller mails it and forgets it; only the hash is stored.
 */
export async function issueLoginToken(personId: string): Promise<string> {
  const token = newToken();
  await db()
    .prepare(
      "INSERT INTO login_token (id, person_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      id(),
      personId,
      await hashToken(token),
      minutesFromNow(LOGIN_TOKEN_MINUTES),
      nowIso(),
    )
    .run();
  return token;
}

/**
 * Spend a sign-in link, once.
 *
 * The WHERE clause carries the whole rule: unused, unexpired, and this
 * exact hash. D1 reports how many rows changed, so a second attempt
 * changes none and returns null without a separate read.
 */
export async function consumeLoginToken(token: string): Promise<string | null> {
  const at = nowIso();
  const result = await db()
    .prepare(
      "UPDATE login_token SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING person_id",
    )
    .bind(at, await hashToken(token), at)
    .first<{ person_id: string }>();
  return result?.person_id ?? null;
}

export type SessionRow = {
  id: string;
  person_id: string;
  mfa_passed_at: string | null;
  expires_at: string;
  revoked_at: string | null;
};

/** A new session, not yet through the second factor. Returns the cookie value. */
export async function startSession(personId: string): Promise<string> {
  const token = newToken();
  await db()
    .prepare(
      "INSERT INTO session (id, person_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id(), personId, await hashToken(token), hoursFromNow(SESSION_HOURS), nowIso())
    .run();
  return token;
}

export async function sessionByToken(token: string): Promise<SessionRow | null> {
  const at = nowIso();
  return db()
    .prepare(
      "SELECT id, person_id, mfa_passed_at, expires_at, revoked_at FROM session WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
    )
    .bind(await hashToken(token), at)
    .first<SessionRow>();
}

export async function markMfaPassed(sessionId: string): Promise<void> {
  await db()
    .prepare("UPDATE session SET mfa_passed_at = ? WHERE id = ? AND mfa_passed_at IS NULL")
    .bind(nowIso(), sessionId)
    .run();
}

export async function touchSession(sessionId: string): Promise<void> {
  await db()
    .prepare("UPDATE session SET last_seen_at = ? WHERE id = ?")
    .bind(nowIso(), sessionId)
    .run();
}

export async function revokeSession(token: string): Promise<void> {
  await db()
    .prepare("UPDATE session SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(nowIso(), await hashToken(token))
    .run();
}

/** Every session for a person, gone. For a lost device or a leaver. */
export async function revokeAllSessions(personId: string): Promise<void> {
  await db()
    .prepare("UPDATE session SET revoked_at = ? WHERE person_id = ? AND revoked_at IS NULL")
    .bind(nowIso(), personId)
    .run();
}

/* Second factor ----------------------------------------------------- */

/**
 * The second factor, decrypted.
 *
 * Callers get the base32 the authenticator uses; what is in the
 * column is sealed. A row written before encryption landed is
 * returned as it is, so nobody is locked out by the improvement.
 */
export async function credentialFor(
  personId: string,
): Promise<{ totp_secret: string; confirmed_at: string | null } | null> {
  const row = await db()
    .prepare("SELECT totp_secret, confirmed_at FROM credential WHERE person_id = ?")
    .bind(personId)
    .first<{ totp_secret: string; confirmed_at: string | null }>();
  if (!row) return null;

  const { env } = getCloudflareContext();
  if (!env.TOTP_KEY) return row;
  return { ...row, totp_secret: await openSecret(row.totp_secret, env.TOTP_KEY) };
}

/**
 * Store an unconfirmed secret, replacing any unconfirmed one.
 *
 * A confirmed credential is never silently replaced: re-enrolling is
 * how an attacker with a live session would lock the owner out, so it
 * refuses and the caller has to revoke the old one deliberately.
 */
export async function beginEnrolment(personId: string, secret: string): Promise<void> {
  const existing = await credentialFor(personId);
  if (existing?.confirmed_at) throw new Error("already enrolled");

  // Refuses rather than falling back to plaintext. 0001's comment
  // says this column never holds the raw base32, and quietly writing
  // it when the key is absent is how that comment stopped being true
  // the first time. In production the secret is always set; without
  // it, enrolment is unavailable and says so.
  const { env } = getCloudflareContext();
  if (!encryptionConfigured(env)) {
    throw new Error(
      "TOTP_KEY is not configured, so a second factor cannot be enrolled. " +
        "Set it with: openssl rand -base64 32 | npx wrangler secret put TOTP_KEY",
    );
  }

  await db()
    .prepare(
      "INSERT INTO credential (person_id, totp_secret, created_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(person_id) DO UPDATE SET totp_secret = excluded.totp_secret, created_at = excluded.created_at",
    )
    .bind(personId, await sealSecret(secret, env.TOTP_KEY!), nowIso())
    .run();
}

/**
 * Remove somebody's second factor so they can enrol a new one.
 *
 * Finding 3 of the ASVS review: `beginEnrolment` correctly refuses to
 * replace a confirmed credential, nothing revoked one, and
 * `revokeAllSessions` had no callers. Losing the phone meant losing
 * the account permanently.
 *
 * Deliberately not self-service. A recovery path somebody can walk
 * alone is a second way in, and a second way in is the one an
 * attacker uses. This is for an officer holding ADMIN_ROLES acting
 * for somebody else, and it takes their sessions with it: an
 * attacker who reached the point of needing a reset may already be
 * holding one.
 */
export async function revokeCredential(
  personId: string,
  revokedBy: string,
): Promise<void> {
  await db().prepare("DELETE FROM credential WHERE person_id = ?").bind(personId).run();
  await revokeAllSessions(personId);
  await audit({
    actorId: revokedBy,
    action: "MFA_REVOKED",
    subject: `person:${personId}`,
    detail: "second factor removed and every session ended",
  });
}

export async function confirmEnrolment(personId: string): Promise<void> {
  await db()
    .prepare("UPDATE credential SET confirmed_at = ? WHERE person_id = ? AND confirmed_at IS NULL")
    .bind(nowIso(), personId)
    .run();
}

/* Roles -------------------------------------------------------------- */

export async function assignmentsFor(personId: string): Promise<RoleAssignment[]> {
  const { results } = await db()
    .prepare(
      "SELECT role, entity FROM role_grant WHERE person_id = ? AND revoked_at IS NULL",
    )
    .bind(personId)
    .all<{ role: string; entity: string }>();
  return results.map((row) => ({
    role: row.role as Role,
    entity: row.entity as Entity,
  }));
}

/**
 * Who holds an office, for a screen that has to offer a colleague.
 *
 * The membership lane needed this to let a reviewer assignment name
 * somebody, and was right not to grow its own directory of people: a
 * module that keeps a list of who is who ends up with a second,
 * staler roster beside the real one.
 *
 * It returns the minimum a picker needs and no more. Not the email,
 * because a list of addresses is a thing to be harvested and a picker
 * does not need one; not the grant history, because "who can do this
 * now" is the question being asked.
 */
export async function listPeopleWithRole(
  role: Role,
  entity: Entity,
): Promise<{ id: string; displayName: string }[]> {
  const { results } = await db()
    .prepare(
      "SELECT p.id, p.display_name FROM role_grant g " +
        "JOIN person p ON p.id = g.person_id " +
        "WHERE g.role = ? AND g.entity = ? AND g.revoked_at IS NULL " +
        "AND p.disabled_at IS NULL " +
        "ORDER BY p.display_name",
    )
    .bind(role, entity)
    .all<{ id: string; display_name: string }>();
  return results.map((row) => ({ id: row.id, displayName: row.display_name }));
}

/**
 * Change the address an account signs in with.
 *
 * Here rather than in membership, because `person` is the identity
 * lane's table. The membership repository has been writing it inside
 * one `atomic` batch to keep the member row and the account row from
 * diverging, which was the right call with what it had; this is the
 * method it should use instead once it can do both in one place.
 *
 * It does not revoke sessions. Changing an address is not evidence
 * that the account is compromised, and signing somebody out of a
 * screen they are working on because they fixed a typo is a worse
 * default than the risk it avoids. A compromise is handled by
 * `revokeAllSessions`, which exists for exactly that.
 */
export async function updatePersonEmail(
  personId: string,
  email: string,
  changedBy: string,
): Promise<void> {
  const normalised = normaliseEmail(email);
  await db()
    .prepare("UPDATE person SET email = ? WHERE id = ?")
    .bind(normalised, personId)
    .run();
  await audit({
    actorId: changedBy,
    action: "EMAIL_CHANGED",
    subject: `person:${personId}`,
    // The address itself is not recorded. A log of every address the
    // organization has ever held for somebody is more than this log
    // needs to be useful.
    detail: "sign-in address updated",
  });
}

export async function grantRole(
  personId: string,
  role: Role,
  entity: Entity,
  grantedBy: string,
): Promise<void> {
  await db()
    .prepare(
      "INSERT INTO role_grant (id, person_id, role, entity, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id(), personId, role, entity, grantedBy, nowIso())
    .run();
}

/* Audit --------------------------------------------------------------- */

export async function audit(entry: {
  actorId?: string | null;
  actorRole?: string | null;
  entity?: Entity | null;
  action: string;
  dataClass?: string | null;
  subject?: string | null;
  detail?: string | null;
}): Promise<void> {
  await db()
    .prepare(
      "INSERT INTO audit_entry (id, at, actor_id, actor_role, entity, action, data_class, subject, detail) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id(),
      nowIso(),
      entry.actorId ?? null,
      entry.actorRole ?? null,
      entry.entity ?? null,
      entry.action,
      entry.dataClass ?? null,
      entry.subject ?? null,
      entry.detail ?? null,
    )
    .run();
}
