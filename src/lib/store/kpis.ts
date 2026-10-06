/**
 * The Store and Sales Chair's dashboard figures.
 *
 * This file is the authorized read behind `/board/store`. It follows the same
 * guard pattern as `board.ts`: `authorize()` first, repository second, and the
 * route never touches the repository itself. The level demanded is AGGREGATE on
 * FINANCIAL for JSOA, because every figure on this dashboard is a total, a
 * split, a tax figure or a unit count. The Store Chair holds exactly that, so
 * the chair sees the whole dashboard. Nothing here is widened to READ to make a
 * tile work: the row-level order list stays behind `boardOrderRows`, and the
 * only thing this file asks about READ is whether to offer the chair a link to
 * a screen they can actually open.
 *
 * Two of these figures are compliance artefacts rather than sales statistics,
 * and the shape of the dashboard follows from that.
 *
 *   1. The member versus non-member split is the evidence IRS Pub. 3386 ch. 9
 *      requires an organization to keep when it runs an activity open to the
 *      public. The penalty for inadequate non-member records is not a tax on
 *      the non-member share; it is that *all* income from the public activity
 *      can be treated as unrelated business income. So the split gets the two
 *      largest figures on the page, and gross sales gets none: a single gross
 *      number tells the chair nothing they can act on and it hides the figure
 *      that carries legal weight.
 *
 *   2. Sales tax collected sits beside the split and never inside it. North
 *      Carolina does not exempt a nonprofit from collecting, the rate is
 *      sourced to the ship-to county, and what is collected is the state's
 *      money held in trust. Any figure that adds collected tax to receipts is
 *      wrong, so no figure here does.
 *
 * Print-on-demand is handled rather than assumed away. A print-on-demand line
 * has no shelf and no on-hand figure; it is excluded from the stock figures and
 * named in the provenance line, because reporting it as zero units on hand
 * would read as a shortage when the truth is that it never had stock.
 */

import type { Kpi } from "../../components/dashboard/Kpi";

import { authorize, can, type Subject } from "../authz/policy";

import { storeSodBanner, storeChairPersonIdFor, recordedStoreChairPersonId } from "./board";
import { formatCents } from "./cart";
import { currentQuarter, inventoryRows } from "./inventory";
import { refundRequiresSecondApprover } from "./refunds";
import { storeRepository } from "./repository";
import { inPeriod, isReceipted, monthsCovered, receiptsReport, yearPeriod } from "./reports";
import { SEED_PEOPLE } from "./seed";
import { STORE_ENTITY, type InventoryRow, type Order, type Period, type Refund } from "./types";

/** How far back "units sold" looks when judging whether a line will last. */
const COVER_WINDOW_DAYS = 90;

/** A refund waiting this long on its second approver is a problem, not a queue. */
const REFUND_STALE_DAYS = 14;

/* ------------------------------------------------------------------ *
 * Small shared helpers
 * ------------------------------------------------------------------ */

function personName(personId: string): string {
  if (SEED_PEOPLE[personId]) return SEED_PEOPLE[personId];
  if (personId.startsWith("dev:")) return `${personId.slice(4).replace(/-/g, " ")} (dev persona)`;
  return personId;
}

