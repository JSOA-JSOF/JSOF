import Link from "next/link";

import { RoleTabs } from "@/components/workspace-shell/RoleTabs";
import { AuthzError } from "@/lib/authz/policy";
import { issueReceipt, readDonationRegister } from "@/lib/donations/actions";
import {
  functionTabHref,
  functionTabs,
  WORKSPACE_BASE,
} from "@/lib/donations/workspace";
import { DEV_SWITCHER_PARAM } from "@/lib/donations/devSubject";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import {
  NC_131F_DISCLOSURE,
  NC_131F_STATUTE_LABEL,
} from "@/lib/donations/disclosure";
import { formatCents } from "@/lib/donations/money";
import { ReceiptError } from "@/lib/donations/receipts";
import Denied from "../Denied";
import styles from "../donations.module.css";

export const metadata = {
  title: "Gift register — board",
  robots: { index: false, follow: false },
};

/**
 * The gift register for one entity, with the receipt each gift would produce.
 *
 * This used to be /board/donations itself. When that route became the
 * dashboard the register had nowhere to live, and a screen carrying every
 * allocation, every benefit valuation and the receipt preview is not something
 * to lose to a layout change. It moved here intact.
 *
 * `readDonationRegister` calls `authorize()` for FINANCIAL READ at row level
 * before it reads anything, so a role holding only AGGREGATE lands on the
 * refusal rather than on a redacted table. The preview receipt is rendered
 * with an explicit sequence so refreshing the page does not burn receipt
 * numbers.
 */
export default async function DonationsBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const asParam = params[DEV_SWITCHER_PARAM];
  const { subject, entity, roleLabel, qs } = await resolveScreenViewer(asParam);
  const hue = entity === "JSOA" ? "var(--jsoa)" : "var(--jsof)";
  const hueTint = entity === "JSOA" ? "var(--jsoa-tint)" : "var(--jsof-tint)";

  let register: ReturnType<typeof readDonationRegister> | null = null;
  let denial: string | null = null;
  try {
    register = readDonationRegister(subject, entity);
  } catch (error) {
    denial = error instanceof AuthzError ? error.message : String(error);
  }

  return (
    <div
      className={styles.page}
      style={{ ["--hue" as string]: hue, ["--hueTint" as string]: hueTint }}
    >
      <header className={styles.bar}>
        <Link href="/" className={styles.back}>
          ← Both entities
        </Link>
        <span className={styles.status}>Board · donations · {entity}</span>
      </header>

      <div className={styles.body}>
        <h1 className={styles.title}>Gifts</h1>
        <p className={styles.lede}>
          Every gift to {entity}, the funds it was split across, and the receipt
          it produces. A gift that cannot produce a receipt says so, with the
          reason.
        </p>

        {/* The workspace spine, with this module's three function screens
            appended. This screen is the gift register and keeps its route. */}
        <RoleTabs
          base={WORKSPACE_BASE}
          current={functionTabHref("gifts", qs)}
          functionTabs={functionTabs(qs)}
        />
        <p className={styles.sectionNote}>
          <Link href="/donate" className={styles.back}>
            The public donate form
          </Link>{" "}
          is what a donor fills in before any of this exists.
        </p>


        {denial && (
          <Denied
            roleLabel={roleLabel}
            needs={`read access to ${entity} financial records at row level`}
            detail={denial}
          />
        )}

        {register && (
          <>
            <h2 className={styles.sectionHead}>Register</h2>
            <p className={styles.sectionNote}>
              {register.length} {register.length === 1 ? "gift" : "gifts"} to{" "}
              {entity}. This register is never summed with the other
              entity&rsquo;s.
            </p>

            {register.map(({ donation, receiptBlockedBecause }) => {
              let preview: ReturnType<typeof issueReceipt> | null = null;
              let receiptProblem: string | null = receiptBlockedBecause;
              if (!receiptBlockedBecause) {
                try {
                  preview = issueReceipt(subject, entity, donation.id, undefined, {
                    sequence: 0,
                  });
                } catch (error) {
                  receiptProblem =
                    error instanceof ReceiptError ? error.message : String(error);
                }
              }

              return (
                <div className={styles.card} key={donation.id}>
                  <div className={styles.cardHead}>
                    <span className={styles.cardTitle}>{donation.donorDisplayName}</span>
                    <span className={styles.figure}>
                      {formatCents(donation.amountCents)}
                    </span>
                  </div>
                  <p className={styles.cardMeta}>
                    <span className="mono">{donation.id}</span> ·{" "}
                    {donation.receivedAt.slice(0, 10)} ·{" "}
                    <span className={styles.pill}>
                      {donation.status.toLowerCase().replace(/_/g, " ")}
                    </span>
                  </p>

                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Fund</th>
                          <th className={styles.numeric}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview
                          ? preview.receipt.allocations.map((line, index) => (
                              <tr key={index}>
                                <td>
                                  {line.fundName}{" "}
                                  <span className={styles.pill}>
                                    {line.restriction.toLowerCase()}
                                  </span>
                                </td>
                                <td className={styles.numeric}>
                                  {formatCents(line.amountCents)}
                                </td>
                              </tr>
                            ))
                          : donation.allocations.map((allocation) => (
                              <tr key={allocation.fundId}>
                                <td className="mono">{allocation.fundId}</td>
                                <td className={styles.numeric}>
                                  {formatCents(allocation.amountCents)}
                                </td>
                              </tr>
                            ))}
                        <tr className={styles.rowTotal}>
                          <td>Total</td>
                          <td className={styles.numeric}>
                            {formatCents(donation.amountCents)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {donation.benefits.length > 0 && (
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Benefit received</th>
                            <th className={styles.numeric}>Qty</th>
                            <th className={styles.numeric}>Unit value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {donation.benefits.map((benefit, index) => (
                            <tr key={index}>
                              <td>{benefit.description}</td>
                              <td className={styles.numeric}>{benefit.quantity}</td>
                              <td className={styles.numeric}>
                                {donation.benefitFairMarketValueCents === null
                                  ? "not valued"
                                  : formatCents(benefit.unitFairMarketValueCents)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {receiptProblem ? (
                    <div className={styles.flag}>
                      <span className={styles.flagHead}>No receipt can be issued</span>
                      {receiptProblem}
                    </div>
                  ) : (
                    preview && (
                      <details className={styles.details}>
                        <summary className={styles.summary}>
                          Receipt · {preview.receipt.templateId}
                        </summary>
                        <div className={styles.receipt}>
                          <span className={styles.receiptMeta}>
                            {preview.receipt.identity.legalName} ·{" "}
                            {preview.receipt.identity.subsection} ·{" "}
                            {preview.receipt.identity.einPlaceholder}
                          </span>
                          {preview.receipt.body.map((paragraph, index) => (
                            <p className={styles.receiptPara} key={index}>
                              {paragraph}
                            </p>
                          ))}
                          <div className={styles.disclosure}>
                            <span className={styles.disclosureStatute}>
                              {NC_131F_STATUTE_LABEL} · minimum nine-point,
                              conspicuous
                            </span>
                            {NC_131F_DISCLOSURE}
                          </div>
                        </div>
                      </details>
                    )
                  )}
                </div>
              );
            })}

            <p className={styles.note}>
              Receipt numbers on this screen are previews and are set to zero.
              Issuing a receipt for real takes the next number in{" "}
              {entity}&rsquo;s own sequence; the two entities never share a
              numbering run, a template, or a donor record.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
