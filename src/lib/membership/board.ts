/**
 * The board layer: the four queues and the composition report.
 *
 * Everything in this file starts with `authorize()`. Not "checks a role", not
 * "hides a link": calls the shared policy engine with a data class, an entity
 * and a required level, and lets it throw. The route files below `/board`
 * render whatever these functions return and hold no policy of their own.
 *
 * Two levels are used, and the difference is the interesting part:
 *
 *   READ       for anything that shows a person — the application queue, the
 *              roster, the chair queue, the audit cohort.
 *   AGGREGATE  for the composition report, which is counts and percentages and
 *              nothing else.
 *
 * That split is why VP Operations and both Treasurers can open the composition
 * report and cannot open the roster. Several roles hold AGGREGATE where READ
 * would be the lazy assumption, and the report was built to fit the weaker
 * grant rather than the grant being widened to fit the report.
 *
 * Row-level reads of MEMBER_PII are written to the audit log, not only writes.
 * Denials are logged too: an attempt that failed is the more interesting
 * record. The log is module-local until the integration module lands the
 * shared one, and it has no delete path.
 */

import { type Level } from "../authz/model";
import {
  assertNotSelfApproval,
  authorize,
  AuthzError,
  type Subject,
} from "../authz/policy";
import {
  grantsMemberAccess,
  next as nextState,
  type MembershipState,
} from "./state";
import { buildCompositionReport, recordFindings } from "./composition";
import { personIdForEmail, PRESIDENT_INBOX } from "./contacts";
import { enqueue } from "./notify";
import type { MembershipRepository } from "./repository";
import { sweepExpiredVouches } from "./vouch";
import {
  type Application,
  type CohortAuditRow,
  type CompositionReport,
  type Member,
  type MembershipAuditEntry,
  AUDIT_WINDOW_DAYS,
  MEMBERSHIP_ENTITY,
} from "./types";

/* ------------------------------------------------------------------ *
 * The guard
 * ------------------------------------------------------------------ */

async function guard(
  repo: MembershipRepository,
  subject: Subject,
  options: { action: string; required: Level; rowLevel: boolean; subjectRef?: string | null },
): Promise<void> {
  const base = {
    at: new Date().toISOString(),
    personId: subject.personId,
    dataClass: "MEMBER_PII" as const,
    entity: MEMBERSHIP_ENTITY,
    rowLevel: options.rowLevel,
    subjectRef: options.subjectRef ?? null,
  };
  try {
    authorize({
      subject,
      dataClass: "MEMBER_PII",
      entity: MEMBERSHIP_ENTITY,
      required: options.required,
      rowLevel: options.rowLevel,
    });
  } catch (error) {
    await repo.appendAudit({ ...base, action: `${options.action}:DENIED` });
    throw error;
  }
  await repo.appendAudit({ ...base, action: options.action });
}

/* ------------------------------------------------------------------ *
 * Queue 1: applications awaiting a vouch
 * ------------------------------------------------------------------ */

export type ApplicationQueue = {
  awaitingVouch: Application[];
  awaitingPayment: Application[];
  sweptToChair: number;
};

