/**
 * Membership domain types.
 *
 * Two records, deliberately separate:
 *
 *   Application — the intake record. Exists from DRAFT through the vouch and
 *                 the chair, and stops being the interesting record once the
 *                 applicant becomes a member.
 *   Member       — the roster record. Carries the four compliance fields that
 *                 Pub. 3386 ch. 9 requires and that the composition report
 *                 counts.
 *
 * Money is integer cents. There is exactly one money figure in this module
 * (annual dues) and it still goes through `amountCents`.
 *
 * What is NOT here, on purpose: any document, any attachment, any national
 * identifier. See docs/PRIVACY-AND-PAYMENTS.md. Service is attested by the
 * applicant and stood behind by a sponsor; it is never documented to the
 * platform, because a pre-2015 DD-214 carries a full SSN.
 */

import type { DataClass, Entity } from "../authz/model";
import type { MembershipState } from "./state";

/** Annual JSOA dues. Not a charitable contribution; the receipt says so. */
export const DUES_AMOUNT_CENTS = 20_000;
export const DUES_CURRENCY = "USD" as const;

/** Membership is an Association function. JSOF has donors, not members. */
export const MEMBERSHIP_ENTITY: Entity = "JSOA";

/**
 * Mirrors the bylaws' classes, not the UI's convenience. `CADET` is a class of
 * its own rather than a flavour of relative because the 97.5% test names
 * cadets separately from qualifying relatives, and folding them together would
 * quietly change which test a member counts toward.
 */
