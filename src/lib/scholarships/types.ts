/**
 * Scholarship domain types.
 *
 * Shaped around the Scholarships Chair's account of the work rather than
 * around a generic application form. The parts that look over-separated are
 * the parts she already separates by hand:
 *
 *   - The disability evidence is its own type, reachable only through
 *     `Application.woundedPatriot`, because scorers read the transcript and
 *     the application and do not read it. The reviewer's view is built by
 *     construction and never carries the field at all.
 *   - The eligibility dataset (enrolment, sponsor, age) is separate from the
 *     selection dataset (essay, activities, transcript), per
 *     docs/PRIVACY-AND-PAYMENTS.md.
 *   - The award amount is a FIELD, not a number retyped into an email. She
 *     retypes 183 of them a cycle, and that is the single most expensive task
 *     in the role.
 *   - Guardian consent is its own record with the guardian's own contact
 *     details. It is not a boolean on the application, because a boolean on
 *     the application is a box the student can tick.
 *
 * What is NOT here, on purpose: no national identifier, no discharge document,
 * no upload of any military paperwork, no attachment of any kind. See
 * docs/PRIVACY-AND-PAYMENTS.md. Service connection is attested and then
 * verified by a person; it is never documented to the platform.
 *
 * Money is integer cents, always.
 */

import type { DataClass, Entity } from "../authz/model";

/** Scholarships are a Foundation function. The Association has members, not applicants. */
export const SCHOLARSHIP_ENTITY: Entity = "JSOF";
export const SCHOLARSHIP_CURRENCY = "USD" as const;

/* ------------------------------------------------------------------ *
 * Programs
 * ------------------------------------------------------------------ */

export const PROGRAMS = ["MERIT", "WOUNDED_PATRIOT"] as const;
export type Program = (typeof PROGRAMS)[number];

export const PROGRAM_LABELS: Record<Program, string> = {
  MERIT: "Merit Scholarship",
  WOUNDED_PATRIOT: "Wounded Patriot Scholarship",
};

/**
 * An applicant may hold both, one, or neither. 150 applications last cycle
 * produced 119 Merit awards and 64 Wounded Patriot awards, so the two
 * decisions are independent and the record models them as two awards rather
 * than one award with a type.
 */

/* ------------------------------------------------------------------ *
 * Cycle
 * ------------------------------------------------------------------ */

export type CycleState = "PLANNED" | "OPEN" | "IN_REVIEW" | "DECIDED" | "CLOSED";

export type Cycle = {
  id: string;
  entity: Entity;
  /** Human-readable, e.g. "2027 cycle". */
  label: string;
  state: CycleState;
  opensAt: string;
  closesAt: string;
  decisionsBy: string;
  /** When the cycle's selection records start their five-year clock. */
  closedAt: string | null;
};

/* ------------------------------------------------------------------ *
 * Patriot Foundation routing
 * ------------------------------------------------------------------ */

/**
 * The three answers that decide whether this is the right place to apply.
 *
 * Asked first, before a name, an email or anything else. Today the chair
 * emails misrouted applicants after they have filled the whole form in; this
 * is the record of the question being asked at the front instead.
 */
export type RoutingAnswers = {
  ncResident: boolean;
  attendingNcSchool: boolean;
  applyingForWoundedPatriot: boolean;
};

export type RoutingOutcome = "CONTINUE_HERE" | "APPLY_TO_PATRIOT_FOUNDATION";

export type RoutingDecision = {
  outcome: RoutingOutcome;
  answers: RoutingAnswers;
  /** What the applicant is told, in full, on the screen that routes them. */
  explanation: string;
  /** Where to send them. Null when they are staying here. */
  referral: { name: string; href: string; note: string } | null;
  decidedAt: string;
};

/* ------------------------------------------------------------------ *
 * Application
 * ------------------------------------------------------------------ */

