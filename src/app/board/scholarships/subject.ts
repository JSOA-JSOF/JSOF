/**
 * The current subject for the scholarship board routes.
 *
 * Thin by design, and the same shape the membership module uses: the dev
 * persona switcher lives in the shared board shell, so this resolves through
 * it rather than carrying a second switcher. When Auth.js and TOTP land,
 * nothing here changes.
 */

import { getCurrentPersona, subjectFor, type Persona } from "@/lib/authz/session";
import type { Subject } from "@/lib/authz/policy";

export type BoardActor = { persona: Persona; subject: Subject };

export async function currentActor(): Promise<BoardActor> {
  const persona = await getCurrentPersona();
  return { persona, subject: subjectFor(persona) };
}
