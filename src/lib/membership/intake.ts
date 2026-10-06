/**
 * Intake: validation of the applicant's own answers, and the submission
 * handler.
 *
 * The submission handler is the security-critical part of this module. Read
 * `submitApplication` before changing it.
 *
 * The threat is enumeration. Anyone can reach /apply. If the form answers
 * differently for a sponsor ID that exists than for one that does not, then the
 * form answers the question "is this person a member of JSOA", for any member
 * ID a stranger cares to try. For this organization that is the one query the
 * platform must not answer.
 *
 * So the handler is written as a single straight line with no branch the
 * applicant can observe:
 *
 *   - every submission performs the same roster lookup, the same duplicate
 *     check, the same token creation and the same queue write, in the same
 *     order, whatever the answers come back as;
 *   - what it learns is written to `flags` for the chair and never to the
 *     response;
 *   - an unreachable sponsor is not routed anywhere special. The application
 *     waits out the 72-hour window like every other and the sweep moves it to
 *     the chair queue, which is the behaviour the state machine already
 *     describes;
 *   - a malformed ID, a duplicate email and a replayed submission all return
 *     the same acknowledgment;
 *   - the return value is `acknowledge()` from state.ts, unmodified. Nothing is
 *     added to it. `tests/invariants.test.ts` already asserts that the shape
 *     carries no sponsor-derived field, and this module must not be the place
 *     that puts one back.
 *
 * Validation errors are a different matter and are allowed to differ, because
 * they are about data the applicant supplied about themselves. A missing email
 * reveals nothing about the roster. The sponsor field is the exception: it is
 * never the reason a submission is rejected, so its well-formedness check is a
 * hint on the field and not a gate in the handler.
 */

import { next as nextState, TransitionError } from "./state";
import {
  acknowledge,
  isWellFormedMemberId,
  VOUCH_WINDOW_HOURS,
  type IntakeAcknowledgment,
  type MembershipState,
} from "./state";
import { MEMBERSHIP_CHAIR_INBOX } from "./contacts";
import { enqueue, vouchRequestUrl } from "./notify";
import { newVouchToken, type MembershipRepository } from "./repository";
import { deriveIsWarVeteran } from "./wartime";
import {
  type Application,
  type ApplicationFields,
  type IntakeFlag,
  CATEGORY_LABELS,
  MEMBERSHIP_CATEGORIES,
  QUALIFYING_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
} from "./types";

/* ------------------------------------------------------------------ *
 * Steps
 * ------------------------------------------------------------------ */

export const APPLY_STEPS = [
  { step: 1, slug: "contact", title: "How to reach you" },
  { step: 2, slug: "service", title: "Eligibility" },
  { step: 3, slug: "sponsor", title: "Your sponsor" },
  { step: 4, slug: "review", title: "Check and submit" },
] as const;

export const LAST_STEP = 4;

/**
 * The single destination for every submission, whatever happened underneath.
 * There is one of these on purpose: a second redirect target is a second
 * answer, and two answers is an oracle.
 */
export const ACKNOWLEDGMENT_PATH = "/apply/submitted";

export type FieldErrors = Partial<Record<keyof ApplicationFields, string>>;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_DIGITS = /\d/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Step 1: contact. */
export function validateContact(fields: Partial<ApplicationFields>): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.applicantName?.trim()) {
    errors.applicantName = "Enter the name you would like on the roster.";
  }
  if (!fields.email?.trim()) {
    errors.email = "Enter an email address. The decision and any payment link go there.";
  } else if (!EMAIL_SHAPE.test(fields.email.trim())) {
    errors.email = "That does not look like an email address. Check it and try again.";
  }
  const digits = (fields.phone ?? "").match(PHONE_DIGITS)?.length ?? 0;
  if (digits === 0) {
    errors.phone = "Enter a phone number the membership chair can use.";
  } else if (digits < 10) {
    errors.phone = "Enter a full ten-digit number, including the area code.";
  }
  return errors;
}

