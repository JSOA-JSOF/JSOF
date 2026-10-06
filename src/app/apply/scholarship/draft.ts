/**
 * Where a part-finished scholarship application lives between steps.
 *
 * Same reasoning as the membership form's draft, and the same mechanism: the
 * answers are a DRAFT row, the browser holds nothing but an opaque id in an
 * httpOnly cookie, and the URL carries only a step number and the NAMES of any
 * fields that failed validation. A field name is not personal data; the values
 * never leave the server.
 *
 * One addition specific to this form. There is no draft at all until the three
 * routing questions have been answered and have come back "apply here", so a
 * North Carolina resident at a North Carolina school never has a cookie set
 * and never has a row written. And when the date of birth turns out to be
 * under 13, `clearDraft` runs before the refusal is rendered.
 */

import { cookies } from "next/headers";

export const DRAFT_COOKIE = "jsof_scholarship_draft";
export const REFERENCE_COOKIE = "jsof_scholarship_reference";

const COOKIE_PATH = "/apply/scholarship";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: COOKIE_PATH,
  // A part-finished application is not kept for long. Come back and start again.
  maxAge: 60 * 60 * 12,
};

export async function readDraftId(): Promise<string | null> {
  return (await cookies()).get(DRAFT_COOKIE)?.value ?? null;
}

export async function writeDraftId(id: string): Promise<void> {
  (await cookies()).set(DRAFT_COOKIE, id, COOKIE_OPTIONS);
}

export async function clearDraftId(): Promise<void> {
  (await cookies()).delete({ name: DRAFT_COOKIE, path: COOKIE_PATH });
}

export async function writeReference(reference: string): Promise<void> {
  (await cookies()).set(REFERENCE_COOKIE, reference, {
    httpOnly: true,
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: 60 * 30,
  });
}

export async function readReference(): Promise<string | null> {
  return (await cookies()).get(REFERENCE_COOKIE)?.value ?? null;
}
