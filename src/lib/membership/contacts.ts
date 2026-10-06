/**
 * Fictional contact addresses for the dev personas, and the notices this
 * module sends to a role rather than to a person.
 *
 * This exists for one reason that is not cosmetic. The no-self-approval
 * invariant has to be applicable in the chair queue, and an applicant reaching
 * /apply is unauthenticated: the only handle connecting an application to a
 * person is the address they applied with. So a board member who applies for
 * membership can be recognised and refused as their own approver.
 *
 * A real identity module resolves this properly against the account. The shape
 * is what matters here, not the lookup.
 */

/** Keyed by `Subject.personId`, which the shared persona helper sets to `dev:<id>`. */
export const BOARD_CONTACTS: Record<string, string> = {
  "dev:president": "president@example.org",
  "dev:vp-ops": "vp.operations@example.org",
  "dev:vp-membership": "vp.membership@example.org",
  "dev:secretary": "secretary@example.org",
  "dev:treasurer-jsoa": "treasurer.jsoa@example.org",
  "dev:treasurer-jsof": "treasurer.jsof@example.org",
  "dev:treasurer-store": "store@example.org",
  "dev:member": "member@example.org",
};

export const MEMBERSHIP_CHAIR_INBOX = "vp.membership@example.org";
export const PRESIDENT_INBOX = "president@example.org";

export function boardContactEmail(personId: string): string | null {
  return BOARD_CONTACTS[personId] ?? null;
}

/** The person, if any, whose contact address matches. Case-insensitive. */
export function personIdForEmail(email: string): string | null {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  for (const [personId, address] of Object.entries(BOARD_CONTACTS)) {
    if (address.toLowerCase() === needle) return personId;
  }
  return null;
}