/** Step 2: the eligibility answers the two exemption tests are built from. */
export function validateService(fields: Partial<ApplicationFields>): FieldErrors {
  const errors: FieldErrors = {};
  const category = fields.membershipCategory;
  if (!category || !MEMBERSHIP_CATEGORIES.includes(category)) {
    errors.membershipCategory = "Choose the description that fits you.";
    return errors;
  }

  if (category === "VETERAN") {
    if (!fields.serviceFrom || !ISO_DATE.test(fields.serviceFrom)) {
      errors.serviceFrom = "Enter the date your service began. An approximate date is fine.";
    }
    if (fields.serviceTo && !ISO_DATE.test(fields.serviceTo)) {
      errors.serviceTo = "Enter the date your service ended, or leave it blank if you are still serving.";
    }
    if (
      fields.serviceFrom &&
      fields.serviceTo &&
      ISO_DATE.test(fields.serviceFrom) &&
      ISO_DATE.test(fields.serviceTo) &&
      fields.serviceTo < fields.serviceFrom
    ) {
      errors.serviceTo = "The end date is before the start date.";
    }
  }

  if (category === "QUALIFYING_RELATIVE") {
    const relationship = fields.qualifyingRelationship;
    if (!relationship || !QUALIFYING_RELATIONSHIPS.includes(relationship)) {
      errors.qualifyingRelationship = "Choose how you are related to the member.";
    }
  }

  return errors;
}

/**
 * Step 3: the sponsor. Note what is missing. A malformed or unknown sponsor ID
 * is never an error here, because an error is a signal. The shape check is
 * offered as a hint beside the field and the handler ignores it.
 */
export function validateSponsor(fields: Partial<ApplicationFields>): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.sponsorMemberId?.trim()) {
    errors.sponsorMemberId =
      "Enter your sponsor's member ID. If you do not have one, the membership chair will look at your application anyway.";
  }
  return errors;
}

/** Non-blocking. Rendered beside the field, never returned by the handler. */
export function sponsorShapeHint(value: string): string | null {
  if (!value.trim()) return null;
  return isWellFormedMemberId(value)
    ? null
    : "Member IDs look like JSOA-2026-0142. Check the format. You can submit either way.";
}

export function validateStep(step: number, fields: Partial<ApplicationFields>): FieldErrors {
  switch (step) {
    case 1:
      return validateContact(fields);
    case 2:
      return validateService(fields);
    case 3:
      return validateSponsor(fields);
    default:
      return {};
  }
}

export function validateAll(fields: Partial<ApplicationFields>): FieldErrors {
  return {
    ...validateContact(fields),
    ...validateService(fields),
    ...validateSponsor(fields),
  };
}

/* ------------------------------------------------------------------ *
 * Submission
 * ------------------------------------------------------------------ */

/**
 * The state the submission lands in.
 *
 * Only two inputs decide it, and both are the applicant's own answers: whether
 * they said they are an augmentee, and whether this draft is still a draft.
 * Nothing about the sponsor reaches this function, which is the property worth
 * protecting.
 */
export function resolveSubmissionState(
  current: MembershipState,
  augmentee: boolean,
  sponsorMemberId: string,
): MembershipState {
  try {
    return nextState(current, { type: "SUBMIT", sponsorMemberId, augmentee });
  } catch (error) {
    if (error instanceof TransitionError) {
      // A replayed submission. Leave the record where it is and acknowledge as
      // usual: telling the applicant their application already exists would
      // make the form a lookup for a different question.
      return current;
    }
    throw error;
  }
}

export type SubmissionResult = {
  acknowledgment: IntakeAcknowledgment;
  /** For the demo only. Not shown to the applicant and not part of the response. */
  debug: { applicationId: string; state: MembershipState; flags: IntakeFlag[] };
};

/**
 * Submit an application. Returns the identical acknowledgment in every case.
 *
 * Callers must not branch on `debug`, must not surface it, and must not vary
 * status code or destination on anything learned here. The route handler
 * redirects to one place.
 */
