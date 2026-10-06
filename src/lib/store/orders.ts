/**
 * Order creation and the hosted-checkout handoff.
 *
 * The one thing in this file that is not ordinary commerce is
 * `snapshotBuyerType`. It is called once, at the moment the order is written,
 * and its output is stored. Nothing recomputes it. If a member lapses in March,
 * the January order still reads MEMBER, because in January it was a sale to a
 * member and the tax record of January must not move. IRS Pub. 3386 ch. 9: the
 * separate record of non-member gross receipts is what keeps receipts from a
 * publicly open activity out of unrelated business income. A record that
 * rewrites itself is not a record.
 *
 * Note on authorization: a buyer placing their own order is not a board
 * subject and is not run through `authorize()`. Member-tier and buyer-tier
 * access is scoped by ownership of the record, as `ROLE_DEFINITIONS.MEMBER`
 * says. Every *board-side* read and write of these rows does call
 * `authorize()`; see `board.ts`.
 */

import { grantsMemberAccess, type MembershipState } from "../membership/state";

import { totalCart, PICKUP_SHIP_TO } from "./cart";
import type { CatalogueViewer } from "./catalogue";
import {
  CURRENCY,
  STORE_ENTITY,
  type BuyerType,
  type CartItem,
  type Order,
  type OrderLine,
  type Product,
  type ShipTo,
} from "./types";

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly code: "EMPTY_CART" | "NOT_PURCHASABLE",
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

/**
 * The snapshot. A visitor with no membership state is a non-member. A member
 * whose state grants access is a member. PROBATIONARY counts, because
 * PROBATIONARY members have paid and hold member access; treating them as
 * non-members would both misstate the tax record and charge them the wrong
 * price.
 */
export function snapshotBuyerType(state: MembershipState | null): BuyerType {
  if (state === null) return "NON_MEMBER";
  return grantsMemberAccess(state) ? "MEMBER" : "NON_MEMBER";
}

export type PlaceOrderInput = {
  id: string;
  items: CartItem[];
  products: Product[];
  viewer: CatalogueViewer;
  shipTo?: ShipTo;
  placedAt: string;
  /** The provider's hosted session reference, once one exists. */
  checkoutSessionRef?: string | null;
};

export function placeOrder(input: PlaceOrderInput): Order {
  const shipTo = input.shipTo ?? PICKUP_SHIP_TO;
  const totals = totalCart(input.items, input.products, input.viewer, shipTo);

  if (input.items.length === 0) {
    throw new CheckoutError("There is nothing in the cart", "EMPTY_CART");
  }
  if (totals.lines.length === 0) {
    throw new CheckoutError(
      "None of the items in the cart can be bought by this buyer",
      "NOT_PURCHASABLE",
    );
  }

  const membershipStateAtSale =
    input.viewer.kind === "member" ? input.viewer.membershipState : null;
  const buyerTypeAtSale = snapshotBuyerType(membershipStateAtSale);

  const lines: OrderLine[] = totals.lines.map((l) => ({
    sku: l.sku,
    name: l.name,
    unitPriceCents: l.unitPriceCents,
    quantity: l.quantity,
    lineSubtotalCents: l.lineSubtotalCents,
    taxTreatment: l.taxTreatment,
    fulfilment: l.fulfilment,
  }));

  return {
    id: input.id,
    entity: STORE_ENTITY,
    placedAt: input.placedAt,
    buyerRef: input.viewer.kind === "member" ? input.viewer.personId : `visitor:${input.id}`,
    buyerTypeAtSale,
    membershipStateAtSale,
    memberIdAtSale:
      buyerTypeAtSale === "MEMBER" && input.viewer.kind === "member"
        ? input.viewer.memberId
        : null,
    lines,
    subtotalCents: totals.subtotalCents,
    shippingCents: totals.shippingCents,
    taxableBaseCents: totals.taxableBaseCents,
    taxJurisdictionCode: totals.taxJurisdictionCode,
    taxRateBasisPoints: totals.taxRateBasisPoints,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    currency: CURRENCY,
    shipTo,
    status: "AWAITING_PAYMENT",
    checkoutSessionRef: input.checkoutSessionRef ?? null,
    refundedCents: 0,
  };
}

/** Marking an order paid is the only thing the provider webhook does here. */
export function markPaid(order: Order, checkoutSessionRef: string): Order {
  return { ...order, status: "PAID", checkoutSessionRef };
}

/* ------------------------------------------------------------------ *
 * Hosted checkout.
 *
 * docs/PRIVACY-AND-PAYMENTS.md: every element of the payment page must come
 * from the payment provider. One merchant-side script on that page moves the
 * organization from SAQ A to SAQ A-EP, which is a dramatically larger
 * questionnaire. So the payment step is a redirect and this module's job ends
 * at producing the URL. Nothing here reads, stores, or logs card data, and the
 * payment step carries no field of ours, no analytics tag and no chat widget.
 * ------------------------------------------------------------------ */

export type HostedCheckoutSession = {
  /** Stub reference. A real one comes back from the provider's API. */
  sessionRef: string;
  redirectUrl: string;
  amountCents: number;
  /** Shown to the buyer before the redirect so the tax is not a surprise. */
  taxCents: number;
  entity: typeof STORE_ENTITY;
};

/**
 * STUB. A real implementation calls the provider's server-side API with the
 * line items, the tax amount and the entity's own account, and returns the
 * session URL it hands back. It is stubbed because the demo has no provider
 * credentials and because the entities need separate provider accounts, which
 * is an integration-module decision and not this module's to make.
 */
export function createHostedCheckoutSession(order: Order): HostedCheckoutSession {
  return {
    sessionRef: `stub_cs_${order.id}`,
    redirectUrl: `/store/checkout/hosted?order=${encodeURIComponent(order.id)}`,
    amountCents: order.totalCents,
    taxCents: order.taxCents,
    entity: STORE_ENTITY,
  };
}
