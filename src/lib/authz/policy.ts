/**
 * Enforcement. The three invariants from docs/ARCHITECTURE.md live here and
 * throw rather than warn.
 *
 * Nothing in this file reads the database. It takes a resolved subject (who is
 * asking, with which role assignments) and answers. That keeps it testable and
 * keeps the decision in one place instead of scattered across route handlers.
 */

import {
  type Capability,
  type DataClass,
  type Entity,
  type Level,
  type Role,
  ROLE_DEFINITIONS,
  satisfies,
} from "./model";

export class AuthzError extends Error {
  constructor(
    message: string,
    readonly code:
      | "DENIED"
      | "SELF_APPROVAL"
      | "RELEASE_NEEDS_SECOND_APPROVER"
      | "INVALID_ROLE_DEFINITION"
      | "READ_ONLY_ROLE",
  ) {
    super(message);
    this.name = "AuthzError";
  }
}

export type RoleAssignment = {
  role: Role;
  entity: Entity;
};

export type Subject = {
  personId: string;
  assignments: RoleAssignment[];
  /** True only once a TOTP challenge has been satisfied this session. */
  mfaSatisfied: boolean;
};

/* ------------------------------------------------------------------ *
 * Invariant 1: no role holds write on both FINANCIAL and APPLICANT
 * for the same entity. Checked against the role table at module load,
 * and again for a person's combined assignments at request time —
 * because two separately legal roles can combine into an illegal pair.
 * ------------------------------------------------------------------ */

const CONFLICTING_WRITE_PAIR: [DataClass, DataClass] = ["FINANCIAL", "APPLICANT"];

function writesBoth(grants: Partial<Record<DataClass, Level>>): boolean {
  const [a, b] = CONFLICTING_WRITE_PAIR;
  return grants[a] === "WRITE" && grants[b] === "WRITE";
}

/** Throws if any single role definition violates invariant 1. */
export function assertRoleTableValid(): void {
  for (const [role, def] of Object.entries(ROLE_DEFINITIONS)) {
    if (writesBoth(def.grants)) {
      throw new AuthzError(
        `Role ${role} holds WRITE on both FINANCIAL and APPLICANT`,
        "INVALID_ROLE_DEFINITION",
      );
    }
    if (def.readOnly) {
      const writes = Object.entries(def.grants).filter(([, lvl]) => lvl === "WRITE");
      if (writes.length > 0) {
        throw new AuthzError(
          `Role ${role} is read-only but declares WRITE on ${writes.map(([c]) => c).join(", ")}`,
          "READ_ONLY_ROLE",
        );
      }
    }
    // An independent count is only independent if the counter cannot also move
    // the figure they are counting against.
    if ((def.capabilities ?? []).includes("ATTEST_COUNT") && def.grants.FINANCIAL === "WRITE") {
      throw new AuthzError(
        `Role ${role} holds ATTEST_COUNT and FINANCIAL WRITE. An attestation by ` +
          `someone who can edit the ledger is not a control.`,
        "INVALID_ROLE_DEFINITION",
      );
    }
  }
}

// Fail at import time rather than at the first unlucky request.
assertRoleTableValid();

/** The effective level a subject holds for a class within one entity. */
export function effectiveLevel(
  subject: Subject,
  dataClass: DataClass,
  entity: Entity,
): Level {
  let best: Level = "NONE";
  for (const assignment of subject.assignments) {
    if (assignment.entity !== entity) continue;
    const def = ROLE_DEFINITIONS[assignment.role];
    if (def.entities && !def.entities.includes(entity)) continue;
    const granted = def.grants[dataClass] ?? "NONE";
    if (satisfies(granted, best) && granted !== best) best = granted;
  }
  return best;
}

/**
 * Invariant 1, applied to the combination. Two roles that are each legal can
 * add up to an illegal pair — a Treasurer who is also Scholarships Chair on
 * the same entity, for instance. Deny rather than silently allow.
 */
export function assertNoConflictingWrites(subject: Subject, entity: Entity): void {
  const [a, b] = CONFLICTING_WRITE_PAIR;
  if (
    effectiveLevel(subject, a, entity) === "WRITE" &&
    effectiveLevel(subject, b, entity) === "WRITE"
  ) {
    throw new AuthzError(
      `Person ${subject.personId} would hold WRITE on both ${a} and ${b} for ${entity}`,
      "INVALID_ROLE_DEFINITION",
    );
  }
}

export function hasCapability(subject: Subject, capability: Capability, entity: Entity): boolean {
  return subject.assignments.some(
    (a) =>
      a.entity === entity &&
      (ROLE_DEFINITIONS[a.role].capabilities ?? []).includes(capability),
  );
}

