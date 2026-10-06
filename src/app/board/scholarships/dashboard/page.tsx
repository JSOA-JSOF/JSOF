import Link from "next/link";

import { KpiGrid } from "@/components/dashboard/Kpi";
import dash from "@/components/dashboard/dashboard.module.css";
import work from "@/components/workspace/workspace.module.css";
import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { loadScholarshipsDashboard } from "@/lib/scholarships/kpis";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { formatCents } from "@/lib/scholarships/scoring";

import styles from "../workspace.module.css";

export const metadata = {
  title: "Dashboard — Scholarships",
  robots: { index: false, follow: false },
};

/**
 * Dashboard: how we know it is working.
 *
 * Three headline figures, per docs/ROLE-WORKSPACE.md. This screen carried six,
 * and a volunteer looking at six numbers has none. The other three are still
 * here, behind a disclosure on the same page, with their provenance intact:
 * none of them is deleted and none of them is a headline.
 *
 * Which three, and why, is in `ScholarshipsDashboard.headline` in
 * src/lib/scholarships/kpis.ts, next to the figures themselves rather than
 * only in a report.
 *
 * The doing has moved to the Overview tab. A dashboard that only reports is a
 * report, and the answer to that is not a second task list here — it is the
 * one task list next door, which this page links to.
 *
 * One authorized read, guarded at APPLICANT WRITE because the tiles carry
 * award amounts, a cumulative total and a cost per dollar awarded. A subject
 * without that grant is told the figures were withheld rather than shown
 * zeroes.
 */

export default async function ScholarshipsDashboardTab() {
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
    <div className={styles.page}>
      <div className={dash.heading}>
        <h1 className={styles.title}>How the cycle is doing</h1>
        {dashboard ? (
          <span className={dash.asOf}>
            {dashboard.cycleLabel.toUpperCase()} &middot; AS AT{" "}
            {dashboard.asOf.slice(0, 10)}
          </span>
        ) : null}
      </div>
      <p className={styles.lede}>
        Three figures. Every one says what it was computed from, with its
        denominator, and a figure this platform cannot measure yet says so
        instead of showing a nought. What follows from them is on{" "}
        <Link href="/board/scholarships">Overview</Link>.
      </p>

      {denial ? (
        <div className={styles.withheld}>
          <p className={styles.withheldWhy}>{denial}</p>
          <p className={styles.note}>
            The figures are withheld, not zero. This dashboard carries award
            amounts and a cost per dollar awarded, so it is read at the
            chair&rsquo;s level and not a reviewer&rsquo;s. If you are scoring,
            your own calibration is on{" "}
            <Link href="/board/scholarships/review">Review</Link>.
          </p>
        </div>
      ) : dashboard ? (
        <>
          <section className={styles.section}>
            <KpiGrid kpis={dashboard.headline} />
          </section>

          {/* Not deleted, not headlines. Each one is still true and still
              carries its provenance; none of them would change a decision
              this week. */}
          <details className={styles.disclosure}>
            <summary className={styles.disclosureSummary}>
              More figures ({dashboard.moreFigures.length})
            </summary>
            <div className={styles.disclosureBody}>
              <p className={styles.note}>
                These were headline tiles and are not any more. The board asked
                for one to three figures per role. One of these cannot be
                measured at all, one is 100% by construction in this platform,
                and one rests on an unverified estimate and is really the
                Treasurer&rsquo;s figure. They are kept because each is true and
                each says what it was computed from.
              </p>
              <KpiGrid kpis={dashboard.moreFigures} />
            </div>
          </details>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Since inception</h2>
            <p className={styles.note}>{dashboard.cumulativeBasis}</p>
            <KpiGrid kpis={dashboard.sinceInception} />
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Where the awards went</h2>
            <p className={styles.note}>
              {dashboard.distribution.schoolsReached} schools in{" "}
              {dashboard.distribution.statesCovered} states.{" "}
              {dashboard.distribution.basis}
            </p>

            {dashboard.distribution.rows.length === 0 ? (
              <p className={styles.note}>
                No standing award in the records on file can be joined to a
                school, so there is nothing to rank.
              </p>
            ) : (
              <div className={work.bands}>
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
                      <span className={work.bandRange}>{row.state}</span>
                    </span>
                    {/* Spread, shown rather than described. Width is the share
                        of the most-awarded school, so the ranking is readable
                        without a mapping library. */}
                    <span
                      className={work.bandBar}
                      style={{ width: `${Math.round((row.awards * 100) / mostAwards)}%` }}
                      aria-hidden="true"
                    />
                    <span className={work.bandAmount}>{formatCents(row.totalCents)}</span>
                    <span className={work.bandCount}>
                      {row.awards}
                      <span className={work.srOnly}> awards</span>
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
