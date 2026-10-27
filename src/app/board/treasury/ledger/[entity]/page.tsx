import Link from "next/link";
import { notFound } from "next/navigation";

import { ENTITIES, type Entity } from "@/lib/authz/model";
import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { personName } from "@/lib/treasury/seed";
import { treasuryRepository, treasurySubject } from "@/lib/treasury/repository";
import { RESTRICTION_LABELS, type LedgerView } from "@/lib/treasury/types";

import {
  ENTITY_LABELS,
  EntityTag,
  Money,
  TreasuryHeader,
  entityClass,
} from "../../_components/chrome";
import styles from "../../treasury.module.css";

/**
 * One entity's ledger. One.
 *
 * The scoping here is the reason the route takes the entity in the path rather
 * than offering a picker: a Treasurer assigned to the Association asking for
 * /board/treasury/ledger/JSOF is refused by `authorize()` in the repository,
 * and the refusal says so rather than returning an empty table. An empty table
 * would read as "the Foundation had no activity this period", which is a
 * different and much worse lie than "this is not yours to see".
 */

function parseEntity(raw: string): Entity | null {
  const upper = raw.toUpperCase();
  return (ENTITIES as readonly string[]).includes(upper) ? (upper as Entity) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const entity = parseEntity((await params).entity);
  return {
    title: entity ? `${entity} ledger — Treasury — JSOA / JSOF` : "Ledger — Treasury",
    robots: { index: false, follow: false },
  };
}

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const entity = parseEntity((await params).entity);
  if (!entity) notFound();

  const query = await searchParams;
  const fundParam = Array.isArray(query.fund) ? query.fund[0] : query.fund;
  const kindParam = Array.isArray(query.kind) ? query.kind[0] : query.kind;
  const kind = kindParam === "revenue" || kindParam === "expense" ? kindParam : undefined;

  const subject = treasurySubject(await getCurrentSubject());
  const repo = await treasuryRepository();
  const labels = ENTITY_LABELS[entity];

  let view: LedgerView | null = null;
  let refusal: string | null = null;
  try {
    view = await repo.ledger(subject, entity, { fundId: fundParam, kind });
  } catch (error) {
    if (error instanceof AuthzError) {
      refusal =
        `The ${labels.short} ledger is not available to you. You hold no ` +
        `row-level financial scope on ${labels.long}. ` +
        `This is not an empty ledger: ${labels.short} has activity in this period ` +
        `and it belongs to that entity's Treasurer.`;
    } else {
      throw error;
    }
  }

  const other: Entity = entity === "JSOA" ? "JSOF" : "JSOA";

  return (
    <div className={entityClass(entity)}>
      <TreasuryHeader
        current={`/board/treasury/ledger/${entity}`}
        title={`${labels.short} ledger`}
        period={view?.period.label}
        lede={
          `Every entry below belongs to ${labels.long} (${labels.subsection}). ` +
          `Nothing from the other entity appears on this page, under any filter.`
        }
      />

      {refusal ? (
        <>
          <p className={styles.refusal} role="status">
            {refusal}
          </p>
          <p className={styles.note}>
            If you are the Treasurer of the other entity, its ledger is at{" "}
            <Link href={`/board/treasury/ledger/${other}`}>
              /board/treasury/ledger/{other}
            </Link>
            . The two-column position statement shows both entities&rsquo; totals to
            anyone holding aggregate scope on both.
          </p>
        </>
      ) : null}

      {view ? (
        <>
          <div className={styles.filters} role="group" aria-label="Filter by fund">
            <span className={styles.eyebrow}>Fund</span>
            <Link
              href={`/board/treasury/ledger/${entity}${kind ? `?kind=${kind}` : ""}`}
              className={`${styles.filterLink} ${
                view.appliedFundId === null ? styles.filterOn : ""
              }`}
            >
              All funds
            </Link>
            {view.funds.map((fund) => (
              <Link
                key={fund.id}
                href={`/board/treasury/ledger/${entity}?fund=${fund.id}${
                  kind ? `&kind=${kind}` : ""
                }`}
                className={`${styles.filterLink} ${
                  view.appliedFundId === fund.id ? styles.filterOn : ""
                }`}
              >
                {fund.name}
              </Link>
            ))}
          </div>

          <div className={styles.filters} role="group" aria-label="Filter by direction">
            <span className={styles.eyebrow}>Direction</span>
            {[
              { value: undefined, label: "Revenue and expenses" },
              { value: "revenue", label: "Revenue only" },
              { value: "expense", label: "Expenses only" },
            ].map((option) => {
              const search = new URLSearchParams();
              if (view.appliedFundId) search.set("fund", view.appliedFundId);
              if (option.value) search.set("kind", option.value);
              const qs = search.toString();
              return (
                <Link
                  key={option.label}
                  href={`/board/treasury/ledger/${entity}${qs ? `?${qs}` : ""}`}
                  className={`${styles.filterLink} ${
                    kind === option.value ? styles.filterOn : ""
                  }`}
                >
                  {option.label}
                </Link>
              );
            })}
          </div>

          <div className={styles.twoUp}>
            <section className={styles.panel}>
              <span className={styles.eyebrow}>
                {labels.short} revenue, {view.appliedFundId ? "this fund" : "all funds"}
              </span>
              <p>
                <Money amountCents={view.revenueCents} lead showCurrency />
              </p>
            </section>
            <section className={styles.panel}>
              <span className={styles.eyebrow}>
                {labels.short} expenses, {view.appliedFundId ? "this fund" : "all funds"}
              </span>
              <p>
                <Money amountCents={view.expenseCents} lead showCurrency />
              </p>
            </section>
          </div>

          {view.appliedFundId ? (
            <p className={`${styles.note} ${styles.noteHue}`}>
              {(() => {
                const fund = view.funds.find((f) => f.id === view.appliedFundId);
                if (!fund) return null;
                return (
                  <>
                    <strong>{fund.name}</strong> &middot;{" "}
                    {RESTRICTION_LABELS[fund.restriction]}. {fund.purpose}
                  </>
                );
              })()}
            </p>
          ) : null}

          <h2 className={styles.sectionHead}>
            Entries <span className={styles.quiet}>({view.entries.length})</span>
          </h2>

          {view.entries.length === 0 ? (
            <p className={styles.note}>
              No entry matches this filter. Clear the filter to see the whole{" "}
              {labels.short} ledger for the period.
            </p>
          ) : (
            <div className={styles.scroller}>
              <table className={styles.table}>
                <caption>
                  {labels.short} only, {view.period.fromDate} to {view.period.toDate}.
                  Amounts are whole cents; direction is in the Revenue and Expense
                  columns rather than a minus sign.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Fund</th>
                    <th scope="col">Account</th>
                    <th scope="col" className={styles.thNum}>
                      Revenue
                    </th>
                    <th scope="col" className={styles.thNum}>
                      Expense
                    </th>
                    <th scope="col">Minute</th>
                    <th scope="col">Entered by</th>
                  </tr>
                </thead>
                <tbody>
                  {view.entries.map((entry) => {
                    const fund = view.funds.find((f) => f.id === entry.fundId);
                    return (
                      <tr key={entry.id}>
                        <td className={styles.tdNum}>{entry.date}</td>
                        <td>
                          <EntityTag entity={entry.entity} />
                        </td>
                        <td className={styles.wrapCell}>{fund?.name ?? entry.fundId}</td>
                        <td className={styles.wrapCell}>
                          {entry.account}
                          {entry.memo ? (
                            <span className={styles.memo}>{entry.memo}</span>
                          ) : null}
                        </td>
                        <td className={styles.tdNum}>
                          {entry.kind === "revenue" ? (
                            <Money amountCents={entry.amountCents} />
                          ) : (
                            <span className={styles.dash}>&mdash;</span>
                          )}
                        </td>
                        <td className={styles.tdNum}>
                          {entry.kind === "expense" ? (
                            <Money amountCents={entry.amountCents} />
                          ) : (
                            <span className={styles.dash}>&mdash;</span>
                          )}
                        </td>
                        <td>
                          {entry.minuteRef ? (
                            <span className={styles.chip}>{entry.minuteRef}</span>
                          ) : (
                            <span className={styles.dash}>&mdash;</span>
                          )}
                        </td>
                        <td>{personName(entry.enteredById)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className={styles.tfoot}>
                  <tr>
                    <td colSpan={4}>{labels.short} total for this view</td>
                    <td className={styles.tdNum}>
                      <Money amountCents={view.revenueCents} />
                    </td>
                    <td className={styles.tdNum}>
                      <Money amountCents={view.expenseCents} />
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className={styles.note}>
            Figures in this build are fictional demo data, not either
            organization&rsquo;s filed numbers.
          </p>
        </>
      ) : null}
    </div>
  );
}
