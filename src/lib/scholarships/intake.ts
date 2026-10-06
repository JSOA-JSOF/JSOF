/**
 * Intake: the steps, the validation, and the submission handler.
 *
 * Three things here are requirements rather than choices.
 *
 * 1. ROUTING FIRST. `startApplication` cannot be called without a routing
 *    decision, and a routed-away decision never produces a draft. There is no
 *    order of calls in which a North Carolina resident at a North Carolina
 *    school gives us a name. Today the chair finds out afterwards and emails
 *    them; this is what stops that happening.
 *
 * 2. THE SPONSOR CHECK IS AUTOMATIC. On submission the sponsoring member's ID
 *    is looked up on the roster and their standing is read. This was the
 *    chair's single biggest automation ask: today she opens a spreadsheet. The
 *    roster is the membership module's; this module imports it and holds no
 *    copy.
 *
 *    What the check does NOT do is tell the applicant. The acknowledgment is
 *    identical whatever the roster says, for the reason set out in
 *    src/lib/membership/intake.ts: a form that answers differently for a real
 *    member ID is a form that answers "is this person a member of JSOA" to
 *    anyone who asks. The result goes to the chair's queue and nowhere else.
 *
 * 3. A MINOR CANNOT SUBMIT WITHOUT A SEPARATE GUARDIAN RECORD.
 *    `submitApplication` refuses, and the refusal is not a validation message
 *    the student can clear by ticking something: the record it wants carries a
 *    guardian's own name, email and phone.
 */

import { grantsMemberAccess, isWellFormedMemberId } from "../membership/state";
import { personIdForEmail } from "../membership/contacts";
import { membershipRepository, type MembershipRepository } from "../membership/repository";

import { evaluateEligibility } from "./eligibility";
import { ageGate, isMinor, GUARDIAN_CONSENT_STATEMENT_VERSION } from "./minors";
import { decideRouting, isRoutedAway, programsOpenTo } from "./routing";
import {
  newReference,
  nextId,
  type ScholarshipRepository,
} from "./repository";
import {
  ENROLMENT_LEVELS,
  GUARDIAN_RELATIONSHIPS,
  SCHOLARSHIP_ENTITY,
  type Application,
  type ApplicantDetails,
  type EnrolmentDetails,
  type GuardianConsent,
  type GuardianRelationship,
  type IntakeFlag,
  type MeritSection,
  type RoutingAnswers,
  type RoutingDecision,
  type SponsorCheck,
  type WoundedPatriotSection,
} from "./types";

/* ------------------------------------------------------------------ *
 * Steps
 * ------------------------------------------------------------------ */

export const STEP_KEYS = [
  "routing",
  "applicant",
  "enrolment",
  "sponsor",
  "merit",
  "wounded-patriot",
  "guardian",
  "review",
] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export type Step = { step: number; key: StepKey; title: string };

const ALL_STEPS: { key: StepKey; title: string }[] = [
  { key: "routing", title: "Where you apply" },
  { key: "applicant", title: "About you" },
  { key: "enrolment", title: "Where you will study" },
  { key: "sponsor", title: "Your sponsoring member" },
  { key: "merit", title: "Merit Scholarship" },
  { key: "wounded-patriot", title: "Wounded Patriot" },
  { key: "guardian", title: "Guardian consent" },
  { key: "review", title: "Check and submit" },
];

/**
 * The steps this applicant actually has.
 *
 * Wounded Patriot appears only for an applicant who said they were applying
 * for it; guardian consent only for an applicant under 18. Both are decided
 * from answers already given, so no step appears and then vanishes.
 */
export function stepsFor(draft: Application | null): Step[] {
  const wantsWoundedPatriot = draft ? programsOpenTo(draft.routing).woundedPatriot : false;
  const minor = draft?.applicant.dateOfBirth ? isMinor(draft.applicant.dateOfBirth) : false;
  return ALL_STEPS.filter((item) => {
    if (item.key === "wounded-patriot") return wantsWoundedPatriot;
    if (item.key === "guardian") return minor;
    return true;
  }).map((item, index) => ({ step: index + 1, key: item.key, title: item.title }));
}

