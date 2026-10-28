import "server-only";

import { atomic, database, many, newId, now, one, requireDatabase } from "../db";
import { senderFor } from "./sender";
import type {
  Draft,
  OutboundMessage,
  Stream,
  Suppression,
  SuppressionReason,
} from "./types";

/**
 * The outbox.
 *
 * `enqueue` is the only way a message is created and it never sends.
 * It writes a row and returns. A worker drains the queue afterwards.
 *
 * Three rules are enforced here rather than left to callers, because a
 * rule each caller has to remember is a rule that will be forgotten by
 * the fourth one:
 *
 *   1. **It never throws for a missing recipient.** A draft with no
 *      address becomes an UNDELIVERABLE row. The membership handler
 *      must not behave differently when a sponsor does not exist,
 *      because response time would then answer a question the form
 *      refuses to answer.
 *   2. **Suppression is checked per stream.** Unsubscribing from the
 *      newsletter does not stop a receipt.
 *   3. **The sender is resolved from the entity**, never supplied.
 */

function rowToMessage(row: Record<string, unknown>): OutboundMessage {
  return {
    id: String(row.id),
    stream: row.stream as Stream,
    entity: (row.entity as OutboundMessage["entity"]) ?? null,
    kind: String(row.kind),
    toAddress: String(row.to_address),
    toName: (row.to_name as string | null) ?? null,
    subject: String(row.subject),
    bodyText: String(row.body_text),
    state: row.state as OutboundMessage["state"],
    stateReason: (row.state_reason as string | null) ?? null,
    queuedAt: String(row.queued_at),
    sentAt: (row.sent_at as string | null) ?? null,
    attempts: Number(row.attempts ?? 0),
    providerRef: (row.provider_ref as string | null) ?? null,
  };
}

/** Is this address suppressed on this stream right now? */
export async function isSuppressed(
  address: string,
  stream: Stream,
): Promise<boolean> {
  const db = database();
  if (!db) return false;
  const row = await one<{ n: number }>(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM suppression " +
          "WHERE address = ? AND stream = ? AND lifted_at IS NULL",
      )
      .bind(address.trim().toLowerCase(), stream),
  );
  return (row?.n ?? 0) > 0;
}

/**
 * Write a message to the outbox. Never sends, never throws for a
 * missing recipient, and does the same work either way.
 */
export async function enqueue(draft: Draft): Promise<OutboundMessage> {
  const id = newId();
  const at = now();
  const address = draft.toAddress?.trim().toLowerCase() ?? "";

  let state: OutboundMessage["state"] = "QUEUED";
  let reason: string | null = null;

  if (!address) {
    state = "UNDELIVERABLE";
    reason = "no address on file";
  } else if (await isSuppressed(address, draft.stream)) {
    state = "SUPPRESSED";
    reason = `on the ${draft.stream.toLowerCase()} suppression list`;
  } else if (!senderFor(draft.entity, draft.stream).ready) {
    // Queued, not failed. The message is correct and the domain is
    // not ready; it goes out when it is, rather than being lost or
    // sent from the wrong organization.
    reason = "waiting for the sending domain to be verified";
  }

  const message: OutboundMessage = {
    id,
    stream: draft.stream,
    entity: draft.entity,
    kind: draft.kind,
    toAddress: address,
    toName: draft.toName ?? null,
    subject: draft.subject,
    bodyText: draft.bodyText,
    state,
    stateReason: reason,
    queuedAt: at,
    sentAt: null,
    attempts: 0,
    providerRef: null,
  };

  const db = database();
  if (!db) return message;

  await atomic([
    db
      .prepare(
        "INSERT INTO outbound_message (id, stream, entity, kind, to_address, to_name, " +
          "subject, body_text, state, state_reason, queued_at, attempts) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
      )
      .bind(
        id,
        draft.stream,
        draft.entity,
        draft.kind,
        address,
        draft.toName ?? null,
        draft.subject,
        draft.bodyText,
        state,
        reason,
        at,
      ),
    db
      .prepare(
        "INSERT INTO delivery_event (id, message_id, event, detail, at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(
        newId(),
        id,
        state === "SUPPRESSED" ? "SUPPRESSED" : "ATTEMPTED",
        reason,
        at,
      ),
  ]);

  return message;
}

/** The queue, newest first. For the Communications Chair's screen. */
export async function listMessages(limit = 100): Promise<OutboundMessage[]> {
  const db = database();
  if (!db) return [];
  const rows = await many<Record<string, unknown>>(
    db
      .prepare(
        "SELECT * FROM outbound_message ORDER BY queued_at DESC, rowid DESC LIMIT ?",
      )
      .bind(limit),
  );
  return rows.map(rowToMessage);
}

export async function countByState(): Promise<Record<string, number>> {
  const db = database();
  if (!db) return {};
  const rows = await many<{ state: string; n: number }>(
    db.prepare("SELECT state, COUNT(*) AS n FROM outbound_message GROUP BY state"),
  );
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}

export async function suppress(
  address: string,
  stream: Stream,
  reason: SuppressionReason,
  note?: string,
): Promise<void> {
  await requireDatabase()
    .prepare(
      "INSERT INTO suppression (address, stream, reason, note, created_at) " +
        "VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(address, stream) DO UPDATE SET " +
        "reason = excluded.reason, note = excluded.note, lifted_at = NULL, lifted_by = NULL",
    )
    .bind(address.trim().toLowerCase(), stream, reason, note ?? null, now())
    .run();
}

/**
 * A hard bounce means the address does not work, so it stops both
 * streams. An unsubscribe is a preference about one of them.
 */
export async function recordBounce(address: string, detail?: string): Promise<void> {
  await suppress(address, "TRANSACTIONAL", "HARD_BOUNCE", detail);
  await suppress(address, "BULK", "HARD_BOUNCE", detail);
}

export async function unsubscribe(address: string): Promise<void> {
  await suppress(address, "BULK", "UNSUBSCRIBED");
}

/** Coming off a list is a new fact, not the removal of an old one. */
export async function lift(address: string, stream: Stream, by: string): Promise<void> {
  await requireDatabase()
    .prepare(
      "UPDATE suppression SET lifted_at = ?, lifted_by = ? " +
        "WHERE address = ? AND stream = ? AND lifted_at IS NULL",
    )
    .bind(now(), by, address.trim().toLowerCase(), stream)
    .run();
}

export async function listSuppressions(): Promise<Suppression[]> {
  const db = database();
  if (!db) return [];
  const rows = await many<Record<string, unknown>>(
    db.prepare("SELECT * FROM suppression ORDER BY created_at DESC"),
  );
  return rows.map((row) => ({
    address: String(row.address),
    stream: row.stream as Stream,
    reason: row.reason as SuppressionReason,
    note: (row.note as string | null) ?? null,
    createdAt: String(row.created_at),
    liftedAt: (row.lifted_at as string | null) ?? null,
    liftedBy: (row.lifted_by as string | null) ?? null,
  }));
}
