/**
 * Seed data. Fictional, and deliberately obviously so.
 *
 * The figures here are invented for a demo. They are not the real
 * organization's sales, and nothing in this file should be quoted as such.
 * Board names are invented too.
 *
 * The seed is shaped to exercise the things that matter rather than to look
 * busy: it contains member and non-member orders in the same periods, a
 * print-on-demand product with no stock figures, a non-taxable line beside
 * taxable ones, an out-of-state order that collects no tax, a refund below the
 * second-approver threshold and one above it, and a stocked SKU with a
 * quarterly count that came out one unit short.
 */

import type { RoleAssignment } from "../authz/policy";

import { combinedBasisPoints, jurisdictionByCode, taxOn } from "./tax";
import {
  CURRENCY,
  STORE_ENTITY,
  type BuyerType,
  type Order,
  type OrderLine,
  type PhysicalCount,
  type Product,
  type Refund,
  type ShipTo,
  type StockMovement,
} from "./types";
import type { MembershipState } from "../membership/state";

/* ------------------------------------------------------------------ *
 * People. Invented. Person IDs are what the platform actually keys on.
 * ------------------------------------------------------------------ */

export const SEED_PEOPLE: Record<string, string> = {
  "p-hollis": "D. Hollis",
  "p-ferris": "J. Ferris",
  "p-marchetti": "A. Marchetti",
  "p-okafor": "T. Okafor",
  "p-langley": "R. Langley",
  "p-devereux": "M. Devereux",
  "p-mem-1": "member 1",
  "p-mem-2": "member 2",
};

/**
 * The role picture that makes this module's controls necessary. Hollis holds
 * TREASURER and STORE_CHAIR on the Association at the same time, which is the
 * critical separation-of-duties finding the platform already detects. Ferris
 * is the assistant treasurer and exists so the quarterly count has somebody
 * who can record it, since the store chair may not.
 */
export const SEED_BOARD_ASSIGNMENTS: Record<string, RoleAssignment[]> = {
  "p-hollis": [
    { role: "TREASURER", entity: "JSOA" },
    { role: "STORE_CHAIR", entity: "JSOA" },
  ],
  "p-ferris": [{ role: "TREASURER", entity: "JSOA" }],
  "p-marchetti": [{ role: "PRESIDENT", entity: "JSOA" }],
  "p-okafor": [{ role: "VP_OPERATIONS", entity: "JSOA" }],
  "p-langley": [{ role: "FINANCE_REVIEW_OFFICER", entity: "JSOA" }],
  "p-devereux": [
    { role: "SECRETARY", entity: "JSOA" },
    { role: "SECRETARY", entity: "JSOF" },
  ],
};

export const STORE_CHAIR_PERSON_ID = "p-hollis";

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

