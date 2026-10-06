/**
 * Reimbursement approval.
 *
 * The approval count comes from `requiresSecondApproval` in
 * `@/lib/authz/policy` and the self-approval refusal from
 * `assertNotSelfApproval`. Neither is re-implemented here: this file decides
 * who is eligible to approve at all, and what the resulting status is.
 *
 * Eligibility is `APPROVE_SPEND` plus read scope on FINANCIAL for the
 * reimbursement's own entity. That is why the Finance Review Officer cannot
 * approve a payment despite holding FINANCIAL READ on both entities: the
 * reviewer does not authorise spend. It is also why the President can, on
 * either entity, without holding WRITE on the ledger.
 */

import type { Entity } from "../authz/model";
import {
  assertNotSelfApproval,
  authorize,
  AuthzError,
  hasCapability,
  requiresSecondApproval,
  type Subject,
} from "../authz/policy";
import { formatCentsWithSymbol, TreasuryError } from "./money";
import type { Reimbursement, ReimbursementStatus } from "./types";

/** How many approvals this claim needs. One, or two above the thresholds. */
export function approvalsRequired(reimbursement: Reimbursement): number {
  return requiresSecondApproval(reimbursement.amountCents, reimbursement.relatedParty) ? 2 : 1;
}

export function statusFor(reimbursement: Reimbursement): ReimbursementStatus {
  if (reimbursement.status === "REFUSED" || reimbursement.status === "PAID") {
    return reimbursement.status;
  }
  const needed = approvalsRequired(reimbursement);
  const have = reimbursement.approvals.length;
  if (have >= needed) return "APPROVED";
  if (have > 0) return "AWAITING_SECOND_APPROVAL";
  return "SUBMITTED";
}

/** Why a second approval is needed, in the reader's terms. */
export function secondApprovalReason(reimbursement: Reimbursement): string | null {
  if (approvalsRequired(reimbursement) < 2) return null;
  if (reimbursement.relatedParty) {
    return (
      `Related party over ${formatCentsWithSymbol(25_000)}, so two approvals are ` +
      `required. ${reimbursement.relatedPartyNote}`
    ).trim();
  }
  return `Over ${formatCentsWithSymbol(100_000)}, so two approvals are required.`;
}

/**
 * Apply one approval. Throws with a specific message rather than a generic
 * refusal: the person is going to have to do something about it.
 */
export function approveReimbursement(
  subject: Subject,
  reimbursement: Reimbursement,
  approvedOn: string,
): Reimbursement {
  // Scope first: no reaching into the other entity's payables.
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity: reimbursement.entity,
    required: "READ",
  });

  if (!hasCapability(subject, "APPROVE_SPEND", reimbursement.entity)) {
    throw new TreasuryError(
      `${subject.personId} holds no spend-approval authority on ${reimbursement.entity}. ` +
        `Approval has to come from that entity's Treasurer or its President.`,
      "NOT_APPROVABLE",
    );
  }

  if (reimbursement.status === "REFUSED") {
    throw new TreasuryError(
      `${reimbursement.id} was refused and cannot be approved. Raise a new claim.`,
      "NOT_APPROVABLE",
    );
  }

  if (!reimbursement.receiptOnFile) {
    throw new TreasuryError(
      `No receipt on file for ${reimbursement.id}. Attach the receipt before approving; ` +
        `a reimbursement without one is an unsubstantiated payment to a board member.`,
      "NO_RECEIPT",
    );
  }

  // Invariant 2, straight from policy.ts. Not a warning, not a soft block.
  assertNotSelfApproval(subject.personId, reimbursement);

  if (reimbursement.approvals.some((a) => a.approverId === subject.personId)) {
    throw new TreasuryError(
      `${subject.personId} has already approved ${reimbursement.id}. A second approval ` +
        `has to come from a different person.`,
      "ALREADY_APPROVED",
    );
  }

  const approvals = [...reimbursement.approvals, { approverId: subject.personId, approvedOn }];
  const updated: Reimbursement = { ...reimbursement, approvals };
  return { ...updated, status: statusFor(updated) };
}

/**
 * The same decision without mutating anything, for rendering. Returns the
 * message to show when the approval would be refused.
 *
 * Persistence is deferred in this build (see docs/MODULE-BRIEF.md), so the
 * screen previews the outcome rather than pretending to write it.
 */
export type ApprovalPreview =
  | { allowed: true; resultingStatus: ReimbursementStatus; remainingApprovals: number }
  | { allowed: false; refusal: string; code: string };

export function previewApproval(
  subject: Subject,
  reimbursement: Reimbursement,
  approvedOn: string,
): ApprovalPreview {
  try {
    const next = approveReimbursement(subject, reimbursement, approvedOn);
    return {
      allowed: true,
      resultingStatus: next.status,
      remainingApprovals: Math.max(0, approvalsRequired(next) - next.approvals.length),
    };
  } catch (error) {
    if (error instanceof TreasuryError) {
      return { allowed: false, refusal: error.message, code: error.code };
    }
    if (error instanceof AuthzError) {
      return { allowed: false, refusal: error.message, code: error.code };
    }
    throw error;
  }
}

/** Claims a subject could act on, for the queue count. */
export function isApprovableBy(
  subject: Subject,
  reimbursement: Reimbursement,
  entity: Entity,
): boolean {
  if (reimbursement.entity !== entity) return false;
  return previewApproval(subject, reimbursement, "1970-01-01").allowed;
}