export function stepKeyAt(draft: Application | null, step: number): StepKey {
  const steps = stepsFor(draft);
  const found = steps.find((s) => s.step === step);
  return found?.key ?? "routing";
}

export function stepNumberFor(draft: Application | null, key: StepKey): number {
  return stepsFor(draft).find((s) => s.key === key)?.step ?? 1;
}

export const ACKNOWLEDGMENT_PATH = "/apply/scholarship/submitted";
export const ROUTED_AWAY_PATH = "/apply/scholarship/patriot-foundation";
export const TOO_YOUNG_PATH = "/apply/scholarship/not-yet";

/* ------------------------------------------------------------------ *
 * Starting an application
 * ------------------------------------------------------------------ */

export class RoutedAwayError extends Error {
  constructor(readonly decision: RoutingDecision) {
    super("This applicant applies to the Patriot Foundation, not here");
    this.name = "RoutedAwayError";
  }
}

export class TooYoungError extends Error {
  constructor(readonly age: number) {
    super("No data is collected from an applicant under 13");
    this.name = "TooYoungError";
  }
}

const EMPTY_APPLICANT: ApplicantDetails = {
  fullName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  residenceState: "",
};

/**
 * Create the draft, from the routing answers and nothing else.
 *
 * Throws `RoutedAwayError` before a record exists when the answers send the
 * applicant to the Patriot Foundation. The three booleans are not written
 * anywhere in that case: the caller has the decision in hand and renders it.
 */
export async function startApplication(
  repo: ScholarshipRepository,
  answers: RoutingAnswers,
  now: Date = new Date(),
): Promise<Application> {
  const routing = decideRouting(answers, now);
  if (isRoutedAway(routing)) throw new RoutedAwayError(routing);

  const cycle = await repo.currentCycle();
  const draft: Application = {
    id: nextId("schapp"),
    entity: SCHOLARSHIP_ENTITY,
    cycleId: cycle.id,
    reference: newReference(),
    state: "DRAFT",
    createdAt: now.toISOString(),
    submittedAt: null,
    step: 2,
    routing,
    applicant: { ...EMPTY_APPLICANT },
    enrolment: null,
    sponsor: null,
    merit: null,
    woundedPatriot: null,
    guardianConsentId: null,
    eligibilityOutcome: "UNDETERMINED",
    eligibilityRuleVersion: "",
    flags: [],
    boardMemberPersonId: null,
    withdrawnAt: null,
    decidedAt: null,
  };
  return repo.createDraft(draft);
}

/**
 * Record the applicant's own details.
 *
 * The age gate runs here, before the details are written. Under 13 the draft
 * is discarded and nothing is kept, which is why this takes the whole block
 * rather than saving a date of birth first and checking it afterwards.
 */
export async function saveApplicantDetails(
  repo: ScholarshipRepository,
  applicationId: string,
  details: ApplicantDetails,
  now: Date = new Date(),
): Promise<Application> {
  const gate = ageGate(details.dateOfBirth, now);
  if (gate.decision === "REFUSE_COLLECTION") {
    await repo.discardDraft(applicationId);
    throw new TooYoungError(gate.age);
  }
  const flags = gate.decision === "GUARDIAN_CONSENT_REQUIRED" ? ["APPLICANT_IS_A_MINOR"] : [];
  const existing = await repo.getApplication(applicationId);
  const merged = new Set<IntakeFlag>([
    ...((existing?.flags ?? []).filter((f) => f !== "APPLICANT_IS_A_MINOR")),
    ...(flags as IntakeFlag[]),
  ]);
  return repo.updateApplication(applicationId, {
    applicant: details,
    flags: [...merged],
  });
}

export async function saveEnrolment(
  repo: ScholarshipRepository,
  applicationId: string,
  enrolment: EnrolmentDetails,
): Promise<Application> {
  return repo.updateApplication(applicationId, { enrolment });
}

