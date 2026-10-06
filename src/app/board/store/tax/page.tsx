import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { boardTaxPeriods, jurisdictionLabel } from "@/lib/store/board";
import { formatCents } from "@/lib/store/cart";
import {
  ANNUAL_FUNDRAISING_EXEMPTION_CONDITIONS,
  annualFundraisingExemptionApplies,
  COLLECTION_POSTURE_NOTE,
  TAX_RATE_SOURCING_NOTE,
} from "@/lib/store/tax";

import styles from "../board.module.css";
import { personLabel, Refused, StoreHeader, StoreScreen, StoreSodWarning } from "../parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sales tax collected — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * Sales tax collected per period, and the reason the store collects at all.
 *
 * The exemption table on this page is not decoration. The board's expectation
 * is likely to be that a nonprofit does not charge sales tax, so the screen
 * shows the six conditions of the annual-fundraising exemption and which of
 * them a year-round catalogue fails, rather than asserting a conclusion.
 */
export default async function SalesTaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const subject = await getCurrentSubject();
  const held = effectiveLevel(subject, "FINANCIAL", "JSOA");

  let rows = null;
  try {
    rows = boardTaxPeriods(subject);
  } catch {
    rows = null;
  }

  return (
    <StoreScreen>
      <StoreHeader here="/board/store/tax" title="Sales tax collected" />
        <p className={styles.lede}>
          Per period, with the taxable base it was computed on. Collected tax is
          the state&apos;s money held until it is remitted, so it is reported
          separately from receipts and is never added into them.
        </p>

        <StoreSodWarning subject={subject} />

        {rows === null ? (
          <Refused
            what="The sales tax figures"
            needed="aggregate"
            held={held.toLowerCase()}
            because={
              subject.mfaSatisfied
                ? "The role table gives this role no reach into JSOA financial records."
                : "The TOTP challenge has not been satisfied this session."
            }
          />
        ) : rows.length === 0 ? (
          <p className={styles.empty}>No receipted orders yet, so nothing has been collected.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Period</th>
                  <th className={styles.num}>Orders</th>
                  <th className={styles.num}>Taxable base</th>
                  <th className={styles.num}>Not in the tax base</th>
                  <th className={styles.num}>Tax collected</th>
                  <th>Jurisdictions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.period.from}>
                    <td>{row.period.label}</td>
                    <td className={styles.num}>{row.orderCount}</td>
                    <td className={styles.num}>{formatCents(row.taxableBaseCents)}</td>
                    <td className={styles.num}>{formatCents(row.exemptBaseCents)}</td>
                    <td className={styles.num}>{formatCents(row.salesTaxCollectedCents)}</td>
                    <td>
                      {row.jurisdictionCodes.map((code) => (
                        <span key={code} className="eyebrow">
                          {jurisdictionLabel(code)}
                          <br />
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
                <tr className={styles.totalRow}>
                  <td>All periods</td>
                  <td className={styles.num}>
                    {rows.reduce((s, r) => s + r.orderCount, 0)}
                  </td>
                  <td className={styles.num}>
                    {formatCents(rows.reduce((s, r) => s + r.taxableBaseCents, 0))}
                  </td>
                  <td className={styles.num}>
                    {formatCents(rows.reduce((s, r) => s + r.exemptBaseCents, 0))}
                  </td>
                  <td className={styles.num}>
                    {formatCents(rows.reduce((s, r) => s + r.salesTaxCollectedCents, 0))}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.whyNote}>
          <strong>Why the store charges sales tax.</strong> {COLLECTION_POSTURE_NOTE}
        </div>

        <h2 className={styles.sectionHead}>
          The annual fundraising exemption, condition by condition
        </h2>
        <p className={styles.lede}>
          All six have to hold at once. The store meets{" "}
          {ANNUAL_FUNDRAISING_EXEMPTION_CONDITIONS.filter((c) => c.metByYearRoundStore).length} of
          them, so the exemption{" "}
          {annualFundraisingExemptionApplies() ? "applies" : "does not apply"}.
        </p>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Condition</th>
                <th>Met by a year-round store</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {ANNUAL_FUNDRAISING_EXEMPTION_CONDITIONS.map((condition) => (
                <tr key={condition.condition}>
                  <td>{condition.condition}</td>
                  <td>
                    <span
                      className={
                        condition.metByYearRoundStore ? styles.chipHue : styles.chipWarn
                      }
                    >
                      {condition.metByYearRoundStore ? "met" : "not met"}
                    </span>
                  </td>
                  <td>{condition.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className={styles.note}>{TAX_RATE_SOURCING_NOTE}</p>
        <p className={styles.note}>
          Research, not advice. The rate table and the reading of the exemption
          both need the CPA&apos;s sign-off before the store takes a live
          payment, and the Association needs to be registered with the state
          before it collects anything.
        </p>
    </StoreScreen>
  );
}