export const SEED_PRODUCTS: Product[] = [
  {
    sku: "JSOA-COIN-STD",
    entity: STORE_ENTITY,
    name: "Association challenge coin",
    blurb: "Antique brass, 1.75 inch, in a presentation sleeve.",
    category: "coin",
    priceCents: 2_500,
    currency: CURRENCY,
    publiclyPurchasable: true,
    fulfilment: "stock",
    collection: null,
    taxTreatment: "tangible_goods",
    active: true,
  },
  {
    sku: "JSOA-CAP-LOWPRO",
    entity: STORE_ENTITY,
    name: "Low-profile cap, stone",
    blurb: "Unstructured six-panel, adjustable strap, embroidered crest.",
    category: "headwear",
    priceCents: 2_800,
    currency: CURRENCY,
    publiclyPurchasable: true,
    fulfilment: "stock",
    collection: null,
    taxTreatment: "tangible_goods",
    active: true,
  },
  {
    sku: "JSOA-POLO-NAVY",
    entity: STORE_ENTITY,
    name: "Performance polo, navy",
    blurb: "Moisture-wicking knit, left-chest crest. Sizes S to 3XL.",
    category: "apparel",
    priceCents: 5_200,
    currency: CURRENCY,
    publiclyPurchasable: true,
    fulfilment: "stock",
    collection: null,
    taxTreatment: "tangible_goods",
    active: true,
  },
  {
    sku: "JSOA-PATCH-CREST",
    entity: STORE_ENTITY,
    name: "Crest patch, hook backing",
    blurb: "Woven, 3 inch, subdued thread.",
    category: "patch",
    priceCents: 900,
    currency: CURRENCY,
    publiclyPurchasable: true,
    fulfilment: "stock",
    collection: null,
    taxTreatment: "tangible_goods",
    active: true,
  },
  {
    sku: "JSOA-PRINT-MEMORIAL",
    entity: STORE_ENTITY,
    name: "Memorial print, 11 by 14",
    blurb:
      "Archival giclee of the memorial pavilion at first light. Printed to order, " +
      "so allow three weeks. No names appear on the print.",
    category: "print",
    priceCents: 4_500,
    currency: CURRENCY,
    publiclyPurchasable: true,
    fulfilment: "print_on_demand",
    collection: null,
    taxTreatment: "tangible_goods",
    active: true,
  },
  {
    sku: "JSOA-TEE-RUCK",
    entity: STORE_ENTITY,
    name: "Ruck march tee",
    blurb: "Cotton blend, printed to order in the size and colour you pick.",
    category: "apparel",
    priceCents: 3_200,
    currency: CURRENCY,
    publiclyPurchasable: true,
    fulfilment: "print_on_demand",
    collection: null,
    taxTreatment: "tangible_goods",
    active: true,
  },
  {
    sku: "JSOA-GIFT-50",
    entity: STORE_ENTITY,
    name: "Gift certificate, 50 dollars",
    blurb:
      "Issued by email or printed. No sales tax is charged when a certificate is " +
      "bought. Tax applies to whatever it is spent on.",
    category: "print",
    priceCents: 5_000,
    currency: CURRENCY,
    publiclyPurchasable: true,
    fulfilment: "print_on_demand",
    collection: null,
    taxTreatment: "exempt_service",
    active: true,
  },

  /* --- member-restricted. Absent from the public catalogue entirely. --- */
  {
    sku: "JSOA-COIN-FOUNDERS",
    entity: STORE_ENTITY,
    name: "Founders coin, numbered",
    blurb: "Struck in a single run, numbered on the edge, one per member.",
    category: "coin",
    priceCents: 6_500,
    currency: CURRENCY,
    publiclyPurchasable: false,
    fulfilment: "stock",
    collection: null,
    taxTreatment: "tangible_goods",
    active: true,
  },
  {
    sku: "JSOA-ZIP-HEATHER",
    entity: STORE_ENTITY,
    name: "Quarter-zip, heather",
    blurb: "Midweight fleece-backed knit, crest on the left chest.",
    category: "apparel",
    priceCents: 7_800,
    currency: CURRENCY,
    publiclyPurchasable: false,
    fulfilment: "stock",
    collection: "Winter 2026",
    taxTreatment: "tangible_goods",
    active: true,
  },
  {
    sku: "JSOA-CAP-REUNION",
    entity: STORE_ENTITY,
    name: "Reunion cap, 2026",
    blurb: "Dated for the 2026 reunion weekend. Printed to order.",
    category: "headwear",
    priceCents: 3_000,
    currency: CURRENCY,
    publiclyPurchasable: false,
    fulfilment: "print_on_demand",
    collection: "Reunion 2026",
    taxTreatment: "tangible_goods",
    active: true,
  },
  {
    sku: "JSOA-PATCH-ANNIV",
    entity: STORE_ENTITY,
    name: "Anniversary patch set",
    blurb: "Three patches, one per decade. Members only while the run lasts.",
    category: "patch",
    priceCents: 2_400,
    currency: CURRENCY,
    publiclyPurchasable: false,
    fulfilment: "stock",
    collection: "Winter 2026",
    taxTreatment: "tangible_goods",
    active: true,
  },
];

