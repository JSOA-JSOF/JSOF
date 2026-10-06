/**
 * Dev-only subject resolution for the demo board screens.
 *
 * This is NOT an auth system and it is not a stand-in for one. It reads a
 * role out of the query string so a reviewer can see what each role is
 * actually allowed to do. Auth.js with TOTP is the integration module's work;
 * when it lands, `subjectFromParam` is replaced by a session read and nothing
 * else in this module changes, because every handler already takes a
 * `Subject`.
 *
 * The default is a subject with no assignments, so an un-switched visit to a
 * board screen is denied rather than quietly permitted.
 */

import { ENTITIES, type Entity, type Role } from "../authz/model";
import type { Subject } from "../authz/policy";

export const DEV_SWITCHER_PARAM = "as";

export type DevRoleOption = {
  /** `TREASURER:JSOF` */
  value: string;
  label: string;
  role: Role;
  entity: Entity;
};

/** The roles worth switching between on a donations screen. */
export const DEV_ROLE_OPTIONS: DevRoleOption[] = [
  { value: "TREASURER:JSOF", label: "Treasurer, Foundation", role: "TREASURER", entity: "JSOF" },
  { value: "TREASURER:JSOA", label: "Treasurer, Association", role: "TREASURER", entity: "JSOA" },
  { value: "PRESIDENT:JSOF", label: "President, Foundation", role: "PRESIDENT", entity: "JSOF" },
  {
    value: "FUNDRAISING_CHAIR:JSOF",
    label: "Fundraising Chair, Foundation",
    role: "FUNDRAISING_CHAIR",
    entity: "JSOF",
  },
  {
    value: "FINANCE_REVIEW_OFFICER:JSOF",
    label: "Finance Review Officer, Foundation",
    role: "FINANCE_REVIEW_OFFICER",
    entity: "JSOF",
  },
  { value: "SECRETARY:JSOF", label: "Secretary, Foundation", role: "SECRETARY", entity: "JSOF" },
  {
    value: "SCHOLARSHIPS_CHAIR:JSOF",
    label: "Scholarships Chair, Foundation",
    role: "SCHOLARSHIPS_CHAIR",
    entity: "JSOF",
  },
  { value: "WEBMASTER:JSOF", label: "Webmaster, Foundation", role: "WEBMASTER", entity: "JSOF" },
  { value: "DONOR:JSOF", label: "Donor, signed in", role: "DONOR", entity: "JSOF" },
];

function isEntity(value: string): value is Entity {
  return (ENTITIES as readonly string[]).includes(value);
}

/** Nobody. Every authorize() call against this denies. */
export const ANONYMOUS_SUBJECT: Subject = {
  personId: "dev-nobody",
  assignments: [],
  mfaSatisfied: false,
};

export function subjectFromParam(param: string | string[] | undefined): Subject {
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw) return ANONYMOUS_SUBJECT;
  const option = DEV_ROLE_OPTIONS.find((o) => o.value === raw);
  if (!option) return ANONYMOUS_SUBJECT;
  return {
    personId: `dev-${option.role.toLowerCase()}-${option.entity.toLowerCase()}`,
    assignments: [{ role: option.role, entity: option.entity }],
    // The demo treats the switch itself as the MFA challenge. Nothing here
    // grants anything the role table does not already grant.
    mfaSatisfied: true,
  };
}

export function labelForParam(param: string | string[] | undefined): string {
  const raw = Array.isArray(param) ? param[0] : param;
  const option = DEV_ROLE_OPTIONS.find((o) => o.value === raw);
  return option ? option.label : "Not signed in";
}

/** Entity implied by the switch, for screens that need one. */
export function entityFromParam(
  param: string | string[] | undefined,
  fallback: Entity = "JSOF",
): Entity {
  const raw = Array.isArray(param) ? param[0] : param;
  const option = DEV_ROLE_OPTIONS.find((o) => o.value === raw);
  if (option) return option.entity;
  if (raw) {
    const [, tail] = raw.split(":");
    if (tail && isEntity(tail)) return tail;
  }
  return fallback;
}
