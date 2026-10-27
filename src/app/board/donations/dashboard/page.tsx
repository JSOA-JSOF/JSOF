import Link from "next/link";

import { KpiGrid } from "@/components/dashboard/Kpi";
import { AuthzError } from "@/lib/authz/policy";
import { DEV_SWITCHER_PARAM } from "@/lib/donations/devSubject";
import {
  ENTITY_LABEL,
  readDonationsDashboard,
  splitKpis,
  type DonationsDashboard,
} from "@/lib/donations/kpis";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import Chrome from "../Chrome";
import Denied from "../Denied";
import styles from "../donations.module.css";

export const metadata = {
  title: "Fundraising dashboard — board",
  robots: { index: false, follow: false },
};

/**
 * Dashboard: how we know fundraising is working. Three figures.
 *
 * It was seven. The board asked for one to three per role, and a volunteer
 * looking at seven numbers has none, so four moved behind a disclosure. The
 * three that stayed are the three that would change a decision:
 *
 *   1. **Gifts that cannot be receipted** — the only figure here with a person
 *      behind every unit. Each one is a donor who cannot claim on a gift
 *      already taken, and the fix is a valuation somebody can do this evening.
 *   2. **Sponsorships over the 2% ceiling** — the cliff. One cent over and the
 *      whole benefit value is carved out, not the excess, so this figure
 *      decides whether the next placement contract can be signed as drafted.
 *   3. **Acknowledgment wording the validator flagged** — one qualitative or
 *      comparative adjective converts a placement from acknowledgment into
 *      taxable advertising, and a flagged string that is also approved can
 *      publish today.
 *
 * What did not make it, and why:
 *
 *   - **Giving received, by entity** is one idea rendered twice. It is a
 *     per-entity pair and the two halves are never added together, so
 *     promoting it would spend two of three slots on a single thought. It is
 *     also the closest thing here to the vanity metric this dashboard refuses
 *     to carry: there is no "total raised" tile and the entities never sum.
 *   - **Restricted funds: committed against available** matters more than any
 *     tile on the page and cannot be computed at all — this module records
 *     money in and nothing out. A tile that will read "not measured" on every
 *     visit is not a headline.
 *   - **Receipt disclosure formatting** and **placements awaiting release** are
 *     the ones that are usually fine, and good is unremarkable.
 *
 * A headline figure this reader may not see stays a headline and reads
 * "withheld". Substituting one they can see would quietly tell the Fundraising
 * Chair that the dashboard holds nothing they are missing.
 *
 * The actions that used to sit under these figures are now the Overview's task
 * list, per docs/ROLE-WORKSPACE.md: the Dashboard keeps the figures, the
 * Overview takes the doing. docs/DASHBOARD-BRIEF.md still wants a dashboard to
 * say what to do, so the count and the way through are below the figures.
 */
export default async function DonationsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { subject, entity, roleLabel, qs } = await resolveScreenViewer(
    params[DEV_SWITCHER_PARAM],
  );

  let board: DonationsDashboard | null = null;
  let denial: string | null = null;
  try {
    board = await readDonationsDashboard(subject, entity);
  } catch (error) {
    denial = error instanceof AuthzError ? error.message : String(error);
  }

  const split = board ? splitKpis(board.kpis) : null;

  return (
    <Chrome
      entity={entity}
      roleLabel={roleLabel}
      current="dashboard"
      qs={qs}
      statusWord="donations"
      title="Dashboard"
      lede={
        <>
          Three figures, for {ENTITY_LABEL[entity]} only. Whether the money
          landed in the right entity with a receipt the donor can rely on, and
          whether the sponsor benefits have stayed inside the harbour. Giving is
          never summed across the two entities: they keep separate books,
          separate receipts and separate donor records, and only one of them is
          the charitable entity.
        </>
      }
    >
      {denial && (
        <Denied
          roleLabel={roleLabel}
          needs={`financial or published-content read on ${entity}`}
          detail={denial}
        />
      )}

      {board && split && (
        <>
          <KpiGrid kpis={split.headline} />

          <p className={styles.sectionNote}>
            These three would change a decision. Giving by entity, the
            restricted-fund balances, the receipt formatting check and the
            release queue are below.
          </p>

          <details className={styles.details}>
            <summary className={styles.summary}>More figures</summary>
            <KpiGrid kpis={split.more} />
          </details>

          {board.withheld.length > 0 && (
            <div className={styles.flag}>
              <span className={styles.flagHead}>Withheld from {roleLabel}</span>
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

          <h2 className={styles.sectionHead}>What follows from these</h2>
          <p className={styles.sectionNote}>
            {board.actions.length === 0
              ? "Nothing is waiting on this role in the figures it can see."
              : `${board.actions.length} ${
                  board.actions.length === 1 ? "thing" : "things"
                } need doing on ${ENTITY_LABEL[entity]}, with what each one blocks.`}{" "}
            <Link href={`/board/donations${qs}`} className={styles.back}>
              Overview
            </Link>{" "}
            carries the task list for every entity this role holds, and it is
            the same derived list rather than a second copy of it.
          </p>

          {/* Second tier. Rows, not tiles: the brief caps the grid, and
              these are the detail behind the figures above. */}

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
                somebody rewrites it. A flagged string already approved can
                publish as written, which is the worse state of the two.
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
                              row.publicationState === "APPROVED" ? styles.pillWarn : ""
                            }`}
                          >
                            {row.publicationState.toLowerCase().replace(/_/g, " ")}
                          </span>
                        </td>
                        <td>
                          {row.categories
                            .map((category) => category.toLowerCase().replace(/_/g, " "))
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
                not recorded in this module, which is why the figure says it is
                not measured rather than showing a nought.
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
            Receipts are rendered here only to be checked, at sequence zero, so
            opening this page does not consume a receipt number out of either
            entity&rsquo;s sequence. Every figure on this page is a sum of
            integer cents.
          </p>
        </>
      )}
    </Chrome>
  );
}
