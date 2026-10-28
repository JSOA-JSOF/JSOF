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
  can,
  type RoleAssignment,
  type Subject,
} from "../authz/policy";
import {
  grantsMemberAccess,
  next as nextState,
  type MembershipState,
} from "./state";
import { database } from "../db";
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
  type RosterFilter,
  AUDIT_WINDOW_DAYS,
  EMPTY_ROSTER_FILTER,
  MEMBERSHIP_ENTITY,
  UNASSIGNED_FLAG_DAYS,
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

/**
 * What the queue says about who holds an item. E09.
 *
 * Unheld is rendered as unheld rather than as quietly everyone's, and an item
 * that has been unheld for longer than `UNASSIGNED_FLAG_DAYS` says so on the
 * row. `mayAssign` is computed from the role table rather than from a list of
 * roles kept here, so a role change does not need this file edited.
 */
export type ChairQueueView = {
  queue: Application[];
  decided: Application[];
  /** Ids of queue items unheld for longer than the flag window. */
  staleUnassigned: string[];
  /** Items currently held by the person looking. Criterion 3's "mine". */
  mine: string[];
  mayAssign: boolean;
};

export async function loadChairQueue(
  repo: MembershipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<ChairQueueView> {
  await guard(repo, subject, { action: "READ_CHAIR_QUEUE", required: "READ", rowLevel: true });
  await sweepExpiredVouches(repo, now);
  const queue = await repo.listApplications(["CHAIR_QUEUE"]);
  return {
    queue,
    decided: await repo.listApplications(["DECLINED"]),
    staleUnassigned: queue.filter((a) => isStaleUnassigned(a, now)).map((a) => a.id),
    mine: queue.filter((a) => a.assignedTo === subject.personId).map((a) => a.id),
    // READ can see the queue and its assignments; assigning is a write.
    mayAssign: can({
      subject,
      dataClass: "MEMBER_PII",
      entity: MEMBERSHIP_ENTITY,
      required: "WRITE",
    }),
  };
}

/** Unheld, and waiting longer than the flag window. A pure function so the screen holds no rule. */
export function isStaleUnassigned(application: Application, now: Date = new Date()): boolean {
  if (application.assignedTo) return false;
  const since = application.submittedAt ?? application.createdAt;
  const days = Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000);
  return days >= UNASSIGNED_FLAG_DAYS;
}

/** How long an item has been waiting, in whole days. For the row, not a report. */
export function daysWaiting(application: Application, now: Date = new Date()): number {
  const since = application.submittedAt ?? application.createdAt;
  return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000));
}

/**
 * Give a chair-queue item to a named reviewer, or take it back. E09.
 *
 * Four things this does that are not obvious from the name.
 *
 * **WRITE, not READ.** A role holding MEMBER_PII at READ sees the queue and
 * every assignment on it and cannot assign, which is the split acceptance
 * criterion 5 asks for. The President and the Secretary read; the office that
 * owns the roster acts.
 *
 * **It refuses to assign an item to its own applicant.** `assertNotSelfApproval`
 * already blocks the DECISION, and that is too late: an item assigned to
 * somebody who can never act on it sits there looking like work in hand. The
 * applicant is matched to a person by the address they applied with, which is
 * the only handle an unauthenticated applicant leaves.
 *
 * **It refuses anything not in CHAIR_QUEUE.** An application awaiting a sponsor
 * is not yet anybody's to hold, and one already decided is nobody's.
 *
 * **Reassignment is not an overwrite of the record.** `assigned_to` is one
 * column and the new reviewer replaces the old one there, because there is
 * exactly one current holder. Every assignment, reassignment and unassignment
 * writes a row to `membership_audit`, which is append-only by database trigger
 * and has no delete path in code, so the history is complete and nothing in it
 * can be rewritten. That is where "nothing is overwritten" is satisfied.
 */
