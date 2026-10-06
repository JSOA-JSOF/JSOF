/**
 * Store module tests.
 *
 * These are written as requirements, not as coverage. The first three groups
 * are the compliance controls: a member-restricted product must be absent from
 * a public response rather than hidden in it, the member or non-member snapshot
 * on an order must not move when the buyer's membership does, and every order
 * must carry a computed sales tax figure. The rest are the separation-of-duties
 * refusals and the print-on-demand case.
 */

import { describe, expect, it } from "vitest";

import {
  AuthzError,
  separationOfDutiesFindings,
  type Subject,
} from "../src/lib/authz/policy";
import { next, type MembershipState } from "../src/lib/membership/state";
import {
  boardApproveRefund,
  boardInventory,
  boardOrderRows,
  boardReceiptsCsv,
  boardReceiptsReport,
  boardRecordPhysicalCount,
  boardRefunds,
  boardTaxPeriods,
  storeChairPersonIdFor,
} from "../src/lib/store/board";
import { parseCartParam, totalCart } from "../src/lib/store/cart";
import {
  CatalogueError,
  findProductForViewer,
  memberCatalogue,
  publicCatalogue,
  toPublicProduct,
  viewerHasMemberAccess,
  type CatalogueViewer,
} from "../src/lib/store/catalogue";
import { buildPhysicalCount, inventoryRows } from "../src/lib/store/inventory";
import { placeOrder, snapshotBuyerType } from "../src/lib/store/orders";
import {
  approveRefund,
  buildRefundRequest,
  REFUND_SECOND_APPROVER_THRESHOLD_CENTS,
  refundRequiresSecondApprover,
} from "../src/lib/store/refunds";
import { freshStoreRepository } from "../src/lib/store/repository";
import { receiptsReport, receiptsReportCsv, yearPeriod } from "../src/lib/store/reports";
import {
  MEMBER_RESTRICTED_SKUS,
  SEED_MOVEMENTS,
  SEED_ORDERS,
  SEED_PRODUCTS,
  SNAPSHOT_FIXTURE_ORDER_ID,
  STORE_CHAIR_PERSON_ID,
} from "../src/lib/store/seed";
import {
  annualFundraisingExemptionApplies,
  combinedBasisPoints,
  jurisdictionByCode,
  resolveJurisdiction,
  taxOn,
} from "../src/lib/store/tax";
import { STORE_ENTITY, type Order, type Product } from "../src/lib/store/types";

const VISITOR: CatalogueViewer = { kind: "visitor" };

const GOOD_STANDING: CatalogueViewer = {
  kind: "member",
  personId: "p-mem-1",
  memberId: "JSOA-2019-0114",
  membershipState: "GOOD_STANDING",
};

const PROBATIONARY: CatalogueViewer = {
  kind: "member",
  personId: "p-mem-2",
  memberId: "JSOA-2026-0031",
  membershipState: "PROBATIONARY",
};

const LAPSED: CatalogueViewer = {
  kind: "member",
  personId: "p-mem-3",
  memberId: "JSOA-2015-0088",
  membershipState: "LAPSED",
};

/**
 * Subjects, built here rather than taken from the shared dev persona list.
 * Two of these do not exist as personas and have to: a Store Chair who is not
 * also the Treasurer, which is what proves the AGGREGATE grant bites, and a
 * subject who has not satisfied MFA.
 */
function subject(
  personId: string,
  assignments: Subject["assignments"],
  mfaSatisfied = true,
): Subject {
  return { personId, assignments, mfaSatisfied };
}

const TREASURER = subject("p-ferris", [{ role: "TREASURER", entity: "JSOA" }]);
const TREASURER_AND_STORE_CHAIR = subject("p-hollis", [
  { role: "TREASURER", entity: "JSOA" },
  { role: "STORE_CHAIR", entity: "JSOA" },
]);
const STORE_CHAIR_ONLY = subject("p-yates", [{ role: "STORE_CHAIR", entity: "JSOA" }]);
const PRESIDENT = subject("p-marchetti", [{ role: "PRESIDENT", entity: "JSOA" }]);
const VP_MEMBERSHIP = subject("p-quill", [{ role: "VP_MEMBERSHIP", entity: "JSOA" }]);
const FINANCE_REVIEW = subject("p-langley", [
  { role: "FINANCE_REVIEW_OFFICER", entity: "JSOA" },
]);
const NO_MFA = subject("p-ferris", [{ role: "TREASURER", entity: "JSOA" }], false);

const MEMBER_ONLY_SKU = "JSOA-COIN-FOUNDERS";
const PUBLIC_SKU = "JSOA-COIN-STD";
const POD_SKU = "JSOA-PRINT-MEMORIAL";

/* ================================================================== *
 * 1. A member-restricted product is absent from the public tier
 * ================================================================== */

