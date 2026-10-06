/**
 * The current subject for the membership board routes.
 *
 * Thin by design. The dev persona switcher lives in the shared board shell and
 * in `src/lib/authz/session.ts`, so this module resolves the subject through
 * that rather than carrying a second switcher of its own: two switchers on one
 * page is a way to be wrong about which role you are looking through.
 *
 * When Auth.js and TOTP land, nothing here changes.
 */

import { getCurrentPersona, subjectFor, type Persona } from "@/lib/authz/session";
import type { Subject } from "@/lib/authz/policy";

export type BoardActor = { persona: Persona; subject: Subject };

export async function currentActor(): Promise<BoardActor> {
  const persona = await getCurrentPersona();
  return { persona, subject: subjectFor(persona) };
}
