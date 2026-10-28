/**
 * The sponsor vouch.
 *
 * The vouch is the whole verification mechanism. There is no document, no
 * discharge paperwork and no national identifier anywhere in this module,
 * because a separation document issued before roughly 2015 carries the
 * member's full Social Security number. What replaces it is a named member
 * clicking a link and saying yes. See docs/PRIVACY-AND-PAYMENTS.md.
 *
 * Three consequences shape this file:
 *
 *   1. The token is the authentication. It is 128 bits of randomness and it is
 *      the only thing separating a stranger from an applicant's name, so an
 *      unknown token and an expired token render the same dead end. A
 *      "not found" page distinguishable from an "expired" page is a token
 *      oracle, which is a slower version of the problem the intake form
 *      avoids.
 *   2. A decline and a "do not know this person" both go to the chair queue,
 *      not to a rejection. A sponsor who does not recognise a name has told us
 *      something worth a human look, not something worth a closed door.
 *   3. The window closes after 72 hours and the application moves to the chair
 *      queue. That is also what happens to an application whose sponsor ID
 *      matched nobody, because the intake refuses to treat that case
 *      differently.
 */

import {
  grantsMemberAccess,
  next as nextState,
  VOUCH_WINDOW_HOURS,
} from "./state";
import { MEMBERSHIP_CHAIR_INBOX } from "./contacts";
import { enqueue, paymentUrl } from "./notify";
import type { MembershipRepository } from "./repository";
import type { VouchOutcome, VouchView } from "./types";

export const VOUCH_ACTIONS: { outcome: VouchOutcome; label: string; consequence: string }[] = [
  {
    outcome: "CONFIRMED",
    label: "Confirm this application",
    consequence: "The applicant gets a payment link. You will not be asked again.",
  },
  {
    outcome: "DECLINED",
    label: "Decline to vouch",
    consequence: "The membership chair takes it from here. The applicant is not told who declined.",
  },
  {
    outcome: "DO_NOT_KNOW",
    label: "I do not know this person",
    consequence:
      "The same route as declining: the membership chair looks at it. Say this if the name means nothing to you.",
  },
];

export function hoursRemaining(expiresAt: string, now: Date): number {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 3_600_000));
}

/**
 * What the page may render for a token. Everything that is not an open request
 * collapses to a dead end, and UNKNOWN and EXPIRED are rendered identically by
 * the page.
 */
export async function describeVouchToken(
  repo: MembershipRepository,
  token: string,
  now: Date = new Date(),
): Promise<VouchView> {
  const request = await repo.getVouchRequest(token);
  if (!request) return { kind: "UNKNOWN" };
  if (request.answeredAt !== null && request.outcome !== null) {
    return { kind: "ANSWERED", outcome: request.outcome };
  }
  if (new Date(request.expiresAt).getTime() <= now.getTime()) {
    return { kind: "EXPIRED" };
  }
  const application = await repo.getApplication(request.applicationId);
  if (!application || application.state !== "AWAITING_VOUCH") {
    return { kind: "CLOSED" };
  }
  return {
    kind: "OPEN",
    request,
    applicantName: application.applicantName,
    hoursLeft: hoursRemaining(request.expiresAt, now),
  };
}

export type VouchAnswer =
  | { ok: true; outcome: VouchOutcome; applicationState: string }
  | { ok: false; reason: "UNKNOWN" | "EXPIRED" | "ANSWERED" | "CLOSED" };

/**
 * Answer a vouch request.
 *
 * The expiry check happens before anything is written. An expired token cannot
 * confirm, however it is submitted: a sponsor who opened the page inside the
 * window and clicked after it closed gets the dead end, not a late approval,
 * because the 72 hours are a property of the application and not of the page.
 */
