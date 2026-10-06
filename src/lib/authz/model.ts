/**
 * Data classes, roles, levels and capabilities.
 *
 * This file is the single source of truth for who may touch what. It is
 * deliberately data, not logic: the enforcement lives in policy.ts and the
 * assertions live in tests/invariants.test.ts.
 */

export const ENTITIES = ["JSOA", "JSOF"] as const;
export type Entity = (typeof ENTITIES)[number];

export const DATA_CLASSES = [
  "MEMBER_PII",
  "FINANCIAL",
  "APPLICANT",
  /**
   * Medical and disability evidence inside an application, and family-support
   * case detail. Separated from APPLICANT because the Scholarships Chair
   * already enforces exactly this split by hand: scorers read the transcript
   * and the application, and do not see the disability documentation.
   *
   * Holding this always implies holding APPLICANT, asserted in
   * `assertRoleTableValid`. The reverse is never true.
   */
  "APPLICANT_SENSITIVE",
  "PUBLIC_CONTENT",
  "AUDIT_LOG",
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** Ordered. A grant of READ implies AGGREGATE; WRITE implies READ. */
export const LEVELS = ["NONE", "AGGREGATE", "READ", "WRITE"] as const;
export type Level = (typeof LEVELS)[number];

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function satisfies(held: Level, required: Level): boolean {
  return levelRank(held) >= levelRank(required);
}

export const CAPABILITIES = [
  "APPROVE_RELEASE",
  "APPROVE_SPEND",
  "PUBLISH",
  "BREAK_GLASS",
  "ADMIN_ROLES",
  /**
   * Record a physical count or an independent attestation — an inventory
   * count, a cash count, a statement agreed to a reconciliation.
   *
   * It exists as a capability rather than a FINANCIAL write because the
   * control it serves is INDEPENDENCE. Recording a count used to require
   * FINANCIAL WRITE, which only TREASURER holds, so when the Treasurer also
   * chairs the store there was nobody left who could perform the count that
   * checks the Treasurer. A control only its subject can execute is not a
   * control.
   *
   * Attesting is not editing: this capability never grants ledger write, and
   * `assertRoleTableValid` refuses any role that holds both it and
   * FINANCIAL WRITE.
   */
  "ATTEST_COUNT",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const ROLES = [
  "PRESIDENT",
  "VP_OPERATIONS",
  "VP_MEMBERSHIP",
  "SECRETARY",
  "TREASURER",
  "FUNDRAISING_CHAIR",
  "SCHOLARSHIPS_CHAIR",
  "SCHOLARSHIP_REVIEWER",
  "STORE_CHAIR",
  "MEMORIAL_CHAIR",
  "WEBMASTER",
  "COMMUNICATIONS_CHAIR",
  "EVENTS_CHAIR",
  "FAMILY_SUPPORT_CHAIR",
  "FINANCE_REVIEW_OFFICER",
  "MEMBER",
  "DONOR",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * What a role may reach, per data class, within an entity it is assigned to.
 *
 * `breakGlass` names classes the role can reach only through a logged,
 * notified break-glass request — it is NOT a standing grant, so those classes
 * sit at NONE in `grants`.
 *
 * `readOnly: true` means the platform refuses to grant this role any write
 * scope at all, whatever a later edit to this table says. The Finance Review
 * Officer's independence depends on that being mechanical.
 */
export type RoleDefinition = {
  grants: Partial<Record<DataClass, Level>>;
  capabilities?: Capability[];
  breakGlass?: DataClass[];
  readOnly?: boolean;
  /** Entities this role can ever be assigned to. Omitted means both. */
  entities?: Entity[];
  note?: string;
};

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  PRESIDENT: {
    grants: {
      MEMBER_PII: "READ",
      FINANCIAL: "READ",
      APPLICANT: "AGGREGATE",
      PUBLIC_CONTENT: "READ",
      AUDIT_LOG: "READ",
    },
    capabilities: ["APPROVE_RELEASE", "APPROVE_SPEND", "ADMIN_ROLES", "BREAK_GLASS"],
    breakGlass: ["APPLICANT"],
    note:
      "Aggregate only on applicants, so 'the President leaned on the committee' " +
      "cannot happen quietly. Named detail is a logged break-glass request that " +
      "notifies the Secretary and the relevant chair.",
  },
  VP_OPERATIONS: {
    grants: {
      MEMBER_PII: "AGGREGATE",
      FINANCIAL: "AGGREGATE",
      APPLICANT: "NONE",
      PUBLIC_CONTENT: "READ",
      AUDIT_LOG: "READ",
    },
    capabilities: ["APPROVE_RELEASE", "ATTEST_COUNT"],
    note:
      "Standing release approver, because this is the person who does not want " +
      "the post to go out. No payment initiation, ever. Holds ATTEST_COUNT so " +
      "the quarterly controls checklist can be executed by someone with no " +
      "ledger write.",
  },
  VP_MEMBERSHIP: {
    grants: { MEMBER_PII: "WRITE", FINANCIAL: "NONE", APPLICANT: "NONE" },
    entities: ["JSOA"],
    note:
      "Owns the roster. Verifies dues cleared by reconciling against the " +
      "Treasurer's receipt list, never by handling money.",
  },
  SECRETARY: {
    grants: {
      MEMBER_PII: "READ",
      FINANCIAL: "AGGREGATE",
      APPLICANT: "AGGREGATE",
      AUDIT_LOG: "READ",
    },
    capabilities: ["ATTEST_COUNT"],
    note:
      "Full audit log read. One Secretary for both entities is correct; the " +
      "minute books stay separate. Holds ATTEST_COUNT because recording that a " +
      "count happened is the same job as recording that a vote happened.",
  },
  TREASURER: {
    grants: { MEMBER_PII: "AGGREGATE", FINANCIAL: "WRITE", APPLICANT: "NONE" },
    capabilities: ["APPROVE_SPEND"],
    note:
      "Assigned per entity. A person holding TREASURER on both entities is " +
      "permitted but flagged, since it puts them on both sides of a transfer.",
  },
  FUNDRAISING_CHAIR: {
    grants: { MEMBER_PII: "NONE", FINANCIAL: "AGGREGATE", PUBLIC_CONTENT: "WRITE" },
    note: "Donor and prospect records are a separate scope, not MEMBER_PII.",
  },
  SCHOLARSHIPS_CHAIR: {
    grants: {
      MEMBER_PII: "AGGREGATE",
      FINANCIAL: "NONE",
      APPLICANT: "WRITE",
      APPLICANT_SENSITIVE: "WRITE",
      PUBLIC_CONTENT: "WRITE",
    },
    note:
      "Sees eligibility flags, not the roster. Conflict blocking is enforced " +
      "separately: a reviewer related to an applicant cannot open the file at all.",
  },
  SCHOLARSHIP_REVIEWER: {
    grants: {
      MEMBER_PII: "NONE",
      FINANCIAL: "NONE",
      APPLICANT: "READ",
      APPLICANT_SENSITIVE: "NONE",
    },
    entities: ["JSOF"],
    note:
      "One of the people who score applications. Reads the application and the " +
      "transcript; never the disability documentation, which is what decides a " +
      "Wounded Patriot award and is the chair's to verify. Not a board seat.",
  },
  STORE_CHAIR: {
    grants: { MEMBER_PII: "NONE", FINANCIAL: "AGGREGATE", PUBLIC_CONTENT: "WRITE" },
    note:
      "Sales reports, not the ledger. If one person holds STORE_CHAIR and " +
      "TREASURER on the same entity the platform raises a separation-of-duties " +
      "finding: that is authorize, custody, record and reconcile in one pair of hands.",
  },
  MEMORIAL_CHAIR: {
    grants: { MEMBER_PII: "NONE", APPLICANT: "WRITE", PUBLIC_CONTENT: "WRITE" },
    capabilities: ["APPROVE_RELEASE"],
    note: "Mandatory additional release approver for anything touching the fallen or Gold Star families.",
  },
  WEBMASTER: {
    grants: {
      MEMBER_PII: "NONE",
      FINANCIAL: "NONE",
      APPLICANT: "NONE",
      PUBLIC_CONTENT: "WRITE",
      AUDIT_LOG: "NONE",
    },
    capabilities: ["PUBLISH", "BREAK_GLASS"],
    breakGlass: ["MEMBER_PII", "FINANCIAL", "APPLICANT"],
    note:
      "Can publish but cannot approve their own content. Admin reach into " +
      "another role's data is break-glass: permitted, logged, auto-notified.",
  },
  COMMUNICATIONS_CHAIR: {
    grants: { MEMBER_PII: "NONE", FINANCIAL: "AGGREGATE", APPLICANT: "NONE", PUBLIC_CONTENT: "WRITE" },
    note:
      "Newsletter list (name and email) is a separate scope from the roster. " +
      "Drafts only; never self-publishes.",
  },
  EVENTS_CHAIR: {
    grants: { MEMBER_PII: "NONE", FINANCIAL: "AGGREGATE", PUBLIC_CONTENT: "WRITE" },
    note: "Registrants are a separate scope. Event budget versus actual, not the ledger.",
  },
  FAMILY_SUPPORT_CHAIR: {
    grants: {
      MEMBER_PII: "NONE",
      FINANCIAL: "NONE",
      APPLICANT: "WRITE",
      APPLICANT_SENSITIVE: "WRITE",
    },
    note: "Exclusive holder of family-support case files. The most sensitive data in the system.",
  },
  FINANCE_REVIEW_OFFICER: {
    grants: { FINANCIAL: "READ", AUDIT_LOG: "READ" },
    capabilities: ["ATTEST_COUNT"],
    readOnly: true,
    note:
      "Independence is mechanical, not procedural: the platform refuses to grant " +
      "this role write scope anywhere. Receives statements directly from the " +
      "institution, unopened by either Treasurer.",
  },
  MEMBER: {
    grants: {},
    entities: ["JSOA"],
    note: "Member-tier access is not a board grant; it is scoped by ownership of the record.",
  },
  DONOR: {
    grants: {},
    entities: ["JSOF"],
    note: "Donor-tier access is scoped by ownership of the record.",
  },
};
