/**
 * Store domain types.
 *
 * Two things in here are compliance controls rather than commerce features,
 * and both are worth stating before the field list:
 *
 *   1. `buyerTypeAtSale` on an order is a snapshot, taken when the money
 *      moves, and it is never recomputed. IRS Pub. 3386 ch. 9 requires
 *      separate records of gross receipts from members and from non-members
 *      for any activity open to the public. If the non-member records are not
 *      adequate, *all* receipts from the public activity are treated as
 *      unrelated business income. A lookup through to the member record would
 *      quietly rewrite the tax record every time somebody lapsed or renewed,
 *      so the order carries its own copy and the member record is not
 *      consulted after the sale.
 *
 *   2. North Carolina does not exempt a nonprofit from *collecting* sales and
 *      use tax on the merchandise it sells. The annual-fundraising exemption
 *      exists but its conditions are conjunctive and include delivery within
 *      60 days and distinct products per sales period, so it cannot cover a
 *      year-round store. Every taxable line carries tax and every order
 *      records what was collected. See `tax.ts`.
 *
 * Money is integer cents throughout. Rates are integer basis points, so no
 * figure in this module is ever a float.
 */

import type { Entity } from "../authz/model";
import type { MembershipState } from "../membership/state";

/** The store belongs to the Association. The Foundation does not sell goods. */
export const STORE_ENTITY: Entity = "JSOA";

export const CURRENCY = "USD" as const;
export type Currency = typeof CURRENCY;

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

/**
 * The board has not chosen between holding stock and printing on demand, so
 * the choice is a per-product data field. Changing it later is an edit to a
 * row, not a rewrite: the inventory screens read `null` on-hand figures for a
 * print-on-demand line rather than assuming every product has a shelf.
 */
export const FULFILMENTS = ["stock", "print_on_demand"] as const;
export type Fulfilment = (typeof FULFILMENTS)[number];

