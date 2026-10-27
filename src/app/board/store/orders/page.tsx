import Link from "next/link";

import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { boardOrderRows, boardOrderSummary, jurisdictionLabel } from "@/lib/store/board";
import { formatCents } from "@/lib/store/cart";
import { formatRate } from "@/lib/store/tax";
import type { BuyerType } from "@/lib/store/types";

import styles from "../board.module.css";
import { personLabel, Refused, StoreHeader, StoreScreen, StoreSodWarning } from "../parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Store orders — JSOA board",
  robots: { index: false, follow: false },
};

const FILTERS: { key: string; label: string; value: BuyerType | "ALL" }[] = [
  { key: "all", label: "All buyers", value: "ALL" },
  { key: "member", label: "Members", value: "MEMBER" },
  { key: "non-member", label: "Non-members", value: "NON_MEMBER" },
];

export default async function BoardStoreOrders({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const subject = await getCurrentSubject();
  const filterKey = typeof params.buyer === "string" ? params.buyer : "all";
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const held = effectiveLevel(subject, "FINANCIAL", "JSOA");

  let rows = null;
  let summary = null;
  try {
    rows = await boardOrderRows(subject, { buyerType: filter.value });
  } catch {
    rows = null;
  }
  try {
    summary = await boardOrderSummary(subject, { buyerType: filter.value });
  } catch {
    summary = null;
  }

  return (
    <StoreScreen>
      <StoreHeader here="/board/store/orders" title="Orders" />
        <p className={styles.lede}>
          Filterable by whether the buyer was a member at the time of the sale.
          That field is the one recorded on the order and is never recalculated,
          so this filter reports history rather than the current roster.
        </p>

        <StoreSodWarning subject={subject} />

        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/board/store/orders?buyer=${f.key}`}
              className={`${styles.action} ${f.key === filter.key ? "" : styles.actionQuiet}`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {summary !== null ? (
          <div className={styles.figures}>
            <div className={styles.figure}>
              <span className={styles.figureKey}>Orders shown</span>
              <div className={styles.figureValue}>{summary.orderCount}</div>
            </div>
            <div className={styles.figure}>
              <span className={styles.figureKey}>Gross receipts</span>
              <div className={styles.figureValue}>
                {formatCents(summary.grossReceiptsCents)}
              </div>
            </div>
            <div className={styles.figure}>
              <span className={styles.figureKey}>Sales tax collected</span>
              <div className={styles.figureValue}>
                {formatCents(summary.salesTaxCollectedCents)}
              </div>
            </div>
          </div>
        ) : null}

        {rows === null ? (
          <Refused
            what="The order list, row by row"
            needed="read"
            held={held.toLowerCase()}
            because={
              subject.mfaSatisfied
                ? "An order row carries a buyer handle and can carry a member ID, so it is row-level financial data. A role with aggregate sees the totals above and the receipts report, not the rows."
                : "The TOTP challenge has not been satisfied this session."
            }
          />
        ) : rows.length === 0 ? (
          <p className={styles.empty}>No orders match that filter.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Buyer at sale</th>
                  <th>Member ID at sale</th>
                  <th className={styles.num}>Units</th>
                  <th className={styles.num}>Goods</th>
                  <th className={styles.num}>Shipping</th>
                  <th>Tax jurisdiction</th>
                  <th className={styles.num}>Tax</th>
                  <th className={styles.num}>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.id}</td>
                    <td>
                      {new Date(row.placedAt).toLocaleDateString("en-US", {
                        timeZone: "America/New_York",
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td>
                      <span
                        className={
                          row.buyerTypeAtSale === "MEMBER" ? styles.chipHue : styles.chip
                        }
                      >
                        {row.buyerTypeAtSale === "MEMBER" ? "member" : "non-member"}
                      </span>
                    </td>
                    <td className="mono">
                      {row.memberIdAtSale ??
                        (row.identityWithheld ? "withheld from this role" : "none")}
                    </td>
                    <td className={styles.num}>{row.lineCount}</td>
                    <td className={styles.num}>{formatCents(row.subtotalCents)}</td>
                    <td className={styles.num}>{formatCents(row.shippingCents)}</td>
                    <td>
                      {jurisdictionLabel(row.taxJurisdictionCode)}
                      <br />
                      <span className="eyebrow">{formatRate(row.taxRateBasisPoints)}</span>
                    </td>
                    <td className={styles.num}>{formatCents(row.taxCents)}</td>
                    <td className={styles.num}>{formatCents(row.totalCents)}</td>
                    <td>
                      <span className={styles.chip}>{row.status.toLowerCase().replace(/_/g, " ")}</span>
                      {row.refundedCents > 0 ? (
                        <>
                          <br />
                          <span className="eyebrow">
                            {formatCents(row.refundedCents)} refunded
                          </span>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className={styles.note}>
          A member ID is member data, so it needs read on member records as well
          as read on financial records. A role with one and not the other sees
          the order and not the member behind it. The buyer type is never
          withheld: it identifies nobody and it is the tax record.
        </p>
    </StoreScreen>
  );
}
