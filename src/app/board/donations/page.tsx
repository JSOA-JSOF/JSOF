import Link from "next/link";

import { KpiGrid } from "@/components/dashboard/Kpi";
import dash from "@/components/dashboard/dashboard.module.css";
import { AuthzError } from "@/lib/authz/policy";
import { DEV_SWITCHER_PARAM } from "@/lib/donations/devSubject";
import {
  ENTITY_LABEL,
  readDonationsDashboard,
  type DonationsDashboard,
} from "@/lib/donations/kpis";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import Denied from "./Denied";
import styles from "./donations.module.css";

export const metadata = {
  title: "Gifts — board",
  robots: { index: false, follow: false },
};

/**
 * The fundraising dashboard for one entity.
 *
 * It is not the gift register and it is not a link menu. Every figure answers
 * one question: did this dollar land in the right entity with a receipt the
 * donor can rely on. There is deliberately no "total raised" headline. That
 * number only goes up, and here it would hide the two things that can actually
 * go wrong, which are a gift that cannot be receipted and a sponsorship whose
 * benefits have broken the safe harbour.
 *
 * `readDonationsDashboard` is one authorized read that gates each figure on
 * its own scope. The module splits the sponsor register across two data
 * classes, FINANCIAL for the money and PUBLIC_CONTENT for the wording, and
 * this screen honours that split rather than routing around it: the Fundraising
 * Chair, who holds FINANCIAL at AGGREGATE, gets the wording tiles, the fund
 * totals and the entity split, and the gift-by-gift money figures come back
 * withheld rather than widened. A viewer with neither scope lands on the
 * refusal and is told nothing about the size of what is behind it.
 */