export async function saveSponsorId(
  repo: ScholarshipRepository,
  applicationId: string,
  sponsorMemberId: string,
): Promise<Application> {
  // Stored as typed. It is not checked here: the check runs once, on
  // submission, so that no step of the form behaves differently for a real ID.
  const existing = await repo.getApplication(applicationId);
  return repo.updateApplication(applicationId, {
    sponsor: {
      sponsorMemberId: sponsorMemberId.trim().toUpperCase(),
      checkedAt: existing?.sponsor?.checkedAt ?? "",
      rosterMemberId: null,
      onRoster: false,
      inGoodStanding: false,
      sponsorName: null,
      sponsorEmail: null,
    },
  });
}

export async function saveMeritSection(
  repo: ScholarshipRepository,
  applicationId: string,
  merit: MeritSection,
): Promise<Application> {
  return repo.updateApplication(applicationId, { merit });
}

export async function saveWoundedPatriotSection(
  repo: ScholarshipRepository,
  applicationId: string,
  section: WoundedPatriotSection,
): Promise<Application> {
  return repo.updateApplication(applicationId, { woundedPatriot: section });
}

/* ------------------------------------------------------------------ *
 * Guardian consent
 * ------------------------------------------------------------------ */

export class GuardianConsentMissingError extends Error {
  constructor(readonly applicationId: string) {
    super(
      "This applicant is under 18. A parent or guardian has to consent, in " +
        "their own name and with their own contact details, before the " +
        "application can be submitted.",
    );
    this.name = "GuardianConsentMissingError";
  }
}

export type GuardianConsentInput = {
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  relationship: GuardianRelationship;
  /** The guardian's affirmation, from the guardian's own step. */
  affirmed: boolean;
};

export class GuardianAffirmationMissingError extends Error {
  constructor() {
    super("The consent statement has not been affirmed");
    this.name = "GuardianAffirmationMissingError";
  }
}

/**
 * Capture the consent.
 *
 * Its own record, with the guardian's own contact details, created in its own
 * step. The application only gains a pointer to it. Nothing about this can be
 * satisfied by a checkbox on the student's form, because the record has no
 * shape without a guardian's name, address and telephone number.
 */
export async function recordGuardianConsent(
  repo: ScholarshipRepository,
  applicationId: string,
  input: GuardianConsentInput,
  now: Date = new Date(),
): Promise<GuardianConsent> {
  if (!input.affirmed) throw new GuardianAffirmationMissingError();
  const consent: GuardianConsent = {
    id: nextId("schcon"),
    entity: SCHOLARSHIP_ENTITY,
    applicationId,
    guardianName: input.guardianName.trim(),
    guardianEmail: input.guardianEmail.trim(),
    guardianPhone: input.guardianPhone.trim(),
    relationship: input.relationship,
    statementVersion: GUARDIAN_CONSENT_STATEMENT_VERSION,
    consentedAt: now.toISOString(),
  };
  const stored = await repo.createGuardianConsent(consent);
  await repo.updateApplication(applicationId, { guardianConsentId: stored.id });
  return stored;
}

/* ------------------------------------------------------------------ *
 * The sponsor check
 * ------------------------------------------------------------------ */

/**
 * Look the sponsoring member up on the roster.
 *
 * The roster belongs to the membership module and is imported, not copied.
 * The result is written to the application for the chair and is never part of
 * anything the applicant sees.
 */
export async function checkSponsor(
  sponsorMemberId: string,
  now: Date = new Date(),
  roster: MembershipRepository = membershipRepository(),
): Promise<SponsorCheck> {
  const typed = sponsorMemberId.trim().toUpperCase();
  const member = isWellFormedMemberId(typed) ? await roster.getMemberByMemberId(typed) : null;
  return {
    sponsorMemberId: typed,
    checkedAt: now.toISOString(),
    rosterMemberId: member?.id ?? null,
    onRoster: member !== null,
    inGoodStanding: member ? grantsMemberAccess(member.state) : false,
    sponsorName: member?.displayName ?? null,
    sponsorEmail: member?.email ?? null,
  };
}

