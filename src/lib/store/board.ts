/**
 * The authorized board-side layer. Every function here calls `authorize()`
 * before it touches anything, and the routes call only these. The repository is
 * not exported to the route files, so there is no path to an order row that
 * skipped the check.
 *
 * The level each function demands is worth reading closely, because
 * ROLE_DEFINITIONS gives STORE_CHAIR `FINANCIAL: AGGREGATE`, not READ, and that
 * is deliberate. The consequence here:
 *
 *   - Totals, splits, tax figures and unit counts need AGGREGATE. The store
 *     chair can see all of them, including the member versus non-member
 *     receipts report, which is the artefact the store chair most needs.
 *   - The row-level order list, which carries a buyer handle and can carry a
 *     member ID, needs READ. The store chair does not hold it. That is not a
 *     bug in this module; it is the role table saying the person who sells the
 *     goods does not get a list of who bought them. The screen says so rather
 *     than pretending the data is missing.
 *   - A member ID on an order row is member PII, so it needs MEMBER_PII READ
 *     as well. Somebody with FINANCIAL READ and no MEMBER_PII sees the order
 *     and not the member behind it.
 */

import type { Entity, Role } from "../authz/model";
import {
  authorize,
  can,
  separationOfDutiesFindings,
  type SodFinding,
  type Subject,
} from "../authz/policy";

import {
  buildPhysicalCount,
  inventoryRows,
  currentQuarter,
  skusMissingCount,
  type PhysicalCountInput,
} from "./inventory";
import {
  approveRefund as approveRefundRecord,
  applyRefundToOrder,
  buildRefundRequest,
  refundRequiresSecondApprover,
  type RefundRequestInput,
} from "./refunds";
import { storeRepository, type OrderFilter, type StoreRepository } from "./repository";
import { STORE_CHAIR_PERSON_ID } from "./seed";
import {
  monthsCovered,
  receiptsReport,
  receiptsReportCsv,
  taxPeriodRows,
  isReceipted,
  inPeriod,
} from "./reports";
import { combinedBasisPoints, jurisdictionByCode } from "./tax";
import {
  STORE_ENTITY,
  type BuyerType,
  type InventoryRow,
  type Order,
  type PhysicalCount,
  type Period,
  type ReceiptsReport,
  type Refund,
  type TaxPeriodRow,
} from "./types";

function repo(): StoreRepository {
  return storeRepository();
}

const ENTITY: Entity = STORE_ENTITY;

/* ------------------------------------------------------------------ *
 * Orders
 * ------------------------------------------------------------------ */

/**
 * One order as the board sees it. `memberIdAtSale` is null and
 * `identityWithheld` true when the subject holds FINANCIAL READ but not
 * MEMBER_PII READ. The buyer type is never withheld: it is the tax record and
 * it identifies nobody.
 */
export type BoardOrderRow = {
  id: string;
  placedAt: string;
  buyerTypeAtSale: BuyerType;
  memberIdAtSale: string | null;
  identityWithheld: boolean;
  lineCount: number;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  taxRateBasisPoints: number;
  taxJurisdictionCode: string;
  totalCents: number;
  refundedCents: number;
  status: Order["status"];
  fulfilments: string[];
};

export async function boardOrderRows(
  subject: Subject,
  filter: OrderFilter = {},
): Promise<BoardOrderRow[]> {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity: ENTITY,
    required: "READ",
    rowLevel: true,
  });
  const maySeeMember = can({
    subject,
    dataClass: "MEMBER_PII",
    entity: ENTITY,
    required: "READ",
  });

  const orders = await repo().listOrders(ENTITY, filter);
  return orders
    .map((order) => ({
      id: order.id,
      placedAt: order.placedAt,
      buyerTypeAtSale: order.buyerTypeAtSale,
      memberIdAtSale: maySeeMember ? order.memberIdAtSale : null,
      identityWithheld: !maySeeMember && order.memberIdAtSale !== null,
      lineCount: order.lines.reduce((sum, l) => sum + l.quantity, 0),
      subtotalCents: order.subtotalCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      taxRateBasisPoints: order.taxRateBasisPoints,
      taxJurisdictionCode: order.taxJurisdictionCode,
      totalCents: order.totalCents,
      refundedCents: order.refundedCents,
      status: order.status,
      fulfilments: Array.from(new Set(order.lines.map((l) => l.fulfilment))).sort(),
    }));
}

