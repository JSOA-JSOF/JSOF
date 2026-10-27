/**
 * The current actor for the membership board routes.
 *
 * Thin by design. It resolves through `src/lib/authz/session.ts` rather
 * than carrying a switcher of its own, because two switchers on one
 * page is a way to be wrong about which role you are looking through.
 *
 * It used to return a `Persona`, which is a dev-only object, and that
 * is why these routes could not run in production. It now returns a
 * label, which both a real session and the dev switcher can produce.
 */

import { requireBoardViewer } from "@/lib/authz/session";
import type { Subject } from "@/lib/authz/policy";

export type BoardActor = { subject: Subject; label: string };

export async function currentActor(): Promise<BoardActor> {
  const { subject, label } = await requireBoardViewer();
  return { subject, label };
}