export const MEMBERSHIP_CATEGORIES = [
  "VETERAN",
  "CADET",
  "QUALIFYING_RELATIVE",
  "NON_QUALIFYING",
] as const;
export type MembershipCategory = (typeof MEMBERSHIP_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<MembershipCategory, string> = {
  VETERAN: "Past or present member of the armed forces",
  CADET: "Cadet or midshipman",
  QUALIFYING_RELATIVE: "Spouse, widow or widower, ancestor, or lineal descendant of a member",
  NON_QUALIFYING: "None of the above",
};

/** Degrees of relation the bylaws recognise for the 97.5% test. */
export const QUALIFYING_RELATIONSHIPS = [
  "SPOUSE",
  "WIDOW_OR_WIDOWER",
  "ANCESTOR",
  "LINEAL_DESCENDANT",
] as const;
export type QualifyingRelationship = (typeof QUALIFYING_RELATIONSHIPS)[number];

export const RELATIONSHIP_LABELS: Record<QualifyingRelationship, string> = {
  SPOUSE: "Spouse",
  WIDOW_OR_WIDOWER: "Widow or widower",
  ANCESTOR: "Parent or grandparent",
  LINEAL_DESCENDANT: "Child or grandchild",
};

/* ------------------------------------------------------------------ *
 * Intake
 * ------------------------------------------------------------------ */

/**
 * Everything the form collects, and nothing else. Every field traces to a
 * purpose: the first three to contacting the applicant, the next four to the
 * two exemption tests and the deductibility test, the last two to routing.
 */
export type ApplicationFields = {
  applicantName: string;
  email: string;
  phone: string;
  membershipCategory: MembershipCategory | null;
  /** Required when the category is QUALIFYING_RELATIVE. */
  qualifyingRelationship: QualifyingRelationship | null;
  /** ISO `YYYY-MM-DD`, attested. Null for a relative who never served. */
  serviceFrom: string | null;
  serviceTo: string | null;
  /** The applicant's own claim. Compared against the derived value, never trusted over it. */
  attestedWarVeteran: boolean;
  isAugmentee: boolean;
  sponsorMemberId: string;
};

/**
 * Notes the chair may see and the applicant never does. Computed at submission
 * for every application, so computing them costs the same whatever the answer.
 */
export const INTAKE_FLAGS = [
  "SPONSOR_ID_MALFORMED",
  "SPONSOR_NOT_ON_ROSTER",
  "SPONSOR_NOT_IN_GOOD_STANDING",
  "DUPLICATE_EMAIL",
  "AUGMENTEE",
  "WAR_VETERAN_ATTESTATION_MISMATCH",
  "NON_QUALIFYING_CATEGORY",
] as const;
export type IntakeFlag = (typeof INTAKE_FLAGS)[number];

export const FLAG_LABELS: Record<IntakeFlag, string> = {
  SPONSOR_ID_MALFORMED: "Sponsor ID is not in the JSOA-YYYY-NNNN form",
  SPONSOR_NOT_ON_ROSTER: "No roster record matches the sponsor ID given",
  SPONSOR_NOT_IN_GOOD_STANDING: "Sponsor is on the roster but not currently a member",
  DUPLICATE_EMAIL: "An earlier application used this email address",
  AUGMENTEE: "Augmentee case, decided individually",
  WAR_VETERAN_ATTESTATION_MISMATCH:
    "Self-attested war-veteran status disagrees with the attested service dates",
  NON_QUALIFYING_CATEGORY: "Applicant selected no qualifying category",
};

export type ChairDecision = {
  at: string;
  chairPersonId: string;
  outcome: "APPROVED" | "DENIED";
  reason: string;
};

export type Application = ApplicationFields & {
  id: string;
  entity: Entity;
  state: MembershipState;
  /** What the acknowledgment shows. Random, carries nothing derived from the input. */
  reference: string;
  createdAt: string;
  submittedAt: string | null;
  /** How far through the form the draft got. Draft-only bookkeeping. */
  step: number;
  vouchExpiresAt: string | null;
  flags: IntakeFlag[];
  chairDecision: ChairDecision | null;
  convertedMemberId: string | null;
};

/* ------------------------------------------------------------------ *
 * Vouch
 * ------------------------------------------------------------------ */

export const VOUCH_OUTCOMES = ["CONFIRMED", "DECLINED", "DO_NOT_KNOW"] as const;
export type VouchOutcome = (typeof VOUCH_OUTCOMES)[number];

export type VouchRequest = {
  token: string;
  applicationId: string;
  sponsorMemberId: string;
  createdAt: string;
  expiresAt: string;
  answeredAt: string | null;
  outcome: VouchOutcome | null;
  /**
   * Whether a sponsor address existed to send to. Internal. A request record is
   * written for every submission whether or not it can be delivered, so that
   * the work done by the submission handler does not depend on the answer.
   */
  deliverable: boolean;
};

/** What the vouch page is allowed to render. Anything not OPEN is a dead end. */
export type VouchView =
  | { kind: "OPEN"; request: VouchRequest; applicantName: string; hoursLeft: number }
  | { kind: "EXPIRED" }
  | { kind: "ANSWERED"; outcome: VouchOutcome }
  | { kind: "CLOSED" }
  | { kind: "UNKNOWN" };

/* ------------------------------------------------------------------ *
 * Payment handoff
 * ------------------------------------------------------------------ */

/**
 * A stub stands in for Stripe hosted Checkout. Nothing here is a card field:
 * under SAQ A every element of the payment page must come from the provider,
 * so our side of the boundary is a redirect and nothing more.
 */
export type CheckoutHandoff = {
  id: string;
  applicationId: string;
  entity: Entity;
  amountCents: number;
  currency: typeof DUES_CURRENCY;
  createdAt: string;
  /** Where the provider would take over. Stubbed; no live session is created. */
  hostedUrl: string;
  status: "CREATED" | "CLEARED";
};

/* ------------------------------------------------------------------ *
 * Roster
 * ------------------------------------------------------------------ */

export type Member = {
  id: string;
  entity: Entity;
  /** `JSOA-YYYY-NNNN`. A lookup key, not a secret: the sponsor click is the authentication. */
  memberId: string;
  /** Roster-tier only. Never rendered on a public page. */
  displayName: string;
  email: string;
  phone: string;
  membershipCategory: MembershipCategory;
  qualifyingRelationship: QualifyingRelationship | null;
  serviceFrom: string | null;
  serviceTo: string | null;
  /** Derived from the attested service dates. Never taken from the checkbox. */
  isWarVeteran: boolean;
  /** Kept so the report can count disagreements rather than hide them. */
  attestedWarVeteran: boolean;
  state: MembershipState;
  sponsorMemberId: string | null;
  joinedAt: string;
  /** When dues cleared. The 30-day audit clock starts here. */
  paymentClearedAt: string | null;
  lastAuditedAt: string | null;
  applicationId: string | null;
};

/* ------------------------------------------------------------------ *
 * 30-day cohort audit
 * ------------------------------------------------------------------ */

export const AUDIT_WINDOW_DAYS = 30;

export type CohortAuditRow = {
  member: Member;
  daysSincePayment: number;
  dueNow: boolean;
  /** What the record itself fails on, independent of the person. */
  recordFindings: string[];
};

/* ------------------------------------------------------------------ *
 * Composition report
 * ------------------------------------------------------------------ */

export const COMPOSITION_TEST_KEYS = [
  "ARMED_FORCES",
  "MEMBERS_CADETS_RELATIVES",
  "WAR_VETERANS",
] as const;
export type CompositionTestKey = (typeof COMPOSITION_TEST_KEYS)[number];

export type CompositionTest = {
  key: CompositionTestKey;
  label: string;
  /** Threshold in permille so the comparison is integer arithmetic, not float. */
  thresholdPermille: number;
  numerator: number;
  denominator: number;
  passes: boolean;
  /** What failing this test costs. The point of the report. */
  governs: string;
  authority: string;
  /** The category counts behind the numerator, so the figure can be checked. */
  breakdown: { label: string; count: number }[];
};

export type CompositionReport = {
  entity: Entity;
  asOf: string;
  /** Members counted: those the state machine says hold member access. */
  denominator: number;
  countedStates: MembershipState[];
  excludedRecords: number;
  tests: CompositionTest[];
  categoryCounts: Record<MembershipCategory, number>;
  /** Records where the attestation and the derived value disagree. */
  attestationMismatches: number;
  /** Records with no service dates but a veteran category. */
  missingServiceDates: number;
};

/* ------------------------------------------------------------------ *
 * Module-local audit log
 * ------------------------------------------------------------------ */

/**
 * Append-only. There is no delete method on the repository interface, which is
 * the whole mechanism. Row-level reads of MEMBER_PII are logged, not only
 * writes: for this organization, who opened the roster matters more than who
 * edited it.
 *
 * This is module-local until the integration module lands the shared log.
 */
export type MembershipAuditEntry = {
  id: string;
  at: string;
  personId: string;
  action: string;
  dataClass: DataClass;
  entity: Entity;
  rowLevel: boolean;
  /** An id or a count description. Never a name. */
  subjectRef: string | null;
};
