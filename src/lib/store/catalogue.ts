/**
 * Catalogue visibility.
 *
 * The public catalogue is a projection, not a filtered list of the real thing.
 * `toPublicProduct` is the only way a product reaches a public response, and it
 * refuses to run on a member-restricted product rather than returning a
 * redacted version of one. That is deliberate: the failure mode to design
 * against is not a price leaking, it is a member-only SKU appearing in a public
 * payload as a greyed-out row, a `null`, or a count of hidden items. Any of
 * those tells a visitor what the members have, which is the thing the public
 * tier must not disclose.
 */

import { grantsMemberAccess, type MembershipState } from "../membership/state";

import type { Product, PublicProduct } from "./types";

export class CatalogueError extends Error {
  constructor(
    message: string,
    readonly code: "MEMBER_RESTRICTED" | "NOT_FOUND",
  ) {
    super(message);
    this.name = "CatalogueError";
  }
}

/**
 * Who is looking. A visitor has no membership state at all; a signed-in member
 * has the state from the membership module. PROBATIONARY and GOOD_STANDING both
 * grant access, which is the membership module's decision and not re-litigated
 * here: the 30-day audit is a check on the record, not a probation the member
 * serves.
 */
export type CatalogueViewer =
  | { kind: "visitor" }
  | { kind: "member"; personId: string; memberId: string; membershipState: MembershipState };

export function viewerHasMemberAccess(viewer: CatalogueViewer): boolean {
  return viewer.kind === "member" && grantsMemberAccess(viewer.membershipState);
}

export function isMemberRestricted(product: Product): boolean {
  return !product.publiclyPurchasable;
}

/** Throws rather than redacting. See the note at the top of the file. */
export function toPublicProduct(product: Product): PublicProduct {
  if (isMemberRestricted(product)) {
    throw new CatalogueError(
      `${product.sku} is member-restricted and cannot be projected to the public tier`,
      "MEMBER_RESTRICTED",
    );
  }
  return {
    sku: product.sku,
    name: product.name,
    blurb: product.blurb,
    category: product.category,
    priceCents: product.priceCents,
    currency: product.currency,
    fulfilment: product.fulfilment,
  };
}

/**
 * What /store returns. There is no `hiddenCount`, no `memberOnlyCategories`,
 * and no total-catalogue size, because each of those is a side channel.
 */
export type PublicCatalogue = {
  items: PublicProduct[];
};

export function publicCatalogue(products: Product[]): PublicCatalogue {
  return {
    items: products
      .filter((p) => p.active && p.publiclyPurchasable)
      .map(toPublicProduct)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export type MemberCatalogue = {
  items: Product[];
  collections: { name: string; items: Product[] }[];
};

/**
 * The member catalogue is the full active catalogue. Seasonal collections are
 * the same rows grouped a second way, so a seasonal item appears once in
 * `items` and once under its collection.
 */
export function memberCatalogue(products: Product[]): MemberCatalogue {
  const items = products.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name));
  const names = Array.from(
    new Set(items.map((p) => p.collection).filter((c): c is string => c !== null)),
  ).sort();
  return {
    items,
    collections: names.map((name) => ({
      name,
      items: items.filter((p) => p.collection === name),
    })),
  };
}

/**
 * Fetch one product as the viewer. A member-restricted SKU is NOT_FOUND to a
 * visitor, not FORBIDDEN: a 403 on a specific SKU confirms the SKU exists.
 */
export function findProductForViewer(
  products: Product[],
  sku: string,
  viewer: CatalogueViewer,
): Product {
  const product = products.find((p) => p.sku === sku && p.active);
  if (!product) {
    throw new CatalogueError(`No product ${sku}`, "NOT_FOUND");
  }
  if (isMemberRestricted(product) && !viewerHasMemberAccess(viewer)) {
    throw new CatalogueError(`No product ${sku}`, "NOT_FOUND");
  }
  return product;
}

/** What the viewer may put in a cart. Used by pricing, so it cannot drift. */
export function purchasableForViewer(products: Product[], viewer: CatalogueViewer): Product[] {
  return viewerHasMemberAccess(viewer)
    ? products.filter((p) => p.active)
    : products.filter((p) => p.active && p.publiclyPurchasable);
}