function sponsorFlags(check: SponsorCheck): IntakeFlag[] {
  const flags: IntakeFlag[] = [];
  if (!isWellFormedMemberId(check.sponsorMemberId)) flags.push("SPONSOR_ID_MALFORMED");
  else if (!check.onRoster) flags.push("SPONSOR_NOT_ON_ROSTER");
  else if (!check.inGoodStanding) flags.push("SPONSOR_NOT_IN_GOOD_STANDING");
  return flags;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export type FieldErrors = Record<string, string | undefined>;

const EMAIL = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
const DIGITS = /\d/g;

export function validateApplicant(details: ApplicantDetails): FieldErrors {
  const errors: FieldErrors = {};
  if (details.fullName.trim().length < 2) errors.fullName = "Give your full name.";
  if (!EMAIL.test(details.email.trim())) errors.email = "Give an email address we can reach you at.";
  if ((details.phone.match(DIGITS) ?? []).length < 10) {
    errors.phone = "Give a phone number with the area code, ten digits.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(details.dateOfBirth)) {
    errors.dateOfBirth = "Give your date of birth.";
  }
  if (!/^[A-Za-z]{2}$/.test(details.residenceState.trim())) {
    errors.residenceState = "Give the two-letter state you live in.";
  }
  return errors;
}

export function validateEnrolment(enrolment: EnrolmentDetails | null): FieldErrors {
  const errors: FieldErrors = {};
  if (!enrolment) return { schoolId: "Choose the school you will be attending." };
  if (!enrolment.schoolId) errors.schoolId = "Choose the school you will be attending.";
  if (!ENROLMENT_LEVELS.includes(enrolment.level)) errors.level = "Say what you will be studying.";
  if (!/^\d{4}-\d{4}$/.test(enrolment.academicYear)) {
    errors.academicYear = "Give the academic year as 2027-2028.";
  }
  if (!enrolment.studentNumber.trim()) {
    errors.studentNumber =
      "Give your student number. The cheque goes to the school, and the bursar needs it to apply the award to your account.";
  }
  return errors;
}

export function validateSponsor(sponsor: SponsorCheck | null): FieldErrors {
  if (!sponsor?.sponsorMemberId.trim()) {
    return { sponsorMemberId: "Give your sponsoring member's ID." };
  }
  return {};
}

/** A hint on the field, not a gate. It never says whether the ID matches anyone. */
export function sponsorShapeHint(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isWellFormedMemberId(trimmed)) return null;
  return "That does not look like a member ID. They are written JSOA-2026-0142.";
}

export function validateMerit(merit: MeritSection | null): FieldErrors {
  const errors: FieldErrors = {};
  if (!merit) return { essay: "Write the essay." };
  if (merit.gpaHundredths <= 0 || merit.gpaHundredths > 500) {
    errors.gpaHundredths = "Give your grade average, for example 3.40.";
  }
  if (merit.essay.trim().length < 40) errors.essay = "Write at least a few sentences.";
  if (!merit.recommendationFrom.trim()) {
    errors.recommendationFrom = "Say who is recommending you and what they are to you.";
  }
  return errors;
}

export function validateWoundedPatriot(section: WoundedPatriotSection | null): FieldErrors {
  const errors: FieldErrors = {};
  if (!section) return { narrative: "Tell us about the service connection." };
  if (!section.serviceMemberRelationship.trim()) {
    errors.serviceMemberRelationship = "Say who served and what they are to you.";
  }
  if (section.disabilityEvidence.narrative.trim().length < 20) {
    errors.narrative = "Tell us, in your own words, what happened and what it has meant.";
  }
  if (!section.disabilityEvidence.verificationContact.trim()) {
    errors.verificationContact =
      "Give someone the Scholarships Chair can speak to. She verifies this herself, by talking to a person.";
  }
  return errors;
}

export function validateGuardian(input: Partial<GuardianConsentInput>): FieldErrors {
  const errors: FieldErrors = {};
  if (!input.guardianName?.trim()) errors.guardianName = "Give the guardian's full name.";
  if (!EMAIL.test(input.guardianEmail?.trim() ?? "")) {
    errors.guardianEmail = "Give the guardian's own email address, not the applicant's.";
  }
  if ((input.guardianPhone?.match(DIGITS) ?? []).length < 10) {
    errors.guardianPhone = "Give the guardian's phone number, ten digits.";
  }
  if (!GUARDIAN_RELATIONSHIPS.includes(input.relationship as GuardianRelationship)) {
    errors.relationship = "Say how the guardian is related to the applicant.";
  }
  if (!input.affirmed) errors.affirmed = "The guardian has to agree to the statement above.";
  return errors;
}

