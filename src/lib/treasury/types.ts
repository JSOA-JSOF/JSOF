/**
 * Treasury domain types.
 *
 * Two rules are structural here rather than procedural:
 *
 *   1. Money is `amountCents: number`, integer, always. There is no float in
 *      this module and no currency arithmetic outside `money.ts`.
 *   2. Anything that can belong to an entity carries `entity: Entity`, and any
 *      figure covering both entities is modelled as a *list of columns*, never
 *      as a single number. `PositionStatement.columns` and
 *      `SubscriptionRegister.annualOperatingCost` are both arrays for that
 *      reason: there is no field on either where a combined total could go.
 *
 * Imports here are relative, not `@/`: the test runner has no path alias.
 */

import type { Entity, Role } from "../authz/model";

/* ------------------------------------------------------------------ *
 * Funds
 * ------------------------------------------------------------------ */

export const RESTRICTIONS = [
  "unrestricted",
  "temporarily_restricted",
  "permanently_restricted",
] as const;
export type Restriction = (typeof RESTRICTIONS)[number];

export const RESTRICTION_LABELS: Record<Restriction, string> = {
  unrestricted: "Unrestricted",
  temporarily_restricted: "Temporarily restricted",
  permanently_restricted: "Permanently restricted",
};

export type Fund = {
  id: string;
  entity: Entity;
  name: string;
  restriction: Restriction;
  /** What the fund may be spent on, in the donor's or the board's words. */
  purpose: string;
  /** Balance at the start of the period. Integer cents. */
  openingBalanceCents: number;
};

/* ------------------------------------------------------------------ *
 * Ledger
 * ------------------------------------------------------------------ */

export type LedgerKind = "revenue" | "expense";

export type LedgerEntry = {
  id: string;
  entity: Entity;
  /** UTC, YYYY-MM-DD. Rendered in America/New_York. */
  date: string;
  fundId: string;
  account: string;
  kind: LedgerKind;
  memo: string;
  /** Integer cents, always positive. `kind` carries the direction. */
  amountCents: number;
  /** Board minute that authorised the entry, where one applies. */
  minuteRef: string | null;
  enteredById: string;
};

export type Period = {
  label: string;
  /** UTC, YYYY-MM-DD, inclusive. */
  fromDate: string;
  toDate: string;
};

export type LedgerFilter = {
  fundId?: string;
  kind?: LedgerKind;
};

export type FundBalance = {
  entity: Entity;
  fundId: string;
  fundName: string;
  restriction: Restriction;
  openingCents: number;
  revenueCents: number;
  expenseCents: number;
  closingCents: number;
};

export type LedgerView = {
  entity: Entity;
  period: Period;
  entries: LedgerEntry[];
  /** Totals for the one entity in scope. Never for both. */
  revenueCents: number;
  expenseCents: number;
  /** The fund filter that produced `entries`, so the UI can say so. */
  appliedFundId: string | null;
  funds: Fund[];
};

/* ------------------------------------------------------------------ *
 * Position statement
 *
 * A column is either visible or withheld. Withheld is not zero: a JSOA
 * treasurer holds no financial scope on JSOF, and rendering that as $0.00
 * would be a lie about the Foundation's position.
 * ------------------------------------------------------------------ */

export type PositionColumn =
  | {
      entity: Entity;
      visible: true;
      revenueCents: number;
      expenseCents: number;
      openingNetAssetsCents: number;
      closingNetAssetsCents: number;
      changeCents: number;
      unrestrictedClosingCents: number;
      restrictedClosingCents: number;
      fundBalances: FundBalance[];
    }
  | {
      entity: Entity;
      visible: false;
      withheldReason: string;
    };

export type PositionStatement = {
  period: Period;
  /** One per entity, in ENTITIES order. Deliberately a list. */
  columns: PositionColumn[];
};

/* ------------------------------------------------------------------ *
 * Subscription and budget register
 * ------------------------------------------------------------------ */

export const CADENCES = ["monthly", "quarterly", "annual", "variable"] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABELS: Record<Cadence, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  variable: "Variable",
};

export type EntitySplit = {
  entity: Entity;
  /** Basis points. The splits for one subscription sum to exactly 10,000. */
  shareBasisPoints: number;
};

export const REVIEW_DECISIONS = [
  "keep",
  "consolidate",
  "downgrade",
  "cancel",
  "not_reviewed",
] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  keep: "Keep",
  consolidate: "Consolidate",
  downgrade: "Downgrade the tier",
  cancel: "Cancel",
  not_reviewed: "Not reviewed",
};

