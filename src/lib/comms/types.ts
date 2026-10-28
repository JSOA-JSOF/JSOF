import type { Entity } from "../authz/model";

/**
 * Outbound mail: the shared seam.
 *
 * Every module that needs to tell somebody something goes through
 * `enqueue` in ./queue. Nothing calls a mail API directly, and nothing
 * awaits a send inside a request.
 *
 * That second rule is a security property, not a performance one. The
 * membership submission handler must not reveal whether a sponsor
 * exists, and how long a request takes is a channel like any other. So
 * the handler does identical work and writes an identical row whether
 * or not the message can ever be delivered, and the decision not to
 * deliver is recorded on the row rather than taken by skipping it.
 */

/**
 * Transactional is a consequence of something the recipient did: a
 * receipt, an approval, a sign-in link. Bulk is something we decided
 * to send.
 *
 * It is a required argument everywhere and has no default. A default
 * would be guessed wrong once and then a member who unsubscribed from
 * the newsletter would stop receiving receipts, which is the failure
 * this whole distinction exists to prevent.
 */
export const STREAMS = ["TRANSACTIONAL", "BULK"] as const;
export type Stream = (typeof STREAMS)[number];

export const MESSAGE_STATES = [
  "QUEUED",
  "SENT",
  "FAILED",
  /** The address is on the suppression list for this stream. */
  "SUPPRESSED",
  /** There was no address to send to. A real outcome, not an error. */
  "UNDELIVERABLE",
] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

export const SUPPRESSION_REASONS = [
  "UNSUBSCRIBED",
  "HARD_BOUNCE",
  "COMPLAINT",
  "MANUAL",
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export type OutboundMessage = {
  id: string;
  stream: Stream;
  /** Which organization is speaking. Null only for platform mail. */
  entity: Entity | null;
  /** The sending module's own name for it, e.g. `VOUCH_REQUEST`. */
  kind: string;
  toAddress: string;
  toName: string | null;
  subject: string;
  bodyText: string;
  state: MessageState;
  stateReason: string | null;
  queuedAt: string;
  sentAt: string | null;
  attempts: number;
  providerRef: string | null;
};

/** What a caller provides. Everything else is the queue's business. */
export type Draft = {
  stream: Stream;
  entity: Entity | null;
  kind: string;
  /** Null is allowed and is the point: it becomes UNDELIVERABLE, not a throw. */
  toAddress: string | null;
  toName?: string | null;
  subject: string;
  bodyText: string;
};

export type Suppression = {
  address: string;
  stream: Stream;
  reason: SuppressionReason;
  note: string | null;
  createdAt: string;
  liftedAt: string | null;
  liftedBy: string | null;
};

export const DELIVERY_EVENTS = [
  "ATTEMPTED",
  "ACCEPTED",
  "REJECTED",
  "BOUNCED",
  "COMPLAINED",
  "SUPPRESSED",
] as const;
export type DeliveryEventKind = (typeof DELIVERY_EVENTS)[number];

/**
 * Who a message appears to come from.
 *
 * Resolved from the entity, never passed in. A (c)(19) receipt must
 * not arrive in a (c)(3) envelope: the separation of the two
 * organizations is a compliance control and the envelope is the one
 * artifact a donor keeps. The Foundation's domain is the only one
 * verified today, so the Association's mail queues and waits rather
 * than going out wearing the wrong name.
 */
export type SenderIdentity = {
  address: string;
  name: string;
  /** False where the domain is not yet verified to send. */
  ready: boolean;
};