function ofTotal(part: number, total: number): string {
  return `${part.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
}

function ageInDays(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
}

function days(count: number): string {
  return count === 1 ? "1 day" : `${count} days`;
}

/** `2026-Q4` to `2026-Q3`. The quarter that has closed is the one with a verdict. */
function previousQuarter(quarter: string): string {
  const [year, q] = quarter.split("-Q");
  const n = Number(q);
  return n === 1 ? `${Number(year) - 1}-Q4` : `${year}-Q${n - 1}`;
}

/**
 * A hole in a filed period.
 *
 * Tax is sourced to the ship-to county and the rate and jurisdiction are stored
 * on the order so a later rate change cannot alter a period already filed. An
 * order that carries neither is unfilable: there is no way to say which
 * jurisdiction the collection belonged to.
 *
 * An out-of-state order is NOT a gap. It carries an explicit jurisdiction code
 * saying no collection obligation has been established and a rate of zero, so
 * the zero is a recorded decision rather than a missing one.
 */
function lacksTaxRecord(order: Order): boolean {
  if (order.taxJurisdictionCode.trim().length === 0) return true;
  if (!Number.isInteger(order.taxRateBasisPoints) || order.taxRateBasisPoints < 0) return true;
  // Inside NC there is always a rate. A zero here is an absent rate, not a
  // decision, because NC grants the store no collection exemption.
  if (order.taxJurisdictionCode.startsWith("NC-") && order.taxRateBasisPoints === 0) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * The facts the tiles and the actions are both built from
 * ------------------------------------------------------------------ */

type StoreFacts = {
  period: Period;
  orders: Order[];
  receiptedInPeriod: Order[];
  report: ReturnType<typeof receiptsReport>;
  memberGrossCents: number;
  memberOrderCount: number;
  nonMemberGrossCents: number;
  nonMemberOrderCount: number;
  nonMemberSharePercent: string;
  salesTaxCents: number;
  taxMonths: number;
  taxRecordGaps: Order[];
  awaitingPaymentCount: number;

  quarter: string;
  lastClosedQuarter: string;
  stockedRows: InventoryRow[];
  podRows: InventoryRow[];
  uncountedThisQuarter: InventoryRow[];
  countedLastClosedQuarter: number;
  lastClosedQuarterCounters: string[];
  countsByStoreChair: number;
  totalCounts: number;
  viewerHoldsBothRoles: boolean;
  recordedChairName: string;

  unitsOnHand: number;
  unitsSoldInWindow: number;
  shrinkageUnits: number;
  thinCover: InventoryRow[];
  podUnitsShipped: number;
  recentlyCounted: InventoryRow[];
  recentVariances: InventoryRow[];

  pendingSecondApproval: Refund[];
  oldestPendingDays: number | null;
  oldestPendingRaisedBy: string | null;
};

function collect(subject: Subject, now: Date): StoreFacts {
  const repo = storeRepository();
  const period = yearPeriod(now.getUTCFullYear());

  const orders = repo.listOrders(STORE_ENTITY);
  const receiptedInPeriod = orders.filter((o) => isReceipted(o) && inPeriod(o, period));
  const report = receiptsReport(orders, period);
  const member = report.rows.find((r) => r.buyerType === "MEMBER");
  const nonMember = report.rows.find((r) => r.buyerType === "NON_MEMBER");

  const products = repo.listProducts(STORE_ENTITY);
  const movements = repo.listMovements(STORE_ENTITY);
  const counts = repo.listCounts(STORE_ENTITY);
  const rows = inventoryRows(products, movements, counts);
  const stockedRows = rows.filter((r) => r.fulfilment === "stock");
  const podRows = rows.filter((r) => r.fulfilment === "print_on_demand");

  const quarter = currentQuarter(now);
  const lastClosedQuarter = previousQuarter(quarter);
  const uncountedThisQuarter = stockedRows.filter(
    (r) => !counts.some((c) => c.sku === r.sku && c.quarter === quarter),
  );
  const lastQuarterCounts = counts.filter((c) => c.quarter === lastClosedQuarter);
  const chairPersonId = storeChairPersonIdFor(subject);

  const windowStart = new Date(now.getTime() - COVER_WINDOW_DAYS * 86_400_000).toISOString();
  const soldInWindow = (sku: string): number =>
    movements
      .filter((m) => m.sku === sku && m.kind === "SALE" && m.occurredAt >= windowStart)
      .reduce((sum, m) => sum + Math.abs(m.units), 0);

  const pendingSecondApproval = repo
    .listRefunds(STORE_ENTITY)
    .filter((r) => r.status === "REQUESTED" && refundRequiresSecondApprover(r.amountCents))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const oldest = pendingSecondApproval[0] ?? null;

  // A variance is only a variance against a count taken recently. Comparing a
  // count from two quarters ago to today's book figure measures the sales that
  // happened in between, which is not what the control is for.
  const recentlyCounted = stockedRows.filter(
    (r) =>
      r.lastCount !== null &&
      (r.lastCount.quarter === quarter || r.lastCount.quarter === lastClosedQuarter),
  );

  return {
    period,
    orders,
    receiptedInPeriod,
    report,
    memberGrossCents: member?.grossReceiptsCents ?? 0,
    memberOrderCount: member?.orderCount ?? 0,
    nonMemberGrossCents: nonMember?.grossReceiptsCents ?? 0,
    nonMemberOrderCount: nonMember?.orderCount ?? 0,
    nonMemberSharePercent: (report.nonMemberShareBasisPoints / 100).toFixed(1),
    salesTaxCents: report.totalSalesTaxCollectedCents,
    taxMonths: monthsCovered(orders).length,
    taxRecordGaps: receiptedInPeriod.filter(lacksTaxRecord),
    awaitingPaymentCount: orders.filter((o) => o.status === "AWAITING_PAYMENT").length,

    quarter,
    lastClosedQuarter,
    stockedRows,
    podRows,
    uncountedThisQuarter,
    countedLastClosedQuarter: new Set(
      lastQuarterCounts
        .filter((c) => stockedRows.some((r) => r.sku === c.sku))
        .map((c) => c.sku),
    ).size,
    lastClosedQuarterCounters: Array.from(
      new Set(lastQuarterCounts.map((c) => c.countedByPersonId)),
    ).sort(),
    countsByStoreChair: counts.filter((c) => c.countedByPersonId === chairPersonId).length,
    totalCounts: counts.length,
    viewerHoldsBothRoles: storeSodBanner(subject).holdsBoth,
    recordedChairName: personName(recordedStoreChairPersonId()),

    unitsOnHand: stockedRows.reduce((sum, r) => sum + (r.unitsOnHand ?? 0), 0),
    unitsSoldInWindow: stockedRows.reduce((sum, r) => sum + soldInWindow(r.sku), 0),
    shrinkageUnits: movements
      .filter((m) => m.kind === "SHRINKAGE")
      .reduce((sum, m) => sum + Math.abs(m.units), 0),
    // On hand below what the line sold in the window: it will not see the
    // window out. Print-on-demand lines are absent from `stockedRows`, so a
    // line with no shelf never appears here as a shortage.
    thinCover: stockedRows.filter(
      (r) => r.unitsOnHand !== null && r.unitsOnHand < soldInWindow(r.sku),
    ),
    podUnitsShipped: podRows.reduce((sum, r) => sum + r.unitsOut, 0),
    recentlyCounted,
    recentVariances: recentlyCounted.filter(
      (r) => r.varianceUnits !== null && r.varianceUnits !== 0,
    ),

    pendingSecondApproval,
    oldestPendingDays: oldest ? ageInDays(oldest.requestedAt, now) : null,
    oldestPendingRaisedBy: oldest ? personName(oldest.createdById) : null,
  };
}

/* ------------------------------------------------------------------ *
 * The tiles
 * ------------------------------------------------------------------ */

/**
 * The dashboard figures. One authorized read: AGGREGATE on FINANCIAL for JSOA,
 * which is what the Store Chair holds. Throws AuthzError for a role that does
 * not reach the store's financial records, and the screen says so rather than
 * showing zeros.
 */
export function storeKpis(subject: Subject, now: Date = new Date()): Kpi[] {
  authorize({ subject, dataClass: "FINANCIAL", entity: STORE_ENTITY, required: "AGGREGATE" });
  const f = collect(subject, now);

  const kpis: Kpi[] = [];

  /* --- 1. The compliance artefact, member side. --- */
  kpis.push({
    key: "receipts-member",
    label: "Gross receipts from members",
    value: formatCents(f.memberGrossCents),
    status: "good",
    from:
      `${f.memberOrderCount} member orders in ${f.period.label}, by the buyer's status ` +
      `recorded at the sale. Sales price and delivery, before tax and before refunds.`,
  });

  /* --- 2. The compliance artefact, non-member side. This is the record whose
         adequacy decides the tax treatment of the whole activity. --- */
  kpis.push({
    key: "receipts-non-member",
    label: "Gross receipts from non-members",
    value: formatCents(f.nonMemberGrossCents),
    status: f.nonMemberOrderCount === 0 && f.nonMemberGrossCents > 0 ? "problem" : "good",
    from:
      `${f.nonMemberOrderCount} non-member orders in ${f.period.label}, ` +
      `${f.nonMemberSharePercent}% of ${formatCents(f.report.totalGrossReceiptsCents)} gross. ` +
      `Kept separately because inadequate non-member records make all income from a ` +
      `public activity taxable, not just this share.`,
  });

  /* --- 3. Beside the split, never inside it. --- */
  kpis.push({
    key: "sales-tax-held-in-trust",
    label: "Sales tax collected, held in trust",
    value: formatCents(f.salesTaxCents),
    status: "good",
    from:
      `Collected on ${f.receiptedInPeriod.length} receipted orders in ${f.period.label} at the ` +
      `ship-to county's rate. The state's money, not a receipt: it is not part of either ` +
      `figure above and the two are never added.`,
  });

  /* --- 4. A gap here is a hole in a period that gets filed. --- */
  const gaps = f.taxRecordGaps.length;
  const outOfState = f.receiptedInPeriod.filter(
    (o) => !o.taxJurisdictionCode.startsWith("NC-"),
  ).length;
  kpis.push({
    key: "tax-record-gaps",
    label: "Receipted orders with no jurisdiction or rate on record",
    value: ofTotal(gaps, f.receiptedInPeriod.length),
    target: `0 of ${f.receiptedInPeriod.length}`,
    status: gaps === 0 ? "good" : "problem",
    from:
      `Every receipted order in ${f.period.label} checked for a stored jurisdiction code and ` +
      `an integer basis-point rate` +
      (outOfState > 0
        ? `. ${outOfState} recorded outside NC at a zero rate with the reason stored, which is a record and not a gap.`
        : `.`),
  });

  /* --- 5. The second-counter control, which is the compensating control for
         the Treasurer also chairing the store. --- */
  const uncounted = f.uncountedThisQuarter.length;
  const stocked = f.stockedRows.length;
  const counters = f.lastClosedQuarterCounters.map(personName);
  const lastQuarterShort = f.countedLastClosedQuarter < stocked;
  kpis.push({
    key: "quarterly-count",
    label: `Stocked lines counted in ${f.quarter}`,
    value: ofTotal(stocked - uncounted, stocked),
    target: `${stocked} of ${stocked}`,
    status: uncounted === 0 && !lastQuarterShort && !f.viewerHoldsBothRoles ? "good" : "problem",
    from:
      `Counts recorded for ${f.quarter} against ${stocked} active stocked lines; ` +
      `${f.lastClosedQuarter} closed at ${ofTotal(f.countedLastClosedQuarter, stocked)}` +
      (counters.length > 0 ? `, counted by ${counters.join(" and ")}` : `, counted by nobody`) +
      `. ${f.countsByStoreChair} of ${f.totalCounts} counts on record were entered by the store chair` +
      (f.viewerHoldsBothRoles
        ? `, and you hold Treasurer and Store Chair together, so you cannot enter one either.`
        : `; the recorded chair is ${f.recordedChairName}.`),
  });

  /* --- 6. A refund is a cash-equivalent credit against a receipt the same
         person may have recorded. The threshold is $50, not $1,000. --- */
  const pending = f.pendingSecondApproval.length;
  const oldestDays = f.oldestPendingDays;
  kpis.push({
    key: "refunds-awaiting-second-approver",
    label: "Refunds awaiting a second approver",
    value: String(pending),
    target: "0",
    status:
      pending === 0
        ? "good"
        : oldestDays !== null && oldestDays >= REFUND_STALE_DAYS
          ? "problem"
          : "watch",
    from:
      pending === 0
        ? `Requested refunds above the $50 second-approver threshold, none outstanding. The threshold is low on purpose: a refund credits a receipt the store chair may also have recorded.`
        : `Requested refunds above the $50 second-approver threshold. Oldest ${days(oldestDays ?? 0)}, ` +
          `raised by ${f.oldestPendingRaisedBy}, who cannot also approve it.`,
  });

  /* --- 7. Stock, with print-on-demand excluded rather than reported as zero. --- */
  kpis.push({
    key: "stock-cover",
    label: `Stocked lines with under ${COVER_WINDOW_DAYS} days of cover`,
    value: ofTotal(f.thinCover.length, stocked),
    target: `0 of ${stocked}`,
    status: f.thinCover.length === 0 ? "good" : "problem",
    from:
      `Units on hand against units sold in the last ${COVER_WINDOW_DAYS} days, line by line: ` +
      `${f.unitsOnHand.toLocaleString("en-US")} on hand, ${f.unitsSoldInWindow} sold` +
      (f.shrinkageUnits > 0 ? `, ${f.shrinkageUnits} written off as shrinkage` : ``) +
      `. ${f.podRows.length} print-on-demand lines hold no stock and are not counted as zero.`,
  });

  return kpis;
}