export type AccessRequest = {
  subject: Subject;
  dataClass: DataClass;
  entity: Entity;
  required: Level;
  /** Row-level reads of MEMBER_PII and APPLICANT are audited, not just writes. */
  rowLevel?: boolean;
};

export function can({ subject, dataClass, entity, required }: AccessRequest): boolean {
  if (!subject.mfaSatisfied) return false;
  try {
    assertNoConflictingWrites(subject, entity);
  } catch {
    return false;
  }
  return satisfies(effectiveLevel(subject, dataClass, entity), required);
}

/** Use at the top of any handler that touches a data class. */
export function authorize(request: AccessRequest): void {
  if (!can(request)) {
    throw new AuthzError(
      `Denied: ${request.subject.personId} needs ${request.required} on ` +
        `${request.dataClass} for ${request.entity}`,
      "DENIED",
    );
  }
}

/* ------------------------------------------------------------------ *
 * Invariant 2: no actor approves what it created.
 * ------------------------------------------------------------------ */

export type Approvable = {
  id: string;
  createdById: string;
  entity: Entity;
};

export function assertNotSelfApproval(approverId: string, subject: Approvable): void {
  if (approverId === subject.createdById) {
    throw new AuthzError(
      `Self-approval refused: ${approverId} created ${subject.id}`,
      "SELF_APPROVAL",
    );
  }
}

/**
 * Spend approval. Thresholds in cents: routine spend needs a second approver
 * above $1,000, anything to a related party above $250, and an inter-entity
 * transfer always does. Transfers have their own path below.
 */
export const DUAL_APPROVAL_THRESHOLD_CENTS = 100_000;
export const RELATED_PARTY_THRESHOLD_CENTS = 25_000;

export function requiresSecondApproval(amountCents: number, relatedParty: boolean): boolean {
  const threshold = relatedParty ? RELATED_PARTY_THRESHOLD_CENTS : DUAL_APPROVAL_THRESHOLD_CENTS;
  return amountCents > threshold;
}

/* ------------------------------------------------------------------ *
 * Invariant 3: the release gate.
 *
 * Anything that will become publicly visible and carries a person's name,
 * unit, rank or face needs a second, different approver. The flag is set by
 * the author or by the scanner; either way the gate is the same.
 * ------------------------------------------------------------------ */

export type ReleaseCandidate = Approvable & {
  /** Set when the content carries a name, unit, rank, or an identifiable face. */
  carriesIdentity: boolean;
};

export function assertReleasable(
  approver: Subject,
  candidate: ReleaseCandidate,
): void {
  assertNotSelfApproval(approver.personId, candidate);
  if (!candidate.carriesIdentity) return;
  if (!hasCapability(approver, "APPROVE_RELEASE", candidate.entity)) {
    throw new AuthzError(
      `Release of ${candidate.id} carries identity and needs an APPROVE_RELEASE holder`,
      "RELEASE_NEEDS_SECOND_APPROVER",
    );
  }
}

/* ------------------------------------------------------------------ *
 * Inter-entity transfers. Their own type because they are the one
 * transaction where the same person sits on both sides.
 * ------------------------------------------------------------------ */

export type InterEntityTransfer = Approvable & {
  fromEntity: Entity;
  toEntity: Entity;
  amountCents: number;
  approvals: { approverId: string; entity: Entity }[];
  minuteRefFrom: string | null;
  minuteRefTo: string | null;
  /**
   * Why the money is moving, and what the receiving entity may spend it on.
   * A grant from the (c)(3) to the (c)(19) must be restricted in writing to a
   * charitable purpose; without this the transfer is undocumented, whatever
   * the minutes say.
   */
  restrictionStatement: string | null;
};

/**
 * Resolves the roles a person actually holds on an entity.
 *
 * This is a parameter rather than an import because policy.ts never touches
 * storage. It is REQUIRED, not optional: an earlier version of this function
 * checked only that approvals were *tagged* one per entity, which meant two
 * approvals from the same Secretary, tagged JSOA and JSOF, satisfied "one
 * treasurer approval per entity". Making the resolver optional would leave
 * that hole open by default.
 */
export type RoleResolver = (personId: string, entity: Entity) => Role[];

