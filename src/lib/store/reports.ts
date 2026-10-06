/**
 * Store reporting. Pure functions over orders; the authorized entry points are
 * in `board.ts`.
 *
 * The member versus non-member receipts report is the compliance artefact of
 * this module. It exists because IRS Pub. 3386 ch. 9 requires an organization
 * running an activity open to the public to keep separate records of gross
 * receipts from members and from non-members, and because the consequence of
 * not keeping adequate non-member records is not a penalty on the non-member
 * share: it is that *all* receipts from the public activity are treated as
 * unrelated business income. The report is therefore a control on the
 * organization's tax position, and the CSV export exists so it can be handed
 * to the CPA as it stands rather than retyped.
 */

import type {
  BuyerType,
  Order,
  Period,
  ReceiptsReport,
  ReceiptsSplitRow,
  TaxPeriodRow,
} from "./types";
import { STORE_ENTITY } from "./types";

/** Orders where money actually moved. An unpaid or cancelled order is not a receipt. */
const RECEIPTED_STATUSES: Order["status"][] = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];

export function isReceipted(order: Order): boolean {
  return RECEIPTED_STATUSES.includes(order.status);
}

export function inPeriod(order: Order, period: Period): boolean {
  return order.placedAt >= period.from && order.placedAt < period.to;
}

export function monthPeriod(year: number, month: number): Period {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    label: `${start.toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${year}`,
  };
}

export function quarterPeriod(year: number, quarter: 1 | 2 | 3 | 4): Period {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(quarter === 4 ? year + 1 : year, quarter === 4 ? 0 : startMonth + 3, 1));
  return { from: start.toISOString(), to: end.toISOString(), label: `${year} Q${quarter}` };
}

export function yearPeriod(year: number): Period {
  return {
    from: new Date(Date.UTC(year, 0, 1)).toISOString(),
    to: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
    label: `${year}`,
  };
}

/** Every month that has at least one receipted order, oldest first. */
export function monthsCovered(orders: Order[]): Period[] {
  const keys = new Set<string>();
  for (const order of orders) {
    if (!isReceipted(order)) continue;
    const d = new Date(order.placedAt);
    keys.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
  }
  return Array.from(keys)
    .map((k) => {
      const [y, m] = k.split("-");
      return monthPeriod(Number(y), Number(m));
    })
    .sort((a, b) => a.from.localeCompare(b.from));
}

export const RECEIPTS_REPORT_NOTE =
  "Why this report exists, in plain terms. The Association may run a store " +
  "that is open to the public, but the tax treatment of what it takes in " +
  "depends on who bought. Sales to members are related to the purpose the " +
  "Association is exempt for. Sales to the general public are not, and are " +
  "generally taxable as unrelated business income. The federal rule is that " +
  "the organization has to keep separate records of the two. If the " +
  "non-member records are not adequate, the consequence is not a tax on the " +
  "non-member share alone: the whole of the income from the public activity " +
  "can be treated as unrelated business income. That is why every order " +
  "records whether the buyer was a member on the day of the sale, and why " +
  "that answer is never recalculated afterwards. A member who lapses next " +
  "year does not change what this period's receipts were.";

/** The split. One row per buyer type, always both rows, even at zero. */
export function receiptsReport(orders: Order[], period: Period): ReceiptsReport {
  const scoped = orders.filter((o) => isReceipted(o) && inPeriod(o, period));

  const rows: ReceiptsSplitRow[] = (["MEMBER", "NON_MEMBER"] as BuyerType[]).map((buyerType) => {
    const forType = scoped.filter((o) => o.buyerTypeAtSale === buyerType);
    const grossReceiptsCents = forType.reduce(
      (sum, o) => sum + o.subtotalCents + o.shippingCents,
      0,
    );
    const refundedCents = forType.reduce((sum, o) => sum + o.refundedCents, 0);
    return {
      buyerType,
      orderCount: forType.length,
      grossReceiptsCents,
      salesTaxCollectedCents: forType.reduce((sum, o) => sum + o.taxCents, 0),
      refundedCents,
      netReceiptsCents: grossReceiptsCents - refundedCents,
    };
  });

  const totalGrossReceiptsCents = rows.reduce((sum, r) => sum + r.grossReceiptsCents, 0);
  const nonMember = rows.find((r) => r.buyerType === "NON_MEMBER");
  const nonMemberGross = nonMember ? nonMember.grossReceiptsCents : 0;

  return {
    entity: STORE_ENTITY,
    period,
    rows,
    totalGrossReceiptsCents,
    totalSalesTaxCollectedCents: rows.reduce((sum, r) => sum + r.salesTaxCollectedCents, 0),
    nonMemberShareBasisPoints:
      totalGrossReceiptsCents === 0
        ? 0
        : Math.round((nonMemberGross * 10_000) / totalGrossReceiptsCents),
    note: RECEIPTS_REPORT_NOTE,
  };
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * CSV for the CPA. Figures are in dollars with two decimals because that is
 * what a return is filed in; the cent figures stay in the JSON for anything
 * that has to reconcile exactly.
 */
export function receiptsReportCsv(report: ReceiptsReport): string {
  const lines: string[][] = [
    ["Entity", report.entity],
    ["Period", report.period.label],
    ["Period start (UTC)", report.period.from],
    ["Period end, exclusive (UTC)", report.period.to],
    [],
    [
      "Buyer type at time of sale",
      "Orders",
      "Gross receipts (USD)",
      "Refunds (USD)",
      "Net receipts (USD)",
      "Sales tax collected (USD)",
    ],
  ];

  for (const row of report.rows) {
    lines.push([
      row.buyerType === "MEMBER" ? "Member" : "Non-member",
      String(row.orderCount),
      dollars(row.grossReceiptsCents),
      dollars(row.refundedCents),
      dollars(row.netReceiptsCents),
      dollars(row.salesTaxCollectedCents),
    ]);
  }

  lines.push([
    "Total",
    String(report.rows.reduce((s, r) => s + r.orderCount, 0)),
    dollars(report.totalGrossReceiptsCents),
    dollars(report.rows.reduce((s, r) => s + r.refundedCents, 0)),
    dollars(report.rows.reduce((s, r) => s + r.netReceiptsCents, 0)),
    dollars(report.totalSalesTaxCollectedCents),
  ]);

  lines.push([]);
  lines.push(["Non-member share of gross receipts", `${(report.nonMemberShareBasisPoints / 100).toFixed(2)}%`]);
  lines.push([]);
  lines.push(["Note", report.note]);

  return lines.map((cells) => cells.map(csvCell).join(",")).join("\n");
}

/* ------------------------------------------------------------------ *
 * Sales tax collected per period.
 * ------------------------------------------------------------------ */

export function taxPeriodRows(orders: Order[], periods: Period[]): TaxPeriodRow[] {
  return periods.map((period) => {
    const scoped = orders.filter((o) => isReceipted(o) && inPeriod(o, period));
    return {
      period,
      taxableBaseCents: scoped.reduce((sum, o) => sum + o.taxableBaseCents, 0),
      exemptBaseCents: scoped.reduce(
        (sum, o) => sum + o.subtotalCents + o.shippingCents - o.taxableBaseCents,
        0,
      ),
      salesTaxCollectedCents: scoped.reduce((sum, o) => sum + o.taxCents, 0),
      orderCount: scoped.length,
      jurisdictionCodes: Array.from(new Set(scoped.map((o) => o.taxJurisdictionCode))).sort(),
    };
  });
}