export async function assignToReviewer(
  repo: MembershipRepository,
  subject: Subject,
  input: { applicationId: string; reviewerPersonId: string | null },
  now: Date = new Date(),
): Promise<Application> {
  const action = input.reviewerPersonId ? "ASSIGN_APPLICATION" : "UNASSIGN_APPLICATION";
  await guard(repo, subject, {
    action,
    required: "WRITE",
    rowLevel: true,
    // Who, to whom, and — through the entry's own `at` — when. Ids, never names.
    subjectRef: input.reviewerPersonId
      ? `${input.applicationId} to ${input.reviewerPersonId}`
      : input.applicationId,
  });

  const application = await repo.getApplication(input.applicationId);
  if (!application) throw new Error("No such application");
  if (application.state !== "CHAIR_QUEUE") {
    throw new Error("That application is not in the chair queue.");
  }

  if (input.reviewerPersonId) {
    // At assignment time, not only at decision time.
    assertNotSelfApproval(input.reviewerPersonId, {
      id: application.id,
      createdById: applicantPersonId(application),
      entity: MEMBERSHIP_ENTITY,
    });
  }

  return repo.assignApplication(
    application.id,
    input.reviewerPersonId,
    now.toISOString(),
  );
}

/**
 * Who an item may be given to.
 *
 * Derived from the role table: anybody holding MEMBER_PII at READ or better on
 * the Association could be asked to look at an application. It is not a list
 * of names kept in this file, because a membership committee is a role-grant
 * decision the board has not taken yet and `src/lib/authz/**` is never edited
 * by a module.
 *
 * The caller supplies the candidates, because resolving people to ids is the
 * identity module's job and this module must not grow a directory of its own.
 * What belongs here is the rule for filtering them.
 */