export async function loadApplicationQueue(
  repo: MembershipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<ApplicationQueue> {
  await guard(repo, subject, {
    action: "READ_APPLICATION_QUEUE",
    required: "READ",
    rowLevel: true,
  });
  // The 72-hour window closes whether or not anyone is looking. In production
  // this is a scheduled job; here the queue sweeps on load so the demo needs
  // no scheduler.
  const sweptToChair = await sweepExpiredVouches(repo, now);
  return {
    awaitingVouch: await repo.listApplications(["AWAITING_VOUCH"]),
    awaitingPayment: await repo.listApplications(["AWAITING_PAYMENT"]),
    sweptToChair,
  };
}

/* ------------------------------------------------------------------ *
 * Queue 2: the chair exception queue
 * ------------------------------------------------------------------ */

export async function loadChairQueue(
  repo: MembershipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<{ queue: Application[]; decided: Application[] }> {
  await guard(repo, subject, { action: "READ_CHAIR_QUEUE", required: "READ", rowLevel: true });
  await sweepExpiredVouches(repo, now);
  return {
    queue: await repo.listApplications(["CHAIR_QUEUE"]),
    decided: await repo.listApplications(["DECLINED"]),
  };
}

/**
 * Approve or deny a chair exception.
 *
 * Requires WRITE, so the President and the Secretary can read this queue and
 * cannot decide in it. The no-self-approval invariant is applied to the
 * application: a board member who applies for membership is an applicant like
 * any other and cannot be the one who approves it. The check is real rather
 * than decorative because the applicant is matched to a person by the address
 * they applied with.
 */
export async function decideChairException(
  repo: MembershipRepository,
  subject: Subject,
  input: { applicationId: string; outcome: "APPROVED" | "DENIED"; reason: string },
  now: Date = new Date(),
): Promise<Application> {
  await guard(repo, subject, {
    action: `CHAIR_DECISION_${input.outcome}`,
    required: "WRITE",
    rowLevel: true,
    subjectRef: input.applicationId,
  });

  const application = await repo.getApplication(input.applicationId);
  if (!application) throw new Error("No such application");
  if (application.state !== "CHAIR_QUEUE") {
    throw new Error("That application is not in the chair queue.");
  }

  assertNotSelfApproval(subject.personId, {
    id: application.id,
    createdById: applicantPersonId(application),
    entity: MEMBERSHIP_ENTITY,
  });

  const resolved = nextState(
    application.state,
    input.outcome === "APPROVED"
      ? { type: "CHAIR_APPROVED", chairPersonId: subject.personId }
      : { type: "CHAIR_DENIED", chairPersonId: subject.personId },
  );

  const decided = await repo.recordChairDecision(
    application.id,
    {
      at: now.toISOString(),
      chairPersonId: subject.personId,
      outcome: input.outcome,
      reason: input.reason.trim() || "No reason recorded.",
    },
    resolved,
  );

  enqueue({
    kind: "DECISION_NOTICE",
    to: application.email,
    subject:
      input.outcome === "APPROVED"
        ? "Your JSOA membership application: dues payment"
        : "Your JSOA membership application",
    deliverable: true,
    ref: application.id,
  });

  return decided;
}

/**
 * Who, if anyone, this applicant is as a person. An applicant reaching /apply
 * is unauthenticated, so the only handle is the address they applied with.
 * A real identity module resolves this properly; the shape is what matters.
 */
function applicantPersonId(application: Application): string {
  return personIdForEmail(application.email) ?? `applicant:${application.id}`;
}

/* ------------------------------------------------------------------ *
 * Queue 3: the roster
 * ------------------------------------------------------------------ */

export type RosterView = {
  members: Member[];
  counted: number;
  offRoster: number;
};

/**
 * The roster. READ, row level, logged. VP Operations and both Treasurers hold
 * AGGREGATE on MEMBER_PII and so cannot open this, which is the point.
 */
export async function loadRoster(
  repo: MembershipRepository,
  subject: Subject,
): Promise<RosterView> {
  await guard(repo, subject, { action: "READ_ROSTER", required: "READ", rowLevel: true });
  const members = await repo.listMembers();
  const sorted = [...members].sort((a, b) => a.memberId.localeCompare(b.memberId));
  return {
    members: sorted,
    counted: sorted.filter((m) => grantsMemberAccess(m.state)).length,
    offRoster: sorted.filter((m) => !grantsMemberAccess(m.state)).length,
  };
}

/* ------------------------------------------------------------------ *
 * Queue 4: the 30-day cohort audit
 * ------------------------------------------------------------------ */

export async function loadCohortAudit(
  repo: MembershipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<{ rows: CohortAuditRow[]; dueCount: number }> {
  await guard(repo, subject, { action: "READ_COHORT_AUDIT", required: "READ", rowLevel: true });
  const members = await repo.listMembers();
  const rows: CohortAuditRow[] = members
    .filter((m) => m.state === "PROBATIONARY")
    .map((member) => {
      const cleared = member.paymentClearedAt ? new Date(member.paymentClearedAt).getTime() : null;
      const daysSincePayment =
        cleared === null ? 0 : Math.floor((now.getTime() - cleared) / 86_400_000);
      return {
        member,
        daysSincePayment,
        dueNow: daysSincePayment >= AUDIT_WINDOW_DAYS,
        recordFindings: recordFindings(member),
      };
    })
    .sort((a, b) => b.daysSincePayment - a.daysSincePayment);
  return { rows, dueCount: rows.filter((r) => r.dueNow).length };
}

/**
 * Why there is no fail-and-revoke button here.
 *
 * The state machine has AUDIT_FAILED going to REVOKED, and this module does
 * not call it. NC's nonprofit statute has no notice period and no hearing
 * requirement for expulsion, so what revocation means for this organization
 * comes from its bylaws and the bylaws do not yet say. docs/PRIVACY-AND-PAYMENTS.md
 * is explicit that the platform must not ship a revoke button until they do.
 *
 * So the audit records a pass, or it records a finding and holds. A held
 * finding is a real outcome: it is on the record, it is in the audit log, and
 * it is in front of the chair. What it is not is an automatic expulsion
 * nobody has defined.
 */
export const REVOCATION_HELD_REASON =
  "Revocation is held pending the bylaws. NC's nonprofit statute sets no notice " +
  "period and no hearing requirement, so what an expulsion means here is a " +
  "bylaws question, not a platform default. The finding is recorded and the " +
  "member keeps access until the board decides.";

export async function recordCohortAudit(
  repo: MembershipRepository,
  subject: Subject,
  input: { memberId: string; outcome: "PASSED" | "HELD"; note: string },
  now: Date = new Date(),
): Promise<Member> {
  await guard(repo, subject, {
    action: `COHORT_AUDIT_${input.outcome}`,
    required: "WRITE",
    rowLevel: true,
    subjectRef: input.memberId,
  });

  const member = await repo.getMember(input.memberId);
  if (!member) throw new Error("No such member");
  if (member.state !== "PROBATIONARY") {
    throw new Error("That member is not in the probationary cohort.");
  }

  if (input.outcome === "HELD") {
    // Deliberately no transition. See REVOCATION_HELD_REASON.
    await repo.appendAudit({
      at: now.toISOString(),
      personId: subject.personId,
      action: "COHORT_AUDIT_FINDING_HELD",
      dataClass: "MEMBER_PII",
      entity: MEMBERSHIP_ENTITY,
      rowLevel: true,
      subjectRef: member.memberId,
    });
    enqueue({
      kind: "CHAIR_NOTICE",
      to: PRESIDENT_INBOX,
      subject: "A 30-day record audit produced a held finding",
      deliverable: true,
      ref: member.memberId,
    });
    return member;
  }

  const resolved = nextState(member.state, { type: "AUDIT_PASSED", auditedById: subject.personId });
  return repo.setMemberState(member.id, resolved, now.toISOString());
}

/* ------------------------------------------------------------------ *
 * The composition report
 * ------------------------------------------------------------------ */

/**
 * AGGREGATE, not READ, and not row level. The report is counts and
 * percentages: it names nobody, so it does not need a grant that can name
 * anybody. Written to fit the weaker grant on purpose, because the roles that
 * most need to see a failing exemption test — VP Operations, both Treasurers —
 * are exactly the roles that hold aggregate only.
 */
export async function loadCompositionReport(
  repo: MembershipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<CompositionReport> {
  await guard(repo, subject, {
    action: "READ_COMPOSITION_REPORT",
    required: "AGGREGATE",
    rowLevel: false,
    subjectRef: "aggregate",
  });
  return buildCompositionReport(await repo.listMembers(), now);
}

/* ------------------------------------------------------------------ *
 * The audit log itself
 * ------------------------------------------------------------------ */

export async function loadMembershipAudit(
  repo: MembershipRepository,
  subject: Subject,
  limit = 60,
): Promise<MembershipAuditEntry[]> {
  // Reading who looked at the roster is itself an AUDIT_LOG read. The Secretary
  // and the President hold it; VP Membership does not, which is correct: the
  // person who writes the roster should not be the person who curates the
  // record of who read it.
  try {
    authorize({ subject, dataClass: "AUDIT_LOG", entity: MEMBERSHIP_ENTITY, required: "READ" });
  } catch (error) {
    if (error instanceof AuthzError) return [];
    throw error;
  }
  return repo.listAudit(limit);
}

export function stateLabel(state: MembershipState): string {
  return state.toLowerCase().replace(/_/g, " ");
}