/* ------------------------------------------------------------------ *
 * What to do about them
 * ------------------------------------------------------------------ */

export type StoreAction = {
  key: string;
  label: string;
  note: string;
  /** The figure the action is sized by. */
  count: string;
  href: string;
  urgent: boolean;
};

/**
 * The actions that follow from the figures. Same guard, same level. A link is
 * only offered when the signed-in role can open what is on the other end of
 * it: the order list needs READ, which the Store Chair does not hold, so the
 * chair is not sent to a screen that will refuse them.
 */
export function storeActions(subject: Subject, now: Date = new Date()): StoreAction[] {
  authorize({ subject, dataClass: "FINANCIAL", entity: STORE_ENTITY, required: "AGGREGATE" });
  const f = collect(subject, now);
  const actions: StoreAction[] = [];

  if (f.uncountedThisQuarter.length > 0) {
    actions.push({
      key: "record-count",
      label: `Get ${f.quarter}'s physical count recorded`,
      note: f.viewerHoldsBothRoles
        ? "You hold both Treasurer and Store Chair, so you cannot enter it. Ask the assistant treasurer or the Finance Review Officer to count and record it."
        : "It has to be entered by somebody other than the store chair. That is the whole control.",
      count: `${f.uncountedThisQuarter.length} lines uncounted`,
      href: "/board/store/inventory",
      urgent: true,
    });
  }

  if (f.pendingSecondApproval.length > 0) {
    actions.push({
      key: "approve-refunds",
      label: "Approve or refuse the refunds waiting on a second approver",
      note: `Above $50 a refund needs a second person, and not the person who raised it.`,
      count: `${f.pendingSecondApproval.length} waiting, oldest ${days(f.oldestPendingDays ?? 0)}`,
      href: "/board/store/refunds",
      urgent: true,
    });
  }

  if (f.taxRecordGaps.length > 0) {
    actions.push({
      key: "fix-tax-records",
      label: "Put a jurisdiction and rate on the orders that have none",
      note: "A filed period cannot be reconstructed from an order that does not say which county it was sourced to.",
      count: `${f.taxRecordGaps.length} orders`,
      href: "/board/store/tax",
      urgent: true,
    });
  }

  actions.push({
    key: "receipts-report",
    label: "Export the member and non-member receipts for the CPA",
    note: "The separate records the public-activity rule asks for, as filed figures rather than a retyped summary.",
    count: `${f.period.label}, ${f.nonMemberSharePercent}% non-member`,
    href: "/board/store/receipts",
    urgent: false,
  });

  actions.push({
    key: "tax-periods",
    label: "Reconcile the sales tax periods before remitting",
    note: "Collected tax is held in trust. The rate and jurisdiction on each order are what the period is filed from.",
    count: `${f.taxMonths} periods, ${formatCents(f.salesTaxCents)} held`,
    href: "/board/store/tax",
    urgent: false,
  });

  actions.push({
    key: "inventory",
    label: "Review stock on hand against what has sold",
    note: `${f.podRows.length} of the catalogue's lines are printed to order and hold no stock.`,
    count: `${f.stockedRows.length + f.podRows.length} active lines`,
    href: "/board/store/inventory",
    urgent: false,
  });

  // READ, which the Store Chair does not hold. The link is withheld rather
  // than offered and then refused on arrival.
  if (can({ subject, dataClass: "FINANCIAL", entity: STORE_ENTITY, required: "READ" })) {
    actions.push({
      key: "orders",
      label: "Work the order list",
      note: "Row-level orders need read on financial records, which this role holds.",
      count: `${f.orders.length} orders, ${f.awaitingPaymentCount} awaiting payment`,
      href: "/board/store/orders",
      urgent: false,
    });
  }

  return actions;
}

