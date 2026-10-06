/**
 * Inter-entity transfers: the rule checklist, and the gate.
 *
 * Two layers, deliberately:
 *
 *   - `assertTransferApprovable` in `@/lib/authz/policy` is the AUTHORITY. It
 *     throws, and `recordTransfer` below calls it before anything is written.
 *     Nothing here re-implements it or works around it.
 *
 *   - `transferRuleStatuses` is the EXPLANATION. The policy assertion stops at
 *     the first broken rule, which is right for a gate and useless for a form:
 *     a treasurer filling this in needs to see every outstanding condition at
 *     once, and needs to be told which one, not "invalid". So this function
 *     evaluates each condition independently and reports all of them.
 *
 * Two conditions here are treasury's own and are not in policy.ts: the written
 * restriction statement, and the President's recusal on the receiving side.
 * The recusal is stated in docs/ARCHITECTURE.md and in the mitigation text of
 * the both-treasuries finding, but policy.ts does not check it, so this module
 * does, and `recordTransfer` refuses without it.
 */

import { type Entity, type Role } from "../authz/model";
import {
  assertTransferApprovable,
  AuthzError,
  type RoleAssignment,
} from "../authz/policy";
import { TreasuryError } from "./money";
import { PEOPLE, personName } from "./seed";
import type { Transfer } from "./types";

/** Minimum length for a restriction statement, so "n/a" cannot pass. */
export const RESTRICTION_STATEMENT_MIN_LENGTH = 20;

export type TransferRuleId =
  | "CROSSES_ENTITIES"
  | "AMOUNT_STATED"
  | "TREASURER_APPROVAL_SENDING"
  | "TREASURER_APPROVAL_RECEIVING"
  | "NO_SELF_APPROVAL"
  | "MINUTE_REF_SENDING"
  | "MINUTE_REF_RECEIVING"
  | "RESTRICTION_STATEMENT"
  | "PRESIDENT_RECUSED_RECEIVING";

export type TransferRule = {
  id: TransferRuleId;
  /** What the rule requires, in the reader's terms. */
  requirement: string;
  met: boolean;
  /** Shown only when unmet. Says which rule and what to do about it. */
  unmetMessage: string;
  /** Where the rule comes from, so nobody deletes it as a UI nicety. */
  source: "policy.ts" | "treasury";
};

/** Who holds what. Defaults to the seeded board; injectable for tests. */
export type RoleDirectory = (personId: string) => RoleAssignment[];

export const seededRoleDirectory: RoleDirectory = (personId) =>
  PEOPLE.find((p) => p.id === personId)?.assignments ?? [];

function holdsRole(
  directory: RoleDirectory,
  personId: string,
  role: Role,
  entity: Entity,
): boolean {
  return directory(personId).some((a) => a.role === role && a.entity === entity);
}

function entityLabel(entity: Entity): string {
  return entity === "JSOA" ? "the Association" : "the Foundation";
}

/**
 * Every condition, evaluated independently, in the order a treasurer works
 * through the form.
 */
