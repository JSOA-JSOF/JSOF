/**
 * Where a part-finished application lives between steps.
 *
 * A multi-step server-rendered form has to keep the answers somewhere. It is
 * not the URL: half of these answers are personal data and a query string ends
 * up in browser history, in referrers and in server logs. So the draft is a
 * DRAFT row — a state the machine already has — and the browser holds nothing
 * but an opaque id in an httpOnly cookie.
 *
 * The only thing the URL carries is the step number and, when a step fails
 * validation, the names of the fields that failed. A field name is not personal
 * data; the value the applicant typed never leaves the server.
 */

import { cookies } from "next/headers";

export const DRAFT_COOKIE = "jsoa_application_draft";
export const REFERENCE_COOKIE = "jsoa_application_reference";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/apply",
  // A part-finished application is not kept: come back next week and start again.
  maxAge: 60 * 60 * 6,
};

export async function readDraftId(): Promise<string | null> {
  return (await cookies()).get(DRAFT_COOKIE)?.value ?? null;
}

export async function writeDraftId(id: string): Promise<void> {
  (await cookies()).set(DRAFT_COOKIE, id, COOKIE_OPTIONS);
}

export async function clearDraftId(): Promise<void> {
  (await cookies()).delete({ name: DRAFT_COOKIE, path: COOKIE_OPTIONS.path });
}

/**
 * The applicant's reference, handed to the acknowledgment page.
 *
 * Every submission gets one and it is random, so the presence, length and shape
 * of this cookie is identical whatever happened to the application.
 */
export async function writeReference(reference: string): Promise<void> {
  (await cookies()).set(REFERENCE_COOKIE, reference, {
    httpOnly: true,
    sameSite: "lax",
    path: "/apply",
    maxAge: 60 * 30,
  });
}

export async function readReference(): Promise<string | null> {
  return (await cookies()).get(REFERENCE_COOKIE)?.value ?? null;
}