/* ------------------------------------------------------------------ *
 * The second tier: real, but not worth a tile
 * ------------------------------------------------------------------ */

export type StoreNote = {
  key: string;
  label: string;
  value: string | null;
  detail: string;
};

/**
 * Figures that belong on the page but not in the grid, including the one this
 * module cannot compute. Cover to the next event is the figure the chair would
 * most like and the one that is honestly unavailable: the store module holds no
 * event calendar, and inventing a date to divide by would be worse than saying
 * so.
 */
export function storeSecondTier(subject: Subject, now: Date = new Date()): StoreNote[] {
  authorize({ subject, dataClass: "FINANCIAL", entity: STORE_ENTITY, required: "AGGREGATE" });
  const f = collect(subject, now);

  return [
    {
      key: "event-cover",
      label: "Stock cover to the next event",
      value: null,
      detail:
        "Needs the event calendar, which this module does not hold, and a demand figure for " +
        "selling from a table rather than by post. Dividing stock by mail-order sales would " +
        "answer a different question.",
    },
    {
      key: "pod-lines",
      label: "Print-on-demand lines",
      value: `${f.podRows.length} lines, ${f.podUnitsShipped} units shipped by the printer`,
      detail:
        "No units in, no units on hand, no count. The board has not chosen between holding " +
        "stock and printing to order, so the choice is a field on the product and these lines " +
        "read as not stocked rather than as empty shelves.",
    },
    {
      key: "awaiting-payment",
      label: "Orders awaiting payment",
      value: String(f.awaitingPaymentCount),
      detail: "Not receipts, so absent from the split, the tax figure and the refund queue.",
    },
    {
      key: "variances",
      label: "Recent counts that disagreed with the book figure",
      value: `${f.recentVariances.length} of ${f.recentlyCounted.length} counted`,
      detail:
        `Counted units against units on hand, for counts taken in ${f.lastClosedQuarter} or ` +
        `${f.quarter}. An older count is left out: the book figure has moved since it was ` +
        `taken, so the difference would not be a variance. Variances are recorded as found, ` +
        `not corrected to match the books.`,
    },
  ];
}
