import { beforeEach, describe, expect, it, vi } from "vitest";

import { openTestDatabase, type TestDatabase } from "./support/d1";

/**
 * The D1 repositories, against a real SQLite built from the real
 * migrations.
 *
 * Until this file existed, `npm test` covered none of the six D1
 * implementations: the suite ran against the in-memory repositories,
 * which is right for speed but proves nothing about the code that
 * talks to a database. Three of the ports built a harness like this in
 * a scratch directory, used it, and threw it away.
 *
 * The mock is at the Cloudflare boundary rather than at the repository,
 * so each module's own accessor runs and the selection between the D1
 * and in-memory implementations is part of what is tested.
 */

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

function db(): TestDatabase {
  if (!current) throw new Error("no test database open");
  return current;
}

/* ------------------------------------------------------------------ *
 * The fixture itself. If these are wrong every test below lies.
 * ------------------------------------------------------------------ */

describe("the test database", () => {
  it("applies every migration, so it cannot drift from the schema", () => {
    const tables = db()
      .raw.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    // One from each migration, so a dropped file shows up here.
    for (const table of [
      "person", "role_grant", "audit_entry",     // 0001
      "inbound_message",                          // 0002
      "application", "member",                    // 0003
      "product", "store_order",                   // 0004
      "meeting", "minute_entry",                  // 0005
      "fund", "donation",                         // 0006
      "scholarship_application", "award",         // 0007
      "ledger_entry", "transfer",                 // 0008
      "counter",                                  // 0009
    ]) {
      expect(tables, `missing ${table}`).toContain(table);
    }
  });

  it("includes the newest migration's columns", () => {
    // 0010. A fixture built from a stale copy of the schema would pass
    // everything else in this file and still be useless.
    const columns = db()
      .raw.prepare("PRAGMA table_info(scholarship_application)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toContain("routing_applying_wounded_patriot");
  });

  it("refuses an undefined bind, the way D1 does", async () => {
    const statement = db()
      .binding.prepare("INSERT INTO counter (name, value) VALUES (?, ?)");
    expect(() => statement.bind("x", undefined)).toThrow(/undefined/);
  });

  it("enforces foreign keys, the way D1 does", async () => {
    await expect(
      db()
        .binding.prepare(
          "INSERT INTO role_grant (id, person_id, role, entity, granted_by, granted_at) " +
            "VALUES ('g','nobody','PRESIDENT','JSOA','nobody','2026-01-01T00:00:00Z')",
        )
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

/* ------------------------------------------------------------------ *
 * The divergences.
 *
 * Each of these is a place the in-memory repository allows something
 * the database refuses. The suite passes on the in-memory behaviour,
 * so without these tests the disagreement is invisible until a real
 * database says no.
 * ------------------------------------------------------------------ */

describe("where the database is stricter than the in-memory repository", () => {
  it("refuses a second physical count for the same sku and quarter", () => {
    const raw = db().raw;
    raw.exec(
      "INSERT INTO product (sku, entity, name, category, price_cents, currency, fulfilment, tax_treatment) " +
        "VALUES ('SKU-1','JSOA','Coin','coin',2500,'USD','stock','TAXABLE')",
    );
    const insert = (id: string, units: number) =>
      raw
        .prepare(
          "INSERT INTO physical_count (id, entity, sku, quarter, counted_at, counted_by_person_id, counted_units) " +
            "VALUES (?, 'JSOA', 'SKU-1', '2026-Q4', '2026-10-01T00:00:00Z', 'p1', ?)",
        )
        .run(id, units);

    insert("pc-1", 10);
    // The in-memory repository appends a second one. The migration says
    // a count is an observation that is never overwritten, and the
    // unique index means the second write fails rather than landing
    // beside the first.
    expect(() => insert("pc-2", 12)).toThrow(/UNIQUE/i);
  });

  it("refuses an edit to an approved minute", () => {
    const raw = db().raw;
    raw.exec(
      "INSERT INTO meeting (id, entity, title, scheduled_start, scheduled_minutes, session, status, quorum) " +
        "VALUES ('m1','JSOA','Board','2026-01-01T00:00:00Z',60,1,'HELD',3)",
    );
    raw.exec(
      "INSERT INTO agenda_item (id, meeting_id, entity, position, item_number, title, owner_role, type) " +
        "VALUES ('a1','m1','JSOA',1,1,'Item','SECRETARY','DISCUSSION')",
    );
    raw.exec(
      "INSERT INTO minute_entry (id, meeting_id, entity, agenda_item_id, item_number, ref, draft, source) " +
        "VALUES ('mi1','m1','JSOA','a1',1,'2026-01-01',0,'TYPED')",
    );

    // draft = 0 means approved. The in-memory repository updates it.
    expect(() =>
      raw.exec("UPDATE minute_entry SET discussion = 'rewritten' WHERE id = 'mi1'"),
    ).toThrow(/approved minutes are the record/);

    // And it cannot be un-approved to get around that, which I had not
    // thought about when writing this test and the trigger had. There
    // is no reopening an approved minute: a correction is a new entry
    // at the next meeting, which is how minute books have always
    // worked.
    expect(() =>
      raw.exec("UPDATE minute_entry SET draft = 1 WHERE id = 'mi1'"),
    ).toThrow(/approved minutes are the record/);
  });

  it("still lets a draft be edited, or the module could not work", () => {
    const raw = db().raw;
    raw.exec(
      "INSERT INTO meeting (id, entity, title, scheduled_start, scheduled_minutes, session, status, quorum) " +
        "VALUES ('m1','JSOA','Board','2026-01-01T00:00:00Z',60,1,'HELD',3)",
    );
    raw.exec(
      "INSERT INTO agenda_item (id, meeting_id, entity, position, item_number, title, owner_role, type) " +
        "VALUES ('a1','m1','JSOA',1,1,'Item','SECRETARY','DISCUSSION')",
    );
    raw.exec(
      "INSERT INTO minute_entry (id, meeting_id, entity, agenda_item_id, item_number, ref, draft, source) " +
        "VALUES ('mi1','m1','JSOA','a1',1,'2026-01-01',1,'TYPED')",
    );
    raw.exec("UPDATE minute_entry SET discussion = 'edited' WHERE id = 'mi1'");
    raw.exec("UPDATE minute_entry SET draft = 0 WHERE id = 'mi1'");
    const row = raw
      .prepare("SELECT discussion, draft FROM minute_entry WHERE id = 'mi1'")
      .get() as { discussion: string; draft: number };
    expect(row).toEqual({ discussion: "edited", draft: 0 });
  });

  it("refuses to delete a minute entry at all", () => {
    const raw = db().raw;
    raw.exec(
      "INSERT INTO meeting (id, entity, title, scheduled_start, scheduled_minutes, session, status, quorum) " +
        "VALUES ('m1','JSOA','Board','2026-01-01T00:00:00Z',60,1,'HELD',3)",
    );
    raw.exec(
      "INSERT INTO agenda_item (id, meeting_id, entity, position, item_number, title, owner_role, type) " +
        "VALUES ('a1','m1','JSOA',1,1,'Item','SECRETARY','DISCUSSION')",
    );
    raw.exec(
      "INSERT INTO minute_entry (id, meeting_id, entity, agenda_item_id, item_number, ref, draft, source) " +
        "VALUES ('mi1','m1','JSOA','a1',1,'2026-01-01',1,'TRANSCRIPT')",
    );
    expect(() => raw.exec("DELETE FROM minute_entry WHERE id = 'mi1'")).toThrow(
      /never deleted/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * The controls that only exist in the database.
 * ------------------------------------------------------------------ */

describe("the controls the schema enforces", () => {
  it("will not allocate a gift to the other entity's fund", () => {
    const raw = db().raw;
    raw.exec(
      "INSERT INTO fund (id, entity, name, restriction, purpose, currency) " +
        "VALUES ('f-jsoa','JSOA','A','UNRESTRICTED','x','USD')",
    );
    raw.exec(
      "INSERT INTO donation (id, entity, donor_display_name, donor_email, amount_cents, currency, status, received_at, created_by_id) " +
        "VALUES ('d1','JSOF','D','d@e.org',1000,'USD','CLEARED','2026-01-01T00:00:00Z','p1')",
    );
    expect(() =>
      raw.exec(
        "INSERT INTO donation_allocation (donation_id, fund_id, amount_cents) VALUES ('d1','f-jsoa',1000)",
      ),
    ).toThrow(/other entity/);
  });

  it("will not let a claimant approve their own reimbursement", () => {
    const raw = db().raw;
    raw.exec(
      "INSERT INTO treasury_fund (id, entity, name, restriction) VALUES ('tf','JSOA','F','UNRESTRICTED')",
    );
    raw.exec(
      "INSERT INTO reimbursement (id, entity, created_by_id, claimant_name, amount_cents, fund_id, incurred_on, status) " +
        "VALUES ('r1','JSOA','p-claimant','C',500,'tf','2026-01-01','SUBMITTED')",
    );
    expect(() =>
      raw.exec(
        "INSERT INTO reimbursement_approval (reimbursement_id, approver_id, approved_at) " +
          "VALUES ('r1','p-claimant','2026-01-02T00:00:00Z')",
      ),
    ).toThrow(/cannot be approved by the person who raised it/);

    // Somebody else may.
    raw.exec(
      "INSERT INTO reimbursement_approval (reimbursement_id, approver_id, approved_at) " +
        "VALUES ('r1','p-other','2026-01-02T00:00:00Z')",
    );
  });

  it("will not let the ledger be rewritten", () => {
    const raw = db().raw;
    raw.exec(
      "INSERT INTO treasury_fund (id, entity, name, restriction) VALUES ('tf','JSOA','F','UNRESTRICTED')",
    );
    raw.exec(
      "INSERT INTO ledger_entry (id, entity, date, fund_id, account, kind, amount_cents, entered_by_id) " +
        "VALUES ('le1','JSOA','2026-01-01','tf','1000','CREDIT',500,'p1')",
    );
    expect(() =>
      raw.exec("UPDATE ledger_entry SET amount_cents = 99999 WHERE id = 'le1'"),
    ).toThrow(/append-only/);
    expect(() => raw.exec("DELETE FROM ledger_entry WHERE id = 'le1'")).toThrow(
      /append-only/,
    );
  });

  it("will not let a transfer stay inside one entity", () => {
    expect(() =>
      db().raw.exec(
        "INSERT INTO transfer (id, created_by_id, entity, from_entity, to_entity, amount_cents, status) " +
          "VALUES ('t1','p1','JSOA','JSOA','JSOA',100,'DRAFT')",
      ),
    ).toThrow(/from_entity <> to_entity/);
  });

  it("will not let an audit row be changed", () => {
    const raw = db().raw;
    raw.exec(
      "INSERT INTO audit_entry (id, at, action) VALUES ('a1','2026-01-01T00:00:00Z','READ')",
    );
    expect(() => raw.exec("UPDATE audit_entry SET action='WRITE' WHERE id='a1'")).toThrow(
      /append-only/,
    );
    expect(() => raw.exec("DELETE FROM audit_entry WHERE id='a1'")).toThrow(
      /append-only/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * The shared layer, against the fixture.
 * ------------------------------------------------------------------ */

describe("the shared D1 layer", () => {
  it("allocates a sequence without repeating", async () => {
    const { nextInSequence } = await import("../src/lib/db");
    const seen = new Set<number>();
    for (let i = 0; i < 25; i += 1) seen.add(await nextInSequence("probe"));
    expect(seen.size).toBe(25);
    expect(Math.max(...seen)).toBe(25);
  });

  it("keeps two counters apart", async () => {
    const { nextInSequence } = await import("../src/lib/db");
    expect(await nextInSequence("a")).toBe(1);
    expect(await nextInSequence("b")).toBe(1);
    expect(await nextInSequence("a")).toBe(2);
  });

  it("rolls a batch back whole when one statement fails", async () => {
    const { atomic, requireDatabase } = await import("../src/lib/db");
    const prepare = (sql: string) => requireDatabase().prepare(sql);

    await expect(
      atomic([
        prepare("INSERT INTO counter (name, value) VALUES ('kept', 1)"),
        // Same primary key: this one fails.
        prepare("INSERT INTO counter (name, value) VALUES ('kept', 2)"),
      ]),
    ).rejects.toThrow();

    const row = db()
      .raw.prepare("SELECT COUNT(*) AS n FROM counter WHERE name = 'kept'")
      .get() as { n: number };
    expect(row.n, "the first insert should have been rolled back").toBe(0);
  });

  it("finds the binding through the real accessor", async () => {
    const { database } = await import("../src/lib/db");
    expect(database()).not.toBeNull();
  });
});
