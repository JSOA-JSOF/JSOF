import { beforeEach, describe, expect, it, vi } from "vitest";

import { openTestDatabase, type TestDatabase } from "./support/d1";

let current: TestDatabase | null = null;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!current) throw new Error("no test database open");
    return { env: { DB: current.binding } };
  },
}));

beforeEach(() => {
  current?.close();
  current = openTestDatabase();
});

const q = async () => import("../src/lib/comms/queue");

/**
 * The properties that are the reason this module exists, rather than a
 * tour of its functions.
 */
describe("the outbox never leaks whether a recipient exists", () => {
  it("writes a row for a message with nowhere to go, instead of throwing", async () => {
    const { enqueue } = await q();
    const message = await enqueue({
      stream: "TRANSACTIONAL",
      entity: "JSOA",
      kind: "VOUCH_REQUEST",
      toAddress: null,
      subject: "Somebody has named you",
      bodyText: "...",
    });
    expect(message.state).toBe("UNDELIVERABLE");
    expect(message.stateReason).toBe("no address on file");
  });

  it("does the same work either way, so timing answers nothing", async () => {
    const { enqueue } = await q();
    const base = {
      stream: "TRANSACTIONAL" as const,
      entity: "JSOA" as const,
      kind: "VOUCH_REQUEST",
      subject: "s",
      bodyText: "b",
    };
    await enqueue({ ...base, toAddress: "real@example.org" });
    await enqueue({ ...base, toAddress: null });

    // Both are rows, and both carry a delivery event. A handler that
    // skipped the write for the second would take measurably less
    // time, and that difference is the answer the form refuses to give.
    const rows = current!.raw.prepare("SELECT state FROM outbound_message").all();
    expect(rows).toHaveLength(2);
    const events = current!.raw
      .prepare("SELECT COUNT(*) AS n FROM delivery_event")
      .get() as { n: number };
    expect(events.n).toBe(2);
  });
});

describe("the two streams are kept apart", () => {
  it("lets a receipt through to somebody who unsubscribed from the newsletter", async () => {
    const { enqueue, unsubscribe } = await q();
    await unsubscribe("member@example.org");

    const bulk = await enqueue({
      stream: "BULK",
      entity: "JSOA",
      kind: "NEWSLETTER",
      toAddress: "member@example.org",
      subject: "n",
      bodyText: "b",
    });
    const receipt = await enqueue({
      stream: "TRANSACTIONAL",
      entity: "JSOA",
      kind: "DUES_RECEIPT",
      toAddress: "member@example.org",
      subject: "r",
      bodyText: "b",
    });

    expect(bulk.state).toBe("SUPPRESSED");
    expect(receipt.state, "an unsubscribe must not stop a receipt").toBe("QUEUED");
  });

  it("stops both streams on a hard bounce, because the address is wrong", async () => {
    const { enqueue, recordBounce } = await q();
    await recordBounce("gone@example.org", "550 no such user");
    for (const stream of ["TRANSACTIONAL", "BULK"] as const) {
      const message = await enqueue({
        stream,
        entity: "JSOF",
        kind: "X",
        toAddress: "gone@example.org",
        subject: "s",
        bodyText: "b",
      });
      expect(message.state, stream).toBe("SUPPRESSED");
    }
  });

  it("normalises the address, so case and spacing cannot route round a suppression", async () => {
    const { enqueue, unsubscribe } = await q();
    await unsubscribe("Member@Example.ORG");
    const message = await enqueue({
      stream: "BULK",
      entity: "JSOA",
      kind: "NEWSLETTER",
      toAddress: "  member@example.org ",
      subject: "s",
      bodyText: "b",
    });
    expect(message.state).toBe("SUPPRESSED");
  });
});

describe("a suppression is lifted, never deleted", () => {
  it("refuses a delete at the database", async () => {
    const { unsubscribe } = await q();
    await unsubscribe("someone@example.org");
    expect(() =>
      current!.raw.exec("DELETE FROM suppression WHERE address = 'someone@example.org'"),
    ).toThrow(/lifted, never deleted/);
  });

  it("lets mail through again once lifted, and keeps the record", async () => {
    const { enqueue, lift, listSuppressions, unsubscribe } = await q();
    await unsubscribe("back@example.org");
    await lift("back@example.org", "BULK", "p-secretary");

    const message = await enqueue({
      stream: "BULK",
      entity: "JSOA",
      kind: "NEWSLETTER",
      toAddress: "back@example.org",
      subject: "s",
      bodyText: "b",
    });
    expect(message.state).toBe("QUEUED");

    const rows = await listSuppressions();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.liftedBy).toBe("p-secretary");
  });
});

describe("the sending identity comes from the entity, never the caller", () => {
  it("will not let Association mail go out as the Foundation", async () => {
    const { senderFor } = await import("../src/lib/comms/sender");
    const assoc = senderFor("JSOA", "TRANSACTIONAL");
    const found = senderFor("JSOF", "TRANSACTIONAL");

    expect(assoc.address).toContain("thejsoa.org");
    expect(found.address).toContain("thejsof.org");
    // The Association's domain cannot send yet, and the fix is not to
    // borrow the Foundation's envelope.
    expect(assoc.ready).toBe(false);
    expect(found.ready).toBe(true);
  });

  it("queues Association mail rather than failing it or re-badging it", async () => {
    const { enqueue } = await q();
    const message = await enqueue({
      stream: "TRANSACTIONAL",
      entity: "JSOA",
      kind: "DUES_RECEIPT",
      toAddress: "member@example.org",
      subject: "s",
      bodyText: "b",
    });
    expect(message.state).toBe("QUEUED");
    expect(message.stateReason).toMatch(/sending domain/);
  });
});