/** Every member-restricted SKU. Used by the tests that assert public absence. */
export const MEMBER_RESTRICTED_SKUS = SEED_PRODUCTS.filter((p) => !p.publiclyPurchasable).map(
  (p) => p.sku,
);

/* ------------------------------------------------------------------ *
 * Orders. Built through the same tax helpers the live path uses, so a
 * seeded order cannot disagree with a placed one.
 * ------------------------------------------------------------------ */

const CUMBERLAND: ShipTo = { state: "NC", county: "Cumberland", postalCode: "28307" };
const WAKE: ShipTo = { state: "NC", county: "Wake", postalCode: "27601" };
const OUT_OF_STATE: ShipTo = { state: "SC", county: "Richland", postalCode: "29201" };

function product(sku: string): Product {
  const found = SEED_PRODUCTS.find((p) => p.sku === sku);
  if (!found) throw new Error(`Seed refers to unknown SKU ${sku}`);
  return found;
}

function line(sku: string, quantity: number): OrderLine {
  const p = product(sku);
  return {
    sku: p.sku,
    name: p.name,
    unitPriceCents: p.priceCents,
    quantity,
    lineSubtotalCents: p.priceCents * quantity,
    taxTreatment: p.taxTreatment,
    fulfilment: p.fulfilment,
  };
}

function seedOrder(spec: {
  id: string;
  placedAt: string;
  buyerRef: string;
  buyerType: BuyerType;
  membershipState: MembershipState | null;
  memberId: string | null;
  items: [string, number][];
  shipTo: ShipTo;
  shippingCents: number;
  status?: Order["status"];
  refundedCents?: number;
}): Order {
  const lines = spec.items.map(([sku, qty]) => line(sku, qty));
  const subtotalCents = lines.reduce((sum, l) => sum + l.lineSubtotalCents, 0);
  const goodsTaxable = lines
    .filter((l) => l.taxTreatment === "tangible_goods")
    .reduce((sum, l) => sum + l.lineSubtotalCents, 0);
  const jurisdiction =
    spec.shipTo.state === "NC"
      ? jurisdictionByCode(spec.shipTo.county === "Wake" ? "NC-WAKE" : "NC-CUMBERLAND")
      : jurisdictionByCode("OUT-OF-STATE-NOT-REGISTERED");
  const rate = combinedBasisPoints(jurisdiction);
  const taxableBaseCents = goodsTaxable > 0 ? goodsTaxable + spec.shippingCents : 0;
  const taxCents = taxOn(taxableBaseCents, rate);

  return {
    id: spec.id,
    entity: STORE_ENTITY,
    placedAt: spec.placedAt,
    buyerRef: spec.buyerRef,
    buyerTypeAtSale: spec.buyerType,
    membershipStateAtSale: spec.membershipState,
    memberIdAtSale: spec.memberId,
    lines,
    subtotalCents,
    shippingCents: spec.shippingCents,
    taxableBaseCents,
    taxJurisdictionCode: jurisdiction.code,
    taxRateBasisPoints: rate,
    taxCents,
    totalCents: subtotalCents + spec.shippingCents + taxCents,
    currency: CURRENCY,
    shipTo: spec.shipTo,
    status: spec.status ?? "PAID",
    checkoutSessionRef: `stub_cs_${spec.id}`,
    refundedCents: spec.refundedCents ?? 0,
  };
}

