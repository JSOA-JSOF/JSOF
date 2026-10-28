/**
 * The dues payment handoff.
 *
 * Two hard rules meet here.
 *
 * Money is never held for an unvouched applicant. The only state in which dues
 * may be asked for is AWAITING_PAYMENT, and the state machine is the authority
 * on that, not this file: `mayRequestPayment` decides and everything here asks
 * it. Any other state is a 404, not a redirect and not a message, because a
 * message would confirm the application exists.
 *
 * Every element of the payment page comes from the payment provider. Under PCI
 * SAQ A a single merchant-side script on the payment page pushes the
 * organization to SAQ A-EP, which is a dramatically larger questionnaire. So
 * our side of the line is a page that states the amount and hands over, and
 * the provider's hosted Checkout renders everything after that. There is no
 * card field, no custom field, no analytics tag and no chat widget in this
 * module, and none may be added to these routes.
 *
 * Stripe is not integrated. `createHandoff` builds a stub session and the URL
 * it produces goes nowhere. What is real is the shape of the boundary: an
 * amount in integer cents, an entity, a redirect out, and a webhook coming
 * back that is the only thing allowed to clear the payment.
 */

import { mayRequestPayment, next as nextState, type MembershipState } from "./state";
import { provisionMemberAccount } from "./account";
import { enqueue } from "./notify";
import type { MembershipRepository } from "./repository";
import { deriveIsWarVeteran } from "./wartime";
import {
  type Application,
  type CheckoutHandoff,
  type Member,
  DUES_AMOUNT_CENTS,
  DUES_CURRENCY,
  MEMBERSHIP_ENTITY,
} from "./types";

/** Thrown when dues are requested in a state that may not be asked for money. */
export class PaymentNotAvailableError extends Error {
  constructor(readonly state: MembershipState) {
    super(`Payment is not available in ${state}`);
    this.name = "PaymentNotAvailableError";
  }
}

/**
 * The guard. Every payment route calls this first and renders a 404 when it
 * throws. Kept as a pure function of the state so the test can walk all nine
 * states rather than the two anyone thought of.
 */
export function assertPaymentAvailable(state: MembershipState): void {
  if (!mayRequestPayment(state)) throw new PaymentNotAvailableError(state);
}

/**
 * Required disclaimer on the dues page and on the receipt. Not decoration: a
 * 501(c)(19) membership payment is not a charitable contribution, and a member
 * who deducts it because the page let them believe it was has been misled by
 * us. Gifts intended to be deductible go to the Foundation.
 */
export const DUES_NOT_DEDUCTIBLE =
  "Membership dues are not a charitable contribution and are not tax deductible. " +
  "You are paying for membership, not making a gift. If you intend to make a " +
  "deductible gift, give to the Foundation instead.";

export type PaymentView = {
  application: Application;
  amountCents: number;
  currency: typeof DUES_CURRENCY;
  existing: CheckoutHandoff | null;
};

/** Throws PaymentNotAvailableError for a missing application too: a 404 either way. */
export async function loadPaymentView(
  repo: MembershipRepository,
  applicationId: string,
): Promise<PaymentView> {
  const application = await repo.getApplication(applicationId);
  if (!application) throw new PaymentNotAvailableError("DRAFT");
  assertPaymentAvailable(application.state);
  return {
    application,
    amountCents: DUES_AMOUNT_CENTS,
    currency: DUES_CURRENCY,
    existing: await repo.getCheckoutHandoffForApplication(application.id),
  };
}

/**
 * Create the hosted-checkout session. Stubbed.
 *
 * A live implementation calls Stripe with the entity's own account key, the
 * amount in cents, and a success URL, and returns `session.url`. It passes no
 * custom fields and no metadata that could identify the member beyond an
 * opaque reference.
 */
export async function createHandoff(
  repo: MembershipRepository,
  applicationId: string,
  now: Date = new Date(),
): Promise<CheckoutHandoff> {
  const application = await repo.getApplication(applicationId);
  if (!application) throw new PaymentNotAvailableError("DRAFT");
  assertPaymentAvailable(application.state);

  const id = `cs_stub_${Math.random().toString(36).slice(2, 14)}`;
  return repo.createCheckoutHandoff({
    id,
    applicationId: application.id,
    entity: MEMBERSHIP_ENTITY,
    amountCents: DUES_AMOUNT_CENTS,
    currency: DUES_CURRENCY,
    createdAt: now.toISOString(),
    // Stub. Shaped like the real thing so the redirect boundary is visible.
    hostedUrl: `https://checkout.stripe.com/c/pay/${id}`,
    status: "CREATED",
  });
}

