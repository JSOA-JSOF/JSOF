import Link from "next/link";

import { KpiGrid } from "@/components/dashboard/Kpi";
import { getCurrentSubject } from "@/lib/authz/session";
import { treasuryDashboard } from "@/lib/treasury/kpis";
import { treasurySubject, treasuryRepository } from "@/lib/treasury/repository";
import { RESTRICTION_LABELS } from "@/lib/treasury/types";

import {
  ENTITY_LABELS,
  EntityTag,
  Money,
  TreasuryHeader,
  Withheld,
  entityClass,
} from "./_components/chrome";
import styles from "./treasury.module.css";

export const metadata = {
  title: "Dashboard — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

/**
 * The Treasurer's dashboard, sitting above the two-column position statement.
 *
 * The position statement is the point of this module and it has not moved. The
 * Association and the Foundation are separate legal persons with separate
 * boards' worth of duty attached to them, separate returns, and separate
 * donors' restrictions. A combined figure is not a summary of this page; it is
 * a statement about an entity that does not exist.
 *
 * So there is no total row anywhere on this screen. `PositionStatement` has no
 * field one could go in, `RenewalCommitment` has none either, and
 * `assertUnblended` in the repository and in `kpis.ts` refuses to return a view
 * carrying a money figure that names no entity. The tiles obey the same rule
 * the hard way: net assets and annual operating cost are each a pair of tiles,
 * one per entity, and nothing on the dashboard adds across them.
 *
 * Figures the reader holds no scope for are withheld, never zero. Zero is a
 * claim about the entity; withheld is a claim about the reader.
 */
export default async function TreasuryDashboardPage() {
  const subject = treasurySubject(await getCurrentSubject());
  const repo = treasuryRepository();
  const dashboard = treasuryDashboard(subject, repo);
  const statement = repo.positionStatement(subject);
  const visibleCount = statement.columns.filter((c) => c.visible).length;

  return (
    <div>
      <TreasuryHeader
        current="/board/treasury"
        title="Treasury, both entities"
        period={statement.period.label}
        lede={
          "What the two treasuries look like this period, what is outstanding, and " +
          "what needs deciding. Two entities, two columns, never one figure: the " +
          "Association and the Foundation file separately, hold separate " +
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

      <KpiGrid kpis={dashboard.kpis} />

      <p className={styles.note}>
        Every tile says what it was computed from. A figure the reader holds no
        scope for reads <strong>Withheld</strong> rather than zero: the figure
        exists, and it is not theirs to see. Figures measured to{" "}
        {dashboard.asOf}.
      </p>

      <h2 className={styles.sectionHead}>What needs doing</h2>

      {dashboard.actions.length === 0 ? (
        <p className={styles.note}>
          Nothing is outstanding in the scope you hold. That is a result of the
          checks above, not an absence of them.
        </p>
      ) : (
        <ul className={styles.rules}>
          {dashboard.actions.map((action) => (
            <li key={action.key} className={styles.rule}>
              <span
                className={`${styles.ruleState} ${
                  action.urgent ? styles.ruleStateUnmet : styles.ruleStateMet
                }`}
              >
                {action.count}
              </span>
              <span className={styles.ruleRequirement}>
                <Link href={action.href}>{action.label}</Link>
              </span>
              <p className={styles.ruleWhy}>{action.note}</p>
            </li>
          ))}
        </ul>
      )}

      <h2 className={styles.sectionHead}>
        Renewals inside {dashboard.renewalWindowDays} days
      </h2>
      <p className={styles.note}>
        The cash each entity commits for the following year if these lines renew,
        per entity, as two figures. A renewal nobody decides on renews by default,
        which is how a register stops being a decision and becomes a direct debit.
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

      <h2 className={styles.sectionHead}>Position, both entities</h2>
      <p className={styles.note}>
        The statement below is the module&rsquo;s point and it has not moved. There
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
                    <span className={styles.memo}>Revenue less expenses, this entity only</span>
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
                    <span className={styles.memo}>Available for general operating use</span>
                  </span>
                  <Money amountCents={column.unrestrictedClosingCents} />
                </li>
                <li>
                  <span className={styles.figureLabel}>
                    of which restricted
                    <span className={styles.memo}>
                      Held to the donors&rsquo; terms, not spendable at the board&rsquo;s
                      discretion
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

      <h2 className={styles.sectionHead}>By fund</h2>
      <p className={styles.note}>
        Funds do not cross entities either. A restricted balance on one side is not
        a resource of the other, whatever the two boards decide, until an
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
                 page sideways at 375px instead of letting `.scroller` scroll.
                 This belongs in `.stack` in treasury.module.css, which is not
                 this change's to edit; noted in the report. */
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
                    {ENTITY_LABELS[column.entity].short} funds, {statement.period.label}.
                    Closing equals opening plus revenue less expenses, per fund.
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

      <p className={styles.note}>
        Figures in this build are fictional demo data. They are not either
        organization&rsquo;s filed numbers and should not be quoted to the board as
        fact.
      </p>
    </div>
  );
}
