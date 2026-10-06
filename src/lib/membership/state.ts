/**
 * The membership state machine.
 *
 * Pure logic, no database. The two rules worth stating out loud, because both
 * were design decisions rather than accidents:
 *
 *   1. No transition reaches AWAITING_PAYMENT without a vouch or a chair
 *      approval. There is no state in which money is held for an applicant
 *      nobody has stood behind.
 *   2. The intake never reveals whether a sponsor ID is real. A form that
 *      confirms an ID belongs to a named person is a form that confirms
 *      whether that person is a member, which is the one query this
 *      organization must not answer to a stranger.
 */

export const MEMBERSHIP_STATES = [
  "DRAFT",
  "AWAITING_VOUCH",
  "CHAIR_QUEUE",
  "AWAITING_PAYMENT",
  "PROBATIONARY",
  "GOOD_STANDING",
  "DECLINED",
  "LAPSED",
  "REVOKED",
] as const;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];

export type MembershipEvent =
  | { type: "SUBMIT"; sponsorMemberId: string; augmentee: boolean }
  | { type: "VOUCH_CONFIRMED"; sponsorMemberId: string }
  | { type: "VOUCH_DECLINED" }
  | { type: "VOUCH_EXPIRED" }
  | { type: "CHAIR_APPROVED"; chairPersonId: string }
  | { type: "CHAIR_DENIED"; chairPersonId: string }
  | { type: "PAYMENT_CLEARED"; paymentId: string }
  | { type: "AUDIT_PASSED"; auditedById: string }
  | { type: "AUDIT_FAILED"; auditedById: string }
  | { type: "REVOKED_FOR_CAUSE"; boardMinuteRef: string };

export const VOUCH_WINDOW_HOURS = 72;

/** States in which the applicant is shown nothing but "under review". */
export const OPAQUE_TO_APPLICANT: MembershipState[] = ["AWAITING_VOUCH", "CHAIR_QUEUE"];

/**
 * PROBATIONARY and GOOD_STANDING grant identical access, deliberately. The
 * 30-day audit is a check on the record, not a probation the member
 * experiences: making someone wait a month for what they paid for is exactly
 * the friction this design removes.
 */
export const MEMBER_ACCESS_STATES: MembershipState[] = ["PROBATIONARY", "GOOD_STANDING"];

export function grantsMemberAccess(state: MembershipState): boolean {
  return MEMBER_ACCESS_STATES.includes(state);
}

export class TransitionError extends Error {
  constructor(from: MembershipState, event: MembershipEvent["type"]) {
    super(`No transition from ${from} on ${event}`);
    this.name = "TransitionError";
  }
}

export function next(state: MembershipState, event: MembershipEvent): MembershipState {
  switch (state) {
    case "DRAFT":
      if (event.type === "SUBMIT") {
        // An augmentee case goes to the chair whatever the sponsor says: the
        // public site already states these are decided individually.
        return event.augmentee ? "CHAIR_QUEUE" : "AWAITING_VOUCH";
      }
      break;

    case "AWAITING_VOUCH":
      if (event.type === "VOUCH_CONFIRMED") return "AWAITING_PAYMENT";
      if (event.type === "VOUCH_DECLINED" || event.type === "VOUCH_EXPIRED") return "CHAIR_QUEUE";
      break;

    case "CHAIR_QUEUE":
      if (event.type === "CHAIR_APPROVED") return "AWAITING_PAYMENT";
      if (event.type === "CHAIR_DENIED") return "DECLINED";
      break;

    case "AWAITING_PAYMENT":
      if (event.type === "PAYMENT_CLEARED") return "PROBATIONARY";
      break;

    case "PROBATIONARY":
      if (event.type === "AUDIT_PASSED") return "GOOD_STANDING";
      if (event.type === "AUDIT_FAILED") return "REVOKED";
      if (event.type === "REVOKED_FOR_CAUSE") return "REVOKED";
      break;

    case "GOOD_STANDING":
      if (event.type === "REVOKED_FOR_CAUSE") return "REVOKED";
      break;

    case "DECLINED":
    case "LAPSED":
    case "REVOKED":
      break;
  }
  throw new TransitionError(state, event.type);
}

/** True when money may be requested. Nothing else may ask for payment. */
export function mayRequestPayment(state: MembershipState): boolean {
  return state === "AWAITING_PAYMENT";
}

/* ------------------------------------------------------------------ *
 * Intake acknowledgment.
 *
 * Every submission returns this exact shape whatever happened underneath:
 * valid sponsor, unknown sponsor, malformed ID, duplicate application. The
 * caller must not branch on anything the applicant can see.
 * ------------------------------------------------------------------ */

export type IntakeAcknowledgment = {
  received: true;
  reference: string;
  message: string;
};

export const INTAKE_MESSAGE =
  "Your application has been received. If a sponsor confirms it, you will get " +
  "a payment link by email. Otherwise the membership chair will be in touch. " +
  "Either way you will hear from us within four days.";

export function acknowledge(reference: string): IntakeAcknowledgment {
  return { received: true, reference, message: INTAKE_MESSAGE };
}

/** `JSOA-YYYY-NNNN`. Readable on purpose: the sponsor click is the authentication. */
const MEMBER_ID_PATTERN = /^JSOA-\d{4}-\d{4}$/;

export function isWellFormedMemberId(value: string): boolean {
  return MEMBER_ID_PATTERN.test(value.trim().toUpperCase());
}

export function formatMemberId(year: number, sequence: number): string {
  return `JSOA-${year}-${String(sequence).padStart(4, "0")}`;
}
