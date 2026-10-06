/**
 * Authorization for the minute book.
 *
 * Every function here calls `authorize()` from `@/lib/authz/policy` first.
 * Nothing here re-implements, relaxes or works around it.
 *
 * ── The mapping, and why ────────────────────────────────────────────
 *
 * Meetings are not one of the five data classes. They had to be mapped onto
 * one, and the mapping is by what the record actually contains:
 *
 *   Agenda and compliance calendar → MEMBER_PII at AGGREGATE.
 *     Neither names a person. An agenda item's owner is a ROLE, and a filing's
 *     owner is a ROLE, deliberately, the same way the public tier lists
 *     contacts by function. So these need a board grant but not row-level
 *     reach. That admits the Treasurer and VP Operations, who both hold
 *     AGGREGATE and both legitimately need to read an agenda they are on.
 *
 *   Minutes and the decision register → MEMBER_PII at READ, row level.
 *     These name people: who moved, who seconded, who recused and why. That is
 *     member PII at row level and it is audited as such. The Treasurer's
 *     AGGREGATE is not enough, which is correct: the Treasurer needs the
 *     decision, and gets it as the minute reference on the transaction, not as
 *     the roll call.
 *
 * ── The gap ─────────────────────────────────────────────────────────
 *
 * SECRETARY holds MEMBER_PII: READ, FINANCIAL: AGGREGATE, APPLICANT:
 * AGGREGATE, AUDIT_LOG: READ. It holds WRITE on nothing, on either entity.
 * So there is no data class on which `authorize({ required: "WRITE" })` lets
 * the Secretary write the minute book, and the only roles that could write it
 * under a MEMBER_PII/WRITE gate are VP Membership (JSOA only) and a
 * break-glass Webmaster. That is not a minute book, that is a roster.
 *
 * `src/lib/authz/**` is read-only to modules, so this is not mine to change.
 * What this file does instead is ADD a requirement rather than remove one:
 *
 *     authorize(MEMBER_PII, READ, row level)   ← the shared policy, unchanged
 *     then assertMinuteBookCustody()           ← plus the office of Secretary
 *
 * The result is strictly narrower than the shared policy alone: the only
 * person who can write a JSOA minute is a Secretary of JSOA who also passes
 * `authorize()`. Custody of the minute book is an office, not an access level,
 * and the President reading the book is not the President keeping it.
 *
 * This is raised in the module report. If the platform would rather express it
 * as a grant, the role table needs a class the Secretary can hold WRITE on,
 * and that is an edit to shared code.
 */

import type { DataClass, Entity, Level, Role } from "../authz/model";
import { AuthzError, authorize, can, type Subject } from "../authz/policy";

/** The class the minute book is filed under. See the note above. */
export const MINUTE_BOOK_CLASS: DataClass = "MEMBER_PII";

/** Reading an agenda or the compliance calendar. No identity in either record. */
export const GOVERNANCE_READ_LEVEL: Level = "AGGREGATE";

/** Reading minutes or the decision register. Both name people at row level. */
export const MINUTE_READ_LEVEL: Level = "READ";

/** The office that keeps the book. Not an access level. */
export const MINUTE_BOOK_CUSTODIAN: Role = "SECRETARY";

export class MinuteBookAccessError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_THE_CUSTODIAN",
  ) {
    super(message);
    this.name = "MinuteBookAccessError";
  }
}

/** Agenda, calendar, meeting list. */
export function authorizeGovernanceRead(subject: Subject, entity: Entity): void {
  authorize({
    subject,
    dataClass: MINUTE_BOOK_CLASS,
    entity,
    required: GOVERNANCE_READ_LEVEL,
  });
}

/** Minutes, decision register. Row level, so the read is audited. */
export function authorizeMinuteRead(subject: Subject, entity: Entity): void {
  authorize({
    subject,
    dataClass: MINUTE_BOOK_CLASS,
    entity,
    required: MINUTE_READ_LEVEL,
    rowLevel: true,
  });
}

/**
 * The office check. Additive to `authorize()`, never a substitute for it.
 * Entity-scoped: a Secretary of JSOA is not a Secretary of JSOF, which is the
 * whole point of two books.
 */
export function assertMinuteBookCustody(subject: Subject, entity: Entity): void {
  const holds = subject.assignments.some(
    (a) => a.entity === entity && a.role === MINUTE_BOOK_CUSTODIAN,
  );
  if (!holds) {
    throw new MinuteBookAccessError(
      `${subject.personId} does not hold the office of Secretary for ${entity}, ` +
        `so cannot write in the ${entity} minute book. Reading it is a separate ` +
        `question and may well be allowed.`,
      "NOT_THE_CUSTODIAN",
    );
  }
}

/**
 * Writing anything into the book: a minute, an agenda item, a notice, a
 * transcript draft. Shared policy first, then custody.
 */
export function authorizeMinuteWrite(subject: Subject, entity: Entity): void {
  authorizeMinuteRead(subject, entity);
  assertMinuteBookCustody(subject, entity);
}

/**
 * Editing the agenda. Same custody rule: the Secretary builds and circulates
 * the agenda. Owners propose items to the Secretary; they do not write the
 * book.
 */
export function authorizeAgendaWrite(subject: Subject, entity: Entity): void {
  authorizeMinuteRead(subject, entity);
  assertMinuteBookCustody(subject, entity);
}

/* ------------------------------------------------------------------ *
 * Non-throwing forms, for deciding what to render rather than what to
 * refuse. A page that hides a control the viewer cannot use is kinder
 * than one that offers it and then throws.
 * ------------------------------------------------------------------ */

export function canReadGovernance(subject: Subject, entity: Entity): boolean {
  return can({
    subject,
    dataClass: MINUTE_BOOK_CLASS,
    entity,
    required: GOVERNANCE_READ_LEVEL,
  });
}

export function canReadMinutes(subject: Subject, entity: Entity): boolean {
  return can({
    subject,
    dataClass: MINUTE_BOOK_CLASS,
    entity,
    required: MINUTE_READ_LEVEL,
    rowLevel: true,
  });
}

export function canWriteMinutes(subject: Subject, entity: Entity): boolean {
  if (!canReadMinutes(subject, entity)) return false;
  try {
    assertMinuteBookCustody(subject, entity);
    return true;
  } catch {
    return false;
  }
}

/** Entities this subject may see at all, in a fixed order. */
export function readableEntities(subject: Subject, entities: readonly Entity[]): Entity[] {
  return entities.filter((entity) => canReadGovernance(subject, entity));
}

/** Human-readable reason a request was refused, for the UI. */
export function refusalMessage(error: unknown): string {
  if (error instanceof MinuteBookAccessError) return error.message;
  if (error instanceof AuthzError) {
    return (
      "This role does not reach the minute book for that entity. " +
      "The minute book names who moved, who seconded and who recused, so it " +
      "sits behind row-level access, not aggregate access."
    );
  }
  return error instanceof Error ? error.message : "The request was refused.";
}