export const SEED_ORDERS: Order[] = [
  seedOrder({
    id: "SO-2026-0101",
    placedAt: "2026-07-06T14:22:00.000Z",
    buyerRef: "p-mem-1",
    buyerType: "MEMBER",
    membershipState: "GOOD_STANDING",
    memberId: "JSOA-2019-0114",
    items: [
      ["JSOA-COIN-FOUNDERS", 1],
      ["JSOA-ZIP-HEATHER", 1],
    ],
    shipTo: CUMBERLAND,
    shippingCents: 0,
  }),
  seedOrder({
    id: "SO-2026-0102",
    placedAt: "2026-07-11T18:03:00.000Z",
    buyerRef: "visitor:SO-2026-0102",
    buyerType: "NON_MEMBER",
    membershipState: null,
    memberId: null,
    items: [
      ["JSOA-COIN-STD", 2],
      ["JSOA-PATCH-CREST", 1],
    ],
    shipTo: WAKE,
    shippingCents: 895,
  }),
  seedOrder({
    id: "SO-2026-0103",
    placedAt: "2026-07-19T12:40:00.000Z",
    buyerRef: "visitor:SO-2026-0103",
    buyerType: "NON_MEMBER",
    membershipState: null,
    memberId: null,
    items: [["JSOA-PRINT-MEMORIAL", 1]],
    shipTo: OUT_OF_STATE,
    shippingCents: 895,
  }),
  seedOrder({
    id: "SO-2026-0104",
    placedAt: "2026-08-02T15:11:00.000Z",
    buyerRef: "p-mem-2",
    buyerType: "MEMBER",
    membershipState: "PROBATIONARY",
    memberId: "JSOA-2026-0031",
    items: [
      ["JSOA-POLO-NAVY", 1],
      ["JSOA-CAP-LOWPRO", 1],
    ],
    shipTo: CUMBERLAND,
    shippingCents: 895,
  }),
  seedOrder({
    id: "SO-2026-0105",
    placedAt: "2026-08-14T20:55:00.000Z",
    buyerRef: "visitor:SO-2026-0105",
    buyerType: "NON_MEMBER",
    membershipState: null,
    memberId: null,
    items: [["JSOA-GIFT-50", 1]],
    shipTo: CUMBERLAND,
    shippingCents: 0,
  }),
  seedOrder({
    id: "SO-2026-0106",
    placedAt: "2026-08-27T13:28:00.000Z",
    buyerRef: "visitor:SO-2026-0106",
    buyerType: "NON_MEMBER",
    membershipState: null,
    memberId: null,
    items: [
      ["JSOA-TEE-RUCK", 2],
      ["JSOA-COIN-STD", 1],
    ],
    shipTo: WAKE,
    shippingCents: 895,
    status: "PARTIALLY_REFUNDED",
    refundedCents: 3_200,
  }),
  seedOrder({
    id: "SO-2026-0107",
    placedAt: "2026-09-04T16:09:00.000Z",
    buyerRef: "p-mem-1",
    buyerType: "MEMBER",
    membershipState: "GOOD_STANDING",
    memberId: "JSOA-2019-0114",
    items: [["JSOA-PATCH-ANNIV", 2]],
    shipTo: CUMBERLAND,
    shippingCents: 895,
  }),
  seedOrder({
    id: "SO-2026-0108",
    placedAt: "2026-09-21T11:47:00.000Z",
    buyerRef: "visitor:SO-2026-0108",
    buyerType: "NON_MEMBER",
    membershipState: null,
    memberId: null,
    items: [["JSOA-POLO-NAVY", 2]],
    shipTo: CUMBERLAND,
    shippingCents: 0,
  }),
  seedOrder({
    id: "SO-2026-0109",
    placedAt: "2026-09-26T09:15:00.000Z",
    buyerRef: "visitor:SO-2026-0109",
    buyerType: "NON_MEMBER",
    membershipState: null,
    memberId: null,
    items: [["JSOA-CAP-LOWPRO", 1]],
    shipTo: WAKE,
    shippingCents: 895,
    status: "AWAITING_PAYMENT",
  }),
];