export default async function DonationsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const asParam = params[DEV_SWITCHER_PARAM];
  const { subject, entity, roleLabel, qs } = await resolveScreenViewer(asParam);
  const hue = entity === "JSOA" ? "var(--jsoa)" : "var(--jsof)";
  const hueTint = entity === "JSOA" ? "var(--jsoa-tint)" : "var(--jsof-tint)";

  let board: DonationsDashboard | null = null;
  let denial: string | null = null;
  try {
    board = readDonationsDashboard(subject, entity);
  } catch (error) {
    denial = error instanceof AuthzError ? error.message : String(error);
  }

  // The dev switcher travels on links, so a refusal stays reachable by URL.
  const to = (href: string) => (href.startsWith("#") ? href : `${href}${qs}`);

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
        <div className={dash.heading}>
          <h1 className={styles.title}>Fundraising</h1>
          <span className={dash.asOf}>
            {roleLabel} · {ENTITY_LABEL[entity]} · computed per request
          </span>
        </div>
        <p className={styles.lede}>
          Whether the money landed in the right entity with a receipt the donor
          can rely on. Giving appears split by entity and is never summed across
          them, because the two keep separate books, separate receipts and
          separate donor records, and only one of them is the charitable entity.
        </p>

        <nav className={styles.nav}>
          <span className={`${styles.navLink} ${styles.navLinkCurrent}`}>
            Fundraising
          </span>
          <Link href={`/board/donations/funds${qs}`} className={styles.navLink}>
            Funds
          </Link>
          <Link href={`/board/donations/sponsors${qs}`} className={styles.navLink}>
            Sponsors
          </Link>
          <Link href="/donate" className={styles.navLink}>
            Public donate form
          </Link>
        </nav>

        {denial && (
          <Denied
            roleLabel={roleLabel}
            needs={`financial or published-content read on ${entity}`}
            detail={denial}
          />
        )}

        {board && (
          <>
            <KpiGrid kpis={board.kpis} />

            {board.withheld.length > 0 && (
              <div className={styles.flag}>
                <span className={styles.flagHead}>
                  Withheld from {roleLabel}
                </span>
                <ul className={styles.findingList}>
                  {board.withheld.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
                <p className={styles.sectionNote}>
                  These figures are withheld, not zero. Nothing has been widened
                  to fill the tiles, and the counts behind them are not reported
                  either.
                </p>
              </div>
            )}

            <h2 className={styles.sectionHead}>What needs doing</h2>
            {board.actions.length === 0 ? (
              <p className={styles.sectionNote}>
                Nothing is waiting on this role in the figures it can see.
              </p>
            ) : (
              <div className={dash.actions}>
                {board.actions.map((action) => (
                  <Link
                    key={action.key}
                    href={to(action.href)}
                    className={`${dash.action} ${action.urgent ? dash.actionUrgent : ""}`}
                  >
                    <span className={dash.actionLabel}>{action.label}</span>
                    <span className={dash.actionNote}>{action.note}</span>
                    <span className={dash.actionCount}>
                      {action.count} waiting
                    </span>
                  </Link>
                ))}
              </div>
            )}

            {/* Second tier. Rows, not tiles: the brief caps the grid, and
                these are the detail behind three of the figures above. */}

            {board.awaitingValuation && board.awaitingValuation.length > 0 && (
              <section id="awaiting-valuation">
                <h2 className={styles.sectionHead}>Gifts awaiting a valuation</h2>
                <p className={styles.sectionNote}>
                  Each of these carries benefits with no fair market value
                  recorded, so no receipt can be issued and the donor cannot
                  claim. Record what the donor received and only the excess over
                  that value is deductible.
                </p>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Gift</th>
                        <th>Donor</th>
                        <th>What they received</th>
                        <th className={styles.numeric}>Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.awaitingValuation.map((row) => (
                        <tr key={row.donationId}>
                          <td className="mono">{row.donationId}</td>
                          <td>{row.donorDisplayName}</td>
                          <td>{row.benefitDescription}</td>
                          <td className={styles.numeric}>{row.amountFormatted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {board.flaggedWording && board.flaggedWording.length > 0 && (
              <section id="flagged-wording">
                <h2 className={styles.sectionHead}>Wording the validator flagged</h2>
                <p className={styles.sectionNote}>
                  Warnings, not blocks. One qualitative or comparative adjective
                  moves a whole placement out of qualified sponsorship and into
                  taxable advertising, so a flagged string stays a risk until
                  somebody rewrites it.
                </p>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Sponsor</th>
                        <th>Placement</th>
                        <th>State</th>
                        <th>Flagged for</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.flaggedWording.map((row) => (
                        <tr key={row.placementId}>
                          <td>{row.sponsorName}</td>
                          <td>{row.placementLabel}</td>
                          <td>
                            <span
                              className={`${styles.pill} ${
                                row.publicationState === "APPROVED"
                                  ? styles.pillWarn
                                  : ""
                              }`}
                            >
                              {row.publicationState.toLowerCase().replace(/_/g, " ")}
                            </span>
                          </td>
                          <td>
                            {row.categories
                              .map((category) =>
                                category.toLowerCase().replace(/_/g, " "),
                              )
                              .join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {board.restrictedFunds && board.restrictedFunds.length > 0 && (
              <section id="restricted-funds">
                <h2 className={styles.sectionHead}>Restricted funds, balance held</h2>
                <p className={styles.sectionNote}>
                  Summed from paid gift allocations, per fund, never across
                  entities. What each fund has committed against its balance is
                  not recorded in this module, which is why the tile above says
                  it is not measured rather than showing a nought.
                </p>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Fund</th>
                        <th className={styles.numeric}>Gifts</th>
                        <th className={styles.numeric}>Held</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.restrictedFunds.map((row) => (
                        <tr key={row.fundId}>
                          <td>
                            <Link
                              href={`/board/donations/funds${qs}`}
                              className={styles.back}
                            >
                              {row.name}
                            </Link>
                          </td>
                          <td className={styles.numeric}>{row.giftCount}</td>
                          <td className={styles.numeric}>{row.balanceFormatted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <p className={styles.note}>
              Receipts are rendered here only to be checked, at sequence zero,
              so opening this page does not consume a receipt number out of
              either entity&rsquo;s sequence. Every figure on this page is a sum
              of integer cents.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