export function transferRuleStatuses(
  transfer: Transfer,
  directory: RoleDirectory = seededRoleDirectory,
): TransferRule[] {
  const { fromEntity, toEntity } = transfer;

  const sendingApprovals = transfer.approvals.filter((a) => a.entity === fromEntity);
  const receivingApprovals = transfer.approvals.filter((a) => a.entity === toEntity);

  const sendingTreasurer = sendingApprovals.find((a) =>
    holdsRole(directory, a.approverId, "TREASURER", fromEntity),
  );
  const receivingTreasurer = receivingApprovals.find((a) =>
    holdsRole(directory, a.approverId, "TREASURER", toEntity),
  );

  const selfApprover = transfer.approvals.find((a) => a.approverId === transfer.createdById);

  const presidentOnReceivingSide = receivingApprovals.find((a) =>
    holdsRole(directory, a.approverId, "PRESIDENT", toEntity),
  );

  const statement = transfer.restrictionStatement.trim();

  return [
    {
      id: "CROSSES_ENTITIES",
      requirement: "The transfer moves money between the two entities.",
      met: fromEntity !== toEntity,
      unmetMessage:
        "The sending and receiving entity are the same. A movement inside one " +
        "entity is a fund reclassification, not an inter-entity transfer, and " +
        "belongs on that entity's ledger.",
      source: "policy.ts",
    },
    {
      id: "AMOUNT_STATED",
      requirement: "An amount in whole cents, greater than zero.",
      met: Number.isInteger(transfer.amountCents) && transfer.amountCents > 0,
      unmetMessage: "Enter the amount. It must be a whole number of cents above zero.",
      source: "treasury",
    },
    {
      id: "TREASURER_APPROVAL_SENDING",
      requirement: `The Treasurer of ${entityLabel(fromEntity)} (${fromEntity}) approves.`,
      met: Boolean(sendingTreasurer),
      unmetMessage:
        sendingApprovals.length === 0
          ? `No approval recorded on the ${fromEntity} side. The Treasurer of ` +
            `${entityLabel(fromEntity)} has to approve the money leaving.`
          : `The ${fromEntity} approval is not from a Treasurer of ${fromEntity}. ` +
            `Another officer's approval does not substitute for the Treasurer's.`,
      source: "policy.ts",
    },
    {
      id: "TREASURER_APPROVAL_RECEIVING",
      requirement: `The Treasurer of ${entityLabel(toEntity)} (${toEntity}) approves.`,
      met: Boolean(receivingTreasurer),
      unmetMessage:
        receivingApprovals.length === 0
          ? `No approval recorded on the ${toEntity} side. The Treasurer of ` +
            `${entityLabel(toEntity)} has to approve the money arriving, ` +
            `separately from the sending side.`
          : `The ${toEntity} approval is not from a Treasurer of ${toEntity}.`,
      source: "policy.ts",
    },
    {
      id: "NO_SELF_APPROVAL",
      requirement: "Nobody approves a transfer they raised.",
      met: !selfApprover,
      unmetMessage: selfApprover
        ? `${personName(selfApprover.approverId)} raised this transfer and cannot ` +
          `also approve it. The approval on the ${selfApprover.entity} side has to ` +
          `come from someone else.`
        : "",
      source: "policy.ts",
    },
    {
      id: "MINUTE_REF_SENDING",
      requirement: `A minute reference in ${fromEntity}'s book.`,
      met: Boolean(transfer.minuteRefFrom && transfer.minuteRefFrom.trim()),
      unmetMessage:
        `No minute reference on the ${fromEntity} side. The transfer has to be ` +
        `minuted in the sending entity's own book before it can be recorded.`,
      source: "policy.ts",
    },
    {
      id: "MINUTE_REF_RECEIVING",
      requirement: `A minute reference in ${toEntity}'s book.`,
      met: Boolean(transfer.minuteRefTo && transfer.minuteRefTo.trim()),
      unmetMessage:
        `No minute reference on the ${toEntity} side. The two minute books stay ` +
        `separate, so a single reference covering both is not enough.`,
      source: "policy.ts",
    },
    {
      id: "RESTRICTION_STATEMENT",
      requirement: "A written statement of what the receiving entity may spend this on.",
      met: statement.length >= RESTRICTION_STATEMENT_MIN_LENGTH,
      unmetMessage:
        statement.length === 0
          ? "No restriction statement. Write what the receiving entity may and may " +
            "not spend this on. Money crossing from a (c)(19) to a (c)(3) or back " +
            "carries its restriction with it, and the statement is the record of it."
          : `The restriction statement is too short to be a record. Write at least ` +
            `${RESTRICTION_STATEMENT_MIN_LENGTH} characters saying what the money ` +
            `may and may not be used for.`,
      source: "treasury",
    },
    {
      id: "PRESIDENT_RECUSED_RECEIVING",
      requirement: `The President is recused on the receiving side (${toEntity}).`,
      met: !presidentOnReceivingSide,
      unmetMessage: presidentOnReceivingSide
        ? `${personName(presidentOnReceivingSide.approverId)} is President of ` +
          `${toEntity} and is recused on the receiving side, because the President ` +
          `is the one officer who could otherwise approve both ends alone. The ` +
          `receiving approval has to come from ${toEntity}'s Treasurer. The ` +
          `President may still approve the sending side.`
        : "",
      source: "treasury",
    },
  ];
}

export function unmetTransferRules(
  transfer: Transfer,
  directory: RoleDirectory = seededRoleDirectory,
): TransferRule[] {
  return transferRuleStatuses(transfer, directory).filter((r) => !r.met);
}

/** True only when every condition is met. The form's submit button reads this. */
export function canRecordTransfer(
  transfer: Transfer,
  directory: RoleDirectory = seededRoleDirectory,
): boolean {
  return unmetTransferRules(transfer, directory).length === 0;
}

/**
 * The gate. Calls `assertTransferApprovable` from policy.ts, which is the
 * authority, then applies treasury's two additional conditions. Throws with
 * the specific unmet rule rather than a generic refusal.
 */
export function recordTransfer(
  transfer: Transfer,
  directory: RoleDirectory = seededRoleDirectory,
): Transfer {
  // Authority first, so a future change to policy.ts cannot be bypassed here.
  // policy.ts resolves roles through this directory rather than trusting the
  // entity tag on an approval: tagging is a claim, the directory is the fact.
  assertTransferApprovable(transfer, (personId, entity) =>
    directory(personId)
      .filter((assignment) => assignment.entity === entity)
      .map((assignment) => assignment.role),
  );

  const unmet = unmetTransferRules(transfer, directory);
  if (unmet.length > 0) {
    throw new TreasuryError(
      unmet.map((r) => r.unmetMessage).join(" "),
      "TRANSFER_RULE_UNMET",
    );
  }
  return { ...transfer, status: "APPROVED" };
}

/**
 * Same gate, without the throw, for rendering. Returns the reason when the
 * transfer cannot be recorded so the screen can name the rule.
 */
export function describeTransferRefusal(
  transfer: Transfer,
  directory: RoleDirectory = seededRoleDirectory,
): string | null {
  try {
    recordTransfer(transfer, directory);
    return null;
  } catch (error) {
    if (error instanceof TreasuryError || error instanceof AuthzError) return error.message;
    throw error;
  }
}