/**
 * The order the snapshot test leans on: buyer p-mem-1 bought in July while in
 * GOOD_STANDING. Whatever happens to that membership afterwards, SO-2026-0101
 * stays a sale to a member.
 */
export const SNAPSHOT_FIXTURE_ORDER_ID = "SO-2026-0101";

/* ------------------------------------------------------------------ *
 * Stock movements. Only stocked SKUs appear. A print-on-demand SKU has
 * fulfilment records, not stock records: it never had a shelf.
 * ------------------------------------------------------------------ */

export const SEED_MOVEMENTS: StockMovement[] = [
  { id: "mv-0001", entity: STORE_ENTITY, sku: "JSOA-COIN-STD", kind: "RECEIPT", units: 250, occurredAt: "2026-06-02T00:00:00.000Z", note: "Opening order from the mint" },
  { id: "mv-0002", entity: STORE_ENTITY, sku: "JSOA-COIN-STD", kind: "SALE", units: -3, occurredAt: "2026-07-11T18:03:00.000Z", note: "SO-2026-0102" },
  { id: "mv-0003", entity: STORE_ENTITY, sku: "JSOA-COIN-STD", kind: "SALE", units: -1, occurredAt: "2026-08-27T13:28:00.000Z", note: "SO-2026-0106" },
  { id: "mv-0004", entity: STORE_ENTITY, sku: "JSOA-COIN-STD", kind: "SHRINKAGE", units: -2, occurredAt: "2026-08-30T00:00:00.000Z", note: "Damaged in the display case at the golf tournament" },

  { id: "mv-0005", entity: STORE_ENTITY, sku: "JSOA-CAP-LOWPRO", kind: "RECEIPT", units: 120, occurredAt: "2026-06-02T00:00:00.000Z", note: "Opening order" },
  { id: "mv-0006", entity: STORE_ENTITY, sku: "JSOA-CAP-LOWPRO", kind: "SALE", units: -1, occurredAt: "2026-08-02T15:11:00.000Z", note: "SO-2026-0104" },
  { id: "mv-0007", entity: STORE_ENTITY, sku: "JSOA-CAP-LOWPRO", kind: "SALE", units: -1, occurredAt: "2026-09-26T09:15:00.000Z", note: "SO-2026-0109" },

  { id: "mv-0008", entity: STORE_ENTITY, sku: "JSOA-POLO-NAVY", kind: "RECEIPT", units: 90, occurredAt: "2026-06-09T00:00:00.000Z", note: "Opening order, size run S to 3XL" },
  { id: "mv-0009", entity: STORE_ENTITY, sku: "JSOA-POLO-NAVY", kind: "SALE", units: -1, occurredAt: "2026-08-02T15:11:00.000Z", note: "SO-2026-0104" },
  { id: "mv-0010", entity: STORE_ENTITY, sku: "JSOA-POLO-NAVY", kind: "SALE", units: -2, occurredAt: "2026-09-21T11:47:00.000Z", note: "SO-2026-0108" },

  { id: "mv-0011", entity: STORE_ENTITY, sku: "JSOA-PATCH-CREST", kind: "RECEIPT", units: 400, occurredAt: "2026-06-02T00:00:00.000Z", note: "Opening order" },
  { id: "mv-0012", entity: STORE_ENTITY, sku: "JSOA-PATCH-CREST", kind: "SALE", units: -1, occurredAt: "2026-07-11T18:03:00.000Z", note: "SO-2026-0102" },

  { id: "mv-0013", entity: STORE_ENTITY, sku: "JSOA-COIN-FOUNDERS", kind: "RECEIPT", units: 300, occurredAt: "2026-05-18T00:00:00.000Z", note: "Single numbered run" },
  { id: "mv-0014", entity: STORE_ENTITY, sku: "JSOA-COIN-FOUNDERS", kind: "SALE", units: -1, occurredAt: "2026-07-06T14:22:00.000Z", note: "SO-2026-0101" },

  { id: "mv-0015", entity: STORE_ENTITY, sku: "JSOA-ZIP-HEATHER", kind: "RECEIPT", units: 60, occurredAt: "2026-06-30T00:00:00.000Z", note: "Winter 2026 collection" },
  { id: "mv-0016", entity: STORE_ENTITY, sku: "JSOA-ZIP-HEATHER", kind: "SALE", units: -1, occurredAt: "2026-07-06T14:22:00.000Z", note: "SO-2026-0101" },

  { id: "mv-0017", entity: STORE_ENTITY, sku: "JSOA-PATCH-ANNIV", kind: "RECEIPT", units: 150, occurredAt: "2026-06-30T00:00:00.000Z", note: "Winter 2026 collection" },
  { id: "mv-0018", entity: STORE_ENTITY, sku: "JSOA-PATCH-ANNIV", kind: "SALE", units: -2, occurredAt: "2026-09-04T16:09:00.000Z", note: "SO-2026-0107" },

  // Print-on-demand lines: units the printer shipped. No receipts, no shelf.
  { id: "mv-0019", entity: STORE_ENTITY, sku: "JSOA-PRINT-MEMORIAL", kind: "POD_FULFILMENT", units: -1, occurredAt: "2026-07-19T12:40:00.000Z", note: "SO-2026-0103, printer shipped direct" },
  { id: "mv-0020", entity: STORE_ENTITY, sku: "JSOA-TEE-RUCK", kind: "POD_FULFILMENT", units: -2, occurredAt: "2026-08-27T13:28:00.000Z", note: "SO-2026-0106, printer shipped direct" },
];