export const PRODUCT_CATEGORIES = [
  "coin",
  "apparel",
  "headwear",
  "patch",
  "print",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/**
 * Whether the line is in the NC sales tax base. Tangible personal property is;
 * a service or a right to participate is not. Kept explicit per product so an
 * order line records the reason it was or was not taxed, rather than leaving
 * that to be reconstructed later.
 */
export const TAX_TREATMENTS = ["tangible_goods", "exempt_service"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export type Product = {
  sku: string;
  entity: Entity;
  name: string;
  blurb: string;
  category: ProductCategory;
  priceCents: number;
  currency: Currency;
  /**
   * The single gate on the public catalogue. False means member-restricted:
   * the item is not listed publicly, is not fetchable publicly, and is not
   * named publicly even to say it is unavailable. Telling a visitor that a
   * thing exists but is members-only tells them what the members have.
   */
  publiclyPurchasable: boolean;
  fulfilment: Fulfilment;
  /** Seasonal collection name. Collections are a member-catalogue feature. */
  collection: string | null;
  taxTreatment: TaxTreatment;
  active: boolean;
};

/**
 * The shape the public catalogue is allowed to emit. It is a separate type,
 * not `Partial<Product>`, so a member-restricted field cannot reach a public
 * response by being forgotten in a spread.
 */
export type PublicProduct = {
  sku: string;
  name: string;
  blurb: string;
  category: ProductCategory;
  priceCents: number;
  currency: Currency;
  fulfilment: Fulfilment;
};

/* ------------------------------------------------------------------ *
 * Cart
 * ------------------------------------------------------------------ */

export type CartItem = {
  sku: string;
  quantity: number;
};

export type PricedLine = {
  sku: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineSubtotalCents: number;
  taxTreatment: TaxTreatment;
  fulfilment: Fulfilment;
};

/**
 * Where the goods are going. Only the three fields sales tax sourcing needs
 * are held here: NC sources a delivered sale to the destination, so the county
 * and postal code decide the rate. The rest of the address belongs to the
 * fulfilment provider, not to this module.
 */
export type ShipTo = {
  state: string;
  county: string;
  postalCode: string;
};

export type CartTotals = {
  lines: PricedLine[];
  subtotalCents: number;
  /** NC includes delivery charges in the sales price of taxable goods. */
  shippingCents: number;
  taxableBaseCents: number;
  exemptBaseCents: number;
  taxJurisdictionCode: string;
  taxRateBasisPoints: number;
  taxCents: number;
  totalCents: number;
  currency: Currency;
};

/* ------------------------------------------------------------------ *
 * Orders
 * ------------------------------------------------------------------ */

export const BUYER_TYPES = ["MEMBER", "NON_MEMBER"] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

export const ORDER_STATUSES = [
  "AWAITING_PAYMENT",
  "PAID",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderLine = {
  sku: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineSubtotalCents: number;
  taxTreatment: TaxTreatment;
  fulfilment: Fulfilment;
};

export type Order = {
  id: string;
  entity: Entity;
  placedAt: string;
  /**
   * Opaque buyer handle. The store keeps no name, no address and no contact
   * detail: STORE_CHAIR holds NONE on MEMBER_PII and the module is built so
   * that is not an inconvenience.
   */
  buyerRef: string;

  /* --- the tax snapshot. Written once, never recomputed. --- */
  buyerTypeAtSale: BuyerType;
  /** The membership state as it stood at the sale, or null for a visitor. */
  membershipStateAtSale: MembershipState | null;
  /** The member ID as it stood at the sale. Null for a non-member. */
  memberIdAtSale: string | null;

  lines: OrderLine[];
  subtotalCents: number;
  shippingCents: number;
  taxableBaseCents: number;
  taxJurisdictionCode: string;
  taxRateBasisPoints: number;
  taxCents: number;
  totalCents: number;
  currency: Currency;
  shipTo: ShipTo;
  status: OrderStatus;
  /**
   * The provider's hosted-checkout session reference. No card data, no last
   * four, no cardholder name: none of it touches this record or our logs.
   */
  checkoutSessionRef: string | null;
  refundedCents: number;
};

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

export const MOVEMENT_KINDS = [
  "RECEIPT",
  "SALE",
  "ADJUSTMENT",
  "SHRINKAGE",
  "POD_FULFILMENT",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export type StockMovement = {
  id: string;
  entity: Entity;
  sku: string;
  kind: MovementKind;
  /** Positive for units in, negative for units out. */
  units: number;
  occurredAt: string;
  note: string;
};

/**
 * A quarterly physical count. The `countedByPersonId` must not be the store
 * chair for the entity: this field is the compensating control for the
 * Treasurer also chairing the store, which puts authorize, custody, record
 * and reconcile in one pair of hands. See `separationOfDutiesFindings`.
 */
export type PhysicalCount = {
  id: string;
  entity: Entity;
  sku: string;
  /** `YYYY-Qn`. */
  quarter: string;
  countedAt: string;
  countedByPersonId: string;
  countedUnits: number;
};

export type InventoryRow = {
  sku: string;
  name: string;
  fulfilment: Fulfilment;
  /** Null for a print-on-demand line: there is no stock to count. */
  unitsIn: number | null;
  unitsOut: number;
  unitsOnHand: number | null;
  lastCount: PhysicalCount | null;
  /** Counted units minus units on hand. Null when either figure is absent. */
  varianceUnits: number | null;
};

/* ------------------------------------------------------------------ *
 * Refunds
 * ------------------------------------------------------------------ */

export const REFUND_STATUSES = ["REQUESTED", "APPROVED", "REFUSED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export type Refund = {
  id: string;
  entity: Entity;
  orderId: string;
  /** Total credited to the buyer, tax portion included. */
  amountCents: number;
  /** The share of `amountCents` that reverses collected sales tax. */
  taxPortionCents: number;
  reason: string;
  /** Named `createdById` so the record satisfies `Approvable` directly. */
  createdById: string;
  requestedAt: string;
  approvedByPersonId: string | null;
  approvedAt: string | null;
  status: RefundStatus;
};

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

export type Period = {
  /** Inclusive, ISO date. */
  from: string;
  /** Exclusive, ISO date. */
  to: string;
  label: string;
};

export type ReceiptsSplitRow = {
  buyerType: BuyerType;
  orderCount: number;
  /**
   * Gross receipts means the sales price before any refund and before tax:
   * collected sales tax is the state's money held in trust, not a receipt of
   * the organization, so it is reported beside the split rather than inside it.
   */
  grossReceiptsCents: number;
  salesTaxCollectedCents: number;
  refundedCents: number;
  netReceiptsCents: number;
};

export type ReceiptsReport = {
  entity: Entity;
  period: Period;
  rows: ReceiptsSplitRow[];
  totalGrossReceiptsCents: number;
  totalSalesTaxCollectedCents: number;
  nonMemberShareBasisPoints: number;
  note: string;
};

export type TaxPeriodRow = {
  period: Period;
  taxableBaseCents: number;
  exemptBaseCents: number;
  salesTaxCollectedCents: number;
  orderCount: number;
  jurisdictionCodes: string[];
};
