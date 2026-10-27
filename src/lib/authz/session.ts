/**
 * Who is making this request. SERVER ONLY — this imports `next/headers`.
 *
 * A client component must import from `./personas` instead, or the whole
 * server-only module is pulled into the browser bundle and the build fails.
 *
 * There are two ways a Subject can be resolved and the order matters.
 *
 *   1. A real session cookie, looked up in the database, carrying the
 *      role grants that person actually holds and whether they have
 *      been through the second factor this session.
 *   2. Outside production only, the dev persona cookie, so a module can
 *      still be exercised as each role with no database and no mailbox.
 *
 * The fallback is never reachable in production, and not because a
 * cookie is missing: `assertDevOnly()` throws on `NODE_ENV === production`
 * whatever the request looks like. A deployment that somehow shipped
 * with the switcher wired in fails loudly on the first board request
 * rather than quietly granting whatever the cookie asked for.
 *
 * `getCurrentSubject()` keeps the shape it had when it was dev-only, so
 * the forty-one call sites did not change when real sessions landed.
 * What changed is that it can now refuse.
 */

import "server-only";
import { cookies } from "next/headers";

import {
  assignmentsFor,
  sessionByToken,
  touchSession,
  type SessionRow,
} from "../auth/store";
import { database } from "../db";
import { SESSION_COOKIE } from "../auth/tokens";
import { DEV_COOKIE, personaById, subjectFor, type Persona } from "./personas";
import type { Subject } from "./policy";

export {
  DEV_COOKIE,
  DEFAULT_PERSONA_ID,
  PERSONAS,
  entitiesFor,
  findingsFor,
  personaById,
  rolesFor,
  subjectFor,
  type Persona,
} from "./personas";

export class NotSignedIn extends Error {
  constructor() {
    super("No session.");
    this.name = "NotSignedIn";
  }
}

export function assertDevOnly(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "The dev persona switcher is not available in production. " +
        "Wire real authentication before deploying.",
    );
  }
}

/** True where the persona switcher may exist at all. */
export const DEV_PERSONAS_AVAILABLE = process.env.NODE_ENV !== "production";

export type LiveSession = { row: SessionRow; subject: Subject };

/**
 * The real session, or null.
 *
 * Soft on infrastructure and hard on authorization. No cookie, no
 * database binding, or an unreadable database all return null, because
 * `next dev` with no Worker behind it is a normal way to work on the
 * public tier. An expired, revoked or unknown session also returns
 * null, which is the same answer for a different reason: the caller
 * cannot tell them apart and should not be able to.
 */
export async function getLiveSession(): Promise<LiveSession | null> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!token) return null;

  try {
    const row = await sessionByToken(token);
    if (!row) return null;
    const assignments = await assignmentsFor(row.person_id);
    // Best effort. A failed timestamp must not cost somebody their
    // session, so it is not awaited into the critical path.
    void touchSession(row.id).catch(() => {});
    return {
      row,
      subject: {
        personId: row.person_id,
        assignments,
        mfaSatisfied: row.mfa_passed_at !== null,
      },
    };
  } catch {
    return null;
  }
}

/**
 * The persona switcher's current choice. Dev only, and throws otherwise.
 */
export async function getCurrentPersona(): Promise<Persona> {
  assertDevOnly();
  const store = await cookies();
  return personaById(store.get(DEV_COOKIE)?.value);
}

/**
 * The Subject for this request.
 *
 * Throws `NotSignedIn` in production when there is no live session.
 * Callers that render a screen should use `requireSubject`, which turns
 * that into a redirect; callers that are already inside an action can
 * let it throw, because an action reached without a session is not a
 * case to render nicely.
 */
export async function getCurrentSubject(): Promise<Subject> {
  const live = await getLiveSession();
  if (live) return live.subject;
  if (process.env.NODE_ENV === "production") throw new NotSignedIn();

  // A persona is only allowed where there is no database.
  //
  // The switcher mints ids like `dev:vp-membership`, which are not in
  // `person`. Several tables reference that table, and D1 enforces
  // foreign keys, so a chair decision recorded by a persona fails with
  // FOREIGN KEY constraint failed at the end of a workflow that has
  // already done its work. The membership port found this.
  //
  // The two bad fixes were to drop the constraint, which weakens a real
  // control for a dev-only reason, and to write null, which drops the
  // approver from the record that the no-self-approval rule depends on.
  // The right line is this one: the persona switcher exists for working
  // with no database and no mailbox, and the moment there is a database
  // there are real identities to use.
  if (database()) throw new NotSignedIn();

  return subjectFor(await getCurrentPersona());
}

/** As above, but sends somebody who is not signed in somewhere useful. */
export async function requireSubject(): Promise<Subject> {
  try {
    return await getCurrentSubject();
  } catch (problem) {
    if (problem instanceof NotSignedIn) {
      const { redirect } = await import("next/navigation");
      redirect("/sign-in");
    }
    throw problem;
  }
}
