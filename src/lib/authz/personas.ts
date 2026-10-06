/**
 * Dev personas and the pure helpers around them.
 *
 * This file is deliberately free of `next/headers` and any other server-only
 * import, because the role switcher is a client component and importing a
 * server-only module from it pulls the whole thing into the browser bundle.
 * Cookie reading lives in session.ts.
 */

import type { Entity, Role } from "./model";
import { separationOfDutiesFindings, type RoleAssignment, type Subject } from "./policy";

export const DEV_COOKIE = "jsoa_dev_persona";

export type Persona = {
  id: string;
  /** What this persona is, by role. Never a real person's name. */
  label: string;
  note?: string;
  assignments: RoleAssignment[];
  /**
   * Defaults to true. Set false to exercise the MFA refusal: `can()` returns
   * false for every class when the second factor is outstanding, which is the
   * one denial that has no per-role nuance.
   */
  mfaSatisfied?: boolean;
};

/**
 * The personas mirror the real board's shape, including the parts that are
 * problems. The Treasurer who also chairs the store exists here on purpose:
 * it is the organization's actual arrangement and the controls panel should
 * light up without anyone having to configure it.
 */
export const PERSONAS: Persona[] = [
  {
    id: "president",
    label: "President",
    note: "Both entities. Aggregate only on applicants.",
    assignments: [
      { role: "PRESIDENT", entity: "JSOA" },
      { role: "PRESIDENT", entity: "JSOF" },
    ],
  },
  {
    id: "vp-ops",
    label: "VP Operations",
    note: "Standing release approver.",
    assignments: [
      { role: "VP_OPERATIONS", entity: "JSOA" },
      { role: "VP_OPERATIONS", entity: "JSOF" },
    ],
  },
  {
    id: "vp-membership",
    label: "VP Membership",
    note: "JSOA only. The roster is theirs.",
    assignments: [{ role: "VP_MEMBERSHIP", entity: "JSOA" }],
  },
  {
    id: "secretary",
    label: "Secretary",
    note: "Both entities, separate minute books.",
    assignments: [
      { role: "SECRETARY", entity: "JSOA" },
      { role: "SECRETARY", entity: "JSOF" },
    ],
  },
  {
    id: "treasurer-jsoa",
    label: "Treasurer, JSOA",
    assignments: [{ role: "TREASURER", entity: "JSOA" }],
  },
  {
    id: "treasurer-jsof",
    label: "Treasurer, JSOF",
    assignments: [{ role: "TREASURER", entity: "JSOF" }],
  },
  {
    id: "treasurer-store",
    label: "Treasurer + Store chair",
    note: "The real arrangement. Raises a critical controls finding.",
    assignments: [
      { role: "TREASURER", entity: "JSOA" },
      { role: "STORE_CHAIR", entity: "JSOA" },
    ],
  },
  {
    id: "fundraising",
    label: "Fundraising Chair",
    assignments: [
      { role: "FUNDRAISING_CHAIR", entity: "JSOA" },
      { role: "FUNDRAISING_CHAIR", entity: "JSOF" },
    ],
  },
  {
    id: "scholarships",
    label: "Scholarships Chair",
    assignments: [{ role: "SCHOLARSHIPS_CHAIR", entity: "JSOF" }],
  },
  {
    id: "memorial",
    label: "Memorial Chair",
    assignments: [{ role: "MEMORIAL_CHAIR", entity: "JSOA" }],
  },
  {
    id: "webmaster",
    label: "Webmaster",
    note: "Publishes, but cannot approve their own content.",
    assignments: [
      { role: "WEBMASTER", entity: "JSOA" },
      { role: "WEBMASTER", entity: "JSOF" },
    ],
  },
  {
    id: "comms",
    label: "Communications Chair",
    note: "Proposed seat. Drafts only.",
    assignments: [
      { role: "COMMUNICATIONS_CHAIR", entity: "JSOA" },
      { role: "COMMUNICATIONS_CHAIR", entity: "JSOF" },
    ],
  },
  {
    id: "finance-review",
    label: "Finance Review Officer",
    note: "Proposed seat. Read-only everywhere, enforced.",
    assignments: [
      { role: "FINANCE_REVIEW_OFFICER", entity: "JSOA" },
      { role: "FINANCE_REVIEW_OFFICER", entity: "JSOF" },
    ],
  },
  {
    id: "store-chair",
    label: "Store & Sales Chair",
    note:
      "Store chair alone, without the treasury. Shows the compliance report " +
      "but not the list of who bought what.",
    assignments: [{ role: "STORE_CHAIR", entity: "JSOA" }],
  },
  {
    id: "member",
    label: "Member",
    note: "No board grants at all. Use this to check a screen denies properly.",
    assignments: [{ role: "MEMBER", entity: "JSOA" }],
  },
  {
    id: "president-no-mfa",
    label: "President, MFA not satisfied",
    note:
      "Every grant the President holds, but the second factor was not " +
      "completed. Every board screen should refuse.",
    assignments: [
      { role: "PRESIDENT", entity: "JSOA" },
      { role: "PRESIDENT", entity: "JSOF" },
    ],
    mfaSatisfied: false,
  },
];

export const DEFAULT_PERSONA_ID = "president";

export function personaById(id: string | undefined): Persona {
  return (
    PERSONAS.find((persona) => persona.id === id) ??
    PERSONAS.find((persona) => persona.id === DEFAULT_PERSONA_ID)!
  );
}

export function subjectFor(persona: Persona): Subject {
  return {
    personId: `dev:${persona.id}`,
    assignments: persona.assignments,
    // MFA is satisfied by assumption in dev, because leaving it false by
    // default would make every screen look broken. One persona opts out so the
    // refusal is reachable from the browser and not only from a test.
    mfaSatisfied: persona.mfaSatisfied ?? true,
  };
}

/** Entities this subject holds any assignment on, for entity pickers. */
export function entitiesFor(subject: Subject): Entity[] {
  const seen = new Set<Entity>();
  for (const assignment of subject.assignments) seen.add(assignment.entity);
  return [...seen];
}

export function rolesFor(subject: Subject, entity: Entity): Role[] {
  return subject.assignments
    .filter((assignment) => assignment.entity === entity)
    .map((assignment) => assignment.role);
}

/** Findings for the signed-in persona, for the warning strip in the shell. */
export function findingsFor(subject: Subject) {
  return separationOfDutiesFindings(subject.personId, subject.assignments);
}
