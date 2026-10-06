/**
 * Cart pricing.
 *
 * The cart is expressed in the URL rather than in server state, because a
 * demo with a global mutable cart lies about what a real session looks like
 * and because there is nothing in a cart worth persisting for an anonymous
 * visitor. `items=SKU:QTY,SKU:QTY`. SKUs are not personal data; nothing else
 * goes in the query string.
 *
 * Pricing runs through `purchasableForViewer`, so a member-restricted SKU
 * hand-typed into the query by a visitor is dropped here as well as in the
 * catalogue. There is one gate, used twice, rather than two gates that can
 * drift apart.
 */

import { purchasableForViewer, type CatalogueViewer } from "./catalogue";
import {
  combinedBasisPoints,
  isTaxable,
  resolveJurisdiction,
  taxOn,
} from "./tax";
import { CURRENCY, type CartItem, type CartTotals, type PricedLine, type Product, type ShipTo } from "./types";

export const MAX_QUANTITY_PER_LINE = 20;

/** Flat-rate demo shipping. Waived over $150, which is a merchandising choice. */
export const SHIPPING_FLAT_CENTS = 895;
export const FREE_SHIPPING_THRESHOLD_CENTS = 15_000;

export const PICKUP_SHIP_TO: ShipTo = {
  state: "NC",
  county: "Cumberland",
  postalCode: "28307",
};

export function parseCartParam(raw: string | null | undefined): CartItem[] {
  if (!raw) return [];
  const items: CartItem[] = [];
  for (const chunk of raw.split(",")) {
    const [sku, qty] = chunk.split(":");
    if (!sku) continue;
    const quantity = Number.parseInt(qty ?? "1", 10);
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    items.push({ sku: sku.trim(), quantity: Math.min(quantity, MAX_QUANTITY_PER_LINE) });
  }
  return items;
}

export function serialiseCartParam(items: CartItem[]): string {
  return items.map((i) => `${i.sku}:${i.quantity}`).join(",");
}

export function addToCart(items: CartItem[], sku: string, quantity = 1): CartItem[] {
  const next = items.map((i) => ({ ...i }));
  const existing = next.find((i) => i.sku === sku);
  if (existing) {
    existing.quantity = Math.min(existing.quantity + quantity, MAX_QUANTITY_PER_LINE);
    return next;
  }
  next.push({ sku, quantity: Math.min(quantity, MAX_QUANTITY_PER_LINE) });
  return next;
}

export function removeFromCart(items: CartItem[], sku: string): CartItem[] {
  return items.filter((i) => i.sku !== sku);
}

export function priceLines(
  items: CartItem[],
  products: Product[],
  viewer: CatalogueViewer,
): PricedLine[] {
  const allowed = purchasableForViewer(products, viewer);
  const lines: PricedLine[] = [];
  for (const item of items) {
    const product = allowed.find((p) => p.sku === item.sku);
    if (!product) continue;
    lines.push({
      sku: product.sku,
      name: product.name,
      unitPriceCents: product.priceCents,
      quantity: item.quantity,
      lineSubtotalCents: product.priceCents * item.quantity,
      taxTreatment: product.taxTreatment,
      fulfilment: product.fulfilment,
    });
  }
  return lines;
}

/** Build a ship-to from loose query values, defaulting to the pickup county. */
export function shipToFromParams(state?: string, county?: string, postalCode?: string): ShipTo {
  return {
    state: state && state.trim().length > 0 ? state.trim() : PICKUP_SHIP_TO.state,
    county: county && county.trim().length > 0 ? county.trim() : PICKUP_SHIP_TO.county,
    postalCode: postalCode && postalCode.trim().length > 0 ? postalCode.trim() : "",
  };
}

export function shippingFor(subtotalCents: number, shipTo: ShipTo | null): number {
  if (shipTo === null) return 0;
  if (subtotalCents === 0) return 0;
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_FLAT_CENTS;
}

/**
 * Totals, with tax as its own figure rather than folded into a price. The
 * buyer sees what the organization is collecting on the state's behalf, and
 * the order records the same number, so the remittance reconciles to the
 * receipts without a spreadsheet in the middle.
 *
 * Delivery charges sit in the taxable base: NC includes them in the sales
 * price of taxable goods, so a shipped taxable order is taxed on goods plus
 * shipping. Shipping on an order with no taxable goods is not taxed.
 */
export function totalCart(
  items: CartItem[],
  products: Product[],
  viewer: CatalogueViewer,
  shipTo: ShipTo = PICKUP_SHIP_TO,
): CartTotals {
  const lines = priceLines(items, products, viewer);
  const subtotalCents = lines.reduce((sum, l) => sum + l.lineSubtotalCents, 0);
  const goodsTaxableCents = lines
    .filter((l) => isTaxable(l.taxTreatment))
    .reduce((sum, l) => sum + l.lineSubtotalCents, 0);
  const exemptBaseCents = subtotalCents - goodsTaxableCents;
  const shippingCents = shippingFor(subtotalCents, shipTo);
  const jurisdiction = resolveJurisdiction(shipTo);
  const rateBasisPoints = combinedBasisPoints(jurisdiction);
  const taxableBaseCents = goodsTaxableCents > 0 ? goodsTaxableCents + shippingCents : 0;
  const taxCents = taxOn(taxableBaseCents, rateBasisPoints);

  return {
    lines,
    subtotalCents,
    shippingCents,
    taxableBaseCents,
    exemptBaseCents,
    taxJurisdictionCode: jurisdiction.code,
    taxRateBasisPoints: rateBasisPoints,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
    currency: CURRENCY,
  };
}

export function formatCents(amountCents: number): string {
  const sign = amountCents < 0 ? "-" : "";
  const abs = Math.abs(amountCents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}