describe("a non-member cannot see or fetch a member-restricted product", () => {
  const products = SEED_PRODUCTS;

  it("has member-restricted products in the seed, so the test means something", () => {
    expect(MEMBER_RESTRICTED_SKUS.length).toBeGreaterThan(0);
    expect(MEMBER_RESTRICTED_SKUS).toContain(MEMBER_ONLY_SKU);
  });

  it("omits every member-restricted SKU from the public catalogue", () => {
    const skus = publicCatalogue(products).items.map((i) => i.sku);
    for (const restricted of MEMBER_RESTRICTED_SKUS) {
      expect(skus).not.toContain(restricted);
    }
  });

  it("leaves no trace of a restricted product anywhere in the public response", () => {
    // The real requirement is absence, not redaction. A greyed-out row, a null
    // placeholder, a "members only" label or a count of hidden items would each
    // tell a visitor what the members have, so the serialised response is
    // searched for every restricted SKU, name and collection name.
    const serialised = JSON.stringify(publicCatalogue(products));
    for (const product of products.filter((p) => !p.publiclyPurchasable)) {
      expect(serialised).not.toContain(product.sku);
      expect(serialised).not.toContain(product.name);
      if (product.collection) expect(serialised).not.toContain(product.collection);
    }
    expect(serialised).not.toMatch(/members only/i);
    expect(serialised).not.toMatch(/hidden/i);
    expect(serialised).not.toMatch(/restricted/i);
  });

  it("carries no count that would reveal how many items are withheld", () => {
    const response = publicCatalogue(products);
    expect(Object.keys(response)).toEqual(["items"]);
    expect(response.items.length).toBe(products.filter((p) => p.publiclyPurchasable && p.active).length);
  });

  it("refuses to project a restricted product to the public tier at all", () => {
    const restricted = products.find((p) => p.sku === MEMBER_ONLY_SKU) as Product;
    expect(() => toPublicProduct(restricted)).toThrow(CatalogueError);
  });

  it("answers a direct fetch by a visitor with NOT_FOUND, not FORBIDDEN", () => {
    // A 403 on a specific SKU confirms the SKU exists, which is the same
    // disclosure the listing is careful to avoid.
    try {
      findProductForViewer(products, MEMBER_ONLY_SKU, VISITOR);
      throw new Error("expected the fetch to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogueError);
      expect((error as CatalogueError).code).toBe("NOT_FOUND");
    }
  });

  it("gives the same refusal for a restricted SKU and a SKU that does not exist", () => {
    const restricted = (() => {
      try {
        findProductForViewer(products, MEMBER_ONLY_SKU, VISITOR);
      } catch (error) {
        return (error as CatalogueError).message;
      }
      return "";
    })();
    const missing = (() => {
      try {
        findProductForViewer(products, "JSOA-DOES-NOT-EXIST", VISITOR);
      } catch (error) {
        return (error as CatalogueError).message;
      }
      return "";
    })();
    expect(restricted).toBe(`No product ${MEMBER_ONLY_SKU}`);
    expect(missing).toBe("No product JSOA-DOES-NOT-EXIST");
  });

  it("refuses a lapsed member too, and an applicant who has not paid", () => {
    for (const viewer of [LAPSED, { ...PROBATIONARY, membershipState: "AWAITING_PAYMENT" as MembershipState }]) {
      expect(() => findProductForViewer(products, MEMBER_ONLY_SKU, viewer)).toThrow(CatalogueError);
    }
  });

  it("drops a restricted SKU hand-typed into the cart by a visitor", () => {
    const items = parseCartParam(`${MEMBER_ONLY_SKU}:1,${PUBLIC_SKU}:1`);
    const totals = totalCart(items, products, VISITOR);
    expect(totals.lines.map((l) => l.sku)).toEqual([PUBLIC_SKU]);
  });

  it("will not let a visitor place an order for a restricted SKU", () => {
    expect(() =>
      placeOrder({
        id: "SO-TEST-1",
        items: parseCartParam(`${MEMBER_ONLY_SKU}:1`),
        products,
        viewer: VISITOR,
        placedAt: "2026-09-30T12:00:00.000Z",
      }),
    ).toThrow(/None of the items in the cart can be bought/);
  });

  it("shows it to a member, which is what makes the absence a gate and not a bug", () => {
    expect(findProductForViewer(products, MEMBER_ONLY_SKU, GOOD_STANDING).sku).toBe(
      MEMBER_ONLY_SKU,
    );
    expect(memberCatalogue(products).items.map((p) => p.sku)).toContain(MEMBER_ONLY_SKU);
  });

  it("grants identical access in probationary and good standing", () => {
    expect(viewerHasMemberAccess(PROBATIONARY)).toBe(true);
    expect(viewerHasMemberAccess(GOOD_STANDING)).toBe(true);
    expect(viewerHasMemberAccess(LAPSED)).toBe(false);
    expect(viewerHasMemberAccess(VISITOR)).toBe(false);
  });

  it("puts seasonal collections on the member catalogue only", () => {
    const collections = memberCatalogue(SEED_PRODUCTS).collections;
    expect(collections.length).toBeGreaterThan(0);
    const publicText = JSON.stringify(publicCatalogue(SEED_PRODUCTS));
    for (const collection of collections) {
      expect(publicText).not.toContain(collection.name);
    }
  });
});

/* ================================================================== *
 * 2. The snapshot does not move
 * ================================================================== */

describe("the member or non-member snapshot on an order does not follow the membership", () => {
  it("records the buyer type at the time of sale", () => {
    const order = placeOrder({
      id: "SO-TEST-2",
      items: parseCartParam(`${PUBLIC_SKU}:1`),
      products: SEED_PRODUCTS,
      viewer: GOOD_STANDING,
      placedAt: "2026-01-15T12:00:00.000Z",
    });
    expect(order.buyerTypeAtSale).toBe("MEMBER");
    expect(order.membershipStateAtSale).toBe("GOOD_STANDING");
    expect(order.memberIdAtSale).toBe("JSOA-2019-0114");
  });

  it("does not change when the buyer's membership lapses afterwards", () => {
    const repo = freshStoreRepository();
    const order = placeOrder({
      id: "SO-TEST-3",
      items: parseCartParam(`${PUBLIC_SKU}:2`),
      products: repo.listProducts(STORE_ENTITY),
      viewer: GOOD_STANDING,
      placedAt: "2026-01-15T12:00:00.000Z",
    });
    repo.saveOrder(order);

    // The membership moves on. Revocation for cause, then a lapse: whichever
    // way it goes, this buyer no longer has member access.
    let state: MembershipState = "GOOD_STANDING";
    state = next(state, { type: "REVOKED_FOR_CAUSE", boardMinuteRef: "JSOA-2026-11-min-3" });
    expect(state).toBe("REVOKED");
    expect(viewerHasMemberAccess({ ...GOOD_STANDING, membershipState: state })).toBe(false);

    const reread = repo.findOrder("SO-TEST-3") as Order;
    expect(reread.buyerTypeAtSale).toBe("MEMBER");
    expect(reread.membershipStateAtSale).toBe("GOOD_STANDING");
    expect(reread.memberIdAtSale).toBe("JSOA-2019-0114");

    // And the receipts split still counts it on the member side.
    const report = receiptsReport(
      [{ ...reread, status: "PAID" }],
      yearPeriod(2026),
    );
    expect(report.rows.find((r) => r.buyerType === "MEMBER")?.orderCount).toBe(1);
    expect(report.rows.find((r) => r.buyerType === "NON_MEMBER")?.orderCount).toBe(0);
  });

  it("holds the seeded fixture order on the member side whatever happens later", () => {
    const repo = freshStoreRepository();
    const before = repo.findOrder(SNAPSHOT_FIXTURE_ORDER_ID) as Order;
    expect(before.buyerTypeAtSale).toBe("MEMBER");

    // Same buyer places a later order after lapsing. The new order is a
    // non-member sale; the old one is untouched.
    const later = placeOrder({
      id: "SO-TEST-4",
      items: parseCartParam(`${PUBLIC_SKU}:1`),
      products: repo.listProducts(STORE_ENTITY),
      viewer: { ...GOOD_STANDING, membershipState: "LAPSED" },
      placedAt: "2026-12-01T12:00:00.000Z",
    });
    repo.saveOrder(later);

    expect(later.buyerTypeAtSale).toBe("NON_MEMBER");
    expect(later.memberIdAtSale).toBeNull();
    expect((repo.findOrder(SNAPSHOT_FIXTURE_ORDER_ID) as Order).buyerTypeAtSale).toBe("MEMBER");
  });

  it("treats a probationary buyer as a member and an unpaid applicant as not", () => {
    expect(snapshotBuyerType("PROBATIONARY")).toBe("MEMBER");
    expect(snapshotBuyerType("GOOD_STANDING")).toBe("MEMBER");
    expect(snapshotBuyerType("AWAITING_PAYMENT")).toBe("NON_MEMBER");
    expect(snapshotBuyerType("LAPSED")).toBe("NON_MEMBER");
    expect(snapshotBuyerType("REVOKED")).toBe("NON_MEMBER");
    expect(snapshotBuyerType(null)).toBe("NON_MEMBER");
  });

  it("records a member ID only when the buyer was a member", () => {
    const order = placeOrder({
      id: "SO-TEST-5",
      items: parseCartParam(`${PUBLIC_SKU}:1`),
      products: SEED_PRODUCTS,
      viewer: LAPSED,
      placedAt: "2026-09-30T12:00:00.000Z",
    });
    expect(order.buyerTypeAtSale).toBe("NON_MEMBER");
    expect(order.memberIdAtSale).toBeNull();
    expect(order.membershipStateAtSale).toBe("LAPSED");
  });
});

/* ================================================================== *
 * 3. Sales tax on every order
 * ================================================================== */

describe("sales tax is computed and recorded on every order", () => {
  it("does not rely on a fundraising exemption, because none applies", () => {
    expect(annualFundraisingExemptionApplies()).toBe(false);
  });

  it("charges the combined state and county rate on the taxable base", () => {
    const order = placeOrder({
      id: "SO-TEST-6",
      items: parseCartParam(`${PUBLIC_SKU}:4`),
      products: SEED_PRODUCTS,
      viewer: VISITOR,
      shipTo: { state: "NC", county: "Cumberland", postalCode: "28307" },
      placedAt: "2026-09-30T12:00:00.000Z",
    });
    const rate = combinedBasisPoints(jurisdictionByCode("NC-CUMBERLAND"));
    expect(rate).toBe(700);
    expect(order.taxRateBasisPoints).toBe(rate);
    expect(order.taxableBaseCents).toBe(order.subtotalCents + order.shippingCents);
    expect(order.taxCents).toBe(taxOn(order.taxableBaseCents, rate));
    expect(order.taxCents).toBeGreaterThan(0);
    expect(order.totalCents).toBe(order.subtotalCents + order.shippingCents + order.taxCents);
  });

  it("follows the destination county, not the seller's", () => {
    expect(resolveJurisdiction({ state: "NC", county: "Wake", postalCode: "27601" }).code).toBe(
      "NC-WAKE",
    );
    expect(
      combinedBasisPoints(resolveJurisdiction({ state: "NC", county: "Mecklenburg", postalCode: "28202" })),
    ).toBe(750);
  });

  it("includes the delivery charge in the taxable base of a taxable order", () => {
    const shipped = placeOrder({
      id: "SO-TEST-7",
      items: parseCartParam(`${PUBLIC_SKU}:1`),
      products: SEED_PRODUCTS,
      viewer: VISITOR,
      shipTo: { state: "NC", county: "Wake", postalCode: "27601" },
      placedAt: "2026-09-30T12:00:00.000Z",
    });
    expect(shipped.shippingCents).toBeGreaterThan(0);
    expect(shipped.taxableBaseCents).toBe(shipped.subtotalCents + shipped.shippingCents);
  });

  it("records a rate and a jurisdiction even when the rate is zero", () => {
    const outOfState = placeOrder({
      id: "SO-TEST-8",
      items: parseCartParam(`${PUBLIC_SKU}:1`),
      products: SEED_PRODUCTS,
      viewer: VISITOR,
      shipTo: { state: "SC", county: "Richland", postalCode: "29201" },
      placedAt: "2026-09-30T12:00:00.000Z",
    });
    expect(outOfState.taxCents).toBe(0);
    expect(outOfState.taxRateBasisPoints).toBe(0);
    // The reason is on the record rather than being an unexplained zero.
    expect(outOfState.taxJurisdictionCode).toBe("OUT-OF-STATE-NOT-REGISTERED");
  });

  it("does not tax a line that is outside the tax base", () => {
    const giftOnly = placeOrder({
      id: "SO-TEST-9",
      items: parseCartParam("JSOA-GIFT-50:1"),
      products: SEED_PRODUCTS,
      viewer: VISITOR,
      placedAt: "2026-09-30T12:00:00.000Z",
    });
    expect(giftOnly.taxableBaseCents).toBe(0);
    expect(giftOnly.taxCents).toBe(0);

    const mixed = placeOrder({
      id: "SO-TEST-10",
      items: parseCartParam(`JSOA-GIFT-50:1,${PUBLIC_SKU}:1`),
      products: SEED_PRODUCTS,
      viewer: VISITOR,
      placedAt: "2026-09-30T12:00:00.000Z",
    });
    expect(mixed.taxableBaseCents).toBeLessThan(mixed.subtotalCents + mixed.shippingCents);
    expect(mixed.taxCents).toBe(taxOn(mixed.taxableBaseCents, mixed.taxRateBasisPoints));
  });

  it("holds integer cents everywhere, never a float", () => {
    const order = placeOrder({
      id: "SO-TEST-11",
      items: parseCartParam(`${PUBLIC_SKU}:3,JSOA-PATCH-CREST:2`),
      products: SEED_PRODUCTS,
      viewer: VISITOR,
      placedAt: "2026-09-30T12:00:00.000Z",
    });
    for (const value of [
      order.subtotalCents,
      order.shippingCents,
      order.taxableBaseCents,
      order.taxCents,
      order.totalCents,
      order.taxRateBasisPoints,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("records a tax figure on every seeded order, and an entity on every one", () => {
    for (const order of SEED_ORDERS) {
      expect(order.entity).toBe(STORE_ENTITY);
      expect(Number.isInteger(order.taxCents)).toBe(true);
      expect(order.taxCents).toBe(taxOn(order.taxableBaseCents, order.taxRateBasisPoints));
      expect(order.taxJurisdictionCode.length).toBeGreaterThan(0);
      expect(order.totalCents).toBe(
        order.subtotalCents + order.shippingCents + order.taxCents,
      );
    }
  });

  it("reports tax collected per period without folding it into receipts", () => {
    const rows = boardTaxPeriods(TREASURER);
    expect(rows.length).toBeGreaterThan(0);
    const report = boardReceiptsReport(TREASURER, yearPeriod(2026));
    const periodTax = rows.reduce((s, r) => s + r.salesTaxCollectedCents, 0);
    expect(periodTax).toBe(report.totalSalesTaxCollectedCents);
    // Gross receipts exclude the tax: it is the state's money, not a receipt.
    const grossPlusTax = report.totalGrossReceiptsCents + report.totalSalesTaxCollectedCents;
    expect(grossPlusTax).toBeGreaterThan(report.totalGrossReceiptsCents);
  });
});

/* ================================================================== *
 * 4. The receipts report splits correctly
 * ================================================================== */

describe("the receipts report splits by buyer type", () => {
  const period = yearPeriod(2026);

  it("always reports both rows, even at zero", () => {
    const empty = receiptsReport([], period);
    expect(empty.rows.map((r) => r.buyerType)).toEqual(["MEMBER", "NON_MEMBER"]);
    expect(empty.totalGrossReceiptsCents).toBe(0);
    expect(empty.nonMemberShareBasisPoints).toBe(0);
  });

  it("puts each order on the side its snapshot says", () => {
    const report = receiptsReport(SEED_ORDERS, period);
    const member = report.rows.find((r) => r.buyerType === "MEMBER");
    const nonMember = report.rows.find((r) => r.buyerType === "NON_MEMBER");
    const receipted = SEED_ORDERS.filter((o) => o.status !== "AWAITING_PAYMENT" && o.status !== "CANCELLED");

    expect(member?.orderCount).toBe(
      receipted.filter((o) => o.buyerTypeAtSale === "MEMBER").length,
    );
    expect(nonMember?.orderCount).toBe(
      receipted.filter((o) => o.buyerTypeAtSale === "NON_MEMBER").length,
    );
    expect((member?.orderCount ?? 0) + (nonMember?.orderCount ?? 0)).toBe(receipted.length);
  });

  it("sums the two sides to the total, with nothing lost or double counted", () => {
    const report = receiptsReport(SEED_ORDERS, period);
    expect(report.rows.reduce((s, r) => s + r.grossReceiptsCents, 0)).toBe(
      report.totalGrossReceiptsCents,
    );
    expect(report.rows.reduce((s, r) => s + r.salesTaxCollectedCents, 0)).toBe(
      report.totalSalesTaxCollectedCents,
    );
  });

  it("leaves an unpaid order out of receipts entirely", () => {
    const awaiting = SEED_ORDERS.filter((o) => o.status === "AWAITING_PAYMENT");
    expect(awaiting.length).toBeGreaterThan(0);
    const report = receiptsReport(SEED_ORDERS, period);
    const counted = report.rows.reduce((s, r) => s + r.orderCount, 0);
    expect(counted).toBe(SEED_ORDERS.length - awaiting.length);
  });

  it("moves an order between sides when the snapshot differs, and only then", () => {
    const base = SEED_ORDERS[0];
    const asMember = receiptsReport([{ ...base, buyerTypeAtSale: "MEMBER" }], period);
    const asNonMember = receiptsReport([{ ...base, buyerTypeAtSale: "NON_MEMBER" }], period);
    expect(asMember.rows.find((r) => r.buyerType === "MEMBER")?.orderCount).toBe(1);
    expect(asNonMember.rows.find((r) => r.buyerType === "NON_MEMBER")?.orderCount).toBe(1);
    expect(asMember.totalGrossReceiptsCents).toBe(asNonMember.totalGrossReceiptsCents);
  });

  it("computes the non-member share of gross receipts", () => {
    const report = receiptsReport(
      [
        { ...SEED_ORDERS[0], buyerTypeAtSale: "MEMBER", subtotalCents: 7_500, shippingCents: 0, status: "PAID", refundedCents: 0 },
        { ...SEED_ORDERS[1], buyerTypeAtSale: "NON_MEMBER", subtotalCents: 2_500, shippingCents: 0, status: "PAID", refundedCents: 0 },
      ],
      period,
    );
    expect(report.totalGrossReceiptsCents).toBe(10_000);
    expect(report.nonMemberShareBasisPoints).toBe(2_500);
  });

  it("nets refunds without disturbing the gross figure", () => {
    const report = receiptsReport(SEED_ORDERS, period);
    for (const row of report.rows) {
      expect(row.netReceiptsCents).toBe(row.grossReceiptsCents - row.refundedCents);
    }
  });

  it("carries the plain-language note explaining why it exists", () => {
    const report = receiptsReport(SEED_ORDERS, period);
    expect(report.note).toMatch(/separate records/i);
    expect(report.note).toMatch(/unrelated business income/i);
    expect(report.note.length).toBeGreaterThan(200);
  });

  it("exports as CSV with both rows, a total and the note", () => {
    const csv = receiptsReportCsv(receiptsReport(SEED_ORDERS, period));
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Entity,JSOA");
    expect(csv).toContain("Buyer type at time of sale");
    expect(csv).toContain("Member,");
    expect(csv).toContain("Non-member,");
    expect(csv).toContain("Total,");
    expect(csv).toContain("Non-member share of gross receipts");
    expect(csv).toMatch(/unrelated business income/);
    // The note contains commas, so it has to be quoted or the columns shift.
    expect(csv).toMatch(/"Why this report exists/);
  });

  it("is reachable by the Store Chair, who holds aggregate and not read", () => {
    // This is the point of putting the compliance artefact at AGGREGATE: the
    // person whose activity creates the exposure can see the figure.
    expect(() => boardReceiptsReport(STORE_CHAIR_ONLY, period)).not.toThrow();
    expect(() => boardReceiptsCsv(STORE_CHAIR_ONLY, period)).not.toThrow();
  });
});

/* ================================================================== *
 * 5. Authorization: the wrong role is refused
 * ================================================================== */

describe("wrong-role requests to the board store are refused", () => {
  const period = yearPeriod(2026);

  it("refuses VP Membership, who holds nothing on financial records", () => {
    expect(() => boardReceiptsReport(VP_MEMBERSHIP, period)).toThrow(AuthzError);
    expect(() => boardOrderRows(VP_MEMBERSHIP)).toThrow(AuthzError);
    expect(() => boardInventory(VP_MEMBERSHIP)).toThrow(AuthzError);
    expect(() => boardRefunds(VP_MEMBERSHIP)).toThrow(AuthzError);
    expect(() => boardTaxPeriods(VP_MEMBERSHIP)).toThrow(AuthzError);
  });

  it("refuses the right role without MFA", () => {
    expect(() => boardReceiptsReport(NO_MFA, period)).toThrow(AuthzError);
    expect(() =>
      boardRecordPhysicalCount(NO_MFA, { sku: PUBLIC_SKU, quarter: "2026-Q4", countedUnits: 10 }),
    ).toThrow(AuthzError);
  });

  it("refuses the Store Chair the row-level order list but not the totals", () => {
    expect(() => boardOrderRows(STORE_CHAIR_ONLY)).toThrow(AuthzError);
    expect(() => boardReceiptsReport(STORE_CHAIR_ONLY, period)).not.toThrow();
    expect(() => boardInventory(STORE_CHAIR_ONLY)).not.toThrow();
  });

  it("refuses the Finance Review Officer any write, mechanically", () => {
    const fro = FINANCE_REVIEW;
    expect(() =>
      boardRecordPhysicalCount(fro, { sku: PUBLIC_SKU, quarter: "2026-Q4", countedUnits: 10 }),
    ).toThrow(AuthzError);
    // Reading is fine. Independence is what the read is for.
    expect(() => boardOrderRows(fro)).not.toThrow();
  });

  it("withholds a member ID from a role with financial read but no member read", () => {
    // The Treasurer holds FINANCIAL WRITE and MEMBER_PII AGGREGATE, so the
    // order is visible and the member behind it is not.
    const rows = boardOrderRows(TREASURER, { buyerType: "MEMBER" });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.memberIdAtSale).toBeNull();
      expect(row.identityWithheld).toBe(true);
      // The buyer type is never withheld: it is the tax record.
      expect(row.buyerTypeAtSale).toBe("MEMBER");
    }
  });

  it("shows the member ID to the President, who holds member read", () => {
    const rows = boardOrderRows(PRESIDENT, { buyerType: "MEMBER" });
    expect(rows.some((r) => r.memberIdAtSale !== null)).toBe(true);
    expect(rows.every((r) => r.identityWithheld === false)).toBe(true);
  });

  it("filters the order list by buyer type", () => {
    const members = boardOrderRows(PRESIDENT, { buyerType: "MEMBER" });
    const nonMembers = boardOrderRows(PRESIDENT, { buyerType: "NON_MEMBER" });
    const all = boardOrderRows(PRESIDENT, { buyerType: "ALL" });
    expect(members.every((r) => r.buyerTypeAtSale === "MEMBER")).toBe(true);
    expect(nonMembers.every((r) => r.buyerTypeAtSale === "NON_MEMBER")).toBe(true);
    expect(members.length + nonMembers.length).toBe(all.length);
  });

  it("denies a subject holding no board role at all", () => {
    const plainMember = subject("p-mem-1", [{ role: "MEMBER", entity: "JSOA" }]);
    expect(() => boardReceiptsReport(plainMember, period)).toThrow(AuthzError);
    expect(() => boardOrderRows(plainMember)).toThrow(AuthzError);
    expect(() => boardInventory(plainMember)).toThrow(AuthzError);
  });
});

/* ================================================================== *
 * 6. Refunds: self-approval above the threshold is refused
 * ================================================================== */

describe("self-approval of a refund above the threshold is refused", () => {
  const order = SEED_ORDERS.find((o) => o.id === "SO-2026-0108") as Order;

  function request(amountCents: number, requestedBy: string) {
    return buildRefundRequest({
      id: "rf-test",
      order,
      amountCents,
      reason: "Returned unworn",
      requestedByPersonId: requestedBy,
      requestedAt: "2026-09-29T10:00:00.000Z",
    });
  }

  it("sets the threshold low, because a refund is a cash-equivalent credit", () => {
    expect(REFUND_SECOND_APPROVER_THRESHOLD_CENTS).toBe(5_000);
    expect(refundRequiresSecondApprover(5_000)).toBe(false);
    expect(refundRequiresSecondApprover(5_001)).toBe(true);
  });

  it("refuses the requester approving their own refund above the threshold", () => {
    const refund = request(10_400, "p-hollis");
    expect(refundRequiresSecondApprover(refund.amountCents)).toBe(true);
    expect(() => approveRefund(refund, "p-hollis", "2026-09-29T11:00:00.000Z")).toThrow(
      AuthzError,
    );
    try {
      approveRefund(refund, "p-hollis", "2026-09-29T11:00:00.000Z");
    } catch (error) {
      expect((error as AuthzError).code).toBe("SELF_APPROVAL");
    }
  });

  it("leaves the refund unapproved after the refusal", () => {
    const refund = request(10_400, "p-hollis");
    try {
      approveRefund(refund, "p-hollis", "2026-09-29T11:00:00.000Z");
    } catch {
      // expected
    }
    expect(refund.status).toBe("REQUESTED");
    expect(refund.approvedByPersonId).toBeNull();
  });

  it("allows a different approver above the threshold", () => {
    const approved = approveRefund(
      request(10_400, "p-hollis"),
      "p-ferris",
      "2026-09-29T11:00:00.000Z",
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedByPersonId).toBe("p-ferris");
  });

  it("allows the requester to approve below the threshold", () => {
    const small = approveRefund(request(2_500, "p-hollis"), "p-hollis", "2026-09-29T11:00:00.000Z");
    expect(small.status).toBe("APPROVED");
  });

  it("refuses self-approval through the authorized board path as well", () => {
    // rf-0002 was raised by p-hollis and is above the threshold. p-hollis holds
    // TREASURER, so authorization passes and the self-approval check is what
    // stops it. That ordering matters: the refusal must not depend on the
    // person also lacking permission.
    expect(() => boardApproveRefund(TREASURER_AND_STORE_CHAIR, "rf-0002")).toThrow(AuthzError);
    try {
      boardApproveRefund(TREASURER_AND_STORE_CHAIR, "rf-0002");
    } catch (error) {
      expect((error as AuthzError).code).toBe("SELF_APPROVAL");
    }
    expect(boardRefunds(TREASURER).find((r) => r.id === "rf-0002")?.status).toBe("REQUESTED");
  });

  it("carries the tax portion of the refund, pro rata", () => {
    const refund = request(10_400, "p-hollis");
    expect(refund.taxPortionCents).toBe(728);
    const half = request(5_200, "p-hollis");
    expect(half.taxPortionCents).toBe(364);
  });

  it("refuses a refund larger than the order", () => {
    expect(() => request(99_999_00, "p-hollis")).toThrow(/more than was charged/);
  });
});

/* ================================================================== *
 * 7. The second-counter control
 * ================================================================== */

describe("the quarterly count cannot be entered by the store chair", () => {
  const stocked = SEED_PRODUCTS.find((p) => p.sku === PUBLIC_SKU) as Product;

  it("refuses a count entered by the store chair", () => {
    expect(() =>
      buildPhysicalCount(
        {
          id: "pc-test",
          sku: stocked.sku,
          quarter: "2026-Q4",
          countedUnits: 240,
          countedByPersonId: STORE_CHAIR_PERSON_ID,
          countedAt: "2026-12-31T00:00:00.000Z",
        },
        stocked,
        STORE_CHAIR_PERSON_ID,
      ),
    ).toThrow(AuthzError);
  });

  it("accepts a count entered by somebody else", () => {
    const count = buildPhysicalCount(
      {
        id: "pc-test",
        sku: stocked.sku,
        quarter: "2026-Q4",
        countedUnits: 240,
        countedByPersonId: "p-ferris",
        countedAt: "2026-12-31T00:00:00.000Z",
      },
      stocked,
      STORE_CHAIR_PERSON_ID,
    );
    expect(count.countedByPersonId).toBe("p-ferris");
    expect(count.countedUnits).toBe(240);
  });

  it("refuses through the authorized path too, where the chair has write access", () => {
    // The Treasurer who also chairs the store passes authorize() and is still
    // refused. If this ever passes, the compensating control is gone.
    expect(() =>
      boardRecordPhysicalCount(TREASURER_AND_STORE_CHAIR, {
        sku: PUBLIC_SKU,
        quarter: "2026-Q4",
        countedUnits: 240,
      }),
    ).toThrow(AuthzError);
  });

  it("surfaces the separation-of-duties finding for that person", () => {
    // The finding comes from the shared policy, not from this module. The
    // inventory screen is reachable by that person, which is why the count
    // refusal has to be the thing that stops them.
    const inventory = boardInventory(TREASURER_AND_STORE_CHAIR);
    expect(inventory.rows.length).toBeGreaterThan(0);
    const findings = separationOfDutiesFindings("p-hollis", [
      { role: "TREASURER", entity: "JSOA" },
      { role: "STORE_CHAIR", entity: "JSOA" },
    ]);
    expect(findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("refuses whatever person ID the session hands us, not just the seeded one", () => {
    // The control has to survive the identity source changing. The shared dev
    // persona switcher yields person IDs like "dev:treasurer-store", which
    // match nothing in the seed, so a check against a recorded chair ID would
    // silently stop refusing. It is derived from the subject's own assignments
    // instead.
    const sessionChair = subject("dev:treasurer-store", [
      { role: "TREASURER", entity: "JSOA" },
      { role: "STORE_CHAIR", entity: "JSOA" },
    ]);
    expect(storeChairPersonIdFor(sessionChair)).toBe("dev:treasurer-store");
    expect(() =>
      boardRecordPhysicalCount(sessionChair, {
        sku: PUBLIC_SKU,
        quarter: "2026-Q4",
        countedUnits: 240,
      }),
    ).toThrow(AuthzError);

    // A treasurer who does not chair the store is not refused.
    const sessionTreasurer = subject("dev:treasurer-jsoa", [
      { role: "TREASURER", entity: "JSOA" },
    ]);
    expect(storeChairPersonIdFor(sessionTreasurer)).not.toBe("dev:treasurer-jsoa");
    expect(() =>
      boardRecordPhysicalCount(sessionTreasurer, {
        sku: PUBLIC_SKU,
        quarter: "2026-Q4",
        countedUnits: 240,
      }),
    ).not.toThrow();
  });

  it("refuses a count on a line that holds no stock", () => {
    const pod = SEED_PRODUCTS.find((p) => p.sku === POD_SKU) as Product;
    expect(() =>
      buildPhysicalCount(
        {
          id: "pc-test",
          sku: pod.sku,
          quarter: "2026-Q4",
          countedUnits: 0,
          countedByPersonId: "p-ferris",
          countedAt: "2026-12-31T00:00:00.000Z",
        },
        pod,
        STORE_CHAIR_PERSON_ID,
      ),
    ).toThrow(/print-on-demand/);
  });
});

/* ================================================================== *
 * 8. Print-on-demand does not break the inventory view
 * ================================================================== */

describe("a print-on-demand product does not break the inventory view", () => {
  it("builds a row for every active product, stocked or not", () => {
    const rows = inventoryRows(SEED_PRODUCTS, SEED_MOVEMENTS, []);
    expect(rows.length).toBe(SEED_PRODUCTS.filter((p) => p.active).length);
    expect(rows.some((r) => r.fulfilment === "print_on_demand")).toBe(true);
  });

  it("gives a print-on-demand line null stock figures, not zero", () => {
    // Zero would read as "we are out of them", and would make the line look
    // like a variance at the next count.
    const row = inventoryRows(SEED_PRODUCTS, SEED_MOVEMENTS, []).find((r) => r.sku === POD_SKU);
    expect(row).toBeDefined();
    expect(row?.unitsIn).toBeNull();
    expect(row?.unitsOnHand).toBeNull();
    expect(row?.varianceUnits).toBeNull();
    expect(row?.lastCount).toBeNull();
  });

  it("still reports the units the printer shipped", () => {
    const row = inventoryRows(SEED_PRODUCTS, SEED_MOVEMENTS, []).find((r) => r.sku === POD_SKU);
    expect(row?.unitsOut).toBe(1);
  });

  it("does not ask for a quarterly count on a print-on-demand line", () => {
    const inventory = boardInventory(TREASURER);
    for (const sku of inventory.printOnDemandSkus) {
      expect(inventory.skusMissingThisQuarter).not.toContain(sku);
    }
    expect(inventory.printOnDemandSkus.length).toBeGreaterThan(0);
  });

  it("handles a catalogue that is entirely print-on-demand", () => {
    const podOnly = SEED_PRODUCTS.filter((p) => p.fulfilment === "print_on_demand");
    const rows = inventoryRows(podOnly, [], []);
    expect(rows.length).toBe(podOnly.length);
    expect(rows.every((r) => r.unitsOnHand === null)).toBe(true);
    expect(rows.every((r) => r.unitsOut === 0)).toBe(true);
  });

  it("handles a product switching to print-on-demand, which is a data change", () => {
    // The point of modelling fulfilment as a field: the board can change its
    // mind without a rewrite.
    const switched: Product[] = SEED_PRODUCTS.map((p) =>
      p.sku === PUBLIC_SKU ? { ...p, fulfilment: "print_on_demand" as const } : p,
    );
    const rows = inventoryRows(switched, SEED_MOVEMENTS, []);
    const row = rows.find((r) => r.sku === PUBLIC_SKU);
    expect(row?.unitsIn).toBeNull();
    expect(row?.unitsOnHand).toBeNull();
    expect(row?.unitsOut).toBe(6);
  });

  it("computes on hand as units in less units out for a stocked line", () => {
    const row = inventoryRows(SEED_PRODUCTS, SEED_MOVEMENTS, []).find(
      (r) => r.sku === PUBLIC_SKU,
    );
    // 250 received, 3 + 1 sold, 2 written off as damaged.
    expect(row?.unitsIn).toBe(250);
    expect(row?.unitsOut).toBe(6);
    expect(row?.unitsOnHand).toBe(244);
  });

  it("records a variance against the last count without correcting it", () => {
    const inventory = boardInventory(TREASURER);
    const polo = inventory.rows.find((r) => r.sku === "JSOA-POLO-NAVY");
    expect(polo?.unitsOnHand).toBe(87);
    expect(polo?.lastCount?.countedUnits).toBe(86);
    expect(polo?.varianceUnits).toBe(-1);
  });
});