export function eligibleReviewers<T extends { personId: string; assignments: RoleAssignment[] }>(
  candidates: T[],
): T[] {
  return candidates.filter((candidate) =>
    can({
      subject: { personId: candidate.personId, assignments: candidate.assignments, mfaSatisfied: true },
      dataClass: "MEMBER_PII",
      entity: MEMBERSHIP_ENTITY,
      required: "READ",
    }),
  );
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

  await enqueue({
    kind: "DECISION_NOTICE",
    to: application.email || null,
    toName: application.applicantName || null,
    subject:
      input.outcome === "APPROVED"
        ? "Your JSOA membership application: dues payment"
        : "Your JSOA membership application",
    stream: "TRANSACTIONAL",
    body:
      input.outcome === "APPROVED"
        ? `Your application for membership of the Joint Special Operations ` +
          `Association has been accepted.\n\n` +
          `To pay the dues, open /apply/pay/${application.id}\n\n` +
          `Dues are $200, paid once and not renewed, and they are not a ` +
          `charitable contribution.`
        : `Your application for membership of the Joint Special Operations ` +
          `Association has not been accepted.\n\n` +
          `Nothing was charged and nothing can be. If you want to talk to ` +
          `somebody about it, write to the membership chair quoting your ` +
          `reference, ${application.reference}.`,
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
  /** The rows to render. Filtered, if a filter was given. */
  members: Member[];
  /** Of the rows rendered, how many hold member access. */
  counted: number;
  /** Of the rows rendered, how many do not. */
  offRoster: number;
  /** Every record, before the filter. So "12 of 43" can be said honestly. */
  total: number;
  /** What was applied, echoed back so the screen holds no state of its own. */
  filter: RosterFilter;
  /** The sponsor IDs that appear on the roster, for the filter control. */
  sponsorMemberIds: string[];
};

/**
 * Does this record match? Pure, so the rule is testable without a repository
 * and without a Subject.
 *
 * `q` matches a partial display name, a partial member number or a partial
 * email, case-insensitively, and nothing else. The member number is in every
 * result because two members with the same name is common here and the chair
 * has to disambiguate on something other than a name before acting.
 */
export function matchesRosterFilter(member: Member, filter: RosterFilter): boolean {
  const q = filter.q.trim().toLowerCase();
  if (q) {
    const haystack = [member.displayName, member.memberId, member.email]
      .join("\u0000")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filter.state && member.state !== filter.state) return false;
  if (filter.category && member.membershipCategory !== filter.category) return false;
  if (filter.sponsorMemberId) {
    const wanted = filter.sponsorMemberId.trim().toUpperCase();
    if ((member.sponsorMemberId ?? "").toUpperCase() !== wanted) return false;
  }
  return true;
}

/**
 * The roster. READ, row level, logged. VP Operations and both Treasurers hold
 * AGGREGATE on MEMBER_PII and so cannot open this, which is the point.
 *
 * Search and filter. E13. Three things about how they are done.
 *
 * **The audit entry does not record what was searched for.** One `READ_ROSTER`
 * row, with the same `subjectRef` whether the search matched everything or
 * nothing. The log records that the roster was opened, because that is the
 * fact that matters here; a log of queries would be a second, searchable
 * record of who the office was looking for, which is a worse thing to hold
 * than the roster.
 *
 * **The filter is applied after the read, in memory.** `listMembers()` loads
 * the whole table and sorts in memory, which at a few hundred members is fine
 * and which stops being reasonable somewhere around a few thousand rows — a
 * number this organization will not reach. Said out loud rather than left for
 * somebody to discover: when it does, this becomes a WHERE clause and a
 * COUNT, not a page size.
 *
 * **`counted` and `offRoster` describe the rows rendered**, so the figures at
 * the top of the screen always agree with the rows underneath. `total` is the
 * whole roster, which is how the screen can say "11 of 43" without either
 * number being a lie.
 */
export async function loadRoster(
  repo: MembershipRepository,
  subject: Subject,
  filter: RosterFilter = EMPTY_ROSTER_FILTER,
): Promise<RosterView> {
  await guard(repo, subject, { action: "READ_ROSTER", required: "READ", rowLevel: true });
  const members = await repo.listMembers();
  const sorted = [...members]
    .filter((m) => matchesRosterFilter(m, filter))
    .sort((a, b) => a.memberId.localeCompare(b.memberId));
  return {
    members: sorted,
    counted: sorted.filter((m) => grantsMemberAccess(m.state)).length,
    offRoster: sorted.filter((m) => !grantsMemberAccess(m.state)).length,
    total: members.length,
    filter,
    sponsorMemberIds: [
      ...new Set(members.map((m) => m.sponsorMemberId).filter((s): s is string => Boolean(s))),
    ].sort(),
  };
}

/* ------------------------------------------------------------------ *
 * Chair-side contact correction. E30's half that is buildable today.
 * ------------------------------------------------------------------ */

/**
 * Why an email change can be refused, in words the screen can print.
 *
 * `EMAIL_TAKEN` deliberately does not say by whom. A refusal that names the
 * holder turns a correction form into a lookup for "is this address a member
 * here", which is the same question `/apply` is built never to answer.
 */
export const CONTACT_REFUSALS = {
  NOTHING_TO_CHANGE: "Nothing was changed, because nothing was different.",
  NO_REASON:
    "Record why you are changing it. A contact correction with no reason is a " +
    "change nobody can account for later.",
  EMAIL_TAKEN:
    "That address cannot be used. Check it with the member on the phone and try " +
    "another, or leave the address as it is.",
  NO_IDENTITY_STORE:
    "This member holds an account, and the identity record cannot be reached " +
    "from here, so the address was not changed. Changing one of the two and not " +
    "the other would leave them unable to sign in. Nothing was changed.",
} as const;

export class ContactCorrectionError extends Error {
  constructor(readonly code: keyof typeof CONTACT_REFUSALS) {
    super(CONTACT_REFUSALS[code]);
    this.name = "ContactCorrectionError";
  }
}

/**
 * Correct a member's email or phone, chair side, with a reason recorded.
 *
 * This is the method that did not exist. Correcting a typo'd address meant
 * editing the database by hand, and a hand edit does not appear in
 * `membership_audit` because it did not go through the application. Needed on
 * day one and independently of any member-facing version, because the
 * Submittable import will land records with bad addresses in them.
 *
 * The procedure around it is the VP's and the board should bless it: the chair
 * acts after a phone call, the change is logged, a notice goes to the address
 * being replaced, and never on an emailed request alone — an emailed request
 * to change an email address is the attack.
 *
 * What it will NOT do:
 *
 *   - change a name, category, service dates, standing or sponsor. Those are
 *     the compliance fields and they move with a decision behind them;
 *   - change the email of a member who holds an account when there is no
 *     identity store to keep in step. `person.email` is the identity and
 *     `member.email` is the roster contact; both move together or neither
 *     does, and the D1 repository does them in one batch. Where there is no
 *     database — `next dev` with no Worker, or the test suite — this refuses
 *     rather than writing half of it;
 *   - tell anybody whose address they collided with.
 */
export async function correctMemberContact(
  repo: MembershipRepository,
  subject: Subject,
  input: { memberId: string; email?: string; phone?: string; reason: string },
  now: Date = new Date(),
): Promise<Member> {
  await guard(repo, subject, {
    action: "UPDATE_MEMBER_CONTACT",
    required: "WRITE",
    rowLevel: true,
    subjectRef: input.memberId,
  });

  const member = await repo.getMember(input.memberId);
  if (!member) throw new Error("No such member");
  if (!input.reason.trim()) throw new ContactCorrectionError("NO_REASON");

  const email = input.email?.trim();
  const phone = input.phone?.trim();
  const emailChanged = email !== undefined && email !== "" && email !== member.email;
  const phoneChanged = phone !== undefined && phone !== "" && phone !== member.phone;
  if (!emailChanged && !phoneChanged) throw new ContactCorrectionError("NOTHING_TO_CHANGE");

  if (emailChanged) {
    if (member.personId && !identityStoreReachable()) {
      throw new ContactCorrectionError("NO_IDENTITY_STORE");
    }
    if (await addressIsTaken(repo, email!, member.id)) {
      throw new ContactCorrectionError("EMAIL_TAKEN");
    }
  }

  const previousEmail = member.email;
  const updated = await repo.updateMemberContact(
    member.id,
    {
      ...(emailChanged ? { email } : {}),
      ...(phoneChanged ? { phone } : {}),
    },
    { alsoPersonEmail: emailChanged && Boolean(member.personId) },
  );

  await repo.appendAudit({
    at: now.toISOString(),
    personId: subject.personId,
    action: emailChanged ? "MEMBER_EMAIL_CORRECTED" : "MEMBER_PHONE_CORRECTED",
    dataClass: "MEMBER_PII",
    entity: MEMBERSHIP_ENTITY,
    rowLevel: true,
    // The member number and the stated reason. Never the old or new address:
    // the audit log would otherwise hold a history of every address the
    // organization has ever had for a person, which is more than it needs.
    subjectRef: `${member.memberId}: ${input.reason.trim()}`,
  });

  /* A notice to the address being REPLACED, not to the new one. It is what
     makes a change visible to its owner, including the spouse-updating-the-
     record case the controls do not stop and should not try to. */
  if (emailChanged) {
    await enqueue({
      kind: "CONTACT_CHANGE_NOTICE",
      to: previousEmail || null,
      toName: member.displayName,
      subject: "The email address on your JSOA membership has been changed",
      stream: "TRANSACTIONAL",
      body:
        `The membership chair has changed the email address held for your ` +
        `membership, ${member.memberId}, at your request.\n\n` +
        `This notice went to the address we held before the change. If it was ` +
        `not you, telephone the membership chair. Do not reply to this message ` +
        `to ask for it to be undone: a request by email to change an email ` +
        `address is not something we act on.`,
    });
  }

  return updated;
}

/**
 * Is this address already in use, as a roster contact or as an identity?
 *
 * Two lookups, because the two things are different: `member.email` is not
 * unique — a shared family mailbox is normal in this population — while
 * `person.email` IS unique and a collision there would fail the write. The
 * identity lookup is a read-only call into the auth module, which is the one
 * register the spine says there is exactly one of, and a failure there
 * degrades to "unknown" rather than taking the correction out.
 */
async function addressIsTaken(
  repo: MembershipRepository,
  email: string,
  exceptMemberId: string,
): Promise<boolean> {
  const onRoster = await repo.getMemberByEmail(email);
  if (onRoster && onRoster.id !== exceptMemberId) return true;
  try {
    const { personByEmail } = await import("../auth/store");
    const person = await personByEmail(email);
    if (!person) return false;
    const theirs = await repo.getMemberByPersonId(person.id);
    return theirs === null || theirs.id !== exceptMemberId;
  } catch {
    // No identity store reachable. Not a refusal: the roster check above
    // stands, and the database's own UNIQUE constraint is the backstop.
    return false;
  }
}

/**
 * Whether there is an identity store to write to at all.
 *
 * The same accessor the repositories use, so this answers "is there a
 * database" rather than "is there a module". Null is a normal state: `next
 * dev` with no Worker behind it has no binding and the test suite has no
 * Worker at all.
 */
function identityStoreReachable(): boolean {
  return Boolean(database());
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
    await enqueue({
      kind: "CHAIR_NOTICE",
      to: PRESIDENT_INBOX,
      subject: "A 30-day record audit produced a held finding",
      stream: "TRANSACTIONAL",
      body:
        `The 30-day record audit on member ${member.memberId} produced a ` +
        `finding, and the finding is held rather than acted on.\n\n` +
        `${REVOCATION_HELD_REASON}\n\n` +
        `Note recorded: ${input.note.trim() || "none"}`,
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