export async function answerVouch(
  repo: MembershipRepository,
  token: string,
  outcome: VouchOutcome,
  now: Date = new Date(),
): Promise<VouchAnswer> {
  const request = await repo.getVouchRequest(token);
  if (!request) return { ok: false, reason: "UNKNOWN" };
  if (request.answeredAt !== null) return { ok: false, reason: "ANSWERED" };
  if (new Date(request.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "EXPIRED" };
  }

  const application = await repo.getApplication(request.applicationId);
  if (!application || application.state !== "AWAITING_VOUCH") {
    return { ok: false, reason: "CLOSED" };
  }

  const event =
    outcome === "CONFIRMED" ? ({ type: "VOUCH_CONFIRMED", sponsorMemberId: request.sponsorMemberId } as const) : ({ type: "VOUCH_DECLINED" } as const);

  const resolved = nextState(application.state, event);
  await repo.answerVouchRequest(token, outcome, now.toISOString());
  await repo.setApplicationState(application.id, resolved);

  if (resolved === "AWAITING_PAYMENT") {
    await enqueue({
      kind: "PAYMENT_LINK",
      to: application.email || null,
      toName: application.applicantName || null,
      subject: "Your JSOA membership application: dues payment",
      stream: "TRANSACTIONAL",
      body:
        `A sponsor has confirmed your application for membership of the Joint ` +
        `Special Operations Association.\n\n` +
        `To pay the dues, open ${paymentUrl(application.id)}\n\n` +
        `Dues are $200, paid once and not renewed. They are not a charitable ` +
        `contribution. The payment page is the provider's own; we never see a ` +
        `card number.`,
    });
  } else {
    await enqueue({
      kind: "CHAIR_NOTICE",
      to: MEMBERSHIP_CHAIR_INBOX,
      subject: "An application needs a chair decision",
      stream: "TRANSACTIONAL",
      body:
        `Application ${application.id} is with the chair. The sponsor either ` +
        `declined or did not recognise the name, and neither is a rejection.\n\n` +
        `The applicant has not been told who was asked or what they said.`,
    });
  }

  return { ok: true, outcome, applicationState: resolved };
}

/**
 * Move every application whose window has closed to the chair queue.
 *
 * Called by the board queue on load, so the demo needs no scheduler. In
 * production this is a job: the 72 hours are a promise to the applicant
 * ("within four days"), not a side effect of someone opening a page.
 */
export async function sweepExpiredVouches(
  repo: MembershipRepository,
  now: Date = new Date(),
): Promise<number> {
  const lapsed = await repo.listLapsedVouchRequests(now.toISOString());
  let moved = 0;
  for (const request of lapsed) {
    const application = await repo.getApplication(request.applicationId);
    if (!application || application.state !== "AWAITING_VOUCH") continue;
    await repo.setApplicationState(application.id, nextState(application.state, { type: "VOUCH_EXPIRED" }));
    await enqueue({
      kind: "CHAIR_NOTICE",
      to: MEMBERSHIP_CHAIR_INBOX,
      subject: "A vouch window closed without an answer",
      stream: "TRANSACTIONAL",
      body:
        `The ${VOUCH_WINDOW_HOURS}-hour window on application ${application.id} ` +
        `closed with no answer, so it has moved to the chair queue. This is also ` +
        `what happens to an application whose sponsor ID matched nobody, because ` +
        `the intake refuses to treat that case differently.\n\n` +
        `The applicant was promised an outcome within four days.`,
    });
    moved += 1;
  }
  return moved;
}

/** Copy for the sponsor page. Kept here so the route file holds no policy. */
export const VOUCH_WINDOW_COPY =
  `This request is open for ${VOUCH_WINDOW_HOURS} hours. After that it closes and ` +
  "the membership chair picks the application up instead. Nothing is lost either way.";

export function sponsorMayBeAsked(state: string): boolean {
  // A sponsor must hold member access to be asked to vouch. Kept as a function
  // so the check reads the state machine rather than a copied list.
  return grantsMemberAccess(state as never);
}
