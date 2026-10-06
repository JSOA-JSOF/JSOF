import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { basisPointsToPercentLabel } from "@/lib/treasury/money";
import { treasuryRepository, treasurySubject } from "@/lib/treasury/repository";
import { personName } from "@/lib/treasury/seed";
import {
  CADENCE_LABELS,
  REVIEW_DECISION_LABELS,
  type SubscriptionRegister,
} from "@/lib/treasury/types";

import {
  ENTITY_LABELS,
  EntityTag,
  FindingItem,
  Money,
  SeverityChip,
  TreasuryHeader,
  Withheld,
  entityClass,
} from "../_components/chrome";
import styles from "../treasury.module.css";

export const metadata = {
  title: "Subscriptions and budget — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

/**
 * The subscription and budget register.
 *
 * Owned by the Treasurer, readable by the board. Every cadence normalises to
 * one annual figure so the lines are comparable, and a shared tool's invoice
 * is apportioned between the entities on a stated basis rather than parked on
 * whichever entity happens to hold the card.
 *
 * The column that earns this screen its keep is the second administrator. A
 * blank there is not a gap in the data, it is the handover test failing: if the
 * owner is unreachable, nobody on the board can get into the account. So it
 * renders as a finding, with the severity it deserves, and not as an empty cell.
 */
export default async function SubscriptionsPage() {
  const subject = treasurySubject(await getCurrentSubject());
  const repo = treasuryRepository();

  let register: SubscriptionRegister | null = null;
  let refusal: string | null = null;
  try {
    register = repo.subscriptionRegister(subject);
  } catch (error) {
    if (error instanceof AuthzError) {
      refusal =
        "The subscription register is not available to you. It holds financial " +
        "detail for both entities, so it needs at least aggregate financial scope " +
        "on one of them.";
    } else {
      throw error;
    }
  }

  return (
    <div>
      <TreasuryHeader
        current="/board/treasury/subscriptions"
        title="Subscriptions and budget"
        period={`As of ${repo.asOfDate()}`}
        lede={
          "Every tool the two entities pay for, normalised to an annual figure so " +
          "the lines can be compared, and apportioned per entity on a stated basis. " +
          "Owned by the Treasurer; the whole board can read it."
        }
      />

      {refusal ? (
        <p className={styles.refusal} role="status">
          {refusal}
        </p>
      ) : null}

      {register ? (
        <>
          <h2 className={styles.sectionHead}>Annual operating cost, per entity</h2>
          <p className={styles.note}>
            Two figures, not one. A combined tooling budget would be a figure for an
            organization that does not exist, and the two entities answer for their
            own costs separately.
          </p>

          <div className={styles.twoUp}>
            {register.annualOperatingCost.map((figure) =>
              figure.visible ? (
                <section
                  key={figure.entity}
                  className={`${entityClass(figure.entity)} ${styles.panel}`}
                >
                  <span className={styles.eyebrow}>
                    {ENTITY_LABELS[figure.entity].short} &middot;{" "}
                    {ENTITY_LABELS[figure.entity].subsection}
                  </span>
                  <p>
                    <Money amountCents={figure.amountCents} lead showCurrency />
                  </p>
                  <p className={styles.panelNote}>
                    {ENTITY_LABELS[figure.entity].long}, annual run rate for the tools
                    on this register.
                  </p>
                </section>
              ) : (
                <Withheld
                  key={figure.entity}
                  entity={figure.entity}
                  what="Annual cost"
                  reason={figure.withheldReason}
                />
              ),
            )}
          </div>

          {register.withheldRowCount > 0 ? (
            <p className={styles.note}>
              {register.withheldRowCount}{" "}
              {register.withheldRowCount === 1 ? "subscription is" : "subscriptions are"}{" "}
              withheld: they belong only to an entity you hold no financial scope on.
              The count is shown so the register does not look shorter than it is.
            </p>
          ) : null}

          <h2 className={styles.sectionHead}>
            The register <span className={styles.quiet}>({register.rows.length} tools)</span>
          </h2>

          <div className={styles.scroller}>
            <table className={`${styles.table} ${styles.tableWide}`}>
              <caption>
                One row per subscription. Annual figures are the invoice normalised to
                a year; the per-entity columns apportion it on the stated basis and add
                back to the invoice exactly.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Tool and vendor</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Second administrator</th>
                  <th scope="col">Cost and cadence</th>
                  <th scope="col" className={styles.thNum}>
                    Annual
                  </th>
                  <th scope="col" className={styles.thNum}>
                    JSOA share
                  </th>
                  <th scope="col" className={styles.thNum}>
                    JSOF share
                  </th>
                  <th scope="col">Renews</th>
                  <th scope="col">Nonprofit rate</th>
                  <th scope="col">Last review</th>
                </tr>
              </thead>
              <tbody>
                {register.rows.map((row) => {
                  const sub = row.subscription;
                  const jsoa = row.annualByEntity.find((p) => p.entity === "JSOA");
                  const jsof = row.annualByEntity.find((p) => p.entity === "JSOF");
                  const handover = row.findings.find(
                    (f) => f.code === "MISSING_SECOND_ADMINISTRATOR",
                  );
                  return (
                    <tr key={sub.id}>
                      <th scope="row" className={styles.wrapCell}>
                        {sub.tool}
                        <span className={styles.memo}>
                          {sub.vendor}. {sub.justification}
                        </span>
                      </th>
                      <td className={styles.wrapCell}>
                        {sub.split.map((part) => (
                          <span key={part.entity} style={{ marginRight: 6 }}>
                            <EntityTag entity={part.entity} />
                            {sub.split.length > 1 ? (
                              <span className={styles.quiet}>
                                {" "}
                                {basisPointsToPercentLabel(part.shareBasisPoints)}
                              </span>
                            ) : null}
                          </span>
                        ))}
                        {sub.split.length > 1 ? (
                          <span className={styles.memo}>
                            {sub.splitBasis ?? "No basis stated, which is a finding below."}
                          </span>
                        ) : null}
                      </td>
                      <td className={styles.wrapCell}>{sub.owningRole.replace(/_/g, " ")}</td>
                      <td className={styles.wrapCell}>
                        {sub.secondAdministratorPersonId ? (
                          personName(sub.secondAdministratorPersonId)
                        ) : (
                          <>
                            <span className={`${styles.sev} ${styles.sevCritical}`}>
                              none named
                            </span>
                            <span className={styles.memo}>
                              {handover
                                ? handover.finding
                                : "No second administrator: the handover test fails."}
                            </span>
                          </>
                        )}
                      </td>
                      <td className={styles.wrapCell}>
                        {sub.cadence === "variable" ? (
                          <span className={styles.quiet}>
                            Variable, per transaction
                            <span className={styles.memo}>
                              Annual figure is the trailing twelve months of actual spend.
                            </span>
                          </span>
                        ) : (
                          <>
                            <span className={styles.num}>
                              {sub.costCents === null ? "" : <Money amountCents={sub.costCents} />}
                            </span>{" "}
                            <span className={styles.quiet}>
                              {CADENCE_LABELS[sub.cadence].toLowerCase()}
                            </span>
                          </>
                        )}
                      </td>
                      <td className={styles.tdNum}>
                        <Money amountCents={row.annualCents} />
                      </td>
                      <td className={styles.tdNum}>
                        {jsoa ? (
                          <Money amountCents={jsoa.amountCents} />
                        ) : (
                          <span className={styles.dash}>&mdash;</span>
                        )}
                      </td>
                      <td className={styles.tdNum}>
                        {jsof ? (
                          <Money amountCents={jsof.amountCents} />
                        ) : (
                          <span className={styles.dash}>&mdash;</span>
                        )}
                      </td>
                      <td className={styles.tdNum}>
                        {sub.renewalDate ?? (
                          <span className={styles.quiet}>Month to month</span>
                        )}
                      </td>
                      <td className={styles.wrapCell}>
                        {sub.nonprofitRateApplied ? "Applied" : "Not applied"}
                        <span className={styles.memo}>{sub.nonprofitRateNote}</span>
                      </td>
                      <td className={styles.wrapCell}>
                        {REVIEW_DECISION_LABELS[sub.lastReviewDecision]}
                        <span className={styles.memo}>
                          {sub.lastReviewedOn
                            ? `Reviewed ${sub.lastReviewedOn}`
                            : "Never reviewed by the board"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className={styles.tfoot}>
                <tr>
                  <td colSpan={6}>Annual operating cost, per entity</td>
                  {(["JSOA", "JSOF"] as const).map((entity) => {
                    const figure = register.annualOperatingCost.find(
                      (f) => f.entity === entity,
                    );
                    return (
                      <td key={entity} className={styles.tdNum}>
                        {figure && figure.visible ? (
                          <Money amountCents={figure.amountCents} />
                        ) : (
                          <span className={styles.quiet}>withheld</span>
                        )}
                      </td>
                    );
                  })}
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className={styles.note}>
            The Annual column is one tool&rsquo;s invoice, which is a single contract
            and not a cross-entity figure. The two share columns apportion it. There
            is no row adding the two entities together, and there is nowhere in the
            data for one to go.
          </p>

          <h2 className={styles.sectionHead}>
            Findings <span className={styles.quiet}>({register.findings.length})</span>
          </h2>

          {register.findings.length === 0 ? (
            <p className={styles.note}>
              No findings on the register. Every tool has a second administrator, a
              stated basis where it is shared, and a review inside the last year.
            </p>
          ) : (
            <ul className={styles.findingList}>
              {register.findings.map((finding, index) => {
                const row = register.rows.find(
                  (r) => r.subscription.id === finding.subscriptionId,
                );
                return (
                  <FindingItem
                    key={`${finding.subscriptionId}-${finding.code}-${index}`}
                    severity={finding.severity}
                    heading={
                      <span>
                        <strong>{row?.subscription.tool ?? finding.subscriptionId}</strong>
                        <span className={styles.quiet}>
                          {" "}
                          &middot; {row?.subscription.vendor}
                        </span>
                      </span>
                    }
                    finding={finding.finding}
                    mitigation={finding.remedy}
                    mitigationLabel="What to do"
                  />
                );
              })}
            </ul>
          )}

          <p className={styles.note}>
            Severity is about consequence, not cost. A free tool with one
            administrator is a{" "}
            <SeverityChip severity="critical" /> finding; a paid tool with two is not.
          </p>

          <p className={styles.note}>
            Costs and vendors in this build are fictional demo data. Verify each line
            against the actual invoices before putting this in front of the board.
          </p>
        </>
      ) : null}
    </div>
  );
}
