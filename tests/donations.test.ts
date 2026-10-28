/**
 * Donations, funds, receipts and sponsorship: the control tests.
 *
 * These are written as requirements. Each one is a rule from
 * docs/ARCHITECTURE.md or docs/PRIVACY-AND-PAYMENTS.md that the code must not
 * be able to break, plus the wrong-role request that has to fail.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openTestDatabase, type TestDatabase } from "./support/d1";

/*
 * A D1 binding, but only where a test asks for one.
 *
 * `vi.mock` is hoisted and applies to the whole file, so the mock throws
 * while `liveDatabase` is null — which is what `database()` sees outside a
 * request context, and what keeps every test below running against the
 * in-memory repository at the speed the suite depends on.
 *
 * Two kinds of test open a real one. The outbox tests, because `enqueue`
 * writes a row and returns the message either way, so asserting that the row
 * actually lands needs a database. And the D1 repository tests, because
 * nothing in `npm test` covered a line of `repository.d1.ts` before: the
 * phase-2 ports built harnesses in scratch directories and threw them away.
 */
let liveDatabase: TestDatabase | null = null;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => {
    if (!liveDatabase) throw new Error("no binding in this test");
    return { env: { DB: liveDatabase.binding } };
  },
}));

function openDatabase(): TestDatabase {
  liveDatabase?.close();
  liveDatabase = openTestDatabase();
  return liveDatabase;
}

function closeDatabase(): void {
  liveDatabase?.close();
  liveDatabase = null;
}

import type { Entity } from "../src/lib/authz/model";
import { AuthzError, type Subject } from "../src/lib/authz/policy";
import { validateAllocations } from "../src/lib/donations/allocation";
import {
  approvePlacementForPublication,
  canApproveRelease,
  canAuthorWording,
  canDefineFund,
  canRecordSponsorship,
  canSendReceipt,
  checkAllocations,
  closeFundToGifts,
  issueReceipt,
  listPublicFundOptions,
  prepareDonationIntent,
  readDonationRegister,
  readFundAggregates,
  readFundRegister,
  readSponsorAcknowledgments,
  readSponsorRegister,
  recordClearedDonation,
  recordSponsorship,
  saveAcknowledgmentString,
  saveFund,
  sendPlacementForRelease,
  sendReceipt,
} from "../src/lib/donations/actions";
import { buildCheckoutHandoff, PCI_NOTE } from "../src/lib/donations/checkout";
import {
  NC_131F_DISCLOSURE,
  NC_131F_TYPE,
} from "../src/lib/donations/disclosure";
import { formatCents, parseDollarsToCents } from "../src/lib/donations/money";
import {
  donationsRepository,
  InMemoryDonationsRepository,
  RepositoryError,
  type FundDraft,
  type SponsorshipDraft,
} from "../src/lib/donations/repository";
import { D1DonationsRepository } from "../src/lib/donations/repository.d1";
import {
  buildReceipt,
  checkDisclosureConspicuous,
  ENTITY_IDENTITY,
  receiptDraft,
  RECEIPT_MESSAGE_KIND,
  ReceiptError,
  renderReceiptHtml,
  renderReceiptText,
  TEMPLATE_FINGERPRINTS,
} from "../src/lib/donations/receipts";
import {
  assessSafeHarbour,
  exceedsSafeHarbour,
  reviewAcknowledgment,
} from "../src/lib/donations/sponsorship";
import type { Donation, Fund } from "../src/lib/donations/types";
import {
  HEADLINE_KPI_KEYS,
  readDonationsDashboard,
  splitKpis,
} from "../src/lib/donations/kpis";
import {
  entitiesInScope,
  functionTabHref,
  functionTabs,
  fundraisingCalendar,
  fundraisingOutside,
  fundraisingPlanning,
  fundraisingProjects,
  fundraisingTasks,
  FUNDRAISING_PLANNING_ITEMS,
  readSponsorshipDates,
} from "../src/lib/donations/workspace";
import { PROJECTS } from "../src/lib/projects/register";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function subject(
  personId: string,
  assignments: Subject["assignments"],
  mfaSatisfied = true,
): Subject {
  return { personId, assignments, mfaSatisfied };
}

const treasurerJsof = subject("p-treas-jsof", [
  { role: "TREASURER", entity: "JSOF" },
]);
const treasurerJsoa = subject("p-treas-jsoa", [
  { role: "TREASURER", entity: "JSOA" },
]);
const fundraisingChairJsof = subject("p-fund-jsof", [
  { role: "FUNDRAISING_CHAIR", entity: "JSOF" },
]);
const scholarshipsChairJsof = subject("p-schol-jsof", [
  { role: "SCHOLARSHIPS_CHAIR", entity: "JSOF" },
]);
const secretaryJsof = subject("p-sec-jsof", [{ role: "SECRETARY", entity: "JSOF" }]);
const nobody = subject("p-nobody", [], false);

function repo() {
  return new InMemoryDonationsRepository();
}

function fund(id: string, entity: Entity, open = true): Fund {
  return {
    id,
    entity,
    name: `Fund ${id}`,
    restriction: "UNRESTRICTED",
    purpose: "Test fund.",
    currency: "USD",
    openToGifts: open,
  };
}

const TEST_FUNDS: Fund[] = [
  fund("f-a", "JSOF"),
  fund("f-b", "JSOF"),
  fund("f-c", "JSOF"),
  fund("f-jsoa", "JSOA"),
];

function paidGift(overrides: Partial<Donation> = {}): Donation {
  return {
    id: "d-test-1",
    entity: "JSOF",
    donorDisplayName: "Test Donor",
    donorEmail: "donor@example.org",
    amountCents: 100_000,
    currency: "USD",
    allocations: [{ fundId: "f-a", amountCents: 100_000 }],
    benefits: [],
    benefitFairMarketValueCents: null,
    sponsorshipId: null,
    status: "PAID",
    receivedAt: "2026-05-01T12:00:00Z",
    checkoutSessionRef: "co_stub_test",
    createdById: "sys-checkout",
    ...overrides,
  };
}

/* ================================================================== *
 * 0. The accessor
 *
 * Every method on `DonationsRepository` returns a Promise, because D1 is
 * async and the interface follows the database rather than the in-memory
 * arrays. That conversion is what the rest of this file exercises; what it
 * cannot exercise is the D1 implementation itself, which needs a binding.
 * What is testable here is the other branch: with no binding, the accessor
 * has to give back the seeded in-memory repository rather than a D1 one
 * pointed at nothing.
 * ================================================================== */

describe("the repository accessor", () => {
  it("falls back to the in-memory repository when there is no D1 binding", () => {
    // The suite runs outside a request context, so `database()` is null.
    const store = donationsRepository();
    expect(store).toBeInstanceOf(InMemoryDonationsRepository);
  });

  it("gives the same fallback instance every time, so a write is not lost", () => {
    // A fresh repository per call would lose a gift the moment it was
    // recorded, which is the whole failure mode of `next dev` with no Worker.
    expect(donationsRepository()).toBe(donationsRepository());
  });

  it("returns a promise from every method, including the in-memory one", async () => {
    const r = repo();
    const reads = [
      r.listFunds("JSOF"),
      r.getFund("fund-jsof-general"),
      r.fundBalances("JSOF"),
      r.giftsBehindFund("fund-jsof-general"),
      r.listDonations("JSOF"),
      r.getDonation("d-jsof-001"),
      r.nextReceiptSequence("JSOF"),
      r.listSponsorships("JSOF"),
      r.getSponsorship("s-jsof-001"),
    ];
    for (const read of reads) {
      expect(read).toBeInstanceOf(Promise);
    }
    await Promise.all(reads);
  });
});

/* ================================================================== *
 * 1. Allocations must sum exactly
 * ================================================================== */

