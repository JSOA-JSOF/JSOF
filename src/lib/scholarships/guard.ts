/**
 * The guard every board-side scholarship function goes through.
 *
 * Calls `authorize()` from the shared policy engine with a data class, an
 * entity and a required level, lets it throw, and writes the attempt to the
 * module's append-only log either way. A denial is the more interesting record
 * of the two, so it is logged as its own action rather than dropped.
 *
 * Nothing in this file decides anything the policy engine could decide. It
 * adds exactly two things on top: the audit write, and the role predicates
 * below, which are about which seat a person holds rather than which grants
 * they have. The chair-only rule on disability verification is a seat rule:
 * the Family Support Chair holds APPLICANT_SENSITIVE WRITE for her own case
 * files and has no business in a scholarship applicant's.
 */

import type { DataClass, Entity, Level, Role } from "../authz/model";
import { authorize, can, AuthzError, type Subject } from "../authz/policy";

import type { ScholarshipRepository } from "./repository";
import { SCHOLARSHIP_ENTITY } from "./types";

export type GuardOptions = {
  action: string;
  dataClass: DataClass;
  required: Level;
  rowLevel: boolean;
  subjectRef?: string | null;
  entity?: Entity;
};

export async function guard(
  repo: ScholarshipRepository,
  subject: Subject,
  options: GuardOptions,
): Promise<void> {
  const entity = options.entity ?? SCHOLARSHIP_ENTITY;
  const base = {
    at: new Date().toISOString(),
    personId: subject.personId,
    dataClass: options.dataClass,
    entity,
    rowLevel: options.rowLevel,
    subjectRef: options.subjectRef ?? null,
  };
  try {
    authorize({
      subject,
      dataClass: options.dataClass,
      entity,
      required: options.required,
      rowLevel: options.rowLevel,
    });
  } catch (error) {
    await repo.appendAudit({ ...base, action: `${options.action}:DENIED` });
    throw error;
  }
  await repo.appendAudit({ ...base, action: options.action });
}

/** Append an entry without an authorization decision. For refusals of our own. */
export async function logRefusal(
  repo: ScholarshipRepository,
  subject: Subject,
  options: { action: string; dataClass: DataClass; subjectRef: string | null },
): Promise<void> {
  await repo.appendAudit({
    at: new Date().toISOString(),
    personId: subject.personId,
    action: options.action,
    dataClass: options.dataClass,
    entity: SCHOLARSHIP_ENTITY,
    rowLevel: true,
    subjectRef: options.subjectRef,
  });
}

/* ------------------------------------------------------------------ *
 * Seat predicates
 * ------------------------------------------------------------------ */

export function holdsRole(subject: Subject, role: Role, entity: Entity = SCHOLARSHIP_ENTITY): boolean {
  return subject.assignments.some((a) => a.role === role && a.entity === entity);
}

/**
 * The disability verification is the chair's, by seat and not only by grant.
 *
 * Checked in addition to `authorize()`, never instead of it: a subject still
 * has to hold APPLICANT_SENSITIVE WRITE on JSOF before this is even reached.
 */
export async function assertScholarshipsChair(
  repo: ScholarshipRepository,
  subject: Subject,
  action: string,
  subjectRef: string | null,
): Promise<void> {
  if (holdsRole(subject, "SCHOLARSHIPS_CHAIR")) return;
  await logRefusal(repo, subject, {
    action: `${action}:NOT_THE_CHAIR`,
    dataClass: "APPLICANT_SENSITIVE",
    subjectRef,
  });
  throw new AuthzError(
    `Denied: ${subject.personId} does not hold the Scholarships Chair seat on ` +
      `${SCHOLARSHIP_ENTITY}. Disability verification is the chair's alone.`,
    "DENIED",
  );
}

/**
 * The cheque run has two legitimate readers with different grants.
 *
 * The Treasurer holds FINANCIAL and no APPLICANT grant at all; the chair holds
 * APPLICANT and no FINANCIAL grant, because invariant 1 forbids anyone holding
 * write on both for one entity. The run itself carries no applicant identity,
 * only a school, an amount and an award reference, so either grant is enough
 * to read it and neither is widened to cover the other.
 *
 * A subject holding neither is refused, and which grant was used is written to
 * the log.
 */
export async function guardChequeRun(
  repo: ScholarshipRepository,
  subject: Subject,
  options: { action: string; required: Level },
): Promise<"FINANCIAL" | "APPLICANT"> {
  const financial = can({
    subject,
    dataClass: "FINANCIAL",
    entity: SCHOLARSHIP_ENTITY,
    required: options.required,
  });
  if (financial) {
    await guard(repo, subject, {
      action: `${options.action}:VIA_FINANCIAL`,
      dataClass: "FINANCIAL",
      required: options.required,
      rowLevel: false,
    });
    return "FINANCIAL";
  }
  // Falls through to the applicant grant, which throws on its own if absent.
  await guard(repo, subject, {
    action: `${options.action}:VIA_APPLICANT`,
    dataClass: "APPLICANT",
    required: options.required,
    rowLevel: false,
  });
  return "APPLICANT";
}
