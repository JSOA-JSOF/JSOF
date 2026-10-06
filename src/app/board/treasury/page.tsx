import Link from "next/link";

import { getCurrentSubject } from "@/lib/authz/session";
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
  title: "Position — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

/**
 * The two-column position statement.
 *
 * The Association and the Foundation are separate legal persons with separate
 * boards' worth of duty attached to them, separate returns, and separate
 * donors' restrictions. A combined figure is not a summary of this page; it is
 * a statement about an entity that does not exist.
 *
 * So there is no total row. `PositionStatement` has no field one could go in,
 * and `assertUnblended` in the repository refuses to return a view carrying a
 * money figure that names no entity. If someone adds a combined total later,
 * the repository throws before the page renders.
 */
export default async function PositionStatementPage() {
  const subject = treasurySubject(await getCurrentSubject());
  const repo = treasuryRepository();
  const statement = repo.positionStatement(subject);
  const visibleCount = statement.columns.filter((c) => c.visible).length;

  return (
    <div>
      <TreasuryHeader
        current="/board/treasury"
        title="Position, both entities"
        period={statement.period.label}
        lede={
          "Two entities, two columns, never one figure. The Association and the " +
          "Foundation file separately, hold separate restrictions and answer to " +
          "separate donors, so nothing on this page adds across them."
        }
      />

      {visibleCount === 0 ? (
        <p className={styles.refusal} role="status">
          You hold no financial scope on either entity, so there is no position to
          show you. If you should be able to see this, the President can grant the
          scope; nothing on this screen is available on request.
        </p>
      ) : null}

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
                  <h2 id={`pos-${column.entity}`} className={styles.panelTitle}>
                    <span className={styles.entityName}>{labels.short}</span>{" "}
                    <span className={styles.quiet}>{labels.long}</span>
                  </h2>
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