/** Counts and totals only. AGGREGATE is enough, so the store chair sees this. */
export type BoardOrderSummary = {
  orderCount: number;
  memberOrderCount: number;
  nonMemberOrderCount: number;
  grossReceiptsCents: number;
  salesTaxCollectedCents: number;
  awaitingPaymentCount: number;
};

export async function boardOrderSummary(
  subject: Subject,
  filter: OrderFilter = {},
): Promise<BoardOrderSummary> {
  authorize({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "AGGREGATE" });
  const orders = await repo().listOrders(ENTITY, filter);
  const receipted = orders.filter(isReceipted);
  return {
    orderCount: orders.length,
    memberOrderCount: receipted.filter((o) => o.buyerTypeAtSale === "MEMBER").length,
    nonMemberOrderCount: receipted.filter((o) => o.buyerTypeAtSale === "NON_MEMBER").length,
    grossReceiptsCents: receipted.reduce((sum, o) => sum + o.subtotalCents + o.shippingCents, 0),
    salesTaxCollectedCents: receipted.reduce((sum, o) => sum + o.taxCents, 0),
    awaitingPaymentCount: orders.filter((o) => o.status === "AWAITING_PAYMENT").length,
  };
}

export function mayReadOrderRows(subject: Subject): boolean {
  return can({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "READ" });
}

/* ------------------------------------------------------------------ *
 * The compliance report
 * ------------------------------------------------------------------ */

export async function boardReceiptsReport(
  subject: Subject,
  period: Period,
): Promise<ReceiptsReport> {
  authorize({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "AGGREGATE" });
  return receiptsReport(await repo().listOrders(ENTITY), period);
}

export async function boardReceiptsCsv(subject: Subject, period: Period): Promise<string> {
  authorize({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "AGGREGATE" });
  return receiptsReportCsv(receiptsReport(await repo().listOrders(ENTITY), period));
}

export async function boardTaxPeriods(subject: Subject): Promise<TaxPeriodRow[]> {
  authorize({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "AGGREGATE" });
  const orders = await repo().listOrders(ENTITY);
  return taxPeriodRows(orders, monthsCovered(orders));
}

export async function boardPeriodsAvailable(subject: Subject): Promise<Period[]> {
  authorize({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "AGGREGATE" });
  return monthsCovered(await repo().listOrders(ENTITY));
}

/* ------------------------------------------------------------------ *
 * Inventory
 * ------------------------------------------------------------------ */

export type BoardInventory = {
  rows: InventoryRow[];
  quarter: string;
  skusMissingThisQuarter: string[];
  /** SKUs with no stock figures at all, because they are print-on-demand. */
  printOnDemandSkus: string[];
  counts: PhysicalCount[];
};

export async function boardInventory(subject: Subject): Promise<BoardInventory> {
  authorize({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "AGGREGATE" });
  // One read of each, rather than the four the synchronous version made. The
  // repository hands back a copy every time, so reading counts once and using
  // it three times is the same answer and three fewer round trips.
  const [products, movements, counts] = await Promise.all([
    repo().listProducts(ENTITY),
    repo().listMovements(ENTITY),
    repo().listCounts(ENTITY),
  ]);
  const rows = inventoryRows(products, movements, counts);
  const quarter = currentQuarter();
  return {
    rows,
    quarter,
    skusMissingThisQuarter: skusMissingCount(rows, counts, quarter),
    printOnDemandSkus: rows.filter((r) => r.fulfilment === "print_on_demand").map((r) => r.sku),
    counts,
  };
}

/** Whoever is recorded as chairing the store, for display. */
export async function recordedStoreChairPersonId(): Promise<string> {
  const holders = await repo().personsHolding("STORE_CHAIR", ENTITY);
  return holders.length > 0 ? holders[0] : STORE_CHAIR_PERSON_ID;
}

/**
 * The person the counter must not be.
 *
 * If the subject doing the counting holds STORE_CHAIR themselves, they ARE the
 * store chair and their own person ID is returned, so `assertNotSelfApproval`
 * refuses them. Deriving it from the subject's assignments rather than looking
 * up a recorded chair is what makes the control hold whatever the session
 * source is: it does not depend on the seeded person IDs lining up with
 * whatever identity the session hands us.
 */
export async function storeChairPersonIdFor(subject: Subject): Promise<string> {
  const holdsChairHere = subject.assignments.some(
    (a) => a.entity === ENTITY && a.role === "STORE_CHAIR",
  );
  return holdsChairHere ? subject.personId : recordedStoreChairPersonId();
}