export async function submitApplication(
  repo: MembershipRepository,
  applicationId: string,
  now: Date = new Date(),
): Promise<SubmissionResult> {
  const application = await repo.getApplication(applicationId);
  if (!application) {
    // No such draft. Still acknowledge, with a fresh reference, so that poking
    // at application ids answers nothing either.
    const reference = deadReference();
    enqueue({
      kind: "CHAIR_NOTICE",
      to: MEMBERSHIP_CHAIR_INBOX,
      subject: "Submission for an application that no longer exists",
      deliverable: true,
      ref: reference,
    });
    return {
      acknowledgment: acknowledge(reference),
      debug: { applicationId, state: "DRAFT", flags: [] },
    };
  }

  const sponsorRaw = application.sponsorMemberId.trim().toUpperCase();

  /* Every lookup below runs on every submission, in this order, whatever the
     answers are. Do not make any of them conditional. */
  const sponsorWellFormed = isWellFormedMemberId(sponsorRaw);
  const sponsor = await repo.getMemberByMemberId(sponsorRaw);
  const priorApplications = await repo.countApplicationsByEmail(application.email);
  const derivedWarVeteran = deriveIsWarVeteran(application.serviceFrom, application.serviceTo);

  const flags: IntakeFlag[] = [];
  if (!sponsorWellFormed) flags.push("SPONSOR_ID_MALFORMED");
  if (!sponsor) flags.push("SPONSOR_NOT_ON_ROSTER");
  else if (sponsor.state !== "PROBATIONARY" && sponsor.state !== "GOOD_STANDING") {
    flags.push("SPONSOR_NOT_IN_GOOD_STANDING");
  }
  if (priorApplications > 0) flags.push("DUPLICATE_EMAIL");
  if (application.isAugmentee) flags.push("AUGMENTEE");
  if (application.attestedWarVeteran !== derivedWarVeteran) {
    flags.push("WAR_VETERAN_ATTESTATION_MISMATCH");
  }
  if (application.membershipCategory === "NON_QUALIFYING") {
    flags.push("NON_QUALIFYING_CATEGORY");
  }

  const resolved = resolveSubmissionState(
    application.state,
    application.isAugmentee,
    sponsorRaw,
  );
  const submittedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + VOUCH_WINDOW_HOURS * 3_600_000).toISOString();

  /* A vouch request record is written for every submission, including the
     augmentee case that goes straight to the chair and the case where no
     sponsor exists. The record is what makes the work constant; whether it can
     be delivered is a field on it, not a branch around it. */
  const deliverable =
    resolved === "AWAITING_VOUCH" &&
    sponsor !== null &&
    (sponsor.state === "PROBATIONARY" || sponsor.state === "GOOD_STANDING");

  const token = newVouchToken();
  await repo.createVouchRequest({
    token,
    applicationId: application.id,
    sponsorMemberId: sponsorRaw,
    createdAt: submittedAt,
    expiresAt,
    answeredAt: null,
    outcome: null,
    deliverable,
  });

  /* Queued, never awaited on a network call. See notify.ts. */
  enqueue({
    kind: "VOUCH_REQUEST",
    to: sponsor?.email ?? "(no sponsor address on file)",
    subject: "A membership application names you as sponsor",
    deliverable,
    ref: vouchRequestUrl(token),
  });

  const submitted = await repo.markSubmitted(application.id, {
    state: resolved,
    flags,
    vouchExpiresAt: resolved === "AWAITING_VOUCH" ? expiresAt : null,
    at: submittedAt,
  });

  return {
    acknowledgment: acknowledge(submitted.reference),
    debug: { applicationId: submitted.id, state: submitted.state, flags },
  };
}

function deadReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Summary for the review step. Reads back only what the applicant typed. */
export function reviewSummary(application: Application): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [
    { label: "Name", value: application.applicantName || "—" },
    { label: "Email", value: application.email || "—" },
    { label: "Phone", value: application.phone || "—" },
    {
      label: "Category",
      value: application.membershipCategory
        ? CATEGORY_LABELS[application.membershipCategory]
        : "—",
    },
  ];
  if (application.membershipCategory === "QUALIFYING_RELATIVE") {
    rows.push({
      label: "Relationship",
      value: application.qualifyingRelationship
        ? RELATIONSHIP_LABELS[application.qualifyingRelationship]
        : "—",
    });
  }
  if (application.serviceFrom) {
    rows.push({
      label: "Service dates",
      value: `${application.serviceFrom} to ${application.serviceTo ?? "still serving"}`,
    });
  }
  rows.push({
    label: "Served during a wartime period",
    value: application.attestedWarVeteran ? "Yes" : "No",
  });
  rows.push({ label: "Augmentee", value: application.isAugmentee ? "Yes" : "No" });
  rows.push({ label: "Sponsor member ID", value: application.sponsorMemberId || "—" });
  rows.push({ label: "Applying to", value: "Joint Special Operations Association" });
  return rows;
}
