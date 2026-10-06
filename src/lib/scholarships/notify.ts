/**
 * Transactional mail for the scholarship cycle, stubbed.
 *
 * Resend is the vendor named in docs/ARCHITECTURE.md. Nothing is sent here:
 * messages land in an in-memory outbox so the flow can be walked in the demo
 * and asserted in tests.
 *
 * The part that is not cosmetic: a queued message carries a LIST of named
 * recipients, each with a role and a reason. There is no bcc field on this
 * type and no "copy" field either. The sponsoring member is a recipient of
 * every message to an applicant because students frequently do not read or
 * answer email, and the chair's current workaround is to leave the platform
 * and chase the sponsor by hand. A bcc would preserve the workaround while
 * looking like a fix.
 */

import type { Entity } from "../authz/model";
import type { Recipient } from "./types";

export const SCHOLARSHIPS_CHAIR_INBOX = "scholarships@example.org";
export const JSOF_TREASURER_INBOX = "treasurer.jsof@example.org";

export type ScholarshipMessageKind =
  | "AWARD_NOTIFICATION"
  | "NOT_AWARDED_NOTICE"
  | "GUARDIAN_CONSENT_REQUEST"
  | "CHAIR_NOTICE"
  | "BOARD_REVIEW_NOTICE";

export type ScholarshipOutboxMessage = {
  id: string;
  at: string;
  entity: Entity;
  kind: ScholarshipMessageKind;
  /** Every recipient, by role. No bcc exists on this type. */
  recipients: Recipient[];
  subject: string;
  body: string;
  /** An application or award reference. Never a name. */
  ref: string;
};

const OUTBOX_KEY = "__jsof_scholarships_outbox__";
type OutboxGlobal = typeof globalThis & { [OUTBOX_KEY]?: ScholarshipOutboxMessage[] };

function outbox(): ScholarshipOutboxMessage[] {
  const store = globalThis as OutboxGlobal;
  store[OUTBOX_KEY] ??= [];
  return store[OUTBOX_KEY];
}

let sequence = 0;

export class NoRecipientsError extends Error {
  constructor(ref: string) {
    super(`Refusing to queue a message about ${ref} with no recipients`);
    this.name = "NoRecipientsError";
  }
}

export function enqueue(
  message: Omit<ScholarshipOutboxMessage, "id" | "at">,
): ScholarshipOutboxMessage {
  if (message.recipients.length === 0) throw new NoRecipientsError(message.ref);
  sequence += 1;
  const record: ScholarshipOutboxMessage = {
    ...message,
    id: `smsg_${sequence.toString(36)}`,
    at: new Date().toISOString(),
  };
  outbox().push(record);
  return record;
}

export function readOutbox(limit = 50): ScholarshipOutboxMessage[] {
  return outbox().slice(-limit).reverse();
}

export function clearOutbox(): void {
  outbox().length = 0;
}

/** Every message about one application or award, oldest first. */
export function messagesFor(ref: string): ScholarshipOutboxMessage[] {
  return outbox().filter((message) => message.ref === ref);
}
