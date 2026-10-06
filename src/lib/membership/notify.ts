/**
 * Transactional mail, stubbed.
 *
 * Resend is the vendor named in the spec. Nothing is sent here: messages land
 * in an in-memory outbox so the flow can be walked in the demo and asserted in
 * tests.
 *
 * One design point that is not cosmetic. The submission handler must not leak
 * whether a sponsor exists, and response time is a channel like any other. So
 * the handler hands every message to this queue and never waits on a send:
 * `enqueue` does the same constant work whether or not the message is
 * deliverable, and the decision not to deliver is recorded on the queued
 * message rather than taken by skipping the call.
 *
 * A real implementation keeps that property by writing the message to a table
 * and letting a worker send it. It must not call the mail API inline.
 */

export type OutboxMessage = {
  id: string;
  at: string;
  kind: "VOUCH_REQUEST" | "PAYMENT_LINK" | "CHAIR_NOTICE" | "DECISION_NOTICE";
  /** Redacted in the outbox view: the recipient is the point of the record, not the copy. */
  to: string;
  subject: string;
  /** False when there was no address to send to. The message is still queued. */
  deliverable: boolean;
  ref: string;
};

const OUTBOX_KEY = "__jsoa_membership_outbox__";
type OutboxGlobal = typeof globalThis & { [OUTBOX_KEY]?: OutboxMessage[] };

function outbox(): OutboxMessage[] {
  const store = globalThis as OutboxGlobal;
  store[OUTBOX_KEY] ??= [];
  return store[OUTBOX_KEY];
}

let sequence = 0;

/** Constant work on every path. Never branches before queueing. */
export function enqueue(message: Omit<OutboxMessage, "id" | "at">): OutboxMessage {
  sequence += 1;
  const record: OutboxMessage = {
    ...message,
    id: `msg_${sequence.toString(36)}`,
    at: new Date().toISOString(),
  };
  outbox().push(record);
  return record;
}

export function readOutbox(limit = 50): OutboxMessage[] {
  return outbox().slice(-limit).reverse();
}

export function vouchRequestUrl(token: string): string {
  return `/apply/vouch/${token}`;
}

export function paymentUrl(applicationId: string): string {
  return `/apply/pay/${applicationId}`;
}