export type Subscription = {
  id: string;
  tool: string;
  vendor: string;
  /** One entry for a single-entity tool, two for a shared one. */
  split: EntitySplit[];
  /** How a shared cost is divided. Required whenever the split crosses entities. */
  splitBasis: string | null;
  owningRole: Role;
  /**
   * Null is a finding, not a blank cell: it is the handover test. If the owner
   * is unreachable, nobody can get into the account.
   */
  secondAdministratorPersonId: string | null;
  /** Cost of one cadence unit. Null only when the cadence is variable. */
  costCents: number | null;
  cadence: Cadence;
  /** Required when the cadence is variable: trailing twelve months of actual spend. */
  observedAnnualCents: number | null;
  /** Null means month to month with no fixed renewal. */
  renewalDate: string | null;
  /** One sentence. If it takes more, the tool is not justified. */
  justification: string;
  nonprofitRateApplied: boolean;
  nonprofitRateNote: string;
  lastReviewedOn: string | null;
  lastReviewDecision: ReviewDecision;
};

export type SubscriptionFindingCode =
  | "MISSING_SECOND_ADMINISTRATOR"
  | "MISSING_SPLIT_BASIS"
  | "MISSING_OBSERVED_ANNUAL"
  | "STALE_REVIEW"
  | "RENEWAL_IMMINENT"
  | "NO_NONPROFIT_RATE";

export type SubscriptionFinding = {
  code: SubscriptionFindingCode;
  subscriptionId: string;
  severity: "critical" | "high" | "moderate";
  finding: string;
  remedy: string;
};

export type SubscriptionRow = {
  subscription: Subscription;
  /**
   * The invoice for one tool from one vendor, normalised to a year. This is a
   * single contract, not a cross-entity aggregate.
   */
  annualCents: number;
  /** The same invoice apportioned. Sums back to `annualCents` exactly. */
  annualByEntity: { entity: Entity; amountCents: number }[];
  findings: SubscriptionFinding[];
};

export type EntityFigure =
  | { entity: Entity; visible: true; amountCents: number }
  | { entity: Entity; visible: false; withheldReason: string };

export type SubscriptionRegister = {
  rows: SubscriptionRow[];
  /**
   * Per entity, as a list. There is no all-entities operating cost field, and
   * adding one would be the bug this shape exists to prevent.
   */
  annualOperatingCost: EntityFigure[];
  findings: SubscriptionFinding[];
  /** Rows the reader holds no financial scope for, reported as a count only. */
  withheldRowCount: number;
};

/* ------------------------------------------------------------------ *
 * Inter-entity transfers
 * ------------------------------------------------------------------ */

export const TRANSFER_STATUSES = [
  "DRAFT",
  "PENDING_APPROVALS",
  "APPROVED",
  "REFUSED",
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export type TransferApproval = {
  approverId: string;
  entity: Entity;
  approvedOn: string;
};

/**
 * Structurally assignable to `InterEntityTransfer` in policy.ts, which is the
 * authority on whether one of these may be recorded. The extra fields here are
 * treasury's: a restriction statement and a purpose, which policy.ts does not
 * know about and which this module gates on separately.
 */
export type Transfer = {
  id: string;
  createdById: string;
  /** The entity whose books originate the transfer. Equals `fromEntity`. */
  entity: Entity;
  fromEntity: Entity;
  toEntity: Entity;
  amountCents: number;
  fromFundId: string | null;
  toFundId: string | null;
  approvals: TransferApproval[];
  minuteRefFrom: string | null;
  minuteRefTo: string | null;
  /** What the receiving entity may and may not spend this on, in writing. */
  restrictionStatement: string;
  purpose: string;
  status: TransferStatus;
};

/* ------------------------------------------------------------------ *
 * Reimbursements
 * ------------------------------------------------------------------ */

export const REIMBURSEMENT_STATUSES = [
  "SUBMITTED",
  "AWAITING_SECOND_APPROVAL",
  "APPROVED",
  "REFUSED",
  "PAID",
] as const;
export type ReimbursementStatus = (typeof REIMBURSEMENT_STATUSES)[number];

export type Reimbursement = {
  id: string;
  entity: Entity;
  /** The claimant. This person may never appear in `approvals`. */
  createdById: string;
  claimantName: string;
  amountCents: number;
  fundId: string;
  purpose: string;
  /** UTC, YYYY-MM-DD. */
  incurredOn: string;
  receiptOnFile: boolean;
  relatedParty: boolean;
  relatedPartyNote: string;
  approvals: { approverId: string; approvedOn: string }[];
  status: ReimbursementStatus;
  refusalReason: string | null;
};
