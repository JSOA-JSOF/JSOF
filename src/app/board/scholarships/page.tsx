import Link from "next/link";
import type { CSSProperties } from "react";

import { KpiGrid } from "@/components/dashboard/Kpi";
import dash from "@/components/dashboard/dashboard.module.css";
import styles from "@/components/workspace/workspace.module.css";
import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { ELIGIBILITY_RULE, eligibilityIsPlaceholder } from "@/lib/scholarships/eligibility";
import { loadScholarshipsDashboard } from "@/lib/scholarships/kpis";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { WOUNDED_PATRIOT, formatCents } from "@/lib/scholarships/scoring";

export const metadata = {
  title: "Scholarships",
  robots: { index: false, follow: false },
};

/**
 * The Scholarships Chair's dashboard.
 *
 * This route holds no policy and no arithmetic. Every figure comes from one
 * authorized read, `loadScholarshipsDashboard`, which guards at APPLICANT WRITE
 * because the tiles carry award amounts and a cost per dollar awarded. A
 * subject without that grant is told the figures were withheld rather than
 * shown zeroes.
 *
 * Both warnings stay above the figures. Eligibility is with counsel and the
 * Wounded Patriot amount is unconfirmed; each one gates the cycle, so neither
 * belongs in a footnote under the numbers.
 */

/** Entity hue, set once here so nothing beneath this page names a colour. */
const HUE: CSSProperties = {
  ["--hue" as string]: "var(--jsof)",
  ["--hueTint" as string]: "var(--jsof-tint)",
};

export default async function ScholarshipsDashboard() {
  const subject = await getCurrentSubject();

  let dashboard: Awaited<ReturnType<typeof loadScholarshipsDashboard>> | null = null;
  let denial: string | null = null;
  try {
    dashboard = await loadScholarshipsDashboard(scholarshipRepository(), subject);
  } catch (error) {
    denial = error instanceof AuthzError ? error.message : String(error);
  }

  const mostAwards = dashboard
    ? Math.max(1, ...dashboard.distribution.rows.map((row) => row.awards))
    : 1;

  return (
    <div className={styles.shell} style={HUE}>
      <div className={dash.heading}>
        <h1 className={dash.title}>Scholarships</h1>
        {dashboard ? (
          <span className={dash.asOf}>
            {dashboard.cycleLabel.toUpperCase()} &middot; AS AT{" "}
            {dashboard.asOf.slice(0, 10)}
          </span>
        ) : null}
      </div>
      <p className={dash.lede}>
        Whether the cycle is working, and what it is costing to run. Every
        figure says what it was computed from. A figure this platform cannot
        measure yet says so instead of showing a nought.
      </p>

      {/* Two things are unresolved and both change what the cycle can do, so
          they sit above the figures rather than in a footnote. */}
      {eligibilityIsPlaceholder() ? (
        <div className={styles.pause}>
          <strong>Eligibility is with counsel.</strong> {ELIGIBILITY_RULE.guidance}
        </div>
      ) : null}

      {!WOUNDED_PATRIOT.amountConfirmed ? (
        <div className={styles.pause}>
          <strong>The Wounded Patriot amount is a placeholder</strong> at{" "}
          {formatCents(WOUNDED_PATRIOT.amountCents)}. It is a flat award and the
          real figure has not been given, so nothing should be sent until you
          confirm it. Every Wounded Patriot figure below carries it.
        </div>
      ) : null}

      {denial ? (
        <div className={styles.card}>
          <p style={{ color: "var(--warn)", maxWidth: "70ch", margin: 0 }}>{denial}</p>
          <p style={{ color: "var(--mute)", maxWidth: "70ch", margin: 0, fontSize: ".9rem" }}>
            The figures are withheld, not zero. This dashboard carries award
            amounts and a cost per dollar awarded, so it is read at the chair&rsquo;s
            level and not a reviewer&rsquo;s.
          </p>
        </div>
      ) : dashboard ? (
        <>
          <section>
            <h2 className={dash.title} style={{ fontSize: "1.1rem", marginBottom: 10 }}>
              This cycle
            </h2>
            <KpiGrid kpis={dashboard.thisCycle} />
          </section>

          {/* A dashboard that only reports is a report. */}
          <section>
            <h2 className={dash.title} style={{ fontSize: "1.1rem", marginBottom: 0 }}>
              What that leaves to do
            </h2>
            <div className={dash.actions}>
              {dashboard.actions.map((action) => (
                <Link
                  key={action.key}
                  href={action.href}
                  className={`${dash.action} ${action.urgent ? dash.actionUrgent : ""}`}
                >
                  <span className={dash.actionLabel}>{action.label}</span>
                  <span className={dash.actionNote}>{action.note}</span>
                  <span className={dash.actionCount}>{action.count}</span>
                </Link>
              ))}
            </div>
          </section>

          <section>
            <h2 className={dash.title} style={{ fontSize: "1.1rem", marginBottom: 6 }}>
              Since inception
            </h2>
            <p
              className={dash.lede}
              style={{ fontSize: ".85rem", marginBottom: 12 }}
            >
              {dashboard.cumulativeBasis}
            </p>
            <KpiGrid kpis={dashboard.sinceInception} />
          </section>

          <section>
            <h2 className={dash.title} style={{ fontSize: "1.1rem", marginBottom: 6 }}>
              Where the awards went
            </h2>
            <p className={dash.lede} style={{ fontSize: ".85rem", marginBottom: 12 }}>
              {dashboard.distribution.schoolsReached} schools in{" "}
              {dashboard.distribution.statesCovered} states.{" "}
              {dashboard.distribution.basis}
            </p>

            {dashboard.distribution.rows.length === 0 ? (
              <p style={{ color: "var(--mute)", margin: 0 }}>
                No standing award in the records on file can be joined to a
                school, so there is nothing to rank.
              </p>
            ) : (
              <div className={styles.bands}>
                {dashboard.distribution.rows.map((row) => (
                  <div
                    key={`${row.schoolName}-${row.state}`}
                    style={{
                      display: "grid",
                      // The bar and the total may shrink to nothing at 375px;
                      // the school name and the count may not.
                      gridTemplateColumns:
                        "minmax(0,1fr) minmax(0,90px) minmax(72px,110px) 44px",
                      gap: 14,
                      alignItems: "center",
                      padding: "9px 0",
                      borderBottom: "1px solid var(--line-2)",
                      fontSize: ".9rem",
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      {row.schoolName}{" "}
                      <span className={styles.bandRange}>{row.state}</span>
                    </span>
                    {/* Spread, shown rather than described. Width is the share
                        of the most-awarded school, so the ranking is readable
                        without a mapping library. */}
                    <span
                      className={styles.bandBar}
                      style={{ width: `${Math.round((row.awards * 100) / mostAwards)}%` }}
                      aria-hidden="true"
                    />
                    <span className={styles.bandAmount}>{formatCents(row.totalCents)}</span>
                    <span className={styles.bandCount}>
                      {row.awards}
                      <span className={styles.srOnly}> awards</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
