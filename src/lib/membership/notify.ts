/**
 * Membership's outbound mail, written against the shared outbox.
 *
 * This file used to BE an outbox: an in-memory array that nothing ever
 * drained. `src/lib/comms/queue.ts` is now the real one — a table, with a
 * worker draining it — so this file is the membership module's vocabulary
 * over it and holds no messages of its own. Two outboxes would mean the
 * Communications Chair's screen showed half the mail.
 *
 * The one design point that is not cosmetic survived the port intact, and it
 * is the reason to read this file before changing it.
 *
 * The submission handler must not leak whether a sponsor exists, and response
 * time is a channel like any other. So every message is handed to the queue
 * and no send is ever awaited: `enqueue` writes a row and returns. A missing
 * recipient is NOT an error — the queue turns it into an UNDELIVERABLE row on
 * purpose, which is what lets the caller pass `sponsor?.email ?? null` with no
 * branch around the call. Do not add one. A call that is skipped when there is
 * nobody to write to is measurably faster than one that is not, and that
 * difference answers the question the form exists to refuse.
 *
 * `stream` is required on every draft and has no default here either. A
 * default would be guessed wrong once and then a member who unsubscribed from
 * the newsletter would stop receiving receipts.
 *
 * Everything this module sends is TRANSACTIONAL: each message is a
 * consequence of something somebody did — a submission, a vouch, a payment, a
 * decision, a correction. Membership sends no bulk mail at all. A vouch
 * request is transactional even though the sponsor did not ask for it, because
 * it is a one-to-one operational message about a named application, and
 * because a sponsor who unsubscribed from the newsletter must still be
 * reachable to be asked.
 */

import { enqueue as enqueueOutbound } from "../comms/queue";
import type { OutboundMessage, Stream } from "../comms/types";
import { MEMBERSHIP_ENTITY } from "./types";

/** This module's own names for what it sends. Not a shared enum. */
export const MEMBERSHIP_MESSAGE_KINDS = [
  /** To the applicant, on submission. E07. */
  "APPLICANT_CONFIRMATION",
  /** To the sponsor named on an application. */
  "VOUCH_REQUEST",
  /** To the applicant, once dues may be asked for. */
  "PAYMENT_LINK",
  /** To the applicant, on a chair decision. */
  "DECISION_NOTICE",
  /** To the new member, when dues clear. */
  "DUES_RECEIPT",
  /** To a role inbox, never to a person. */
  "CHAIR_NOTICE",
  /** To the address being replaced, so a change is visible to its owner. */
  "CONTACT_CHANGE_NOTICE",
] as const;
export type MembershipMessageKind = (typeof MEMBERSHIP_MESSAGE_KINDS)[number];

export type MembershipDraft = {
  kind: MembershipMessageKind;
  /**
   * Null is allowed and is the point. The queue records UNDELIVERABLE rather
   * than throwing, so the caller never has to ask whether there is an address.
   */
  to: string | null;
  toName?: string | null;
  subject: string;
  body: string;
  /** Required. See the note at the top of this file. */
  stream: Stream;
};

/**
 * Hand one message to the outbox. Never sends, never branches on the
 * recipient, and does the same work whether or not there is one.
 *
 * It returns the queued row so a caller can record what it queued. Nothing
 * applicant-facing may be computed from the return value.
 */
export async function enqueue(draft: MembershipDraft): Promise<OutboundMessage> {
  return enqueueOutbound({
    stream: draft.stream,
    entity: MEMBERSHIP_ENTITY,
    kind: draft.kind,
    toAddress: draft.to,
    toName: draft.toName ?? null,
    subject: draft.subject,
    bodyText: draft.body,
  });
}

export function vouchRequestUrl(token: string): string {
  return `/apply/vouch/${token}`;
}

export function paymentUrl(applicationId: string): string {
  return `/apply/pay/${applicationId}`;
}