/** Everything outstanding, for the review step. */
export async function outstandingFor(
  repo: ScholarshipRepository,
  draft: Application,
): Promise<FieldErrors> {
  const errors: FieldErrors = {
    ...validateApplicant(draft.applicant),
    ...validateEnrolment(draft.enrolment),
    ...validateSponsor(draft.sponsor),
    ...validateMerit(draft.merit),
  };
  if (programsOpenTo(draft.routing).woundedPatriot) {
    Object.assign(errors, validateWoundedPatriot(draft.woundedPatriot));
  }
  if (isMinor(draft.applicant.dateOfBirth)) {
    const consent = await repo.getGuardianConsentForApplication(draft.id);
    if (!consent) errors.guardianConsent = "A parent or guardian still has to consent.";
  }
  return errors;
}

/* ------------------------------------------------------------------ *
 * Submission
 * ------------------------------------------------------------------ */

export type IntakeAcknowledgment = {
  received: true;
  reference: string;
  message: string;
};

export const INTAKE_MESSAGE =
  "Your application has been received. The Scholarships Chair reads every " +
  "application and will write to you, and to your sponsoring member, with the " +
  "decision. Decisions go out in the spring.";

/**
 * Submit.
 *
 * The sponsor check runs here, on every submission, and what it finds goes to
 * the chair's flags. The acknowledgment is the same object whatever it found:
 * same text, same shape, one destination. A difference is an answer, and
 * whether a given person is a member of the Association is the question this
 * platform does not answer to a stranger.
 *
 * The one refusal that is visible to the applicant is the missing guardian
 * consent, because it is about the applicant's own household and reveals
 * nothing about the roster.
 */
export async function submitApplication(
  repo: ScholarshipRepository,
  applicationId: string,
  now: Date = new Date(),
  roster: MembershipRepository = membershipRepository(),
): Promise<IntakeAcknowledgment> {
  const draft = await repo.getApplication(applicationId);
  if (!draft) {
    // A replayed or expired submit gets the same acknowledgment as a real one.
    return { received: true, reference: newReference(), message: INTAKE_MESSAGE };
  }

  if (isMinor(draft.applicant.dateOfBirth, now)) {
    const consent = await repo.getGuardianConsentForApplication(draft.id);
    if (!consent) throw new GuardianConsentMissingError(draft.id);
  }

  const sponsor = await checkSponsor(draft.sponsor?.sponsorMemberId ?? "", now, roster);
  const flags = new Set<IntakeFlag>([
    ...draft.flags,
    ...sponsorFlags(sponsor),
    "ELIGIBILITY_NEEDS_DETERMINATION",
  ]);

  const duplicates = await repo.countApplicationsByEmail(draft.cycleId, draft.applicant.email);
  if (duplicates > 0) flags.add("DUPLICATE_EMAIL_THIS_CYCLE");

  // A sponsoring member who holds a board seat makes any award to this
  // applicant a full-board decision with that member recused. Recognised here
  // so the awards screen does not have to work it out later.
  const boardMemberPersonId = sponsor.sponsorEmail
    ? personIdForEmail(sponsor.sponsorEmail)
    : null;
  if (boardMemberPersonId) flags.add("BOARD_MEMBER_DEPENDENT");

  const determination = evaluateEligibility({
    enrolmentLevel: draft.enrolment?.level ?? "",
    accreditedInstitution: draft.enrolment?.accreditedInstitution ?? false,
    sponsorInGoodStanding: sponsor.inGoodStanding,
    declaredServiceConnection: draft.woundedPatriot !== null,
  });

  await repo.updateApplication(draft.id, {
    state: "SUBMITTED",
    submittedAt: now.toISOString(),
    sponsor,
    flags: [...flags],
    boardMemberPersonId,
    eligibilityOutcome: determination.outcome,
    eligibilityRuleVersion: determination.ruleVersion,
  });

  return { received: true, reference: draft.reference, message: INTAKE_MESSAGE };
}