/**
 * Record a quarterly count. Recording is a write on FINANCIAL, and the count
 * must not come from the store chair. Both checks are shared code: the first is
 * `authorize`, the second is `assertNotSelfApproval` inside
 * `buildPhysicalCount`.
 */
export async function boardRecordPhysicalCount(
  subject: Subject,
  input: Omit<PhysicalCountInput, "id" | "countedByPersonId" | "countedAt"> & {
    countedAt?: string;
  },
): Promise<PhysicalCount> {
  authorize({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "WRITE" });
  const product = await repo().findProduct(input.sku);
  if (!product) throw new Error(`No product ${input.sku}`);
  const count = buildPhysicalCount(
    {
      id: await repo().nextId("pc"),
      sku: input.sku,
      quarter: input.quarter,
      countedUnits: input.countedUnits,
      countedByPersonId: subject.personId,
      countedAt: input.countedAt ?? new Date().toISOString(),
    },
    product,
    await storeChairPersonIdFor(subject),
  );
  return repo().saveCount(count);
}

/* ------------------------------------------------------------------ *
 * Refunds
 * ------------------------------------------------------------------ */

export async function boardRefunds(subject: Subject): Promise<Refund[]> {
  authorize({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "AGGREGATE" });
  return repo().listRefunds(ENTITY);
}

export async function boardRequestRefund(
  subject: Subject,
  input: Omit<RefundRequestInput, "id" | "order" | "requestedByPersonId" | "requestedAt"> & {
    orderId: string;
  },
): Promise<Refund> {
  authorize({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "WRITE" });
  const order = await repo().findOrder(input.orderId);
  if (!order) throw new Error(`No order ${input.orderId}`);
  const refund = buildRefundRequest({
    id: await repo().nextId("rf"),
    order,
    amountCents: input.amountCents,
    reason: input.reason,
    requestedByPersonId: subject.personId,
    requestedAt: new Date().toISOString(),
  });
  return repo().saveRefund(refund);
}

/**
 * Approve. Above the threshold the approver must not be the requester, which
 * `approveRefundRecord` enforces through the shared `assertNotSelfApproval`.
 * The AuthzError propagates; this module has no override.
 */
export async function boardApproveRefund(
  subject: Subject,
  refundId: string,
): Promise<Refund> {
  authorize({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "WRITE" });
  const refund = await repo().findRefund(refundId);
  if (!refund) throw new Error(`No refund ${refundId}`);
  const approved = approveRefundRecord(refund, subject.personId, new Date().toISOString());
  const order = await repo().findOrder(refund.orderId);
  // The order is updated before the refund, and both are awaited rather than
  // fired off together: if the order write fails, the refund stays REQUESTED
  // and the queue still shows it. The other order would show an approved
  // refund against an order that never recorded it.
  if (order) await repo().saveOrder(applyRefundToOrder(order, approved));
  return repo().saveRefund(approved);
}

export { refundRequiresSecondApprover };

/* ------------------------------------------------------------------ *
 * The separation-of-duties banner
 * ------------------------------------------------------------------ */

export type StoreSodBanner = {
  findings: SodFinding[];
  rolesHeld: Role[];
  /** True when the signed-in person holds both TREASURER and STORE_CHAIR here. */
  holdsBoth: boolean;
};

/**
 * Reads `separationOfDutiesFindings` rather than re-deriving anything. The
 * banner is shown on the board store screens because this is where the
 * consequence of the overlap actually lands.
 */
export function storeSodBanner(subject: Subject): StoreSodBanner {
  const assignments = subject.assignments;
  const findings = separationOfDutiesFindings(subject.personId, assignments);
  const rolesHeld = assignments.filter((a) => a.entity === ENTITY).map((a) => a.role);
  return {
    findings,
    rolesHeld,
    holdsBoth: rolesHeld.includes("TREASURER") && rolesHeld.includes("STORE_CHAIR"),
  };
}

/* ------------------------------------------------------------------ *
 * Small helpers the screens want
 * ------------------------------------------------------------------ */

export function jurisdictionLabel(code: string): string {
  return jurisdictionByCode(code).label;
}

export function jurisdictionRate(code: string): number {
  return combinedBasisPoints(jurisdictionByCode(code));
}

export function ordersInPeriod(orders: Order[], period: Period): Order[] {
  return orders.filter((o) => inPeriod(o, period));
}