/* ------------------------------------------------------------------ *
 * Quarterly counts. Entered by the assistant treasurer, not by the store
 * chair, which is the whole point of the field.
 * ------------------------------------------------------------------ */

export const SEED_COUNTS: PhysicalCount[] = [
  {
    id: "pc-0001",
    entity: STORE_ENTITY,
    sku: "JSOA-COIN-STD",
    quarter: "2026-Q2",
    countedAt: "2026-06-30T00:00:00.000Z",
    countedByPersonId: "p-ferris",
    countedUnits: 250,
  },
  {
    id: "pc-0002",
    entity: STORE_ENTITY,
    sku: "JSOA-CAP-LOWPRO",
    quarter: "2026-Q2",
    countedAt: "2026-06-30T00:00:00.000Z",
    countedByPersonId: "p-ferris",
    countedUnits: 120,
  },
  {
    // Came out one short against the book figure. Recorded, not corrected.
    id: "pc-0003",
    entity: STORE_ENTITY,
    sku: "JSOA-POLO-NAVY",
    quarter: "2026-Q3",
    countedAt: "2026-09-29T00:00:00.000Z",
    countedByPersonId: "p-ferris",
    countedUnits: 86,
  },
];

/* ------------------------------------------------------------------ *
 * Refunds
 * ------------------------------------------------------------------ */

export const SEED_REFUNDS: Refund[] = [
  {
    id: "rf-0001",
    entity: STORE_ENTITY,
    orderId: "SO-2026-0106",
    amountCents: 3_200,
    taxPortionCents: 232,
    reason: "One tee printed off-centre. Buyer kept the coin.",
    createdById: "p-hollis",
    requestedAt: "2026-09-02T14:00:00.000Z",
    approvedByPersonId: "p-ferris",
    approvedAt: "2026-09-03T09:30:00.000Z",
    status: "APPROVED",
  },
  {
    id: "rf-0002",
    entity: STORE_ENTITY,
    orderId: "SO-2026-0108",
    amountCents: 10_400,
    taxPortionCents: 728,
    reason: "Both polos returned unworn, wrong size run.",
    createdById: "p-hollis",
    requestedAt: "2026-09-28T10:05:00.000Z",
    approvedByPersonId: null,
    approvedAt: null,
    status: "REQUESTED",
  },
];
