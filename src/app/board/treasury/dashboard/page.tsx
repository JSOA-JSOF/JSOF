import Link from "next/link";

import { KpiGrid } from "@/components/dashboard/Kpi";
import { getCurrentSubject } from "@/lib/authz/session";
import { splitKpis, treasuryDashboard } from "@/lib/treasury/kpis";
import { treasuryRepository, treasurySubject } from "@/lib/treasury/repository";
import { RESTRICTION_LABELS } from "@/lib/treasury/types";
import { FICTIONAL_DATA_NOTE } from "@/lib/treasury/workspace";

import {
  ENTITY_LABELS,
  EntityTag,
  Money,
  TreasuryHeader,
  Withheld,
  entityClass,
} from "../_components/chrome";
import styles from "../treasury.module.css";

export const metadata = {
  title: "Dashboard — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

/**
 * The Treasurer's Dashboard: three figures, and the position statement.
 *
 * Three IDEAS, not three tiles. Net assets is a per-entity pair, which is one
 * idea rendered twice and costs one of the three slots. Collapsing the pair to
 * save a slot would be the exact blend this whole module refuses: the
 * Association and the Foundation are separate legal persons, and a combined
 * movement describes an entity that does not exist. The reasoning for each of
 * the three, and for what went behind the disclosure, is in
 * `HEADLINE_KPI_KEYS` in `@/lib/treasury/kpis`.
 *
 * The two-column position statement has not moved and does not move. It is the
 * point of this module, it sits directly under the figures rather than behind
 * anything, and there is no total row and no field a total could go in:
 * `PositionStatement` carries a LIST of columns, and `assertUnblended` refuses
 * to return a view holding a money figure that names no entity.
 *
 * A withheld column renders as withheld. Never as $0.00. Zero is a claim about
 * the entity's finances; withheld is a claim about the reader's permissions,
 * and a Treasurer deciding whether a figure is bad has to know which of the
 * two they are looking at.
 *
 * The doing has moved to the Overview. A dashboard that only reports is a
 * report, so this one links to the tasks rather than repeating them, which
 * also means the two screens cannot disagree about how many claims are waiting.
 */
export default async function TreasuryDashboardPage() {
  const subject = treasurySubject(await getCurrentSubject());
  const repo = await treasuryRepository();
  const dashboard = await treasuryDashboard(subject, repo);
  const { headline, more } = splitKpis(dashboard.kpis);
  const statement = await repo.positionStatement(subject);
  const visibleCount = statement.columns.filter((c) => c.visible).length;
  const openTasks = dashboard.actions.length;

  return (
    <div>
      <TreasuryHeader
        current="dashboard"
        title="How we know it is working"
        period={statement.period.label}
        lede={
          "Three figures, then the position. Two entities, two columns, never one " +
          "figure: the Association and the Foundation file separately, hold separate " +
          "restrictions and answer to separate donors, so nothing on this screen " +
          "adds across them."
        }
      />

      {visibleCount === 0 ? (
        <p className={styles.refusal} role="status">
          You hold no financial scope on either entity, so there is no position to
          show you. If you should be able to see this, the President can grant the
          scope; nothing on this screen is available on request.
        </p>
      ) : null}

      <KpiGrid kpis={headline} />

      <p className={styles.note}>
        Three figures, because a volunteer looking at seven has none. Net assets is
        one idea shown twice, once per entity, and the pair is never summed. Every
        tile says what it was computed from; a figure the reader holds no scope for
        reads <strong>Withheld</strong> rather than zero, because the figure exists
        and is not theirs to see. Measured to {dashboard.asOf}.
      </p>

      <p className={styles.note}>
        {openTasks > 0 ? (
          <>
            <Link href="/board/treasury">
              {openTasks === 1
                ? "One thing is waiting on you"
                : `${openTasks} things are waiting on you`}
            </Link>{" "}
            on the Overview, each with what it blocks. The figures report; the
            Overview is where the doing lives.
          </>
        ) : (
          <>
            Nothing is outstanding in the scope you hold, which is a result of the
            checks above rather than an absence of them. The{" "}
            <Link href="/board/treasury">Overview</Link> is where work appears as it
            arrives.
          </>
        )}
      </p>

      <h2 className={styles.sectionHead}>Position, both entities</h2>
      <p className={styles.note}>
        The statement below is this module&rsquo;s point and it has not moved. There
        is no total row and no field one could go in: a combined figure would be a
        statement about an entity that does not exist.
      </p>

      <div className={styles.twoUp}>
        {statement.columns.map((column) => {
          if (!column.visible) {
            return (
              <Withheld
                key={column.entity}
                entity={column.entity}
                what="Position"
                reason={column.withheldReason}
              />
            );
          }
          const labels = ENTITY_LABELS[column.entity];
          return (
            <section
              key={column.entity}
              className={`${entityClass(column.entity)} ${styles.panel}`}
              aria-labelledby={`pos-${column.entity}`}
            >
              <div className={styles.panelHead}>
                <div>
                  <span className={styles.eyebrow}>{labels.subsection}</span>
                  <h3 id={`pos-${column.entity}`} className={styles.panelTitle}>
                    <span className={styles.entityName}>{labels.short}</span>{" "}
                    <span className={styles.quiet}>{labels.long}</span>
                  </h3>
                </div>
              </div>

              <ul className={styles.figures}>
                <li>
                  <span className={styles.figureLabel}>Revenue, period to date</span>
                  <Money amountCents={column.revenueCents} lead showCurrency />
                </li>
                <li>
                  <span className={styles.figureLabel}>Expenses, period to date</span>
                  <Money amountCents={column.expenseCents} lead showCurrency />
                </li>
                <li>
                  <span className={styles.figureLabel}>
                    Change over the period
                    <span className={styles.memo}>
                      Revenue less expenses, this entity only
                    </span>
                  </span>
                  <Money amountCents={column.changeCents} lead showCurrency />
                </li>
                <li>
                  <span className={styles.figureLabel}>Net assets, opening</span>
                  <Money amountCents={column.openingNetAssetsCents} />
                </li>
                <li>
                  <span className={styles.figureLabel}>Net assets, closing</span>
                  <Money amountCents={column.closingNetAssetsCents} lead showCurrency />
                </li>
                <li>
                  <span className={styles.figureLabel}>
                    of which unrestricted
                    <span className={styles.memo}>
                      Available for general operating use
                    </span>
                  </span>
                  <Money amountCents={column.unrestrictedClosingCents} />
                </li>
                <li>
                  <span className={styles.figureLabel}>
                    of which restricted
                    <span className={styles.memo}>
                      Held to the donors&rsquo; terms, not spendable at the
                      board&rsquo;s discretion
                    </span>
                  </span>
                  <Money amountCents={column.restrictedClosingCents} />
                </li>
              </ul>

              <div className={styles.actions}>
                <Link
                  className={styles.actionLink}
                  href={`/board/treasury/ledger/${column.entity}`}
                >
                  Open the {labels.short} ledger
                </Link>
              </div>
            </section>
          );
        })}
      </div>

      {/* Everything that did not earn a headline. Open by default would be
          seven figures again, so it is closed, and it is a disclosure rather
          than a deletion because these are real and somebody wants them at
          renewal time. */}
      <details className={styles.disclosure}>
        <summary className={styles.disclosureSummary}>
          More figures
          <span className={styles.disclosureHint}>
            {more.length} further {more.length === 1 ? "tile" : "tiles"}, the
            renewal commitments and the fund detail
          </span>
        </summary>

        <div className={styles.disclosureBody}>
          <p className={styles.note}>
            These did not earn a headline and are not hidden. Annual operating cost
            is a planning figure looked at when something renews, not weekly; the
            second-administrator count already drives a task on the Overview and a
            finding on the Subscriptions tab, which is two places more useful than a
            tile.
          </p>

          {more.length > 0 ? <KpiGrid kpis={more} /> : null}

          <h3 className={styles.sectionHead}>
            Renewals inside {dashboard.renewalWindowDays} days
          </h3>
          <p className={styles.note}>
            The cash each entity commits for the following year if these lines
            renew, per entity, as two figures. A renewal nobody decides on renews by
            default, which is how a register stops being a decision and becomes a
            direct debit.
          </p>

          <div className={styles.panelPlain}>
            <ul className={styles.figures}>
              {dashboard.renewals.map((row) => (
                <li key={`renewal-${row.entity}`} className={entityClass(row.entity)}>
                  <span className={styles.figureLabel}>
                    <EntityTag entity={row.entity} />{" "}
                    {row.visible ? (
                      <>
                        {row.lineCount}{" "}
                        {row.lineCount === 1 ? "line renews" : "lines renew"} by{" "}
                        {dashboard.renewalWindowEndDate}
                        <span className={styles.memo}>
                          {row.soonestRenewalDate
                            ? `Soonest ${row.soonestRenewalDate}. ` +
                              `${ENTITY_LABELS[row.entity].short} share of the annual cost, apportioned on the stated basis.`
                            : `No ${ENTITY_LABELS[row.entity].short} line renews inside the window.`}
                        </span>
                      </>
                    ) : (
                      <>
                        Withheld
                        <span className={styles.memo}>{row.withheldReason}</span>
                      </>
                    )}
                  </span>
                  {row.visible ? (
                    <Money amountCents={row.committedAnnualCents} lead showCurrency />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <h3 className={styles.sectionHead}>By fund</h3>
          <p className={styles.note}>
            Funds do not cross entities either. A restricted balance on one side is
            not a resource of the other, whatever the two boards decide, until an
            inter-entity transfer is minuted on both sides.
          </p>

          <div className={styles.stack}>
            {statement.columns.map((column) => {
              if (!column.visible) return null;
              return (
                <section
                  key={`funds-${column.entity}`}
                  className={entityClass(column.entity)}
                  aria-labelledby={`funds-h-${column.entity}`}
                  /* A grid item defaults to min-width:auto, so this section was
                     sized by the fund table's intrinsic width and pushed the whole
                     page sideways at 375px instead of letting `.scroller` scroll. */
                  style={{ minWidth: 0 }}
                >
                  <div className={styles.panelHead}>
                    <h3 id={`funds-h-${column.entity}`} className={styles.panelTitle}>
                      <EntityTag entity={column.entity} />{" "}
                      <span className={styles.entityName}>
                        {ENTITY_LABELS[column.entity].long}
                      </span>
                    </h3>
                  </div>
                  <div className={styles.scroller}>
                    <table className={styles.table}>
                      <caption>
                        {ENTITY_LABELS[column.entity].short} funds,{" "}
                        {statement.period.label}. Closing equals opening plus revenue
                        less expenses, per fund.
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Fund</th>
                          <th scope="col">Restriction</th>
                          <th scope="col" className={styles.thNum}>
                            Opening
                          </th>
                          <th scope="col" className={styles.thNum}>
                            Revenue
                          </th>
                          <th scope="col" className={styles.thNum}>
                            Expenses
                          </th>
                          <th scope="col" className={styles.thNum}>
                            Closing
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {column.fundBalances.map((balance) => (
                          <tr key={balance.fundId}>
                            <th scope="row" className={styles.wrapCell}>
                              {balance.fundName}
                            </th>
                            <td>{RESTRICTION_LABELS[balance.restriction]}</td>
                            <td className={styles.tdNum}>
                              <Money amountCents={balance.openingCents} />
                            </td>
                            <td className={styles.tdNum}>
                              <Money amountCents={balance.revenueCents} />
                            </td>
                            <td className={styles.tdNum}>
                              <Money amountCents={balance.expenseCents} />
                            </td>
                            <td className={styles.tdNum}>
                              <Money amountCents={balance.closingCents} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className={styles.tfoot}>
                        <tr>
                          <th scope="row" colSpan={2}>
                            {ENTITY_LABELS[column.entity].short} only
                          </th>
                          <td className={styles.tdNum}>
                            <Money amountCents={column.openingNetAssetsCents} />
                          </td>
                          <td className={styles.tdNum}>
                            <Money amountCents={column.revenueCents} />
                          </td>
                          <td className={styles.tdNum}>
                            <Money amountCents={column.expenseCents} />
                          </td>
                          <td className={styles.tdNum}>
                            <Money amountCents={column.closingNetAssetsCents} />
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </details>

      <p className={styles.note}>{FICTIONAL_DATA_NOTE}</p>
    </div>
  );
}
