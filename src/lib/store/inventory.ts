/**
 * Inventory, and the second-counter control.
 *
 * The control first, because it is the reason this screen exists at all. One
 * person currently holds TREASURER and STORE_CHAIR on the Association. That is
 * authorize, custody, record and reconcile in one pair of hands, and
 * `separationOfDutiesFindings` in the authz policy already reports it as
 * critical. Moving the store to another chair is the fix. Until that happens,
 * the quarterly physical count by somebody other than the store chair is the
 * compensating control: it is the only point in the cycle where a second
 * person observes the goods independently of the person who records them.
 *
 * So `recordPhysicalCount` refuses a count entered by the store chair. It
 * refuses through `assertNotSelfApproval` from the shared policy rather than a
 * local comparison, so the refusal reads the same as every other
 * separation-of-duties refusal in the platform and cannot be softened here.
 *
 * Print-on-demand second, because it changes what this screen can say. A
 * print-on-demand line has no receipts, no shelf and no on-hand figure. The
 * rows carry `null`, not `0`, and the screen renders "not stocked". A zero
 * would read as "we are out", which is the opposite of the truth, and it would
 * make every POD line look like a variance at the next count.
 */

import { assertNotSelfApproval, AuthzError } from "../authz/policy";

import type {
  InventoryRow,
  MovementKind,
  PhysicalCount,
  Product,
  StockMovement,
} from "./types";

export class InventoryError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_STOCKED" | "UNKNOWN_SKU" | "NEGATIVE_COUNT",
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

const INBOUND: MovementKind[] = ["RECEIPT", "ADJUSTMENT"];

export function isStocked(product: Product): boolean {
  return product.fulfilment === "stock";
}

/**
 * Build the rows. A stocked line gets units in, units out and on hand. A
 * print-on-demand line gets units out only, because units fulfilled by the
 * printer is a real and useful figure, and nulls elsewhere.
 */
export function inventoryRows(
  products: Product[],
  movements: StockMovement[],
  counts: PhysicalCount[],
): InventoryRow[] {
  return products
    .filter((p) => p.active)
    .map((product) => {
      const forSku = movements.filter((m) => m.sku === product.sku);
      const unitsOut = forSku
        .filter((m) => m.units < 0)
        .reduce((sum, m) => sum + Math.abs(m.units), 0);

      if (!isStocked(product)) {
        return {
          sku: product.sku,
          name: product.name,
          fulfilment: product.fulfilment,
          unitsIn: null,
          unitsOut,
          unitsOnHand: null,
          lastCount: null,
          varianceUnits: null,
        };
      }

      const unitsIn = forSku
        .filter((m) => m.units > 0 && INBOUND.includes(m.kind))
        .reduce((sum, m) => sum + m.units, 0);
      const unitsOnHand = unitsIn - unitsOut;
      const lastCount = latestCount(counts, product.sku);

      return {
        sku: product.sku,
        name: product.name,
        fulfilment: product.fulfilment,
        unitsIn,
        unitsOut,
        unitsOnHand,
        lastCount,
        varianceUnits: lastCount === null ? null : lastCount.countedUnits - unitsOnHand,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function latestCount(counts: PhysicalCount[], sku: string): PhysicalCount | null {
  const forSku = counts
    .filter((c) => c.sku === sku)
    .sort((a, b) => b.countedAt.localeCompare(a.countedAt));
  return forSku.length > 0 ? forSku[0] : null;
}

export function currentQuarter(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-Q${Math.floor(at.getUTCMonth() / 3) + 1}`;
}

/** SKUs that are stocked and have no count in the given quarter. */
export function skusMissingCount(
  rows: InventoryRow[],
  counts: PhysicalCount[],
  quarter: string,
): string[] {
  return rows
    .filter((r) => r.fulfilment === "stock")
    .filter((r) => !counts.some((c) => c.sku === r.sku && c.quarter === quarter))
    .map((r) => r.sku);
}

export type PhysicalCountInput = {
  id: string;
  sku: string;
  quarter: string;
  countedUnits: number;
  countedByPersonId: string;
  countedAt: string;
};

/**
 * The count itself. `storeChairPersonId` is the person holding STORE_CHAIR on
 * the entity; a count entered by that person is refused, which is the whole
 * point of the field. The refusal comes out of the shared policy as an
 * AuthzError with code SELF_APPROVAL.
 */
export function buildPhysicalCount(
  input: PhysicalCountInput,
  product: Product,
  storeChairPersonId: string | null,
): PhysicalCount {
  if (!isStocked(product)) {
    throw new InventoryError(
      `${product.sku} is fulfilled print-on-demand and holds no stock to count`,
      "NOT_STOCKED",
    );
  }
  if (!Number.isInteger(input.countedUnits) || input.countedUnits < 0) {
    throw new InventoryError("A physical count is a whole number of units, zero or more", "NEGATIVE_COUNT");
  }
  if (storeChairPersonId !== null) {
    // The store chair records the books, so the store chair cannot also be the
    // independent observer of the goods. Same helper, same error, as every
    // other self-approval refusal in the platform.
    assertNotSelfApproval(input.countedByPersonId, {
      id: `inventory-count:${product.sku}:${input.quarter}`,
      createdById: storeChairPersonId,
      entity: product.entity,
    });
  }
  return {
    id: input.id,
    entity: product.entity,
    sku: input.sku,
    quarter: input.quarter,
    countedAt: input.countedAt,
    countedByPersonId: input.countedByPersonId,
    countedUnits: input.countedUnits,
  };
}

export function isSecondCounterRefusal(error: unknown): boolean {
  return error instanceof AuthzError && error.code === "SELF_APPROVAL";
}

export const SECOND_COUNTER_NOTE =
  "The quarterly count must be entered by somebody other than the store " +
  "chair. The store chair prices the goods, holds them, and records what was " +
  "sold, so a count entered by the same person confirms the records against " +
  "themselves. This is a compensating control, not a fix. The fix is to move " +
  "the store to a chair who is not the Treasurer.";