export function assertTransferApprovable(
  transfer: InterEntityTransfer,
  rolesOf: RoleResolver,
): void {
  if (transfer.fromEntity === transfer.toEntity) {
    throw new AuthzError("A transfer must cross entities", "DENIED");
  }

  for (const approval of transfer.approvals) {
    assertNotSelfApproval(approval.approverId, transfer);
  }

  // One approval per side, and the approver must actually be that entity's
  // Treasurer. Tagging is a claim; the role table is the fact.
  for (const side of [transfer.fromEntity, transfer.toEntity]) {
    const approvedBy = transfer.approvals.filter(
      (approval) =>
        approval.entity === side &&
        rolesOf(approval.approverId, side).includes("TREASURER"),
    );
    if (approvedBy.length === 0) {
      throw new AuthzError(
        `An inter-entity transfer needs an approval from the ${side} Treasurer. ` +
          `No approval on the ${side} side came from someone holding TREASURER on ${side}.`,
        "DENIED",
      );
    }
  }

  // The President sits on both sides of every transfer, so they are recused on
  // the receiving side. ARCHITECTURE.md states this as a rule of the
  // transaction type, which makes here its home rather than a module's.
  const presidentOnReceivingSide = transfer.approvals.find(
    (approval) =>
      approval.entity === transfer.toEntity &&
      rolesOf(approval.approverId, transfer.toEntity).includes("PRESIDENT"),
  );
  if (presidentOnReceivingSide) {
    throw new AuthzError(
      `The President is recused on the receiving side. ` +
        `${presidentOnReceivingSide.approverId} cannot approve into ${transfer.toEntity}.`,
      "DENIED",
    );
  }

  if (!transfer.minuteRefFrom || !transfer.minuteRefTo) {
    throw new AuthzError(
      "An inter-entity transfer needs a minute reference on both sides",
      "DENIED",
    );
  }

  if (!transfer.restrictionStatement?.trim()) {
    throw new AuthzError(
      "An inter-entity transfer needs a written restriction statement saying " +
        "what the receiving entity may spend it on",
      "DENIED",
    );
  }
}

/* ------------------------------------------------------------------ *
 * Separation-of-duties findings. Not a block: the board may knowingly
 * accept these. The platform's job is to surface them, not to pretend
 * a ten-person volunteer board can fully separate duties.
 * ------------------------------------------------------------------ */

export type SodFinding = {
  severity: "critical" | "high" | "moderate";
  personId: string;
  entity: Entity;
  roles: Role[];
  finding: string;
  mitigation: string;
};

const SOD_RULES: {
  roles: [Role, Role];
  severity: SodFinding["severity"];
  finding: string;
  mitigation: string;
}[] = [
  {
    roles: ["TREASURER", "STORE_CHAIR"],
    severity: "critical",
    finding:
      "One person sets prices, holds inventory, takes payment, records the receipt " +
      "and reconciles the account: authorize, custody, record and reconcile in one pair of hands.",
    mitigation:
      "Move Store and Sales to another chair. Failing that: card only with no cash " +
      "custody, quarterly inventory counted by someone else, and the Finance Review " +
      "Officer reconciling processor statements received directly.",
  },
  {
    roles: ["TREASURER", "FINANCE_REVIEW_OFFICER"],
    severity: "critical",
    finding: "The reviewer would be reviewing their own books.",
    mitigation: "The Finance Review Officer must hold no other financial role, on either entity.",
  },
  {
    roles: ["WEBMASTER", "COMMUNICATIONS_CHAIR"],
    severity: "high",
    finding: "The author of public content would also be able to publish it without a second pair of eyes.",
    mitigation:
      "Keep drafting and publishing in different hands, or require VP Operations " +
      "approval on every release from this person regardless of identity flags.",
  },
];

export function separationOfDutiesFindings(
  personId: string,
  assignments: RoleAssignment[],
): SodFinding[] {
  const findings: SodFinding[] = [];
  for (const entity of new Set(assignments.map((a) => a.entity))) {
    const held = new Set(assignments.filter((a) => a.entity === entity).map((a) => a.role));
    for (const rule of SOD_RULES) {
      if (rule.roles.every((r) => held.has(r))) {
        findings.push({
          severity: rule.severity,
          personId,
          entity,
          roles: rule.roles,
          finding: rule.finding,
          mitigation: rule.mitigation,
        });
      }
    }
  }
  // Holding the same treasury on both entities is its own finding. It is a
  // finding ABOUT BOTH entities, so it is raised on each rather than pinned to
  // whichever happened to be first in the array.
  const treasuries = assignments.filter((a) => a.role === "TREASURER").map((a) => a.entity);
  if (treasuries.length > 1) {
    for (const entity of treasuries) {
      findings.push({
        severity: "high",
        personId,
        entity,
        roles: ["TREASURER"],
        finding:
          "This person is Treasurer of both entities and so sits on both sides of every transfer.",
        mitigation:
          "Separate treasurers per entity. Until then, no transfer may be approved " +
          "by this person on either side, and the President recuses on the receiving side.",
      });
    }
  }
  return findings;
}
