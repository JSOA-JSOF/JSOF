import Link from "next/link";

import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { boardPeriodsAvailable, boardReceiptsReport } from "@/lib/store/board";
import { formatCents } from "@/lib/store/cart";
import { monthPeriod, quarterPeriod, yearPeriod } from "@/lib/store/reports";
import type { Period } from "@/lib/store/types";

import styles from "../board.module.css";
import { personLabel, Refused, StoreHeader, StoreScreen, StoreSodWarning } from "../parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Member and non-member receipts — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The compliance artefact.
 *
 * Gross receipts split by whether the buyer was a member at the time of the
 * sale, per period, with the reason it exists written on the page in plain
 * words rather than as a citation. Exportable as CSV so it can go to the CPA
 * as it stands.
 *
 * Needs AGGREGATE, not READ: it is totals and counts and names nobody. The
 * Store Chair can therefore see it, which is the point, since the Store Chair
 * is the person whose activity creates the exposure.
 */

const PRESETS: { key: string; label: string; period: () => Period }[] = [
  { key: "2026", label: "2026 to date", period: () => yearPeriod(2026) },
  { key: "2026-Q3", label: "2026 Q3", period: () => quarterPeriod(2026, 3) },
  { key: "2026-Q2", label: "2026 Q2", period: () => quarterPeriod(2026, 2) },
  { key: "2026-09", label: "September 2026", period: () => monthPeriod(2026, 9) },
  { key: "2026-08", label: "August 2026", period: () => monthPeriod(2026, 8) },
  { key: "2026-07", label: "July 2026", period: () => monthPeriod(2026, 7) },
];

export default async function ReceiptsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const subject = await getCurrentSubject();
  const presetKey = typeof params.period === "string" ? params.period : "2026";
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
  const held = effectiveLevel(subject, "FINANCIAL", "JSOA");

  let report = null;
  let monthly: Period[] = [];
  try {
    report = await boardReceiptsReport(subject, preset.period());
    monthly = await boardPeriodsAvailable(subject);
  } catch {
    report = null;
  }

  return (
    <StoreScreen>
      <StoreHeader here="/board/store/receipts" title="Member and non-member receipts" />

        {report === null ? (
          <>
            <StoreSodWarning subject={subject} />
            <Refused
              what="The receipts split"
              needed="aggregate"
              held={held.toLowerCase()}
              because={
                subject.mfaSatisfied
                  ? "The role table gives this role no reach into JSOA financial records."
                  : "The TOTP challenge has not been satisfied this session."
              }
            />
          </>
        ) : (
          <>
            <p className={styles.lede}>
              Gross receipts for {report.period.label}, split by whether the
              buyer was a member on the day of the sale.
            </p>

            <StoreSodWarning subject={subject} />

            <div className={styles.filters}>
              {PRESETS.map((p) => (
                <Link
                  key={p.key}
                  href={`/board/store/receipts?period=${p.key}`}
                  className={`${styles.action} ${p.key === preset.key ? "" : styles.actionQuiet}`}
                >
                  {p.label}
                </Link>
              ))}
            </div>

            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Buyer at time of sale</th>
                    <th className={styles.num}>Orders</th>
                    <th className={styles.num}>Gross receipts</th>
                    <th className={styles.num}>Refunds</th>
                    <th className={styles.num}>Net receipts</th>
                    <th className={styles.num}>Sales tax collected</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.buyerType}>
                      <td>{row.buyerType === "MEMBER" ? "Member" : "Non-member"}</td>
                      <td className={styles.num}>{row.orderCount}</td>
                      <td className={styles.num}>{formatCents(row.grossReceiptsCents)}</td>
                      <td className={styles.num}>{formatCents(row.refundedCents)}</td>
                      <td className={styles.num}>{formatCents(row.netReceiptsCents)}</td>
                      <td className={styles.num}>
                        {formatCents(row.salesTaxCollectedCents)}
                      </td>
                    </tr>
                  ))}
                  <tr className={styles.totalRow}>
                    <td>Total</td>
                    <td className={styles.num}>
                      {report.rows.reduce((s, r) => s + r.orderCount, 0)}
                    </td>
                    <td className={styles.num}>
                      {formatCents(report.totalGrossReceiptsCents)}
                    </td>
                    <td className={styles.num}>
                      {formatCents(report.rows.reduce((s, r) => s + r.refundedCents, 0))}
                    </td>
                    <td className={styles.num}>
                      {formatCents(report.rows.reduce((s, r) => s + r.netReceiptsCents, 0))}
                    </td>
                    <td className={styles.num}>
                      {formatCents(report.totalSalesTaxCollectedCents)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className={styles.figures}>
              <div className={styles.figure}>
                <span className={styles.figureKey}>Non-member share</span>
                <div className={styles.figureValue}>
                  {(report.nonMemberShareBasisPoints / 100).toFixed(2)}%
                </div>
                <p className={styles.figureNote}>of gross receipts this period</p>
              </div>
              <div className={styles.figure}>
                <span className={styles.figureKey}>Entity</span>
                <div className={styles.figureValue}>{report.entity}</div>
                <p className={styles.figureNote}>
                  The Foundation has no store and no line on this report
                </p>
              </div>
            </div>

            <div className={styles.actionRow}>
              <Link
                href={`/board/store/receipts/export?period=${preset.key}`}
                className={styles.action}
                prefetch={false}
              >
                Download this report as CSV
              </Link>
            </div>

            <div className={styles.whyNote}>
              <strong>Why this report exists.</strong> {report.note}
            </div>

            <h2 className={styles.sectionHead}>Month by month</h2>
            <div className={styles.filters}>
              {monthly.map((period) => (
                <span key={period.from} className={styles.chip}>
                  {period.label}
                </span>
              ))}
            </div>
            <p className={styles.note}>
              Pick a month above to run the split for that period alone. The
              periods listed are the ones with receipted orders in them.
            </p>
          </>
        )}
    </StoreScreen>
  );
}