describe("allocations must sum exactly to the total", () => {
  it("refuses a shortfall and names it", () => {
    const result = validateAllocations({
      entity: "JSOF",
      totalCents: 1_500_000,
      allocations: [
        { fundId: "f-a", amountCents: 1_000_000 },
        { fundId: "f-b", amountCents: 300_000 },
      ],
      funds: TEST_FUNDS,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("SHORTFALL");
    expect(result.differenceCents).toBe(-200_000);
    // The message has to name the shortfall in dollars, not just say "invalid".
    expect(result.message).toContain("$2,000.00");
    expect(result.message).toContain("$15,000.00");
    expect(result.message).toContain("unallocated");
  });

  it("refuses an overage and names it", () => {
    const result = validateAllocations({
      entity: "JSOF",
      totalCents: 1_500_000,
      allocations: [
        { fundId: "f-a", amountCents: 1_000_000 },
        { fundId: "f-b", amountCents: 600_000 },
      ],
      funds: TEST_FUNDS,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("OVERAGE");
    expect(result.differenceCents).toBe(100_000);
    expect(result.message).toContain("$1,000.00");
  });

  it("refuses a one-cent shortfall, because exactly means exactly", () => {
    const result = validateAllocations({
      entity: "JSOF",
      totalCents: 100_000,
      allocations: [{ fundId: "f-a", amountCents: 99_999 }],
      funds: TEST_FUNDS,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("SHORTFALL");
    expect(result.message).toContain("$0.01");
  });

  it("accepts a three-way split of one gift", () => {
    // The brief's example: $10,000 to the golf tournament, $5,000 to
    // scholarships, the rest to general.
    const result = validateAllocations({
      entity: "JSOF",
      totalCents: 2_500_000,
      allocations: [
        { fundId: "f-a", amountCents: 1_000_000 },
        { fundId: "f-b", amountCents: 500_000 },
        { fundId: "f-c", amountCents: 1_000_000 },
      ],
      funds: TEST_FUNDS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.allocatedCents).toBe(2_500_000);
  });

  it("refuses a gift with no fund at all", () => {
    const result = validateAllocations({
      entity: "JSOF",
      totalCents: 100_000,
      allocations: [],
      funds: TEST_FUNDS,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("NO_ALLOCATIONS");
  });

  it("refuses an allocation to the other entity's fund", () => {
    const result = validateAllocations({
      entity: "JSOF",
      totalCents: 100_000,
      allocations: [{ fundId: "f-jsoa", amountCents: 100_000 }],
      funds: TEST_FUNDS,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("FUND_WRONG_ENTITY");
  });

  it("refuses the same fund listed twice rather than adding the lines up", () => {
    const result = validateAllocations({
      entity: "JSOF",
      totalCents: 100_000,
      allocations: [
        { fundId: "f-a", amountCents: 50_000 },
        { fundId: "f-a", amountCents: 50_000 },
      ],
      funds: TEST_FUNDS,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("DUPLICATE_FUND");
  });

  it("refuses a fractional cent", () => {
    const result = validateAllocations({
      entity: "JSOF",
      totalCents: 100_000,
      allocations: [{ fundId: "f-a", amountCents: 99_999.5 }],
      funds: TEST_FUNDS,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("NOT_INTEGER_CENTS");
  });

  it("refuses the intent at the donate flow's own entry point", async () => {
    const result = await prepareDonationIntent(
      {
        entity: "JSOF",
        donorDisplayName: "Test Donor",
        donorEmail: "donor@example.org",
        amountCents: 1_500_000,
        allocations: [{ fundId: "fund-jsof-golf", amountCents: 1_000_000 }],
      },
      repo(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("SHORTFALL");
    expect(result.message).toContain("$5,000.00");
  });

  it("refuses a mismatched allocation at the repository boundary too", async () => {
    const r = repo();
    await expect(
      r.recordClearedDonation(
        {
          entity: "JSOF",
          donorDisplayName: "Test Donor",
          donorEmail: "donor@example.org",
          amountCents: 100_000,
          currency: "USD",
          allocations: [{ fundId: "fund-jsof-general", amountCents: 90_000 }],
          benefits: [],
          benefitFairMarketValueCents: null,
          sponsorshipId: null,
        },
        {
          createdById: "p-treas-jsof",
          checkoutSessionRef: "co_stub_test",
          receivedAt: "2026-05-01T12:00:00Z",
        },
      ),
    ).rejects.toThrow(RepositoryError);
  });
});

/* ================================================================== *
 * 2. The entity is chosen, never inferred
 * ================================================================== */

describe("the entity is always chosen, never inferred", () => {
  it("refuses an intent with no entity", async () => {
    const result = await prepareDonationIntent(
      {
        // Simulates a form posted without the first step completed.
        entity: undefined as unknown as Entity,
        donorDisplayName: "Test Donor",
        donorEmail: "donor@example.org",
        amountCents: 100_000,
        allocations: [{ fundId: "fund-jsof-general", amountCents: 100_000 }],
      },
      repo(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("NO_ENTITY");
  });

  it("offers each entity only its own funds", async () => {
    const jsof = await listPublicFundOptions("JSOF", repo());
    const jsoa = await listPublicFundOptions("JSOA", repo());
    expect(jsof.length).toBeGreaterThan(0);
    expect(jsoa.length).toBeGreaterThan(0);
    expect(jsof.every((f) => f.entity === "JSOF")).toBe(true);
    expect(jsoa.every((f) => f.entity === "JSOA")).toBe(true);
    const overlap = jsof.filter((f) => jsoa.some((o) => o.id === f.id));
    expect(overlap).toHaveLength(0);
  });

  it("does not offer a fund that is closed to gifts", async () => {
    const ids = (await listPublicFundOptions("JSOF", repo())).map((f) => f.id);
    expect(ids).not.toContain("fund-jsof-pavers-2019");
  });

  it("shows no figure on the public fund list", async () => {
    for (const option of await listPublicFundOptions("JSOF", repo())) {
      expect(Object.keys(option)).toEqual([
        "id",
        "entity",
        "name",
        "restriction",
        "purpose",
      ]);
    }
  });
});

/* ================================================================== *
 * 3. Hosted checkout is a redirect stub
 * ================================================================== */

describe("hosted checkout handoff", () => {
  it("carries no payment instrument and no redirect, and says it is a stub", () => {
    const handoff = buildCheckoutHandoff({
      entity: "JSOF",
      donorDisplayName: "",
      donorEmail: "",
      amountCents: 250_000,
      currency: "USD",
      allocations: [{ fundId: "fund-jsof-general", amountCents: 250_000 }],
      benefits: [],
      benefitFairMarketValueCents: null,
      sponsorshipId: null,
    });
    expect(handoff.stub).toBe(true);
    expect(handoff.redirectUrl).toBeNull();
    expect(handoff.amountCents).toBe(250_000);
    expect(handoff.pciNote).toBe(PCI_NOTE);
    // Nothing resembling a card field or token may appear on the handoff.
    const serialised = JSON.stringify(handoff).toLowerCase();
    for (const forbidden of ["cardnumber", "cvc", "cvv", "pan", "token", "secret"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("prices benefits as their own lines so a fee is not bundled", () => {
    const handoff = buildCheckoutHandoff({
      entity: "JSOF",
      donorDisplayName: "",
      donorEmail: "",
      amountCents: 400_000,
      currency: "USD",
      allocations: [{ fundId: "fund-jsof-golf", amountCents: 400_000 }],
      benefits: [
        {
          kind: "TOURNAMENT_ENTRY",
          description: "Foursome",
          quantity: 1,
          unitFairMarketValueCents: 90_000,
        },
      ],
      benefitFairMarketValueCents: 90_000,
      sponsorshipId: null,
    });
    expect(handoff.lineItems).toHaveLength(2);
    expect(handoff.lineItems[0].amountCents).toBe(90_000);
    expect(handoff.lineItems[1].amountCents).toBe(310_000);
    const total = handoff.lineItems.reduce((t, l) => t + l.amountCents, 0);
    expect(total).toBe(400_000);
  });
});

/* ================================================================== *
 * 4. A gift with benefits and no FMV cannot produce a receipt
 * ================================================================== */

describe("a gift with benefits and no fair market value cannot be receipted", () => {
  const withBenefitsNoValue = paidGift({
    benefits: [
      {
        kind: "EVENT_TICKET",
        description: "Two tickets to the annual ball",
        quantity: 2,
        unitFairMarketValueCents: 22_500,
      },
    ],
    benefitFairMarketValueCents: null,
  });

  it("refuses, with the reason and the fix", () => {
    let thrown: unknown;
    try {
      buildReceipt({ donation: withBenefitsNoValue, funds: TEST_FUNDS, sequence: 1 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ReceiptError);
    const error = thrown as ReceiptError;
    expect(error.code).toBe("BENEFITS_WITHOUT_FMV");
    expect(error.message).toContain("fair market value");
    expect(error.message).toContain("benefitFairMarketValueCents");
  });

  it("refuses for JSOA as well as JSOF", () => {
    const jsoa = paidGift({
      entity: "JSOA",
      allocations: [{ fundId: "f-jsoa", amountCents: 100_000 }],
      benefits: withBenefitsNoValue.benefits,
      benefitFairMarketValueCents: null,
    });
    expect(() => buildReceipt({ donation: jsoa, funds: TEST_FUNDS, sequence: 1 })).toThrow(
      ReceiptError,
    );
  });

  it("succeeds once the value is recorded, and states the deductible excess", () => {
    const valued = { ...withBenefitsNoValue, benefitFairMarketValueCents: 45_000 };
    const receipt = buildReceipt({ donation: valued, funds: TEST_FUNDS, sequence: 1 });
    expect(receipt.benefitFairMarketValueCents).toBe(45_000);
    expect(receipt.excessOverBenefitsCents).toBe(55_000);
    const text = receipt.body.join(" ");
    expect(text).toContain("$450.00");
    expect(text).toContain("$550.00");
    expect(text.toLowerCase()).toContain("excess");
  });

  it("refuses the seeded gift that was recorded without a valuation", async () => {
    await expect(
      issueReceipt(treasurerJsof, "JSOF", "d-jsof-004", repo(), { sequence: 1 }),
    ).rejects.toThrow(ReceiptError);
  });

  it("refuses to file a new gift with benefits and no valuation at all", async () => {
    await expect(
      recordClearedDonation(
        treasurerJsof,
        {
          entity: "JSOF",
          donorDisplayName: "Test Donor",
          donorEmail: "donor@example.org",
          amountCents: 100_000,
          currency: "USD",
          allocations: [{ fundId: "fund-jsof-general", amountCents: 100_000 }],
          benefits: [
            {
              kind: "MERCHANDISE",
              description: "Challenge coin",
              quantity: 1,
              unitFairMarketValueCents: 2_500,
            },
          ],
          benefitFairMarketValueCents: null,
          sponsorshipId: null,
        },
        { checkoutSessionRef: "co_stub_test", receivedAt: "2026-05-01T12:00:00Z" },
        repo(),
      ),
    ).rejects.toThrow(RepositoryError);
  });

  it("refuses when the benefits are worth as much as the payment", () => {
    const purchase = paidGift({
      benefits: [
        {
          kind: "MERCHANDISE",
          description: "Jacket",
          quantity: 1,
          unitFairMarketValueCents: 100_000,
        },
      ],
      benefitFairMarketValueCents: 100_000,
    });
    let thrown: unknown;
    try {
      buildReceipt({ donation: purchase, funds: TEST_FUNDS, sequence: 1 });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ReceiptError).code).toBe("FMV_NOT_LESS_THAN_PAYMENT");
  });

  it("will not receipt a gift that has not been paid", () => {
    const unpaid = paidGift({ status: "AWAITING_PAYMENT" });
    let thrown: unknown;
    try {
      buildReceipt({ donation: unpaid, funds: TEST_FUNDS, sequence: 1 });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ReceiptError).code).toBe("NOT_PAID");
  });
});

/* ================================================================== *
 * 5. The NC 131F disclosure appears in every receipt from both entities
 * ================================================================== */

describe("the NC Chapter 131F disclosure appears in every receipt", () => {
  const cases: { entity: Entity; donation: Donation }[] = [
    { entity: "JSOF", donation: paidGift() },
    {
      entity: "JSOF",
      donation: paidGift({
        benefits: [
          {
            kind: "BANQUET_SEAT",
            description: "Banquet seat",
            quantity: 1,
            unitFairMarketValueCents: 12_500,
          },
        ],
        benefitFairMarketValueCents: 12_500,
      }),
    },
    {
      entity: "JSOA",
      donation: paidGift({
        entity: "JSOA",
        allocations: [{ fundId: "f-jsoa", amountCents: 100_000 }],
      }),
    },
    {
      entity: "JSOA",
      donation: paidGift({
        entity: "JSOA",
        allocations: [{ fundId: "f-jsoa", amountCents: 100_000 }],
        benefits: [
          {
            kind: "EVENT_TICKET",
            description: "Ball ticket",
            quantity: 1,
            unitFairMarketValueCents: 22_500,
          },
        ],
        benefitFairMarketValueCents: 22_500,
      }),
    },
  ];

  it.each(cases)("carries it verbatim on a $entity receipt", ({ donation }) => {
    const receipt = buildReceipt({ donation, funds: TEST_FUNDS, sequence: 1 });
    expect(receipt.disclosure.text).toBe(NC_131F_DISCLOSURE);
    expect(renderReceiptText(receipt)).toContain(NC_131F_DISCLOSURE);
    expect(renderReceiptHtml(receipt)).toContain(NC_131F_DISCLOSURE);
  });

  it("uses the statutory wording, including the word license", () => {
    expect(NC_131F_DISCLOSURE).toBe(
      "Financial information about this organization and a copy of its license are " +
        "available from the State Solicitation Licensing Branch at 888-830-4989. " +
        "The license is not an endorsement by the State.",
    );
    // "licence" is the British spelling. The statute's word is "license".
    expect(NC_131F_DISCLOSURE).not.toContain("licence");
    expect(NC_131F_DISCLOSURE).toContain("is not an endorsement by the State");
  });

  it.each(cases)("renders it at nine points or larger and conspicuously", ({
    donation,
  }) => {
    const html = renderReceiptHtml(
      buildReceipt({ donation, funds: TEST_FUNDS, sequence: 1 }),
    );
    const check = checkDisclosureConspicuous(html);
    expect(check).toEqual({ ok: true });
  });

  it("declares a size above the nine-point floor, with bold and a border", () => {
    expect(NC_131F_TYPE.declaredPointSize).toBeGreaterThanOrEqual(
      NC_131F_TYPE.minPointSize,
    );
    expect(NC_131F_TYPE.bold || NC_131F_TYPE.bordered).toBe(true);
    const html = renderReceiptHtml(
      buildReceipt({ donation: paidGift(), funds: TEST_FUNDS, sequence: 1 }),
    );
    expect(html).toMatch(/data-statute="131F"/);
    expect(html).toMatch(/font-size:10pt/);
    expect(html).toMatch(/font-weight:700/);
    expect(html).toMatch(/border:1\.5pt solid/);
  });

  it("catches a rendering that drops below the floor", () => {
    const bad =
      `<p data-statute="131F" style="font-size:7pt">${NC_131F_DISCLOSURE}</p>`;
    const check = checkDisclosureConspicuous(bad);
    expect(check.ok).toBe(false);
    if (check.ok) throw new Error("unreachable");
    expect(check.problems.join(" ")).toContain("9pt or larger");
  });

  it("catches a rendering that is big enough but not conspicuous", () => {
    const bad =
      `<p data-statute="131F" style="font-size:11pt">${NC_131F_DISCLOSURE}</p>`;
    const check = checkDisclosureConspicuous(bad);
    expect(check.ok).toBe(false);
    if (check.ok) throw new Error("unreachable");
    expect(check.problems.join(" ")).toContain("conspicuous");
  });

  it("catches a paraphrase", () => {
    const bad =
      '<p data-statute="131F" style="font-size:11pt;font-weight:700">Financial ' +
      "info about us is available from the State. </p>";
    expect(checkDisclosureConspicuous(bad).ok).toBe(false);
  });
});

/* ================================================================== *
 * 6. Entity receipt templates never cross
 * ================================================================== */

describe("entity receipt templates never cross", () => {
  const jsofReceipt = buildReceipt({
    donation: paidGift(),
    funds: TEST_FUNDS,
    sequence: 1,
  });
  const jsoaReceipt = buildReceipt({
    donation: paidGift({
      entity: "JSOA",
      allocations: [{ fundId: "f-jsoa", amountCents: 100_000 }],
    }),
    funds: TEST_FUNDS,
    sequence: 1,
  });

  it("uses a different template id per entity", () => {
    expect(jsofReceipt.templateId).toBe("JSOF_CONTRIBUTION_V1");
    expect(jsoaReceipt.templateId).toBe("JSOA_PAYMENT_V1");
    expect(ENTITY_IDENTITY.JSOF.templateId).not.toBe(ENTITY_IDENTITY.JSOA.templateId);
  });

  it("numbers receipts in separate per-entity sequences", async () => {
    expect(jsofReceipt.receiptNumber.startsWith("JSOF-R-")).toBe(true);
    expect(jsoaReceipt.receiptNumber.startsWith("JSOA-R-")).toBe(true);
    const r = repo();
    expect(await r.nextReceiptSequence("JSOF")).toBe(1);
    expect(await r.nextReceiptSequence("JSOF")).toBe(2);
    expect(await r.nextReceiptSequence("JSOA")).toBe(1);
  });

  it("puts the IRS no-goods-or-services language only on the JSOF template", () => {
    const jsof = jsofReceipt.body.join(" ");
    const jsoa = jsoaReceipt.body.join(" ");
    expect(jsof).toContain("No goods or services were provided in exchange");
    expect(jsoa).not.toContain("No goods or services were provided in exchange");
  });

  it("puts the dues-and-benefits disclaimer only on the JSOA template", () => {
    const jsof = jsofReceipt.body.join(" ");
    const jsoa = jsoaReceipt.body.join(" ");
    expect(jsoa).toContain(
      "Membership dues and any payment that carries member benefits are not deductible",
    );
    expect(jsof).not.toContain("Membership dues");
  });

  it("never lets one entity's fingerprint phrases appear on the other's receipt", () => {
    const jsofText = renderReceiptText(jsofReceipt);
    const jsoaText = renderReceiptText(jsoaReceipt);
    for (const phrase of TEMPLATE_FINGERPRINTS.JSOF_CONTRIBUTION_V1) {
      expect(jsofText).toContain(phrase);
      expect(jsoaText).not.toContain(phrase);
    }
    for (const phrase of TEMPLATE_FINGERPRINTS.JSOA_PAYMENT_V1) {
      expect(jsoaText).toContain(phrase);
      expect(jsofText).not.toContain(phrase);
    }
  });

  it("shares no paragraph between the two templates", () => {
    const shared = jsofReceipt.body.filter((p) => jsoaReceipt.body.includes(p));
    expect(shared).toEqual([]);
  });

  it("refuses to receipt one entity's gift under the other entity's heading", async () => {
    // A JSOF treasurer asking for a JSOF receipt against a JSOA gift.
    const r = repo();
    await expect(
      issueReceipt(treasurerJsof, "JSOF", "d-jsoa-001", r, { sequence: 1 }),
    ).rejects.toThrow(ReceiptError);
  });

  it("gives each entity's own treasurer their own entity's template", async () => {
    const jsof = await issueReceipt(treasurerJsof, "JSOF", "d-jsof-001", repo(), {
      sequence: 1,
    });
    const jsoa = await issueReceipt(treasurerJsoa, "JSOA", "d-jsoa-001", repo(), {
      sequence: 1,
    });
    expect(jsof.receipt.templateId).toBe("JSOF_CONTRIBUTION_V1");
    expect(jsoa.receipt.templateId).toBe("JSOA_PAYMENT_V1");
    expect(jsof.receipt.identity.legalName).toBe("Joint Special Operations Foundation");
    expect(jsoa.receipt.identity.legalName).toBe("Joint Special Operations Association");
    // And both still carry the disclosure.
    expect(jsof.text).toContain(NC_131F_DISCLOSURE);
    expect(jsoa.text).toContain(NC_131F_DISCLOSURE);
  });
});

/* ================================================================== *
 * 7. The 2% safe harbour, at, under and over
 * ================================================================== */

describe("the 2% safe harbour is all or nothing", () => {
  const PAYMENT = 1_000_000; // $10,000. Two percent is $200.

  it("is inside the harbour exactly at the threshold", () => {
    const a = assessSafeHarbour(PAYMENT, 20_000);
    expect(a.thresholdCents).toBe(20_000);
    expect(a.withinSafeHarbour).toBe(true);
    expect(a.carvedOutCents).toBe(0);
    expect(a.qualifiedSponsorshipPortionCents).toBe(PAYMENT);
    expect(exceedsSafeHarbour(PAYMENT, 20_000)).toBe(false);
  });

  it("is inside the harbour one cent under the threshold", () => {
    const a = assessSafeHarbour(PAYMENT, 19_999);
    expect(a.withinSafeHarbour).toBe(true);
    expect(a.carvedOutCents).toBe(0);
    expect(a.qualifiedSponsorshipPortionCents).toBe(PAYMENT);
  });

  it("carves out the WHOLE benefit value one cent over the threshold", () => {
    const a = assessSafeHarbour(PAYMENT, 20_001);
    expect(a.withinSafeHarbour).toBe(false);
    // Not the $0.01 of excess. All of it.
    expect(a.carvedOutCents).toBe(20_001);
    expect(a.excessOverThresholdCents).toBe(1);
    expect(a.qualifiedSponsorshipPortionCents).toBe(979_999);
    expect(a.explanation).toContain("entire");
    expect(a.explanation).toContain("$200.01");
  });

  it("judges a payment that is not a multiple of fifty cents correctly", () => {
    // 2% of $1,000.01 is 2000.02 cents, which is not an integer. Integer ratio
    // maths, not a floored threshold, is what makes this right.
    const payment = 100_001;
    expect(exceedsSafeHarbour(payment, 2_000)).toBe(false);
    expect(exceedsSafeHarbour(payment, 2_001)).toBe(true);
    expect(assessSafeHarbour(payment, 2_000).withinSafeHarbour).toBe(true);
    expect(assessSafeHarbour(payment, 2_001).carvedOutCents).toBe(2_001);
  });

  it("treats a zero benefit value as inside the harbour", () => {
    const a = assessSafeHarbour(PAYMENT, 0);
    expect(a.withinSafeHarbour).toBe(true);
    expect(a.qualifiedSponsorshipPortionCents).toBe(PAYMENT);
  });

  it("sums benefit value across every placement before applying the test", async () => {
    const rows = await readSponsorRegister(treasurerJsof, "JSOF", repo());
    const carraway = rows.find((r) => r.sponsorName === "Carraway Diesel & Fleet");
    expect(carraway).toBeDefined();
    if (!carraway) throw new Error("unreachable");
    // 15,000 + 5,000 + 25,000 = 45,000 against a 1,500,000 payment. The 2%
    // ceiling is 30,000, so all 45,000 is carved out.
    expect(carraway.assessment.totalBenefitFairMarketValueCents).toBe(45_000);
    expect(carraway.assessment.thresholdCents).toBe(30_000);
    expect(carraway.assessment.withinSafeHarbour).toBe(false);
    expect(carraway.assessment.carvedOutCents).toBe(45_000);
    expect(carraway.assessment.qualifiedSponsorshipPortionCents).toBe(1_455_000);
  });

  it("holds the seeded sponsorship that sits exactly on the ceiling", async () => {
    const rows = await readSponsorRegister(treasurerJsoa, "JSOA", repo());
    const twoRivers = rows.find((r) => r.sponsorName === "Two Rivers Title Company");
    expect(twoRivers).toBeDefined();
    if (!twoRivers) throw new Error("unreachable");
    expect(twoRivers.assessment.totalBenefitFairMarketValueCents).toBe(10_000);
    expect(twoRivers.assessment.thresholdCents).toBe(10_000);
    expect(twoRivers.assessment.withinSafeHarbour).toBe(true);
  });
});

/* ================================================================== *
 * 8. Advertising is a different category from an acknowledgment
 * ================================================================== */

describe("advertising placements are tagged separately", () => {
  it("separates advertising value from acknowledgment value", async () => {
    const rows = await readSponsorRegister(treasurerJsof, "JSOF", repo());
    const carraway = rows.find((r) => r.sponsorName === "Carraway Diesel & Fleet");
    if (!carraway) throw new Error("unreachable");
    expect(carraway.categories.advertisingCents).toBe(25_000);
    expect(carraway.categories.acknowledgmentCents).toBe(20_000);
    expect(carraway.categories.advertisingPlacements).toContain("Programme advert");
  });

  it("tags a tee sign as an acknowledgment and a programme page as advertising", async () => {
    const rows = await readSponsorRegister(treasurerJsof, "JSOF", repo());
    const kinds = rows.flatMap((r) =>
      r.placements.map((p) => [p.placement.kind, p.category] as const),
    );
    expect(kinds).toContainEqual(["SIGNAGE", "ACKNOWLEDGMENT"]);
    expect(kinds).toContainEqual(["PROGRAMME_AD", "ADVERTISING"]);
    expect(kinds).toContainEqual(["EVENT_TSHIRT", "ACKNOWLEDGMENT"]);
  });
});

/* ================================================================== *
 * 9. The acknowledgment validator warns; it never blocks
 * ================================================================== */

describe("the acknowledgment validator", () => {
  it("passes an acknowledgment that is only identity", () => {
    const review = reviewAcknowledgment(
      "Piedmont Ironworks. Structural steel fabrication. Sanford, North Carolina.",
    );
    expect(review.clean).toBe(true);
    expect(review.findings).toEqual([]);
  });

  it("flags a qualitative adjective and explains what one adjective does", () => {
    const review = reviewAcknowledgment("Halverson Optics, the best optics in the state.");
    expect(review.clean).toBe(false);
    expect(review.findings.some((f) => f.category === "QUALITATIVE")).toBe(true);
    expect(review.findings[0].explanation).toContain("one adjective");
    expect(review.findings[0].severity).toBe("warning");
  });

  it("flags comparative language", () => {
    const review = reviewAcknowledgment("The region's leading fleet service.");
    expect(review.findings.some((f) => f.category === "COMPARATIVE")).toBe(true);
  });

  it("flags savings language, a percentage and a call to action", () => {
    const review = reviewAcknowledgment("Save 10% on your first order. Call today.");
    const categories = review.findings.map((f) => f.category);
    expect(categories).toContain("SAVINGS");
    expect(categories).toContain("PRICE");
    expect(categories).toContain("CALL_TO_ACTION");
  });

  it("flags price information", () => {
    const review = reviewAcknowledgment("Oil changes from $39.95.");
    expect(review.findings.some((f) => f.category === "PRICE")).toBe(true);
  });

  it("flags an endorsement and exclusive-provider language", () => {
    const review = reviewAcknowledgment(
      "The exclusive provider of fleet service to the Foundation.",
    );
    expect(review.findings.some((f) => f.category === "ENDORSEMENT")).toBe(true);
  });

  it("says in the advisory that it is a warning and not a block", () => {
    const review = reviewAcknowledgment("The best in the business.");
    expect(review.advisory).toContain("not a block");
    expect(review.advisory).toContain("save and publish this wording anyway");
  });

  it("every finding is a warning; no severity blocks", () => {
    const review = reviewAcknowledgment(
      "The best, leading, award-winning shop. Save 20%. Call now.",
    );
    expect(review.findings.length).toBeGreaterThan(3);
    expect(review.findings.every((f) => f.severity === "warning")).toBe(true);
  });

  it("saves flagged wording anyway, and hands back the warnings", async () => {
    const r = repo();
    const result = await saveAcknowledgmentString(
      fundraisingChairJsof,
      "JSOF",
      "s-jsof-001",
      {
        kind: "SIGNAGE",
        approvedAcknowledgmentString: "Piedmont Ironworks, simply the best steel.",
        benefitFairMarketValueCents: 400,
      },
    r,
    );
    expect(result.placement.approvedAcknowledgmentString).toContain("simply the best");
    expect(result.review.clean).toBe(false);
    expect(result.review.findings.length).toBeGreaterThan(0);
  });

  it("flags the seeded sponsor-supplied copy that has not been cleaned up", async () => {
    const rows = await readSponsorRegister(treasurerJsof, "JSOF", repo());
    const halverson = rows.find((r) => r.sponsorName === "Halverson Optics");
    if (!halverson) throw new Error("unreachable");
    const footer = halverson.placements.find(
      (p) => p.placement.kind === "WEBSITE_FOOTER",
    );
    expect(footer).toBeDefined();
    if (!footer) throw new Error("unreachable");
    expect(footer.review.clean).toBe(false);
    expect(footer.placement.publicationState).toBe("DRAFT");
  });

  it("sends changed wording back through the release gate", async () => {
    const r = repo();
    const before = await r.getSponsorship("s-jsof-001");
    expect(before?.placements[0].publicationState).toBe("APPROVED");
    const result = await saveAcknowledgmentString(
      fundraisingChairJsof,
      "JSOF",
      "s-jsof-001",
      {
        id: "pl-jsof-001-a",
        kind: "SIGNAGE",
        approvedAcknowledgmentString: "Piedmont Ironworks. Steel. Sanford, NC.",
        benefitFairMarketValueCents: 400,
      },
      r,
    );
    expect(result.placement.publicationState).toBe("AWAITING_RELEASE");
    expect(result.placement.approvedById).toBeNull();
  });
});

/* ================================================================== *
 * 10. Wrong-role requests fail
 * ================================================================== */

describe("a wrong-role request to the sponsor register fails", () => {
  it("refuses the Fundraising Chair the money view", async () => {
    // AGGREGATE on FINANCIAL, not READ. The Chair does not see payments row
    // by row, which is the point of the two-view split.
    await expect(
      readSponsorRegister(fundraisingChairJsof, "JSOF", repo()),
    ).rejects.toThrow(AuthzError);
  });

  it("gives the Fundraising Chair the wording view", async () => {
    const rows = await readSponsorAcknowledgments(fundraisingChairJsof, "JSOF", repo());
    expect(rows.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(rows);
    // The wording view still carries the placement records, so assert what it
    // is used for rather than pretending the object is stripped: no payment
    // figure is present on any row.
    expect(serialised).not.toContain("paymentCents");
    expect(serialised).not.toContain("assessment");
  });

  it("refuses the Scholarships Chair the money view", async () => {
    // NONE on FINANCIAL, so no view of the payments. The Chair does hold WRITE
    // on PUBLIC_CONTENT, so the wording view opens; that is the intended shape.
    await expect(
      readSponsorRegister(scholarshipsChairJsof, "JSOF", repo()),
    ).rejects.toThrow(AuthzError);
    expect(
      (await readSponsorAcknowledgments(scholarshipsChairJsof, "JSOF", repo())).length,
    ).toBeGreaterThan(0);
  });

  it("refuses a Treasurer of the other entity", async () => {
    await expect(readSponsorRegister(treasurerJsoa, "JSOF", repo())).rejects.toThrow(
      AuthzError,
    );
    await expect(readSponsorRegister(treasurerJsof, "JSOA", repo())).rejects.toThrow(
      AuthzError,
    );
  });

  it("refuses an unauthenticated subject", async () => {
    await expect(readSponsorRegister(nobody, "JSOF", repo())).rejects.toThrow(AuthzError);
  });

  it("refuses a subject whose MFA has not been satisfied, whatever the role", async () => {
    const unverified = subject(
      "p-treas-jsof",
      [{ role: "TREASURER", entity: "JSOF" }],
      false,
    );
    await expect(readSponsorRegister(unverified, "JSOF", repo())).rejects.toThrow(
      AuthzError,
    );
  });

  it("allows the Treasurer of the right entity", async () => {
    const rows = await readSponsorRegister(treasurerJsof, "JSOF", repo());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.entity === "JSOF")).toBe(true);
  });
});

describe("wrong-role requests to the rest of the module", () => {
  it("refuses the gift register to a role holding only aggregate", async () => {
    await expect(
      readDonationRegister(fundraisingChairJsof, "JSOF", repo()),
    ).rejects.toThrow(AuthzError);
    await expect(readDonationRegister(secretaryJsof, "JSOF", repo())).rejects.toThrow(
      AuthzError,
    );
  });

  it("refuses the fund register but allows fund totals to the Secretary", async () => {
    await expect(readFundRegister(secretaryJsof, "JSOF", repo())).rejects.toThrow(
      AuthzError,
    );
    const totals = await readFundAggregates(secretaryJsof, "JSOF", repo());
    expect(totals.length).toBeGreaterThan(0);
    // Aggregate means counts and totals, and that is all that comes back.
    for (const row of totals) {
      expect(Object.keys(row).sort()).toEqual(
        ["balanceCents", "entity", "fundId", "giftCount", "name", "restriction"].sort(),
      );
    }
  });

  it("refuses a write to the ledger from a role that only reads it", async () => {
    const president = subject("p-pres", [{ role: "PRESIDENT", entity: "JSOF" }]);
    await expect(
      recordClearedDonation(
        president,
        {
          entity: "JSOF",
          donorDisplayName: "Test Donor",
          donorEmail: "donor@example.org",
          amountCents: 100_000,
          currency: "USD",
          allocations: [{ fundId: "fund-jsof-general", amountCents: 100_000 }],
          benefits: [],
          benefitFairMarketValueCents: null,
          sponsorshipId: null,
        },
        { checkoutSessionRef: "co_stub_test", receivedAt: "2026-05-01T12:00:00Z" },
        repo(),
      ),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses a receipt to a role with no financial read", async () => {
    await expect(
      issueReceipt(scholarshipsChairJsof, "JSOF", "d-jsof-001", repo(), { sequence: 1 }),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses the acknowledgment write to a role with no public-content write", async () => {
    await expect(
      saveAcknowledgmentString(
        treasurerJsof,
        "JSOF",
        "s-jsof-001",
        {
          kind: "SIGNAGE",
          approvedAcknowledgmentString: "Piedmont Ironworks.",
          benefitFairMarketValueCents: 400,
        },
        repo(),
      ),
    ).rejects.toThrow(AuthzError);
  });
});

/* ================================================================== *
 * 11. Funds, balances and the gifts behind them
 * ================================================================== */

describe("fund register", () => {
  it("keeps restricted and unrestricted apart and per entity", async () => {
    const rows = await readFundRegister(treasurerJsof, "JSOF", repo());
    expect(rows.every((r) => r.balance.entity === "JSOF")).toBe(true);
    expect(rows.some((r) => r.balance.restriction === "RESTRICTED")).toBe(true);
    expect(rows.some((r) => r.balance.restriction === "UNRESTRICTED")).toBe(true);
  });

  it("counts cleared gifts only, so an unpaid gift is not a balance", async () => {
    const rows = await readFundRegister(treasurerJsof, "JSOF", repo());
    const family = rows.find((r) => r.balance.name === "Family Support Fund");
    if (!family) throw new Error("unreachable");
    // d-jsof-005 is AWAITING_PAYMENT against this fund.
    expect(family.balance.balanceCents).toBe(0);
    expect(family.gifts.some((g) => g.status === "AWAITING_PAYMENT")).toBe(true);
  });

  it("shows the gifts behind a balance and they add up to it", async () => {
    const rows = await readFundRegister(treasurerJsof, "JSOF", repo());
    const golf = rows.find((r) => r.balance.name === "Golf Tournament Fund");
    if (!golf) throw new Error("unreachable");
    const paid = golf.gifts
      .filter((g) => g.status === "PAID")
      .reduce((t, g) => t + g.amountCents, 0);
    expect(paid).toBe(golf.balance.balanceCents);
    expect(golf.balance.balanceCents).toBe(1_400_000);
  });

  it("never sums the two entities into one figure", async () => {
    const jsof = await readFundAggregates(treasurerJsof, "JSOF", repo());
    const jsoa = await readFundAggregates(treasurerJsoa, "JSOA", repo());
    expect(jsof.every((r) => r.entity === "JSOF")).toBe(true);
    expect(jsoa.every((r) => r.entity === "JSOA")).toBe(true);
    expect(jsof.map((r) => r.fundId)).not.toContain("fund-jsoa-operating");
  });

  it("records a cleared gift and moves the balance", async () => {
    const r = repo();
    const before = (await readFundAggregates(treasurerJsof, "JSOF", r)).find(
      (b) => b.fundId === "fund-jsof-general",
    );
    if (!before) throw new Error("unreachable");
    await recordClearedDonation(
      treasurerJsof,
      {
        entity: "JSOF",
        donorDisplayName: "Test Donor",
        donorEmail: "donor@example.org",
        amountCents: 60_000,
        currency: "USD",
        allocations: [
          { fundId: "fund-jsof-general", amountCents: 40_000 },
          { fundId: "fund-jsof-scholarship", amountCents: 20_000 },
        ],
        benefits: [],
        benefitFairMarketValueCents: null,
        sponsorshipId: null,
      },
      { checkoutSessionRef: "co_stub_test", receivedAt: "2026-05-02T12:00:00Z" },
      r,
    );
    const after = (await readFundAggregates(treasurerJsof, "JSOF", r)).find(
      (b) => b.fundId === "fund-jsof-general",
    );
    if (!after) throw new Error("unreachable");
    expect(after.balanceCents).toBe(before.balanceCents + 40_000);
  });
});

/* ================================================================== *
 * 12. Integer cents, everywhere
 * ================================================================== */

describe("money is integer cents", () => {
  it("formats without rounding drift", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1)).toBe("$0.01");
    expect(formatCents(1_500_000)).toBe("$15,000.00");
    expect(formatCents(2_500_050)).toBe("$25,000.50");
  });

  it("parses and refuses rather than guessing", () => {
    expect(parseDollarsToCents("10000")).toBe(1_000_000);
    expect(parseDollarsToCents("$10,000.50")).toBe(1_000_050);
    expect(parseDollarsToCents("0.01")).toBe(1);
    expect(parseDollarsToCents("1.005")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("ten dollars")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
  });

  it("round-trips anything it prints", () => {
    for (const cents of [0, 1, 99, 100, 123_456, 1_500_000, 999_999_99]) {
      expect(parseDollarsToCents(formatCents(cents))).toBe(cents);
    }
  });

  it("holds no non-integer amount anywhere in the seed", async () => {
    const r = repo();
    for (const entity of ["JSOA", "JSOF"] as Entity[]) {
      for (const d of await r.listDonations(entity)) {
        expect(Number.isSafeInteger(d.amountCents)).toBe(true);
        for (const a of d.allocations) {
          expect(Number.isSafeInteger(a.amountCents)).toBe(true);
        }
        if (d.benefitFairMarketValueCents !== null) {
          expect(Number.isSafeInteger(d.benefitFairMarketValueCents)).toBe(true);
        }
      }
      for (const s of await r.listSponsorships(entity)) {
        expect(Number.isSafeInteger(s.paymentCents)).toBe(true);
        for (const p of s.placements) {
          expect(Number.isSafeInteger(p.benefitFairMarketValueCents)).toBe(true);
        }
      }
    }
  });

  it("keeps every seeded gift's allocations summing exactly", async () => {
    const r = repo();
    for (const entity of ["JSOA", "JSOF"] as Entity[]) {
      for (const d of await r.listDonations(entity)) {
        const result = await checkAllocations(entity, d.amountCents, d.allocations, r);
        // The closed paver fund is not offered publicly, so only the open-fund
        // path is asserted here; the seed uses open funds throughout.
        expect(result.ok, `${d.id}: ${result.ok ? "" : result.message}`).toBe(true);
      }
    }
  });
});

/* ================================================================== *
 * 13. Sponsorship records cannot express a contingent fee
 * ================================================================== */

describe("sponsorship record shape", () => {
  it("never carries a fee contingent on attendance or impressions", async () => {
    const r = repo();
    for (const entity of ["JSOA", "JSOF"] as Entity[]) {
      for (const s of await r.listSponsorships(entity)) {
        expect(s.contingentOnAttendanceOrImpressions).toBe(false);
      }
    }
  });

  it("records exclusive sponsor and has no exclusive-provider value", async () => {
    const r = repo();
    const values = (
      await Promise.all(
        (["JSOA", "JSOF"] as Entity[]).map((e) => r.listSponsorships(e)),
      )
    ).flatMap((sponsorships) => sponsorships.map((s) => s.exclusivity));
    expect(values).toContain("EXCLUSIVE_SPONSOR");
    expect(values.every((v) => v === "NONE" || v === "EXCLUSIVE_SPONSOR")).toBe(true);
  });

  it("carries an approved wording and a valuation on every placement", async () => {
    const r = repo();
    for (const entity of ["JSOA", "JSOF"] as Entity[]) {
      for (const s of await r.listSponsorships(entity)) {
        for (const p of s.placements) {
          expect(p.approvedAcknowledgmentString.length).toBeGreaterThan(0);
          expect(typeof p.benefitFairMarketValueCents).toBe("number");
          expect(p.entity).toBe(s.entity);
        }
      }
    }
  });
});

/* ================================================================== *
 * 14. The role workspace: five spine tabs over the same data
 *
 * The spine's own rule is that four of the five tabs are FILTERS over
 * shared data rather than per-role copies, and that a task is derived from
 * state and never entered by hand. These are the tests that hold both.
 * ================================================================== */

describe("workspace: derived tasks", () => {
  it("derives the task list from state, so an empty register yields no tasks", async () => {
    const empty = new InMemoryDonationsRepository(TEST_FUNDS, [], []);
    const { tasks } = await fundraisingTasks(treasurerJsof, empty);
    expect(tasks).toEqual([]);
  });

  it("fills itself from the seeded register without anything being entered", async () => {
    const { tasks } = await fundraisingTasks(treasurerJsof, repo());
    expect(tasks.length).toBeGreaterThan(0);
    // The gift carrying unvalued benefits is the one a donor is waiting on.
    expect(tasks.some((task) => task.key === "JSOF-value-benefits")).toBe(true);
    expect(tasks.some((task) => task.key === "JSOF-safe-harbour-review")).toBe(true);
  });

  it("gives every task a reason that says what it blocks, and an urgency", async () => {
    const { tasks } = await fundraisingTasks(treasurerJsof, repo());
    for (const task of tasks) {
      expect(task.because.length).toBeGreaterThan(20);
      expect(["overdue", "soon", "open"]).toContain(task.urgency);
      expect(task.href.startsWith("/board/donations")).toBe(true);
      expect(task.entity).toBe("JSOF");
    }
  });

  it("withholds rather than denying for a role holding one scope and not the other", async () => {
    const { tasks, withheld } = await fundraisingTasks(fundraisingChairJsof, repo());
    // The Chair holds PUBLIC_CONTENT at WRITE, so the wording work is theirs.
    expect(tasks.some((task) => task.key === "JSOF-rewrite-wording")).toBe(true);
    // And holds FINANCIAL only at AGGREGATE, so the gift-by-gift work is not.
    expect(tasks.some((task) => task.key === "JSOF-value-benefits")).toBe(false);
    expect(withheld.join(" ")).toContain("Gifts that cannot be receipted");
  });

  it("gives a role with no scope on either entity no tasks and no counts", async () => {
    const vpMembership = subject("p-vpm", [{ role: "VP_MEMBERSHIP", entity: "JSOA" }]);
    const { tasks, withheld } = await fundraisingTasks(vpMembership, repo());
    expect(tasks).toEqual([]);
    expect(withheld.length).toBeGreaterThan(0);
    // Nothing about the size of what is behind the wall.
    expect(withheld.join(" ")).not.toMatch(/\d/);
  });

  it("gives an unassigned subject nothing at all", async () => {
    const { tasks, withheld } = await fundraisingTasks(nobody, repo());
    expect(tasks).toEqual([]);
    expect(withheld.join(" ")).toContain("no assignment on either entity");
  });
});

describe("workspace: three headline figures", () => {
  it("promotes exactly three, and the same three for every reader", async () => {
    const board = await readDonationsDashboard(treasurerJsof, "JSOF", repo());
    const { headline, more } = splitKpis(board.kpis);
    expect(headline.map((kpi) => kpi.key)).toEqual([...HEADLINE_KPI_KEYS]);
    expect(headline.length).toBe(3);
    expect(more.length).toBe(board.kpis.length - 3);
    // The per-entity pair is one idea rendered twice and is never a headline.
    expect(headline.some((kpi) => kpi.key === "giving-by-entity")).toBe(false);
    expect(more.some((kpi) => kpi.key === "giving-by-entity")).toBe(true);
  });

  it("keeps a headline the reader may not see as a headline, withheld rather than swapped", async () => {
    const board = await readDonationsDashboard(fundraisingChairJsof, "JSOF", repo());
    const { headline } = splitKpis(board.kpis);
    expect(headline.map((kpi) => kpi.key)).toEqual([...HEADLINE_KPI_KEYS]);
    const unreceiptable = headline.find((kpi) => kpi.key === "gifts-unreceiptable")!;
    expect(unreceiptable.value).toBeNull();
    expect(unreceiptable.needs).toBeTruthy();
    // The wording figure is the Chair's own and is a real number.
    expect(headline.find((kpi) => kpi.key === "wording-flagged")!.value).not.toBeNull();
  });
});

describe("workspace: calendar", () => {
  it("derives pledge, renewal and event dates for a reader who holds the rows", async () => {
    const { items } = await fundraisingCalendar(treasurerJsof, repo());
    const kinds = items.map((item) => item.kind);
    expect(kinds).toContain("CYCLE");
    expect(kinds).toContain("RENEWAL");
    expect(kinds).toContain("EVENT");
    for (const item of items) {
      expect(item.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.entity).toBe("JSOF");
    }
  });

  it("marks an inferred renewal and an unrecorded event date as unverified", async () => {
    const { items, gaps } = await fundraisingCalendar(treasurerJsof, repo());
    for (const item of items.filter((i) => i.kind === "RENEWAL" || i.kind === "EVENT")) {
      expect(item.unverified).toBe(true);
    }
    // A pledge date is recorded, so it is not a guess.
    for (const item of items.filter((i) => i.kind === "CYCLE")) {
      expect(item.unverified).toBeUndefined();
    }
    expect(gaps.join(" ")).toContain("no recorded date");
  });

  it("withholds the whole calendar from a role holding financial only at aggregate", async () => {
    const { items, withheld } = await fundraisingCalendar(fundraisingChairJsof, repo());
    expect(items).toEqual([]);
    expect(withheld.join(" ")).toContain("aggregate");
  });

  it("refuses the sponsorship dates read to a role without row-level financial", async () => {
    await expect(
      readSponsorshipDates(fundraisingChairJsof, "JSOF", repo()),
    ).rejects.toThrow(AuthzError);
    await expect(readSponsorshipDates(nobody, "JSOF", repo())).rejects.toThrow(
      AuthzError,
    );
  });

  it("never carries a date from one entity onto the other", async () => {
    const { items } = await fundraisingCalendar(treasurerJsoa, repo());
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.entity === "JSOA")).toBe(true);
  });
});

describe("workspace: planning", () => {
  it("files the three decisions the role cannot take alone", () => {
    expect(FUNDRAISING_PLANNING_ITEMS.length).toBe(3);
    for (const item of FUNDRAISING_PLANNING_ITEMS) {
      expect(item.proposedByRole).toBe("FUNDRAISING_CHAIR");
      expect(item.estimateMinutes).toBeGreaterThan(0);
      expect(item.reason.length).toBeGreaterThan(40);
      expect(item.acceptedForMeetingId).toBeNull();
    }
  });

  it("shows a viewer only the items filed against an entity they hold", () => {
    expect(fundraisingPlanning(treasurerJsof).every((i) => i.entity === "JSOF")).toBe(true);
    expect(fundraisingPlanning(treasurerJsof).length).toBe(2);
    const chairBoth = subject("p-fund-both", [
      { role: "FUNDRAISING_CHAIR", entity: "JSOA" },
      { role: "FUNDRAISING_CHAIR", entity: "JSOF" },
    ]);
    expect(fundraisingPlanning(chairBoth).length).toBe(3);
    expect(fundraisingPlanning(nobody)).toEqual([]);
  });
});

describe("workspace: projects are a filter, not a copy", () => {
  it("returns rows from the one org-level register by identity", () => {
    const { owned, contributing } = fundraisingProjects();
    for (const project of [...owned, ...contributing]) {
      expect(PROJECTS).toContain(project);
    }
    expect(owned.every((p) => p.ownerRole === "FUNDRAISING_CHAIR")).toBe(true);
    expect(
      contributing.every((p) => p.contributorRoles.includes("FUNDRAISING_CHAIR")),
    ).toBe(true);
    expect(owned.length + contributing.length).toBeGreaterThan(0);
  });
});

describe("workspace: outside view", () => {
  it("keeps the two audiences separate and never merges them", async () => {
    const { surface } = await fundraisingOutside(fundraisingChairJsof, repo());
    expect(surface.noExternalSurface).toBe(false);
    const audiences = new Set(surface.items.map((item) => item.audience));
    expect(audiences.has("PUBLIC")).toBe(true);
    expect(audiences.has("MEMBER_OR_DONOR")).toBe(true);
  });

  it("sorts a flagged string that is also approved above a flagged draft", async () => {
    /*
     * The seed has no flagged-and-approved placement: its one flagged string
     * is still a draft. That is the worse of the two states, so it is built
     * here rather than left untested.
     */
    const placement = (
      id: string,
      text: string,
      publicationState: "DRAFT" | "APPROVED",
    ) => ({
      id,
      sponsorshipId: "s-loud",
      entity: "JSOF" as Entity,
      kind: "SIGNAGE" as const,
      approvedAcknowledgmentString: text,
      benefitFairMarketValueCents: 100,
      publicationState,
      approvedById: publicationState === "APPROVED" ? "p-vp-operations" : null,
      authoredById: "p-fundraising-chair",
      notes: "",
    });
    const loud = new InMemoryDonationsRepository(TEST_FUNDS, [], [
      {
        id: "s-loud",
        entity: "JSOF",
        sponsorName: "Testerman Supply",
        eventName: "2026 Golf Tournament",
        tier: "Tee sponsor",
        paymentCents: 100_000,
        currency: "USD",
        contingentOnAttendanceOrImpressions: false,
        exclusivity: "NONE",
        receivedAt: "2026-02-10T14:00:00Z",
        createdById: "p-fundraising-chair",
        placements: [
          placement("pl-draft", "Testerman Supply. The best prices in town.", "DRAFT"),
          placement(
            "pl-approved",
            "Testerman Supply, the region's leading supplier. Call today.",
            "APPROVED",
          ),
        ],
      },
    ]);

    const { surface, counts } = await fundraisingOutside(fundraisingChairJsof, loud);
    expect(counts.flagged).toBe(2);
    expect(counts.flaggedApproved).toBe(1);
    const publicItems = surface.items.filter((item) => item.audience === "PUBLIC");
    expect(publicItems[0].key).toBe("wording-pl-approved");
    expect(publicItems[0].note).toContain("Approved, so this publishes as written");
    expect(publicItems[0].note).toContain("taxable advertising");
    expect(publicItems[1].key).toBe("wording-pl-draft");
    expect(publicItems[1].note).toContain("cannot publish yet");
  });

  it("puts the flagged wording above the unproblematic pages either way", async () => {
    const { surface } = await fundraisingOutside(fundraisingChairJsof, repo());
    const publicItems = surface.items.filter((item) => item.audience === "PUBLIC");
    expect(publicItems.findIndex((item) => item.key.startsWith("wording-"))).toBe(0);
    expect(publicItems[0].note).toContain("taxable advertising");
  });

  it("flags that the Foundation has no public contact path", async () => {
    const { surface } = await fundraisingOutside(fundraisingChairJsof, repo());
    const contact = surface.items.find((item) => item.key === "foundation-contact")!;
    expect(contact.audience).toBe("PUBLIC");
    expect(contact.problem).toBe("MISSING_OWNER");
    expect(contact.note).toContain("no named");
  });

  it("withholds the published wording from a role with no content read", async () => {
    const { surface, withheld, counts } = await fundraisingOutside(treasurerJsof, repo());
    expect(counts.flagged).toBe(0);
    expect(surface.items.some((item) => item.key.startsWith("wording-"))).toBe(false);
    expect(withheld.join(" ")).toContain("published content");
    // The Treasurer still sees the donor side of their own entity's gifts.
    expect(surface.items.some((item) => item.key === "donor-no-receipt-JSOF")).toBe(true);
  });

  it("withholds the count of donors waiting on a receipt from an aggregate-only role", async () => {
    const { surface, withheld } = await fundraisingOutside(fundraisingChairJsof, repo());
    expect(surface.items.some((item) => item.key.startsWith("donor-no-receipt"))).toBe(
      false,
    );
    expect(withheld.join(" ")).toContain("gift-by-gift");
  });
});

describe("workspace: the tab spine", () => {
  it("keeps the three function tabs at their own routes", () => {
    expect(functionTabs().map((tab) => tab.href)).toEqual([
      "/board/donations/gifts",
      "/board/donations/funds",
      "/board/donations/sponsors",
    ]);
    // The dev override travels on the function tabs, as it always did.
    expect(functionTabHref("gifts", "?as=TREASURER:JSOF")).toBe(
      "/board/donations/gifts?as=TREASURER:JSOF",
    );
  });

  it("scopes the workspace to the entities a viewer holds, Foundation first", () => {
    expect(entitiesInScope(treasurerJsof)).toEqual(["JSOF"]);
    expect(entitiesInScope(treasurerJsoa)).toEqual(["JSOA"]);
    expect(
      entitiesInScope(
        subject("p-both", [
          { role: "FUNDRAISING_CHAIR", entity: "JSOA" },
          { role: "FUNDRAISING_CHAIR", entity: "JSOF" },
        ]),
      ),
    ).toEqual(["JSOF", "JSOA"]);
    expect(entitiesInScope(nobody)).toEqual([]);
  });
});

/* ================================================================== *
 * Reference data: a fund has to be creatable
 *
 * docs/PHASE2-FINDINGS.md item 1. There was no `saveFund`, so against a real
 * database the donate form offered a donor no fund at all and no code path
 * could change it. It was invisible for as long as the arrays came from
 * seed.ts. The first test here is that gap, written down.
 * ================================================================== */

/** The state a fresh database is actually in: no funds, no gifts, no sponsors. */
function emptyRepo() {
  return new InMemoryDonationsRepository([], [], []);
}

const presidentJsof = subject("p-pres-jsof", [{ role: "PRESIDENT", entity: "JSOF" }]);
const vpOperationsJsof = subject("p-vpops-jsof", [
  { role: "VP_OPERATIONS", entity: "JSOF" },
]);
const webmasterJsof = subject("p-web-jsof", [{ role: "WEBMASTER", entity: "JSOF" }]);
const financeReviewJsof = subject("p-fro-jsof", [
  { role: "FINANCE_REVIEW_OFFICER", entity: "JSOF" },
]);
/** The person the seed records as having authored every placement. */
const seedAuthorChair = subject("p-fundraising-chair", [
  { role: "FUNDRAISING_CHAIR", entity: "JSOF" },
]);

function fundDraft(overrides: Partial<FundDraft> = {}): FundDraft {
  return {
    entity: "JSOF",
    name: "Hurricane Relief Fund",
    restriction: "RESTRICTED",
    purpose: "Emergency assistance after a declared disaster.",
    openToGifts: true,
    ...overrides,
  };
}

describe("a fund can be created, and until one is there is nothing to give to", () => {
  it("offers a donor no fund at all on an empty register", async () => {
    // The gap itself. This is what a deployed donate form showed against a
    // fresh database, and why the fix is a create path rather than the seed.
    const store = emptyRepo();
    expect(await listPublicFundOptions("JSOF", store)).toEqual([]);
    expect(await listPublicFundOptions("JSOA", store)).toEqual([]);
  });

  it("puts a fund the Fundraising Chair opens onto the donate form", async () => {
    const store = emptyRepo();
    const { fund, offeredPublicly } = await saveFund(
      fundraisingChairJsof,
      fundDraft(),
      store,
    );

    expect(offeredPublicly).toBe(true);
    expect(fund.currency).toBe("USD");
    const offered = await listPublicFundOptions("JSOF", store);
    expect(offered.map((option) => option.name)).toEqual(["Hurricane Relief Fund"]);
    // No figure on a public option, ever.
    expect(Object.keys(offered[0]!)).toEqual([
      "id",
      "entity",
      "name",
      "restriction",
      "purpose",
    ]);
  });

  it("lets the Treasurer open one too, on the entity they hold", async () => {
    const store = emptyRepo();
    await saveFund(treasurerJsof, fundDraft(), store);
    expect(await listPublicFundOptions("JSOF", store)).toHaveLength(1);
  });

  it("keeps a fund closed to gifts out of the donate form and in the register", async () => {
    const store = emptyRepo();
    const { offeredPublicly } = await saveFund(
      treasurerJsof,
      fundDraft({ openToGifts: false }),
      store,
    );
    expect(offeredPublicly).toBe(false);
    expect(await listPublicFundOptions("JSOF", store)).toEqual([]);
    // Still in the register: nothing is deleted, only closed.
    expect(await store.listFunds("JSOF")).toHaveLength(1);
  });

  it("does not offer one entity's fund to the other", async () => {
    const store = emptyRepo();
    await saveFund(treasurerJsoa, fundDraft({ entity: "JSOA" }), store);
    expect(await listPublicFundOptions("JSOA", store)).toHaveLength(1);
    expect(await listPublicFundOptions("JSOF", store)).toEqual([]);
  });

  it("refuses a fund with no stated purpose", async () => {
    const store = emptyRepo();
    await expect(
      saveFund(treasurerJsof, fundDraft({ purpose: "   " }), store),
    ).rejects.toThrow(RepositoryError);
    await expect(
      saveFund(treasurerJsof, fundDraft({ purpose: "" }), store),
    ).rejects.toThrow(/cannot state is one it cannot honour/);
    expect(await store.listFunds("JSOF")).toEqual([]);
  });

  it("refuses a fund with no name", async () => {
    const store = emptyRepo();
    await expect(
      saveFund(treasurerJsof, fundDraft({ name: " " }), store),
    ).rejects.toThrow(/needs a name/);
  });

  it("refuses to move an existing fund to the other entity", async () => {
    // The board review's finding 1 manufactured anew: the memorial fund under
    // the Association while the Foundation's page promises a deductible gift.
    const store = emptyRepo();
    const { fund } = await saveFund(treasurerJsof, fundDraft(), store);

    const bothTreasurers = subject("p-both", [
      { role: "TREASURER", entity: "JSOF" },
      { role: "TREASURER", entity: "JSOA" },
    ]);
    await expect(
      saveFund(bothTreasurers, { ...fundDraft({ entity: "JSOA" }), id: fund.id }, store),
    ).rejects.toThrow(/cannot be moved to JSOA/);

    expect((await store.getFund(fund.id))!.entity).toBe("JSOF");
  });

  it("closes a fund to new gifts without deleting anything", async () => {
    const store = emptyRepo();
    const { fund } = await saveFund(fundraisingChairJsof, fundDraft(), store);

    const closed = await closeFundToGifts(fundraisingChairJsof, "JSOF", fund.id, store);
    expect(closed.openToGifts).toBe(false);
    expect(await listPublicFundOptions("JSOF", store)).toEqual([]);
    const register = await store.listFunds("JSOF");
    expect(register).toHaveLength(1);
    expect(register[0]!.purpose).toBe(fund.purpose);
  });
});

describe("a wrong-role request to open a fund fails", () => {
  it("refuses the Webmaster, which can publish and holds no financial scope", async () => {
    // PUBLIC_CONTENT WRITE and FINANCIAL NONE. Publishing a page is not the
    // same act as deciding the Foundation now holds money for a new purpose.
    expect(canDefineFund(webmasterJsof, "JSOF")).toBe(false);
    await expect(
      saveFund(webmasterJsof, fundDraft(), emptyRepo()),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses the Scholarships Chair and the Secretary", async () => {
    for (const who of [scholarshipsChairJsof, secretaryJsof]) {
      expect(canDefineFund(who, "JSOF")).toBe(false);
      await expect(saveFund(who, fundDraft(), emptyRepo())).rejects.toThrow(AuthzError);
    }
  });

  it("refuses a role held on the other entity", async () => {
    expect(canDefineFund(treasurerJsoa, "JSOF")).toBe(false);
    await expect(
      saveFund(treasurerJsoa, fundDraft({ entity: "JSOF" }), emptyRepo()),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses an unauthenticated visitor", async () => {
    expect(canDefineFund(nobody, "JSOF")).toBe(false);
    await expect(saveFund(nobody, fundDraft(), emptyRepo())).rejects.toThrow(AuthzError);
  });
});

/* ================================================================== *
 * Reference data: sponsorships
 * ================================================================== */

function sponsorshipDraft(
  overrides: Partial<Omit<SponsorshipDraft, "createdById">> = {},
): Omit<SponsorshipDraft, "createdById"> {
  return {
    entity: "JSOF",
    sponsorName: "Ridgeline Contracting",
    eventName: "Golf Tournament 2027",
    tier: "Hole sponsor",
    paymentCents: 250_000,
    exclusivity: "NONE",
    receivedAt: "2027-02-01T12:00:00Z",
    contingentOnAttendanceOrImpressions: false,
    ...overrides,
  };
}

describe("a sponsorship can be recorded, and only by the office that holds the money", () => {
  it("starts from an empty register", async () => {
    expect(await readSponsorRegister(treasurerJsof, "JSOF", emptyRepo())).toEqual([]);
  });

  it("records one for the Treasurer, in integer cents, never contingent", async () => {
    const store = emptyRepo();
    const sponsorship = await recordSponsorship(treasurerJsof, sponsorshipDraft(), store);

    expect(sponsorship.paymentCents).toBe(250_000);
    expect(Number.isInteger(sponsorship.paymentCents)).toBe(true);
    expect(sponsorship.currency).toBe("USD");
    expect(sponsorship.contingentOnAttendanceOrImpressions).toBe(false);
    expect(sponsorship.createdById).toBe(treasurerJsof.personId);
    expect(sponsorship.placements).toEqual([]);

    const register = await readSponsorRegister(treasurerJsof, "JSOF", store);
    expect(register).toHaveLength(1);
    // No placements, so no benefit value, so the whole payment qualifies.
    expect(register[0]!.assessment.withinSafeHarbour).toBe(true);
    expect(register[0]!.assessment.qualifiedSponsorshipPortionCents).toBe(250_000);
  });

  it("refuses the Fundraising Chair, who holds the money at aggregate only", async () => {
    // Not a gap. The office that negotiates the sponsorship is deliberately
    // not the office that records the cash, and letting the Chair write
    // paymentCents would hand them the ledger through the content door.
    expect(canRecordSponsorship(fundraisingChairJsof, "JSOF")).toBe(false);
    await expect(
      recordSponsorship(fundraisingChairJsof, sponsorshipDraft(), emptyRepo()),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses the read-only Finance Review Officer", async () => {
    await expect(
      recordSponsorship(financeReviewJsof, sponsorshipDraft(), emptyRepo()),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses a payment that is not a whole number of cents, and a zero one", async () => {
    for (const paymentCents of [250_000.5, 0, -100]) {
      await expect(
        recordSponsorship(treasurerJsof, sponsorshipDraft({ paymentCents }), emptyRepo()),
      ).rejects.toThrow(/whole number of cents/);
    }
  });

  it("refuses a fee contingent on attendance or impressions", async () => {
    // The type says `false`, so this can only arrive through a cast — off a
    // form, or out of a row written by something else. It is refused rather
    // than coerced, because coercing would file advertising income as a
    // qualified sponsorship payment.
    const contingent = {
      ...sponsorshipDraft(),
      contingentOnAttendanceOrImpressions: true,
    } as unknown as Omit<SponsorshipDraft, "createdById">;
    await expect(
      recordSponsorship(treasurerJsof, contingent, emptyRepo()),
    ).rejects.toThrow(/not a qualified sponsorship payment at all/);
  });

  it("refuses a row that does not say who or what it is for", async () => {
    for (const overrides of [
      { sponsorName: " " },
      { eventName: "" },
      { tier: "  " },
    ]) {
      await expect(
        recordSponsorship(treasurerJsof, sponsorshipDraft(overrides), emptyRepo()),
      ).rejects.toThrow(RepositoryError);
    }
  });

  it("has no shape for exclusive provider", async () => {
    const bad = {
      ...sponsorshipDraft(),
      exclusivity: "EXCLUSIVE_PROVIDER",
    } as unknown as Omit<SponsorshipDraft, "createdById">;
    await expect(recordSponsorship(treasurerJsof, bad, emptyRepo())).rejects.toThrow(
      /exclusive provider is advertising/i,
    );
  });
});

/* ================================================================== *
 * The receipt is handed to somebody
 *
 * `receipts.ts` rendered a statutory acknowledgment and gave it to nobody.
 * What matters about wiring it to the outbox is the envelope: the entity
 * decides the sending identity, and a 501(c)(19) receipt arriving as the
 * Foundation is the board review's heaviest finding repeated in the one
 * artifact a donor keeps and files.
 * ================================================================== */

describe("a receipt goes out in its own entity's envelope", () => {
  it("queues a Foundation receipt as the Foundation, on the transactional stream", async () => {
    const store = repo();
    const { receipt, message } = await sendReceipt(
      treasurerJsof,
      "JSOF",
      "d-jsof-001",
      store,
    );

    expect(message.entity).toBe("JSOF");
    expect(message.stream).toBe("TRANSACTIONAL");
    expect(message.kind).toBe(RECEIPT_MESSAGE_KIND);
    expect(message.state).toBe("QUEUED");
    expect(message.subject).toContain("Joint Special Operations Foundation");
    expect(message.subject).toContain(receipt.receiptNumber);
    expect(receipt.templateId).toBe("JSOF_CONTRIBUTION_V1");
  });

  it("will not re-badge an Association receipt as the Foundation to get it out", async () => {
    // thejsoa.org cannot send yet. The message queues and waits, carrying the
    // reason, rather than borrowing the one verified domain. The tempting fix
    // is the exact error the entity separation exists to prevent.
    const store = repo();
    const { receipt, message } = await sendReceipt(
      treasurerJsoa,
      "JSOA",
      "d-jsoa-001",
      store,
    );

    expect(message.entity).toBe("JSOA");
    expect(message.state).toBe("QUEUED");
    expect(message.stateReason).toMatch(/sending domain/);
    expect(message.subject).toContain("Joint Special Operations Association");
    expect(message.subject).not.toContain("Foundation");
    expect(receipt.templateId).toBe("JSOA_PAYMENT_V1");
    expect(message.bodyText).toContain("501(c)(19)");
    expect(message.bodyText).not.toContain("501(c)(3)");
  });

  it("carries the Chapter 131F statement verbatim in the body that is sent", async () => {
    const { message } = await sendReceipt(treasurerJsof, "JSOF", "d-jsof-001", repo());
    expect(message.bodyText).toContain(NC_131F_DISCLOSURE);
    expect(message.bodyText).toContain("license");
    expect(message.bodyText).not.toContain("licence");
  });

  it("refuses to send a receipt for a gift whose benefits carry no value", async () => {
    // And allocates no receipt number doing it. A number burned on a refusal
    // is a gap in the numbering whose only explanation is "the send failed",
    // which nobody can verify afterwards.
    const store = repo();
    let allocations = 0;
    const next = store.nextReceiptSequence.bind(store);
    store.nextReceiptSequence = async (entity) => {
      allocations += 1;
      return next(entity);
    };

    await expect(
      sendReceipt(treasurerJsof, "JSOF", "d-jsof-004", store),
    ).rejects.toThrow(ReceiptError);
    expect(allocations).toBe(0);
  });

  it("refuses a gift that belongs to the other entity", async () => {
    await expect(
      sendReceipt(
        subject("p-both-treas", [
          { role: "TREASURER", entity: "JSOF" },
          { role: "TREASURER", entity: "JSOA" },
        ]),
        "JSOF",
        "d-jsoa-001",
        repo(),
      ),
    ).rejects.toThrow(/belongs to JSOA, not JSOF/);
  });

  it("numbers two receipts differently, within one entity's own run", async () => {
    const store = repo();
    const first = await sendReceipt(treasurerJsof, "JSOF", "d-jsof-001", store);
    const second = await sendReceipt(treasurerJsof, "JSOF", "d-jsof-002", store);
    expect(first.receipt.receiptNumber).not.toBe(second.receipt.receiptNumber);
    expect(first.receipt.receiptNumber).toMatch(/^JSOF-R-\d{5}$/);
  });

  it("passes a missing address through as null rather than throwing", async () => {
    const store = repo();
    const gift = (await store.getDonation("d-jsof-001"))!;
    const draft = receiptDraft(
      buildReceipt({
        donation: gift,
        funds: await store.listFunds("JSOF"),
        sequence: 1,
      }),
      "   ",
    );
    expect(draft.toAddress).toBeNull();
    expect(draft.entity).toBe("JSOF");
  });
});

describe("a wrong-role request to send a receipt fails", () => {
  it("refuses the Finance Review Officer, which can read every one of them", async () => {
    // Independence is mechanical: the role holds FINANCIAL READ and the
    // platform refuses it write scope anywhere. It can see each receipt on
    // the register screen and issue none.
    expect(canSendReceipt(financeReviewJsof, "JSOF")).toBe(false);
    await expect(
      issueReceipt(financeReviewJsof, "JSOF", "d-jsof-001", repo()),
    ).resolves.toBeDefined();
    await expect(
      sendReceipt(financeReviewJsof, "JSOF", "d-jsof-001", repo()),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses the Fundraising Chair and the Secretary", async () => {
    for (const who of [fundraisingChairJsof, secretaryJsof, nobody]) {
      await expect(
        sendReceipt(who, "JSOF", "d-jsof-001", repo()),
      ).rejects.toThrow(AuthzError);
    }
  });
});

describe("the receipt actually lands in the outbox", () => {
  beforeEach(() => {
    openDatabase();
  });

  // Closed again afterwards, so no later test accidentally runs against a
  // binding: `donationsRepository()` would then hand back the D1 repository
  // pointed at an empty fixture rather than the seeded in-memory one.
  afterEach(() => {
    closeDatabase();
  });

  it("writes one outbound_message row, with the gift's entity on it", async () => {
    const database = liveDatabase!;
    // The repository is the in-memory one, passed explicitly: what is being
    // tested here is the queue write, not the gift read.
    const { receipt } = await sendReceipt(treasurerJsof, "JSOF", "d-jsof-001", repo());

    const rows = database.raw
      .prepare(
        "SELECT entity, stream, kind, state, to_address, subject, body_text " +
          "FROM outbound_message",
      )
      .all() as {
      entity: string;
      stream: string;
      kind: string;
      state: string;
      to_address: string;
      subject: string;
      body_text: string;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.entity).toBe("JSOF");
    expect(rows[0]!.stream).toBe("TRANSACTIONAL");
    expect(rows[0]!.kind).toBe(RECEIPT_MESSAGE_KIND);
    expect(rows[0]!.state).toBe("QUEUED");
    expect(rows[0]!.subject).toContain(receipt.receiptNumber);
    expect(rows[0]!.body_text).toContain(NC_131F_DISCLOSURE);

    // One delivery event, and it is append-only at the database.
    expect(() =>
      database.raw.exec("DELETE FROM delivery_event"),
    ).toThrow(/append-only/);
  });

  it("still sends a receipt to somebody who unsubscribed from the newsletter", async () => {
    const database = liveDatabase!;
    const gift = (await repo().getDonation("d-jsof-001"))!;
    database.raw
      .prepare(
        "INSERT INTO suppression (address, stream, reason, created_at) " +
          "VALUES (?, 'BULK', 'UNSUBSCRIBED', '2027-01-01T00:00:00Z')",
      )
      .run(gift.donorEmail.toLowerCase());

    const { message } = await sendReceipt(treasurerJsof, "JSOF", "d-jsof-001", repo());
    expect(message.state).toBe("QUEUED");
  });

  it("does not send to an address suppressed on the transactional stream", async () => {
    const database = liveDatabase!;
    const gift = (await repo().getDonation("d-jsof-001"))!;
    database.raw
      .prepare(
        "INSERT INTO suppression (address, stream, reason, created_at) " +
          "VALUES (?, 'TRANSACTIONAL', 'HARD_BOUNCE', '2027-01-01T00:00:00Z')",
      )
      .run(gift.donorEmail.toLowerCase());

    const { message } = await sendReceipt(treasurerJsof, "JSOF", "d-jsof-001", repo());
    expect(message.state).toBe("SUPPRESSED");
    // The receipt was still issued and numbered. A bounced address is not a
    // reason to have no record of the acknowledgment.
    expect(
      database.raw
        .prepare("SELECT COUNT(*) AS n FROM outbound_message")
        .get() as { n: number },
    ).toEqual({ n: 1 });
  });
});

/* ================================================================== *
 * The release gate around a placement
 *
 * `savePlacement` existed; the approve-and-publish path around it did not.
 * Author and approver must be different people, and the approved wording is
 * a stored string the board approved — never generated, because one
 * adjective turns an acknowledgment into advertising and converts the whole
 * payment.
 * ================================================================== */

async function draftPlacement(store: InMemoryDonationsRepository, author = seedAuthorChair) {
  const sponsorship = await recordSponsorship(treasurerJsof, sponsorshipDraft(), store);
  const { placement } = await saveAcknowledgmentString(
    author,
    "JSOF",
    sponsorship.id,
    {
      kind: "SIGNAGE",
      approvedAcknowledgmentString: "Ridgeline Contracting, Fayetteville, NC.",
      benefitFairMarketValueCents: 2_500,
    },
    store,
  );
  return { sponsorshipId: sponsorship.id, placement };
}

describe("sponsor copy publishes on a second person's approval, or not at all", () => {
  it("goes draft, then awaiting release, then approved by somebody else", async () => {
    const store = emptyRepo();
    const { sponsorshipId, placement } = await draftPlacement(store);
    expect(placement.publicationState).toBe("DRAFT");
    expect(placement.approvedById).toBeNull();
    expect(placement.authoredById).toBe(seedAuthorChair.personId);

    const sent = await sendPlacementForRelease(
      seedAuthorChair,
      "JSOF",
      sponsorshipId,
      placement.id,
      store,
    );
    expect(sent.placement.publicationState).toBe("AWAITING_RELEASE");

    const approved = await approvePlacementForPublication(
      vpOperationsJsof,
      "JSOF",
      sponsorshipId,
      placement.id,
      store,
    );
    expect(approved.placement.publicationState).toBe("APPROVED");
    expect(approved.placement.approvedById).toBe(vpOperationsJsof.personId);
    expect(approved.placement.authoredById).toBe(seedAuthorChair.personId);
  });

  it("does not touch the wording when it approves it", async () => {
    // The whole compliance surface is this string. Approval is a signature on
    // words that already exist; nothing generates, rewrites or normalises it.
    const store = emptyRepo();
    const { sponsorshipId, placement } = await draftPlacement(store);
    await sendPlacementForRelease(
      seedAuthorChair,
      "JSOF",
      sponsorshipId,
      placement.id,
      store,
    );
    const approved = await approvePlacementForPublication(
      presidentJsof,
      "JSOF",
      sponsorshipId,
      placement.id,
      store,
    );
    expect(approved.placement.approvedAcknowledgmentString).toBe(
      placement.approvedAcknowledgmentString,
    );
  });

  it("refuses the author's own approval", async () => {
    const store = emptyRepo();
    // An author who also holds release approval: the Memorial Chair writes
    // and approves, which is the pair that makes this reachable at all.
    const memorialChair = subject("p-memorial", [
      { role: "MEMORIAL_CHAIR", entity: "JSOF" },
    ]);
    const { sponsorshipId, placement } = await draftPlacement(store, memorialChair);
    await sendPlacementForRelease(
      memorialChair,
      "JSOF",
      sponsorshipId,
      placement.id,
      store,
    );

    expect(canApproveRelease(memorialChair, "JSOF")).toBe(true);
    await expect(
      approvePlacementForPublication(
        memorialChair,
        "JSOF",
        sponsorshipId,
        placement.id,
        store,
      ),
    ).rejects.toThrow(AuthzError);

    const after = (await store.getSponsorship(sponsorshipId))!.placements[0]!;
    expect(after.publicationState).toBe("AWAITING_RELEASE");
    expect(after.approvedById).toBeNull();
  });

  it("refuses an approver who does not hold release approval", async () => {
    const store = emptyRepo();
    const { sponsorshipId, placement } = await draftPlacement(store);
    await sendPlacementForRelease(
      seedAuthorChair,
      "JSOF",
      sponsorshipId,
      placement.id,
      store,
    );

    // The Fundraising Chair can write the wording and cannot clear it to
    // publish; the Webmaster can publish and cannot approve its own content.
    for (const who of [fundraisingChairJsof, webmasterJsof]) {
      expect(canAuthorWording(who, "JSOF")).toBe(true);
      expect(canApproveRelease(who, "JSOF")).toBe(false);
      await expect(
        approvePlacementForPublication(who, "JSOF", sponsorshipId, placement.id, store),
      ).rejects.toThrow(AuthzError);
    }
  });

  it("will not approve something straight out of draft", async () => {
    const store = emptyRepo();
    const { sponsorshipId, placement } = await draftPlacement(store);
    await expect(
      approvePlacementForPublication(
        vpOperationsJsof,
        "JSOF",
        sponsorshipId,
        placement.id,
        store,
      ),
    ).rejects.toThrow(/cannot be approved from there/);
  });

  it("will not send empty wording for release", async () => {
    const store = emptyRepo();
    const sponsorship = await recordSponsorship(treasurerJsof, sponsorshipDraft(), store);
    const { placement } = await saveAcknowledgmentString(
      seedAuthorChair,
      "JSOF",
      sponsorship.id,
      {
        kind: "SIGNAGE",
        approvedAcknowledgmentString: "   ",
        benefitFairMarketValueCents: 0,
      },
      store,
    );
    await expect(
      sendPlacementForRelease(
        seedAuthorChair,
        "JSOF",
        sponsorship.id,
        placement.id,
        store,
      ),
    ).rejects.toThrow(/nothing to approve/);
  });

  it("refuses an approver authorized on the other entity", async () => {
    const store = emptyRepo();
    const { sponsorshipId, placement } = await draftPlacement(store);
    await sendPlacementForRelease(
      seedAuthorChair,
      "JSOF",
      sponsorshipId,
      placement.id,
      store,
    );
    const presidentBoth = subject("p-pres-both", [
      { role: "PRESIDENT", entity: "JSOF" },
      { role: "PRESIDENT", entity: "JSOA" },
    ]);
    await expect(
      approvePlacementForPublication(
        presidentBoth,
        "JSOA",
        sponsorshipId,
        placement.id,
        store,
      ),
    ).rejects.toThrow(/belongs to JSOF, not JSOA/);
  });

  it("sends changed wording back through the gate and moves authorship with it", async () => {
    // The hole this closes: keeping the original author on an edit let the
    // editor approve their own text as a "second" reader. Authorship follows
    // the words.
    const store = emptyRepo();
    const { sponsorshipId, placement } = await draftPlacement(store);
    // The Memorial Chair is the one role that both writes published content
    // and holds release approval, which is what makes this reachable.
    const memorialChair = subject("p-memorial", [
      { role: "MEMORIAL_CHAIR", entity: "JSOF" },
    ]);

    await sendPlacementForRelease(
      seedAuthorChair,
      "JSOF",
      sponsorshipId,
      placement.id,
      store,
    );
    await approvePlacementForPublication(
      memorialChair,
      "JSOF",
      sponsorshipId,
      placement.id,
      store,
    );

    // The approver now rewrites the words. They are the author of the new
    // ones, so they cannot be the second reader of them.
    const { placement: edited } = await saveAcknowledgmentString(
      memorialChair,
      "JSOF",
      sponsorshipId,
      {
        id: placement.id,
        kind: placement.kind,
        approvedAcknowledgmentString:
          "Ridgeline Contracting, the region's finest roofer.",
        benefitFairMarketValueCents: placement.benefitFairMarketValueCents,
      },
      store,
    );

    expect(edited.publicationState).toBe("AWAITING_RELEASE");
    expect(edited.approvedById).toBeNull();
    expect(edited.authoredById).toBe(memorialChair.personId);

    await expect(
      approvePlacementForPublication(
        memorialChair,
        "JSOF",
        sponsorshipId,
        placement.id,
        store,
      ),
    ).rejects.toThrow(AuthzError);

    // Somebody else can, and the validator's warning travels with it.
    const approved = await approvePlacementForPublication(
      presidentJsof,
      "JSOF",
      sponsorshipId,
      placement.id,
      store,
    );
    expect(approved.placement.publicationState).toBe("APPROVED");
    expect(approved.review.clean).toBe(false);
    expect(approved.review.findings.map((f) => f.match)).toContain("finest");
  });
});

/* ================================================================== *
 * The D1 implementation of all of the above
 *
 * docs/PHASE2-FINDINGS.md item 7: not one line of any D1 repository had run,
 * and nothing in `npm test` would catch a broken `repository.d1.ts`. These
 * run the new methods against the real migrations, applied from disk.
 *
 * It is SQLite and not D1, so what it proves is the SQL, the constraints and
 * the row-to-domain mapping — not the Cloudflare driver, not `batch` under
 * concurrency, and not the error shape D1 raises on a trigger abort.
 * ================================================================== */

describe("the D1 repository, against the real schema", () => {
  let store: D1DonationsRepository;

  beforeEach(() => {
    store = new D1DonationsRepository(openDatabase().binding);
  });

  afterEach(() => {
    closeDatabase();
  });

  it("creates a fund that reads back as a fund", async () => {
    const fund = await store.saveFund(fundDraft());
    expect(fund.entity).toBe("JSOF");
    expect(fund.restriction).toBe("RESTRICTED");
    expect(fund.openToGifts).toBe(true);
    expect(fund.currency).toBe("USD");
    expect(await store.listFunds("JSOF")).toHaveLength(1);
    expect(await store.listFunds("JSOA")).toEqual([]);
  });

  it("closes a fund by writing the boolean as an integer", async () => {
    // D1 refuses a boolean bind and so does the fixture, on purpose.
    const fund = await store.saveFund(fundDraft());
    const closed = await store.saveFund({
      ...fundDraft(),
      id: fund.id,
      openToGifts: false,
    });
    expect(closed.openToGifts).toBe(false);
    expect(
      liveDatabase!.raw
        .prepare("SELECT open_to_gifts AS v FROM fund WHERE id = ?")
        .get(fund.id),
    ).toEqual({ v: 0 });
  });

  it("records a sponsorship with contingent_on_attendance at zero", async () => {
    const sponsorship = await store.saveSponsorship({
      ...sponsorshipDraft(),
      createdById: "p-treas-jsof",
    });
    expect(sponsorship.contingentOnAttendanceOrImpressions).toBe(false);
    expect(
      liveDatabase!.raw
        .prepare("SELECT contingent_on_attendance AS v FROM sponsorship WHERE id = ?")
        .get(sponsorship.id),
    ).toEqual({ v: 0 });
  });

  it("has a CHECK that refuses a contingent payment even in raw SQL", async () => {
    expect(() =>
      liveDatabase!.raw.exec(
        "INSERT INTO sponsorship (id, entity, sponsor_name, event_name, tier, " +
          "payment_cents, currency, contingent_on_attendance, exclusivity, " +
          "received_at, created_by_id) VALUES ('s-bad', 'JSOF', 'X', 'Y', 'Z', " +
          "100, 'USD', 1, 'NONE', '2027-01-01T00:00:00Z', 'p')",
      ),
    ).toThrow();
  });

  it("runs the whole release gate through the database", async () => {
    const sponsorship = await store.saveSponsorship({
      ...sponsorshipDraft(),
      createdById: "p-treas-jsof",
    });
    const placement = await store.savePlacement(sponsorship.id, {
      kind: "EVENT_TSHIRT",
      approvedAcknowledgmentString: "Ridgeline Contracting, Fayetteville, NC.",
      benefitFairMarketValueCents: 1_200,
      authoredById: "p-fundraising-chair",
    });
    expect(placement.publicationState).toBe("DRAFT");
    expect(placement.entity).toBe("JSOF");

    await store.submitPlacementForRelease(sponsorship.id, placement.id);
    await expect(
      store.approvePlacement(sponsorship.id, placement.id, "p-fundraising-chair"),
    ).rejects.toThrow(/cannot also approve it/);

    const approved = await store.approvePlacement(
      sponsorship.id,
      placement.id,
      "p-vpops",
    );
    expect(approved.publicationState).toBe("APPROVED");
    expect(approved.approvedById).toBe("p-vpops");
    expect(approved.approvedAcknowledgmentString).toBe(
      placement.approvedAcknowledgmentString,
    );

    // Changed wording loses the approval and the authorship.
    const edited = await store.savePlacement(sponsorship.id, {
      id: placement.id,
      kind: placement.kind,
      approvedAcknowledgmentString: "Ridgeline Contracting, the region's best roofer.",
      benefitFairMarketValueCents: placement.benefitFairMarketValueCents,
      authoredById: "p-vpops",
    });
    expect(edited.publicationState).toBe("AWAITING_RELEASE");
    expect(edited.approvedById).toBeNull();
    expect(edited.authoredById).toBe("p-vpops");
  });

  it("numbers receipts per entity through the counter, never by reading the highest", async () => {
    const jsof = [
      await store.nextReceiptSequence("JSOF"),
      await store.nextReceiptSequence("JSOF"),
      await store.nextReceiptSequence("JSOF"),
    ];
    const jsoa = await store.nextReceiptSequence("JSOA");

    expect(jsof).toEqual([1, 2, 3]);
    // Separate runs. The two entities never share a numbering sequence.
    expect(jsoa).toBe(1);
    expect(
      liveDatabase!.raw
        .prepare("SELECT name, value FROM counter ORDER BY name")
        .all(),
    ).toEqual([
      { name: "donation-receipt-JSOA", value: 1 },
      { name: "donation-receipt-JSOF", value: 3 },
    ]);
  });

  it("records a gift, its allocations and its benefits in one transaction", async () => {
    const fund = await store.saveFund(fundDraft({ restriction: "UNRESTRICTED" }));
    const donation = await store.recordClearedDonation(
      {
        entity: "JSOF",
        donorDisplayName: "A Donor",
        donorEmail: "donor@example.org",
        amountCents: 100_000,
        currency: "USD",
        allocations: [{ fundId: fund.id, amountCents: 100_000 }],
        benefits: [
          {
            kind: "BANQUET_SEAT",
            description: "Dinner seat",
            quantity: 2,
            unitFairMarketValueCents: 4_000,
          },
        ],
        benefitFairMarketValueCents: 8_000,
        sponsorshipId: null,
      },
      {
        createdById: "p-treas-jsof",
        checkoutSessionRef: "co_test",
        receivedAt: "2027-03-01T12:00:00Z",
      },
    );

    expect(donation.status).toBe("PAID");
    expect(donation.allocations).toHaveLength(1);
    expect(donation.benefits).toHaveLength(1);
    expect(donation.benefitFairMarketValueCents).toBe(8_000);

    const balances = await store.fundBalances("JSOF");
    expect(balances[0]!.balanceCents).toBe(100_000);
    expect(balances[0]!.giftCount).toBe(1);
  });

  it("refuses a gift allocated to the other entity's fund, before the trigger has to", async () => {
    // The trigger `allocation_entity_must_match` is the backstop and a
    // backstop that is never reached is the point of it: the arithmetic check
    // refuses first, with a sentence naming both organizations. Either way
    // nothing lands — there is no catch and no "put it in the general fund".
    const associationFund = await store.saveFund(
      fundDraft({ entity: "JSOA", restriction: "UNRESTRICTED" }),
    );
    await expect(
      store.recordClearedDonation(
        {
          entity: "JSOF",
          donorDisplayName: "A Donor",
          donorEmail: "donor@example.org",
          amountCents: 5_000,
          currency: "USD",
          allocations: [{ fundId: associationFund.id, amountCents: 5_000 }],
          benefits: [],
          benefitFairMarketValueCents: null,
          sponsorshipId: null,
        },
        {
          createdById: "p-treas-jsof",
          checkoutSessionRef: "co_test",
          receivedAt: "2027-03-01T12:00:00Z",
        },
      ),
    ).rejects.toThrow(/never share a fund/);

    expect(
      liveDatabase!.raw.prepare("SELECT COUNT(*) AS n FROM donation").get(),
    ).toEqual({ n: 0 });
    expect(
      liveDatabase!.raw.prepare("SELECT COUNT(*) AS n FROM donation_allocation").get(),
    ).toEqual({ n: 0 });
  });

  it("refuses a gift with benefits and no fair market value, with the same words", async () => {
    const fund = await store.saveFund(fundDraft({ restriction: "UNRESTRICTED" }));
    await expect(
      store.recordClearedDonation(
        {
          entity: "JSOF",
          donorDisplayName: "A Donor",
          donorEmail: "donor@example.org",
          amountCents: 20_000,
          currency: "USD",
          allocations: [{ fundId: fund.id, amountCents: 20_000 }],
          benefits: [
            {
              kind: "EVENT_TICKET",
              description: "Ball ticket",
              quantity: 1,
              unitFairMarketValueCents: 9_000,
            },
          ],
          benefitFairMarketValueCents: null,
          sponsorshipId: null,
        },
        {
          createdById: "p-treas-jsof",
          checkoutSessionRef: "co_test",
          receivedAt: "2027-03-01T12:00:00Z",
        },
      ),
    ).rejects.toThrow(/cannot be issued without one/);
  });

  it("refuses to move a fund between entities at the repository, whatever the SQL allows", async () => {
    const fund = await store.saveFund(fundDraft());
    await expect(
      store.saveFund({ ...fundDraft({ entity: "JSOA" }), id: fund.id }),
    ).rejects.toThrow(/cannot be moved to JSOA/);
  });
});