/**
 * Clear the dues and create the roster record.
 *
 * In production only a verified Stripe webhook may call this. Nothing on the
 * applicant's side of the redirect is allowed to: a success URL is a claim, not
 * a payment. The demo exposes it behind a labelled dev affordance.
 */
export async function clearDues(
  repo: MembershipRepository,
  handoffId: string,
  now: Date = new Date(),
): Promise<Member> {
  const handoff = await repo.getCheckoutHandoff(handoffId);
  if (!handoff) throw new Error("No such checkout session");
  const application = await repo.getApplication(handoff.applicationId);
  if (!application) throw new Error("No such application");
  assertPaymentAvailable(application.state);

  const resolved = nextState(application.state, { type: "PAYMENT_CLEARED", paymentId: handoff.id });
  const at = now.toISOString();

  /* E11. The account comes first, before anything is marked cleared.
     `provisionMemberAccount` finds or creates the `person` row and grants
     MEMBER for the Association, and it is idempotent in both halves, so a
     webhook that is retried after a failure here reuses the identity rather
     than minting a second one. Doing it first means a failure leaves the
     handoff uncleared and the application where it was, which is a state the
     provider will retry into; doing it last would mean a member with money
     taken, a roster row, and no way to sign in. */
  const account = await provisionMemberAccount({
    email: application.email,
    displayName: application.applicantName,
    entity: MEMBERSHIP_ENTITY,
  });

  await repo.markCheckoutCleared(handoff.id);
  await repo.setApplicationState(application.id, resolved);

  const isWarVeteran = deriveIsWarVeteran(application.serviceFrom, application.serviceTo);
  const member = await repo.createMember({
    entity: MEMBERSHIP_ENTITY,
    personId: account.personId,
    displayName: application.applicantName,
    email: application.email,
    phone: application.phone,
    membershipCategory: application.membershipCategory ?? "NON_QUALIFYING",
    qualifyingRelationship: application.qualifyingRelationship,
    serviceFrom: application.serviceFrom,
    serviceTo: application.serviceTo,
    isWarVeteran,
    attestedWarVeteran: application.attestedWarVeteran,
    state: resolved,
    sponsorMemberId: application.sponsorMemberId.trim().toUpperCase() || null,
    joinedAt: at,
    paymentClearedAt: at,
    lastAuditedAt: null,
    applicationId: application.id,
  });

  /* What conferred the role, in the record. `role_grant.granted_by` names the
     new person because there is no human in a webhook; the provenance — which
     application, which payment — belongs here, where it can be read. */
  await repo.appendAudit({
    at,
    personId: account.personId ?? "system:dues-cleared",
    action: account.linked ? "MEMBER_ACCOUNT_LINKED" : "MEMBER_ACCOUNT_NOT_LINKED",
    dataClass: "MEMBER_PII",
    entity: MEMBERSHIP_ENTITY,
    rowLevel: true,
    subjectRef: `${member.memberId} from ${application.id} on ${handoff.id}`,
  });

  await enqueue({
    kind: "DUES_RECEIPT",
    to: member.email,
    toName: member.displayName,
    subject: "Your JSOA membership: dues received",
    stream: "TRANSACTIONAL",
    body: duesReceiptBody(member),
  });

  return member;
}

/**
 * The dues receipt.
 *
 * Carries the non-deductibility statement because a (c)(19) membership
 * payment is not a charitable contribution and the receipt is the artifact a
 * member keeps and hands to whoever does their return. It states the amount
 * once and says it is not charged again, which is the one-time basis the board
 * settled on 27 October; three published statements said otherwise before
 * that and two of them were wrong.
 */
export function duesReceiptBody(member: Member): string {
  return [
    `Your membership of the Joint Special Operations Association is on the roster.`,
    ``,
    `Member number: ${member.memberId}`,
    `Dues received: ${formatCents(DUES_AMOUNT_CENTS)}`,
    ``,
    `This is a one-time payment. Membership does not renew and nothing further`,
    `is owed.`,
    ``,
    DUES_NOT_DEDUCTIBLE,
    ``,
    `To see your own record, sign in at /sign-in with this address. If that`,
    `address is wrong, or stops working, the membership chair can correct it.`,
  ].join("\n");
}

export function formatCents(amountCents: number): string {
  const dollars = Math.trunc(amountCents / 100);
  const cents = Math.abs(amountCents % 100);
  return `$${dollars.toLocaleString("en-US")}.${String(cents).padStart(2, "0")}`;
}
