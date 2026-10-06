/**
 * Donations, funds, receipts and sponsorship: the control tests.
 *
 * These are written as requirements. Each one is a rule from
 * docs/ARCHITECTURE.md or docs/PRIVACY-AND-PAYMENTS.md that the code must not
 * be able to break, plus the wrong-role request that has to fail.
 */

import { describe, expect, it } from "vitest";

import type { Entity } from "../src/lib/authz/model";
import { AuthzError, type Subject } from "../src/lib/authz/policy";
import { validateAllocations } from "../src/lib/donations/allocation";
import {
  checkAllocations,
  issueReceipt,
  listPublicFundOptions,
  prepareDonationIntent,
  readDonationRegister,
  readFundAggregates,
  readFundRegister,
  readSponsorAcknowledgments,
  readSponsorRegister,
  recordClearedDonation,
  saveAcknowledgmentString,
} from "../src/lib/donations/actions";
import { buildCheckoutHandoff, PCI_NOTE } from "../src/lib/donations/checkout";
import {
  NC_131F_DISCLOSURE,
  NC_131F_TYPE,
} from "../src/lib/donations/disclosure";
import { formatCents, parseDollarsToCents } from "../src/lib/donations/money";
import {
  InMemoryDonationsRepository,
  RepositoryError,
} from "../src/lib/donations/repository";
import {
  buildReceipt,
  checkDisclosureConspicuous,
  ENTITY_IDENTITY,
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

  it("refuses the intent at the donate flow's own entry point", () => {
    const result = prepareDonationIntent(
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

  it("refuses a mismatched allocation at the repository boundary too", () => {
    const r = repo();
    expect(() =>
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
    ).toThrow(RepositoryError);
  });
});

/* ================================================================== *
 * 2. The entity is chosen, never inferred
 * ================================================================== */

describe("the entity is always chosen, never inferred", () => {
  it("refuses an intent with no entity", () => {
    const result = prepareDonationIntent(
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

  it("offers each entity only its own funds", () => {
    const jsof = listPublicFundOptions("JSOF", repo());
    const jsoa = listPublicFundOptions("JSOA", repo());
    expect(jsof.length).toBeGreaterThan(0);
    expect(jsoa.length).toBeGreaterThan(0);
    expect(jsof.every((f) => f.entity === "JSOF")).toBe(true);
    expect(jsoa.every((f) => f.entity === "JSOA")).toBe(true);
    const overlap = jsof.filter((f) => jsoa.some((o) => o.id === f.id));
    expect(overlap).toHaveLength(0);
  });

  it("does not offer a fund that is closed to gifts", () => {
    const ids = listPublicFundOptions("JSOF", repo()).map((f) => f.id);
    expect(ids).not.toContain("fund-jsof-pavers-2019");
  });

  it("shows no figure on the public fund list", () => {
    for (const option of listPublicFundOptions("JSOF", repo())) {
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

  it("refuses the seeded gift that was recorded without a valuation", () => {
    expect(() =>
      issueReceipt(treasurerJsof, "JSOF", "d-jsof-004", repo(), { sequence: 1 }),
    ).toThrow(ReceiptError);
  });

  it("refuses to file a new gift with benefits and no valuation at all", () => {
    expect(() =>
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
    ).toThrow(RepositoryError);
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

  it("numbers receipts in separate per-entity sequences", () => {
    expect(jsofReceipt.receiptNumber.startsWith("JSOF-R-")).toBe(true);
    expect(jsoaReceipt.receiptNumber.startsWith("JSOA-R-")).toBe(true);
    const r = repo();
    expect(r.nextReceiptSequence("JSOF")).toBe(1);
    expect(r.nextReceiptSequence("JSOF")).toBe(2);
    expect(r.nextReceiptSequence("JSOA")).toBe(1);
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

  it("refuses to receipt one entity's gift under the other entity's heading", () => {
    // A JSOF treasurer asking for a JSOF receipt against a JSOA gift.
    const r = repo();
    expect(() =>
      issueReceipt(treasurerJsof, "JSOF", "d-jsoa-001", r, { sequence: 1 }),
    ).toThrow(ReceiptError);
  });

  it("gives each entity's own treasurer their own entity's template", () => {
    const jsof = issueReceipt(treasurerJsof, "JSOF", "d-jsof-001", repo(), {
      sequence: 1,
    });
    const jsoa = issueReceipt(treasurerJsoa, "JSOA", "d-jsoa-001", repo(), {
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

  it("sums benefit value across every placement before applying the test", () => {
    const rows = readSponsorRegister(treasurerJsof, "JSOF", repo());
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

  it("holds the seeded sponsorship that sits exactly on the ceiling", () => {
    const rows = readSponsorRegister(treasurerJsoa, "JSOA", repo());
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
  it("separates advertising value from acknowledgment value", () => {
    const rows = readSponsorRegister(treasurerJsof, "JSOF", repo());
    const carraway = rows.find((r) => r.sponsorName === "Carraway Diesel & Fleet");
    if (!carraway) throw new Error("unreachable");
    expect(carraway.categories.advertisingCents).toBe(25_000);
    expect(carraway.categories.acknowledgmentCents).toBe(20_000);
    expect(carraway.categories.advertisingPlacements).toContain("Programme advert");
  });

  it("tags a tee sign as an acknowledgment and a programme page as advertising", () => {
    const rows = readSponsorRegister(treasurerJsof, "JSOF", repo());
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

  it("saves flagged wording anyway, and hands back the warnings", () => {
    const r = repo();
    const result = saveAcknowledgmentString(
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

  it("flags the seeded sponsor-supplied copy that has not been cleaned up", () => {
    const rows = readSponsorRegister(treasurerJsof, "JSOF", repo());
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

  it("sends changed wording back through the release gate", () => {
    const r = repo();
    const before = r.getSponsorship("s-jsof-001");
    expect(before?.placements[0].publicationState).toBe("APPROVED");
    const result = saveAcknowledgmentString(
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
  it("refuses the Fundraising Chair the money view", () => {
    // AGGREGATE on FINANCIAL, not READ. The Chair does not see payments row
    // by row, which is the point of the two-view split.
    expect(() => readSponsorRegister(fundraisingChairJsof, "JSOF", repo())).toThrow(
      AuthzError,
    );
  });

  it("gives the Fundraising Chair the wording view", () => {
    const rows = readSponsorAcknowledgments(fundraisingChairJsof, "JSOF", repo());
    expect(rows.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(rows);
    // The wording view still carries the placement records, so assert what it
    // is used for rather than pretending the object is stripped: no payment
    // figure is present on any row.
    expect(serialised).not.toContain("paymentCents");
    expect(serialised).not.toContain("assessment");
  });

  it("refuses the Scholarships Chair the money view", () => {
    // NONE on FINANCIAL, so no view of the payments. The Chair does hold WRITE
    // on PUBLIC_CONTENT, so the wording view opens; that is the intended shape.
    expect(() => readSponsorRegister(scholarshipsChairJsof, "JSOF", repo())).toThrow(
      AuthzError,
    );
    expect(
      readSponsorAcknowledgments(scholarshipsChairJsof, "JSOF", repo()).length,
    ).toBeGreaterThan(0);
  });

  it("refuses a Treasurer of the other entity", () => {
    expect(() => readSponsorRegister(treasurerJsoa, "JSOF", repo())).toThrow(AuthzError);
    expect(() => readSponsorRegister(treasurerJsof, "JSOA", repo())).toThrow(AuthzError);
  });

  it("refuses an unauthenticated subject", () => {
    expect(() => readSponsorRegister(nobody, "JSOF", repo())).toThrow(AuthzError);
  });

  it("refuses a subject whose MFA has not been satisfied, whatever the role", () => {
    const unverified = subject(
      "p-treas-jsof",
      [{ role: "TREASURER", entity: "JSOF" }],
      false,
    );
    expect(() => readSponsorRegister(unverified, "JSOF", repo())).toThrow(AuthzError);
  });

  it("allows the Treasurer of the right entity", () => {
    const rows = readSponsorRegister(treasurerJsof, "JSOF", repo());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.entity === "JSOF")).toBe(true);
  });
});

describe("wrong-role requests to the rest of the module", () => {
  it("refuses the gift register to a role holding only aggregate", () => {
    expect(() => readDonationRegister(fundraisingChairJsof, "JSOF", repo())).toThrow(
      AuthzError,
    );
    expect(() => readDonationRegister(secretaryJsof, "JSOF", repo())).toThrow(AuthzError);
  });

  it("refuses the fund register but allows fund totals to the Secretary", () => {
    expect(() => readFundRegister(secretaryJsof, "JSOF", repo())).toThrow(AuthzError);
    const totals = readFundAggregates(secretaryJsof, "JSOF", repo());
    expect(totals.length).toBeGreaterThan(0);
    // Aggregate means counts and totals, and that is all that comes back.
    for (const row of totals) {
      expect(Object.keys(row).sort()).toEqual(
        ["balanceCents", "entity", "fundId", "giftCount", "name", "restriction"].sort(),
      );
    }
  });

  it("refuses a write to the ledger from a role that only reads it", () => {
    const president = subject("p-pres", [{ role: "PRESIDENT", entity: "JSOF" }]);
    expect(() =>
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
    ).toThrow(AuthzError);
  });

  it("refuses a receipt to a role with no financial read", () => {
    expect(() =>
      issueReceipt(scholarshipsChairJsof, "JSOF", "d-jsof-001", repo(), { sequence: 1 }),
    ).toThrow(AuthzError);
  });

  it("refuses the acknowledgment write to a role with no public-content write", () => {
    expect(() =>
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
    ).toThrow(AuthzError);
  });
});

/* ================================================================== *
 * 11. Funds, balances and the gifts behind them
 * ================================================================== */

describe("fund register", () => {
  it("keeps restricted and unrestricted apart and per entity", () => {
    const rows = readFundRegister(treasurerJsof, "JSOF", repo());
    expect(rows.every((r) => r.balance.entity === "JSOF")).toBe(true);
    expect(rows.some((r) => r.balance.restriction === "RESTRICTED")).toBe(true);
    expect(rows.some((r) => r.balance.restriction === "UNRESTRICTED")).toBe(true);
  });

  it("counts cleared gifts only, so an unpaid gift is not a balance", () => {
    const rows = readFundRegister(treasurerJsof, "JSOF", repo());
    const family = rows.find((r) => r.balance.name === "Family Support Fund");
    if (!family) throw new Error("unreachable");
    // d-jsof-005 is AWAITING_PAYMENT against this fund.
    expect(family.balance.balanceCents).toBe(0);
    expect(family.gifts.some((g) => g.status === "AWAITING_PAYMENT")).toBe(true);
  });

  it("shows the gifts behind a balance and they add up to it", () => {
    const rows = readFundRegister(treasurerJsof, "JSOF", repo());
    const golf = rows.find((r) => r.balance.name === "Golf Tournament Fund");
    if (!golf) throw new Error("unreachable");
    const paid = golf.gifts
      .filter((g) => g.status === "PAID")
      .reduce((t, g) => t + g.amountCents, 0);
    expect(paid).toBe(golf.balance.balanceCents);
    expect(golf.balance.balanceCents).toBe(1_400_000);
  });

  it("never sums the two entities into one figure", () => {
    const jsof = readFundAggregates(treasurerJsof, "JSOF", repo());
    const jsoa = readFundAggregates(treasurerJsoa, "JSOA", repo());
    expect(jsof.every((r) => r.entity === "JSOF")).toBe(true);
    expect(jsoa.every((r) => r.entity === "JSOA")).toBe(true);
    expect(jsof.map((r) => r.fundId)).not.toContain("fund-jsoa-operating");
  });

  it("records a cleared gift and moves the balance", () => {
    const r = repo();
    const before = readFundAggregates(treasurerJsof, "JSOF", r).find(
      (b) => b.fundId === "fund-jsof-general",
    );
    if (!before) throw new Error("unreachable");
    recordClearedDonation(
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
    const after = readFundAggregates(treasurerJsof, "JSOF", r).find(
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

  it("holds no non-integer amount anywhere in the seed", () => {
    const r = repo();
    for (const entity of ["JSOA", "JSOF"] as Entity[]) {
      for (const d of r.listDonations(entity)) {
        expect(Number.isSafeInteger(d.amountCents)).toBe(true);
        for (const a of d.allocations) {
          expect(Number.isSafeInteger(a.amountCents)).toBe(true);
        }
        if (d.benefitFairMarketValueCents !== null) {
          expect(Number.isSafeInteger(d.benefitFairMarketValueCents)).toBe(true);
        }
      }
      for (const s of r.listSponsorships(entity)) {
        expect(Number.isSafeInteger(s.paymentCents)).toBe(true);
        for (const p of s.placements) {
          expect(Number.isSafeInteger(p.benefitFairMarketValueCents)).toBe(true);
        }
      }
    }
  });

  it("keeps every seeded gift's allocations summing exactly", () => {
    const r = repo();
    for (const entity of ["JSOA", "JSOF"] as Entity[]) {
      for (const d of r.listDonations(entity)) {
        const result = checkAllocations(entity, d.amountCents, d.allocations, r);
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
  it("never carries a fee contingent on attendance or impressions", () => {
    const r = repo();
    for (const entity of ["JSOA", "JSOF"] as Entity[]) {
      for (const s of r.listSponsorships(entity)) {
        expect(s.contingentOnAttendanceOrImpressions).toBe(false);
      }
    }
  });

  it("records exclusive sponsor and has no exclusive-provider value", () => {
    const r = repo();
    const values = (["JSOA", "JSOF"] as Entity[]).flatMap((e) =>
      r.listSponsorships(e).map((s) => s.exclusivity),
    );
    expect(values).toContain("EXCLUSIVE_SPONSOR");
    expect(values.every((v) => v === "NONE" || v === "EXCLUSIVE_SPONSOR")).toBe(true);
  });

  it("carries an approved wording and a valuation on every placement", () => {
    const r = repo();
    for (const entity of ["JSOA", "JSOF"] as Entity[]) {
      for (const s of r.listSponsorships(entity)) {
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
  it("derives the task list from state, so an empty register yields no tasks", () => {
    const empty = new InMemoryDonationsRepository(TEST_FUNDS, [], []);
    const { tasks } = fundraisingTasks(treasurerJsof, empty);
    expect(tasks).toEqual([]);
  });

  it("fills itself from the seeded register without anything being entered", () => {
    const { tasks } = fundraisingTasks(treasurerJsof, repo());
    expect(tasks.length).toBeGreaterThan(0);
    // The gift carrying unvalued benefits is the one a donor is waiting on.
    expect(tasks.some((task) => task.key === "JSOF-value-benefits")).toBe(true);
    expect(tasks.some((task) => task.key === "JSOF-safe-harbour-review")).toBe(true);
  });

  it("gives every task a reason that says what it blocks, and an urgency", () => {
    const { tasks } = fundraisingTasks(treasurerJsof, repo());
    for (const task of tasks) {
      expect(task.because.length).toBeGreaterThan(20);
      expect(["overdue", "soon", "open"]).toContain(task.urgency);
      expect(task.href.startsWith("/board/donations")).toBe(true);
      expect(task.entity).toBe("JSOF");
    }
  });

  it("withholds rather than denying for a role holding one scope and not the other", () => {
    const { tasks, withheld } = fundraisingTasks(fundraisingChairJsof, repo());
    // The Chair holds PUBLIC_CONTENT at WRITE, so the wording work is theirs.
    expect(tasks.some((task) => task.key === "JSOF-rewrite-wording")).toBe(true);
    // And holds FINANCIAL only at AGGREGATE, so the gift-by-gift work is not.
    expect(tasks.some((task) => task.key === "JSOF-value-benefits")).toBe(false);
    expect(withheld.join(" ")).toContain("Gifts that cannot be receipted");
  });

  it("gives a role with no scope on either entity no tasks and no counts", () => {
    const vpMembership = subject("p-vpm", [{ role: "VP_MEMBERSHIP", entity: "JSOA" }]);
    const { tasks, withheld } = fundraisingTasks(vpMembership, repo());
    expect(tasks).toEqual([]);
    expect(withheld.length).toBeGreaterThan(0);
    // Nothing about the size of what is behind the wall.
    expect(withheld.join(" ")).not.toMatch(/\d/);
  });

  it("gives an unassigned subject nothing at all", () => {
    const { tasks, withheld } = fundraisingTasks(nobody, repo());
    expect(tasks).toEqual([]);
    expect(withheld.join(" ")).toContain("no assignment on either entity");
  });
});

describe("workspace: three headline figures", () => {
  it("promotes exactly three, and the same three for every reader", () => {
    const board = readDonationsDashboard(treasurerJsof, "JSOF", repo());
    const { headline, more } = splitKpis(board.kpis);
    expect(headline.map((kpi) => kpi.key)).toEqual([...HEADLINE_KPI_KEYS]);
    expect(headline.length).toBe(3);
    expect(more.length).toBe(board.kpis.length - 3);
    // The per-entity pair is one idea rendered twice and is never a headline.
    expect(headline.some((kpi) => kpi.key === "giving-by-entity")).toBe(false);
    expect(more.some((kpi) => kpi.key === "giving-by-entity")).toBe(true);
  });

  it("keeps a headline the reader may not see as a headline, withheld rather than swapped", () => {
    const board = readDonationsDashboard(fundraisingChairJsof, "JSOF", repo());
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
  it("derives pledge, renewal and event dates for a reader who holds the rows", () => {
    const { items } = fundraisingCalendar(treasurerJsof, repo());
    const kinds = items.map((item) => item.kind);
    expect(kinds).toContain("CYCLE");
    expect(kinds).toContain("RENEWAL");
    expect(kinds).toContain("EVENT");
    for (const item of items) {
      expect(item.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.entity).toBe("JSOF");
    }
  });

  it("marks an inferred renewal and an unrecorded event date as unverified", () => {
    const { items, gaps } = fundraisingCalendar(treasurerJsof, repo());
    for (const item of items.filter((i) => i.kind === "RENEWAL" || i.kind === "EVENT")) {
      expect(item.unverified).toBe(true);
    }
    // A pledge date is recorded, so it is not a guess.
    for (const item of items.filter((i) => i.kind === "CYCLE")) {
      expect(item.unverified).toBeUndefined();
    }
    expect(gaps.join(" ")).toContain("no recorded date");
  });

  it("withholds the whole calendar from a role holding financial only at aggregate", () => {
    const { items, withheld } = fundraisingCalendar(fundraisingChairJsof, repo());
    expect(items).toEqual([]);
    expect(withheld.join(" ")).toContain("aggregate");
  });

  it("refuses the sponsorship dates read to a role without row-level financial", () => {
    expect(() => readSponsorshipDates(fundraisingChairJsof, "JSOF", repo())).toThrow(
      AuthzError,
    );
    expect(() => readSponsorshipDates(nobody, "JSOF", repo())).toThrow(AuthzError);
  });

  it("never carries a date from one entity onto the other", () => {
    const { items } = fundraisingCalendar(treasurerJsoa, repo());
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
  it("keeps the two audiences separate and never merges them", () => {
    const { surface } = fundraisingOutside(fundraisingChairJsof, repo());
    expect(surface.noExternalSurface).toBe(false);
    const audiences = new Set(surface.items.map((item) => item.audience));
    expect(audiences.has("PUBLIC")).toBe(true);
    expect(audiences.has("MEMBER_OR_DONOR")).toBe(true);
  });

  it("sorts a flagged string that is also approved above a flagged draft", () => {
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

    const { surface, counts } = fundraisingOutside(fundraisingChairJsof, loud);
    expect(counts.flagged).toBe(2);
    expect(counts.flaggedApproved).toBe(1);
    const publicItems = surface.items.filter((item) => item.audience === "PUBLIC");
    expect(publicItems[0].key).toBe("wording-pl-approved");
    expect(publicItems[0].note).toContain("Approved, so this publishes as written");
    expect(publicItems[0].note).toContain("taxable advertising");
    expect(publicItems[1].key).toBe("wording-pl-draft");
    expect(publicItems[1].note).toContain("cannot publish yet");
  });

  it("puts the flagged wording above the unproblematic pages either way", () => {
    const { surface } = fundraisingOutside(fundraisingChairJsof, repo());
    const publicItems = surface.items.filter((item) => item.audience === "PUBLIC");
    expect(publicItems.findIndex((item) => item.key.startsWith("wording-"))).toBe(0);
    expect(publicItems[0].note).toContain("taxable advertising");
  });

  it("flags that the Foundation has no public contact path", () => {
    const { surface } = fundraisingOutside(fundraisingChairJsof, repo());
    const contact = surface.items.find((item) => item.key === "foundation-contact")!;
    expect(contact.audience).toBe("PUBLIC");
    expect(contact.problem).toBe("MISSING_OWNER");
    expect(contact.note).toContain("no named");
  });

  it("withholds the published wording from a role with no content read", () => {
    const { surface, withheld, counts } = fundraisingOutside(treasurerJsof, repo());
    expect(counts.flagged).toBe(0);
    expect(surface.items.some((item) => item.key.startsWith("wording-"))).toBe(false);
    expect(withheld.join(" ")).toContain("published content");
    // The Treasurer still sees the donor side of their own entity's gifts.
    expect(surface.items.some((item) => item.key === "donor-no-receipt-JSOF")).toBe(true);
  });

  it("withholds the count of donors waiting on a receipt from an aggregate-only role", () => {
    const { surface, withheld } = fundraisingOutside(fundraisingChairJsof, repo());
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