export const APPLICATION_STATES = [
  "DRAFT",
  "AWAITING_GUARDIAN_CONSENT",
  "SUBMITTED",
  "IN_REVIEW",
  "SCORED",
  "AWARDED",
  "NOT_AWARDED",
  "WITHDRAWN",
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

export const STATE_LABELS: Record<ApplicationState, string> = {
  DRAFT: "Draft",
  AWAITING_GUARDIAN_CONSENT: "Waiting on a guardian",
  SUBMITTED: "Submitted",
  IN_REVIEW: "In review",
  SCORED: "Scored",
  AWARDED: "Awarded",
  NOT_AWARDED: "Not awarded",
  WITHDRAWN: "Withdrawn",
};

/** Outcomes that make an applicant unsuccessful for retention purposes. */
export const UNSUCCESSFUL_STATES: ApplicationState[] = ["NOT_AWARDED", "WITHDRAWN"];

export const ENROLMENT_LEVELS = [
  "HIGH_SCHOOL_SENIOR",
  "UNDERGRADUATE",
  "GRADUATE",
  "VOCATIONAL",
] as const;
export type EnrolmentLevel = (typeof ENROLMENT_LEVELS)[number];

export const ENROLMENT_LEVEL_LABELS: Record<EnrolmentLevel, string> = {
  HIGH_SCHOOL_SENIOR: "Final year of secondary school, starting next autumn",
  UNDERGRADUATE: "Undergraduate",
  GRADUATE: "Graduate or professional",
  VOCATIONAL: "Vocational, trade or technical",
};

/**
 * Where the cheque goes. The payee is the school, never the student, so the
 * school's payable name and postal address are part of the application and not
 * an afterthought at disbursement.
 */
export type School = {
  id: string;
  name: string;
  /** Exactly how the cheque is made out. Schools are fussy about this. */
  payableTo: string;
  addressLines: string[];
  city: string;
  /** Two-letter state. Drives nothing; the routing question is answered separately. */
  state: string;
  postalCode: string;
  /** Where the bursar wants a scholarship cheque sent, if different. */
  office: string | null;
};

/** The eligibility dataset. Thin on purpose. */
export type EnrolmentDetails = {
  schoolId: string;
  level: EnrolmentLevel;
  /** As attested. No transcript office is contacted by this platform. */
  accreditedInstitution: boolean;
  /** Academic year the award would apply to, e.g. "2027-2028". */
  academicYear: string;
  expectedCompletion: string;
  /** The student's own number at the school, so the bursar can apply the cheque. */
  studentNumber: string;
};

/** The selection dataset. A reviewer reads this. */
export type MeritSection = {
  /** Grade point average as attested, to two decimals, stored as an integer out of 400. */
  gpaHundredths: number;
  transcriptSummary: string;
  essay: string;
  activities: string[];
  recommendationFrom: string;
};

/**
 * Wounded Patriot section.
 *
 * `disabilityEvidence` is APPLICANT_SENSITIVE. It is a narrative the applicant
 * writes, not a document: there is no upload here, no DD-214 path, and no
 * field for a rating decision letter. The chair verifies it by speaking to a
 * person, which is the step that must never run without one.
 */
export type WoundedPatriotSection = {
  /** Who served. A relationship, not a name and not a service number. */
  serviceMemberRelationship: string;
  disabilityEvidence: DisabilityEvidence;
};

export type DisabilityEvidence = {
  /** The applicant's own account. Never a document, never an attachment. */
  narrative: string;
  /** What the applicant says the connection to service is. */
  claimedServiceConnection: string;
  /** Who the chair may speak to in order to verify it. */
  verificationContact: string;
};

/**
 * The applicant's own details.
 *
 * `dateOfBirth` is here because age decides two things: whether we may collect
 * anything at all (under 13, we may not) and whether a guardian consent record
 * is required (under 18, it is). It is the first thing asked after routing and
 * the reason a sub-13 draft is destroyed rather than saved.
 */
export type ApplicantDetails = {
  fullName: string;
  email: string;
  phone: string;
  /** ISO `YYYY-MM-DD`. */
  dateOfBirth: string;
  /** Two-letter state of residence. */
  residenceState: string;
};

export type SponsorCheck = {
  /** `JSOA-YYYY-NNNN`, as typed. */
  sponsorMemberId: string;
  checkedAt: string;
  /** Null when the ID matched nothing on the roster. */
  rosterMemberId: string | null;
  onRoster: boolean;
  inGoodStanding: boolean;
  /** Only populated when the roster matched, and only ever shown to the chair. */
  sponsorName: string | null;
  sponsorEmail: string | null;
};

export const INTAKE_FLAGS = [
  "SPONSOR_ID_MALFORMED",
  "SPONSOR_NOT_ON_ROSTER",
  "SPONSOR_NOT_IN_GOOD_STANDING",
  "APPLICANT_IS_A_MINOR",
  "ELIGIBILITY_NEEDS_DETERMINATION",
  "DUPLICATE_EMAIL_THIS_CYCLE",
  "BOARD_MEMBER_DEPENDENT",
] as const;
export type IntakeFlag = (typeof INTAKE_FLAGS)[number];

export const FLAG_LABELS: Record<IntakeFlag, string> = {
  SPONSOR_ID_MALFORMED: "Sponsor ID is not in the JSOA-YYYY-NNNN form",
  SPONSOR_NOT_ON_ROSTER: "No roster record matches the sponsor ID given",
  SPONSOR_NOT_IN_GOOD_STANDING: "Sponsor is on the roster but is not currently a member",
  APPLICANT_IS_A_MINOR: "Applicant is under 18, so a guardian consent record is required",
  ELIGIBILITY_NEEDS_DETERMINATION: "No eligibility rule is in force, so the chair decides this one",
  DUPLICATE_EMAIL_THIS_CYCLE: "Another application this cycle used this email address",
  BOARD_MEMBER_DEPENDENT: "The sponsoring member holds a board seat, so any award goes to the full board",
};

export type Application = {
  id: string;
  entity: Entity;
  cycleId: string;
  /** Applicant-facing. Random, carries nothing derived from what was submitted. */
  reference: string;
  state: ApplicationState;
  createdAt: string;
  submittedAt: string | null;
  /** How far through the form the draft got. Draft-only bookkeeping. */
  step: number;

  routing: RoutingDecision;
  applicant: ApplicantDetails;
  enrolment: EnrolmentDetails | null;
  sponsor: SponsorCheck | null;

  /** Null when the applicant did not apply for that program. */
  merit: MeritSection | null;
  woundedPatriot: WoundedPatriotSection | null;

  /** Set when the applicant is under 18. Points at a separate consent record. */
  guardianConsentId: string | null;

  /** From `evaluateEligibility`. Stamped with the rule version in force. */
  eligibilityOutcome: string;
  eligibilityRuleVersion: string;

  flags: IntakeFlag[];
  /** Set when the sponsoring member holds a board seat. Drives the recusal. */
  boardMemberPersonId: string | null;

  withdrawnAt: string | null;
  decidedAt: string | null;
};

/* ------------------------------------------------------------------ *
 * Guardian consent
 * ------------------------------------------------------------------ */

export const GUARDIAN_RELATIONSHIPS = [
  "PARENT",
  "STEP_PARENT",
  "LEGAL_GUARDIAN",
  "GRANDPARENT_WITH_CUSTODY",
] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export const GUARDIAN_RELATIONSHIP_LABELS: Record<GuardianRelationship, string> = {
  PARENT: "Parent",
  STEP_PARENT: "Step-parent",
  LEGAL_GUARDIAN: "Legal guardian",
  GRANDPARENT_WITH_CUSTODY: "Grandparent with custody",
};

/**
 * Captured in its own step, from the guardian, with the guardian's own contact
 * details. Not a checkbox on the student's form. The student cannot create one
 * of these, because the record carries an address that is not theirs and the
 * consent statement is sent to it.
 */
export type GuardianConsent = {
  id: string;
  entity: Entity;
  applicationId: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  relationship: GuardianRelationship;
  /** The exact wording consented to, so a later change does not rewrite history. */
  statementVersion: string;
  consentedAt: string;
};

/* ------------------------------------------------------------------ *
 * Conflicts
 * ------------------------------------------------------------------ */

export const RELATIONSHIP_KINDS = [
  "PARENT_OR_GUARDIAN",
  "STEP_PARENT",
  "SIBLING",
  "GRANDPARENT",
  "AUNT_OR_UNCLE",
  "COUSIN",
  "SAME_HOUSEHOLD",
  "TEACHER_OR_COACH",
  "EMPLOYER",
  "OTHER_CLOSE_RELATIONSHIP",
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const RELATIONSHIP_KIND_LABELS: Record<RelationshipKind, string> = {
  PARENT_OR_GUARDIAN: "Parent or guardian",
  STEP_PARENT: "Step-parent",
  SIBLING: "Sibling",
  GRANDPARENT: "Grandparent",
  AUNT_OR_UNCLE: "Aunt or uncle",
  COUSIN: "Cousin",
  SAME_HOUSEHOLD: "Lives in the same household",
  TEACHER_OR_COACH: "Teacher or coach",
  EMPLOYER: "Employer",
  OTHER_CLOSE_RELATIONSHIP: "Another close relationship",
};

/**
 * A declared relationship between a reviewer and an applicant.
 *
 * Modelled explicitly rather than inferred from surnames or addresses. The
 * committee declares these at the start of the cycle and the chair may add
 * one at any time; the platform refuses the file either way. Guessing at a
 * conflict from a shared surname would miss a step-parent and would block a
 * stranger.
 */
export type ReviewerRelationship = {
  id: string;
  entity: Entity;
  reviewerPersonId: string;
  applicationId: string;
  kind: RelationshipKind;
  declaredAt: string;
  declaredByPersonId: string;
  note: string | null;
};

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

export const CRITERION_KEYS = [
  "ACADEMIC_RECORD",
  "ESSAY",
  "SERVICE_AND_LEADERSHIP",
  "RECOMMENDATION",
  "FINANCIAL_NEED",
] as const;
export type CriterionKey = (typeof CRITERION_KEYS)[number];

export type ScoringCriterion = {
  key: CriterionKey;
  label: string;
  maxPoints: number;
  /** Published to applicants before the cycle opens. The criteria are not a secret. */
  published: string;
};

export type ScoreSheet = {
  id: string;
  entity: Entity;
  applicationId: string;
  reviewerPersonId: string;
  points: Record<CriterionKey, number>;
  /** Sum of `points`. Stored so a later change to the criteria does not restate history. */
  total: number;
  comment: string;
  scoredAt: string;
};

/* ------------------------------------------------------------------ *
 * The reviewer's view
 * ------------------------------------------------------------------ */

/**
 * What a SCHOLARSHIP_REVIEWER is handed.
 *
 * Built by construction from an Application, field by field. There is no
 * `disabilityEvidence` on this type and no `woundedPatriot` either, so no
 * future edit can leak it by spreading the application in. A test walks the
 * returned object at every depth and asserts the same thing at runtime.
 */
export type ReviewerFile = {
  applicationId: string;
  reference: string;
  entity: Entity;
  cycleId: string;
  applicantName: string;
  enrolment: {
    schoolName: string;
    level: EnrolmentLevel;
    academicYear: string;
    expectedCompletion: string;
    accreditedInstitution: boolean;
  } | null;
  merit: MeritSection | null;
  /**
   * Whether the applicant also applied for Wounded Patriot. A reviewer may
   * know that the application exists; the evidence behind it is the chair's.
   */
  appliedForWoundedPatriot: boolean;
  criteria: ScoringCriterion[];
  myScore: ScoreSheet | null;
  scoresRecorded: number;
};

/* ------------------------------------------------------------------ *
 * Disability verification
 * ------------------------------------------------------------------ */

export const VERIFICATION_METHODS = [
  "SPOKE_TO_APPLICANT",
  "SPOKE_TO_VERIFICATION_CONTACT",
  "SPOKE_TO_SPONSORING_MEMBER",
  "COMMITTEE_REVIEW",
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const VERIFICATION_METHOD_LABELS: Record<VerificationMethod, string> = {
  SPOKE_TO_APPLICANT: "Spoke to the applicant",
  SPOKE_TO_VERIFICATION_CONTACT: "Spoke to the contact the applicant named",
  SPOKE_TO_SPONSORING_MEMBER: "Spoke to the sponsoring member",
  COMMITTEE_REVIEW: "Taken to the committee",
};

export type VerificationOutcome = "VERIFIED" | "NOT_VERIFIED";

/**
 * The record of a person having checked.
 *
 * `verifiedByPersonId`, `verifiedAt` and `method` are required and not
 * nullable. There is no shape of this type that records a verification nobody
 * performed, and `recordDisabilityVerification` is the only function that
 * produces one. The absence of a record is the unverified state; there is no
 * UNVERIFIED value to set, so nothing can set it in passing.
 */
export type DisabilityVerification = {
  id: string;
  entity: Entity;
  applicationId: string;
  outcome: VerificationOutcome;
  /** The human who did it. Required. No default, no system actor, no fallback. */
  verifiedByPersonId: string;
  verifiedAt: string;
  method: VerificationMethod;
  /** What was said and by whom, in the chair's words. */
  note: string;
};

/* ------------------------------------------------------------------ *
 * Awards
 * ------------------------------------------------------------------ */

export const AWARD_STATUSES = [
  "PROPOSED",
  "BOARD_REVIEW",
  "APPROVED",
  "DECLINED",
  "NOTIFIED",
] as const;
export type AwardStatus = (typeof AWARD_STATUSES)[number];

export const AWARD_STATUS_LABELS: Record<AwardStatus, string> = {
  PROPOSED: "Proposed",
  BOARD_REVIEW: "With the full board",
  APPROVED: "Approved",
  DECLINED: "Declined",
  NOTIFIED: "Notified",
};

/**
 * Sent to the full board with one member recused.
 *
 * Surfaced, never auto-approved: there is no function that moves one of these
 * to APPROVED without a minute reference and a list of approvers, and the
 * recused person cannot be one of them.
 */
export type BoardReview = {
  reason: "BOARD_MEMBER_DEPENDENT";
  recusedPersonId: string;
  requestedAt: string;
  requestedByPersonId: string;
  minuteRef: string | null;
  decidedAt: string | null;
  outcome: "APPROVED" | "DECLINED" | null;
  approverPersonIds: string[];
};

/**
 * The award.
 *
 * `amountCents` is a field on the record. It is set once, on this record, and
 * the notification merges it. Nobody retypes it into an email, because there
 * is no step in this module where anyone types an amount into an email.
 */
export type Award = {
  id: string;
  entity: Entity;
  cycleId: string;
  applicationId: string;
  program: Program;
  amountCents: number;
  currency: typeof SCHOLARSHIP_CURRENCY;
  status: AwardStatus;
  /** How the amount was arrived at. For Merit, the band and the score. */
  basis: string;
  proposedAt: string;
  decidedByPersonId: string | null;
  decidedAt: string | null;
  boardReview: BoardReview | null;
  notifiedAt: string | null;
};

/* ------------------------------------------------------------------ *
 * Notification
 * ------------------------------------------------------------------ */

export const RECIPIENT_ROLES = ["APPLICANT", "SPONSOR", "GUARDIAN"] as const;
export type RecipientRole = (typeof RECIPIENT_ROLES)[number];

/**
 * A named recipient of a message, with the reason they are on it.
 *
 * The sponsor is a recipient with a role, not a bcc. Students frequently do
 * not read or answer email, and today the chair leaves the platform entirely
 * in order to reach the sponsor. There is no bcc field on this type.
 */
export type Recipient = {
  role: RecipientRole;
  name: string;
  address: string;
  /** Why this person is on the message. Rendered in the message itself. */
  because: string;
};

export type AwardNotification = {
  awardId: string;
  applicationId: string;
  entity: Entity;
  recipients: Recipient[];
  subject: string;
  body: string;
  /** The figure merged from the record. Kept so the message can be checked against it. */
  mergedAmountCents: number;
  builtAt: string;
};

/* ------------------------------------------------------------------ *
 * Disbursement
 * ------------------------------------------------------------------ */

export const CHEQUE_STATUSES = ["QUEUED", "MAILED"] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

/**
 * One line of the cheque run.
 *
 * The payee is the school. The student appears only as `memoReference`, which
 * is the award reference and not a name, so this list can be handed to the
 * Treasurer without handing over the applicant roll. That is also why the
 * Treasurer, who holds no APPLICANT grant at all, can open the run.
 *
 * Nothing here moves money. There is no payment integration in this module and
 * no field that would carry one.
 */
export type Cheque = {
  id: string;
  entity: Entity;
  cycleId: string;
  awardId: string;
  payeeSchoolId: string;
  payableTo: string;
  addressLines: string[];
  city: string;
  state: string;
  postalCode: string;
  office: string | null;
  amountCents: number;
  currency: typeof SCHOLARSHIP_CURRENCY;
  /** Printed on the memo line. An award reference and a student number, never a name. */
  memoReference: string;
  status: ChequeStatus;
  mailedAt: string | null;
  mailedByPersonId: string | null;
  note: string | null;
};

/* ------------------------------------------------------------------ *
 * Retention
 * ------------------------------------------------------------------ */

/**
 * What survives the purge.
 *
 * Carries the decision and the figures and nothing that identifies a person:
 * no name, no email, no school, no essay. Retained five years because the
 * selection has to be defensible for that long; the applicant's personal data
 * is not needed in order to defend it.
 */
export type SelectionRecord = {
  id: string;
  entity: Entity;
  cycleId: string;
  /** The application's reference. Random, and the application itself is gone. */
  applicationRef: string;
  outcome: ApplicationState;
  totalScore: number | null;
  scoresRecorded: number;
  awards: { program: Program; amountCents: number }[];
  eligibilityRuleVersion: string;
  /**
   * The state of the school the award was paid to, as a two-letter code, or
   * null where the application never reached an enrolment.
   *
   * It is here because the purge deletes the application, and with it the only
   * link from an award to a place. Without this field, the moment a cycle is
   * purged, where its awards went becomes unreconstructable permanently — so
   * the question "which states have we reached" could only ever be answered
   * about cycles recent enough to still hold their applicants.
   *
   * A STATE and not a school id, deliberately. This record is retained for
   * five years precisely because it has no person in it, and it already
   * carries a score, an amount and an outcome. A school narrows the field to
   * one institution's applicants in one cycle, which in a small school is a
   * person. A state does not, and a state is what a reach question is actually
   * asking.
   */
  schoolState: string | null;
  decidedAt: string;
  /** ISO date. The five-year clock. */
  retainUntil: string;
};

export type PurgeResult = {
  at: string;
  /** Applications whose personal data was removed. */
  applicationsPurged: number;
  guardianConsentsPurged: number;
  scoreSheetsPurged: number;
  verificationsPurged: number;
  /** Selection records written in their place. */
  selectionRecordsWritten: number;
  /** References of what went, for the audit entry. Never names. */
  references: string[];
};

/* ------------------------------------------------------------------ *
 * Module-local audit log
 * ------------------------------------------------------------------ */

/**
 * Append-only. No delete method exists on the repository, which is the whole
 * mechanism. Row-level reads of APPLICANT and APPLICANT_SENSITIVE are logged,
 * not only writes, and a refused conflict is logged as its own action.
 *
 * Module-local until the integration module lands the shared log.
 */
export type ScholarshipAuditEntry = {
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
