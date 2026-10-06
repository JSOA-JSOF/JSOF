/**
 * Age rules, from docs/PRIVACY-AND-PAYMENTS.md.
 *
 * Two rules, and they are different in kind:
 *
 *   Under 13   we do not collect at all. Not "collect and delete", not
 *              "collect with consent": the form stops, the draft is destroyed,
 *              and the applicant is told who to write to instead.
 *   Under 18   a guardian consents, as a separate step, with the guardian's
 *              own contact details. Not a checkbox the student can tick.
 *
 * The date of birth is asked immediately after the routing questions and
 * before anything else, so that a form which must not be filled in is not
 * filled in first. That ordering is the rule; it is not a nicety.
 */

export const MINIMUM_AGE = 13;
export const AGE_OF_MAJORITY = 18;

export type AgeGate =
  | { decision: "REFUSE_COLLECTION"; age: number }
  | { decision: "GUARDIAN_CONSENT_REQUIRED"; age: number }
  | { decision: "MAY_PROCEED"; age: number }
  | { decision: "DATE_OF_BIRTH_NOT_GIVEN"; age: null };

/** Whole years, on the given day. Nothing clever: birthday not yet reached counts as the year before. */
export function ageOn(dateOfBirth: string, on: Date = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  let age = on.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = on.getUTCMonth() - born.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

export function ageGate(dateOfBirth: string, on: Date = new Date()): AgeGate {
  const age = ageOn(dateOfBirth, on);
  if (age === null) return { decision: "DATE_OF_BIRTH_NOT_GIVEN", age: null };
  if (age < MINIMUM_AGE) return { decision: "REFUSE_COLLECTION", age };
  if (age < AGE_OF_MAJORITY) return { decision: "GUARDIAN_CONSENT_REQUIRED", age };
  return { decision: "MAY_PROCEED", age };
}

export function isMinor(dateOfBirth: string, on: Date = new Date()): boolean {
  return ageGate(dateOfBirth, on).decision === "GUARDIAN_CONSENT_REQUIRED";
}

export function tooYoungToCollect(dateOfBirth: string, on: Date = new Date()): boolean {
  return ageGate(dateOfBirth, on).decision === "REFUSE_COLLECTION";
}

/**
 * What the applicant under 13 is shown. It collects nothing, offers no way
 * around itself, and names a person to write to, because a thirteen-year-old
 * reading a refusal should not be left with nowhere to go.
 */
export const UNDER_THIRTEEN_NOTICE = {
  heading: "We cannot take an application from you yet",
  body: [
    "We do not collect information from anyone under 13, so this form stops " +
      "here. Nothing you have entered has been kept.",
    "If you will be starting at a college, university or trade school soon, " +
      "write to the Scholarships Chair and she will tell you when to apply " +
      "and what will be needed.",
  ],
  contact: "scholarships@example.org",
} as const;

/* ------------------------------------------------------------------ *
 * Guardian consent
 * ------------------------------------------------------------------ */

/** Bump this when the wording changes. Consent records keep the version they agreed to. */
export const GUARDIAN_CONSENT_STATEMENT_VERSION = "2026-10-v1";

export const GUARDIAN_CONSENT_STATEMENT = {
  version: GUARDIAN_CONSENT_STATEMENT_VERSION,
  heading: "Consent from a parent or guardian",
  /** Who is being asked, and what for. Written to the guardian, not to the student. */
  body: [
    "The applicant named on this application is under 18. A parent or " +
      "guardian has to consent before we can accept it.",
    "What we will hold: the applicant's name, contact details, date of birth, " +
      "where they are enrolled, what they wrote in support of the " +
      "application, and the decision. We do not collect a Social Security " +
      "number, any discharge paperwork, or any uploaded document.",
    "Who sees it: the Scholarships Chair, and the people who score " +
      "applications. A scorer related to the applicant cannot open the file " +
      "at all. Anyone who does open it is recorded.",
    "How long we keep it: if the application is unsuccessful, the personal " +
      "details are deleted on a schedule and only the decision is kept. If an " +
      "award is made, the selection record is kept for five years.",
    "You can withdraw the application, and the consent, by writing to the " +
      "Scholarships Chair.",
  ],
  /** The sentence the guardian is agreeing to. Stored by version on the record. */
  affirmation:
    "I am the applicant's parent or guardian, I have read what will be held " +
    "and who will see it, and I consent to this application being made.",
  /**
   * Why this is a separate step and not a checkbox: the record carries the
   * guardian's own name, email and phone, which a student completing the form
   * on their own cannot supply truthfully, and the consent statement is sent
   * to that address.
   */
  note:
    "This is captured from the guardian, with the guardian's own contact " +
    "details. It is not a box on the applicant's form.",
} as const;
