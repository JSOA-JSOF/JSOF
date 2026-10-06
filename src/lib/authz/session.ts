/**
 * Dev-only session resolution. SERVER ONLY — this imports `next/headers`.
 *
 * A client component must import from `./personas` instead, or the whole
 * server-only module is pulled into the browser bundle and the build fails.
 *
 * There is no authentication yet. This resolves a Subject from a cookie set by
 * the role switcher in the board shell, so every module can be exercised as
 * each role without an auth system existing.
 *
 * When Auth.js lands, this file is the only thing that changes:
 * `getCurrentSubject()` keeps its shape and starts reading a real session.
 *
 * SAFETY: `assertDevOnly()` throws in production, so a deployment that somehow
 * shipped with this wired in fails loudly on the first board request rather
 * than quietly granting whatever the cookie asked for.
 */

import "server-only";
import { cookies } from "next/headers";

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

export function assertDevOnly(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "The dev persona switcher is not available in production. " +
        "Wire real authentication before deploying.",
    );
  }
}

export async function getCurrentPersona(): Promise<Persona> {
  assertDevOnly();
  const store = await cookies();
  return personaById(store.get(DEV_COOKIE)?.value);
}

export async function getCurrentSubject(): Promise<Subject> {
  return subjectFor(await getCurrentPersona());
}
