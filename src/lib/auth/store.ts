import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import type { Entity, Role } from "../authz/model";
import type { RoleAssignment } from "../authz/policy";
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

export async function credentialFor(
  personId: string,
): Promise<{ totp_secret: string; confirmed_at: string | null } | null> {
  return db()
    .prepare("SELECT totp_secret, confirmed_at FROM credential WHERE person_id = ?")
    .bind(personId)
    .first<{ totp_secret: string; confirmed_at: string | null }>();
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
  await db()
    .prepare(
      "INSERT INTO credential (person_id, totp_secret, created_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(person_id) DO UPDATE SET totp_secret = excluded.totp_secret, created_at = excluded.created_at",
    )
    .bind(personId, secret, nowIso())
    .run();
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
