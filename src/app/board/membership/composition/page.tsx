import { AuthzError } from "@/lib/authz/policy";
import { loadCompositionReport } from "@/lib/membership/board";
import { formatPercent, formatThreshold } from "@/lib/membership/composition";
import { membershipRepository } from "@/lib/membership/repository";
import type { CompositionReport } from "@/lib/membership/types";

import styles from "../board.module.css";
import { MembershipShell, Refused } from "../shell";
import { currentActor } from "../subject";

export const metadata = {
  title: "Membership composition — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The composition report.
 *
 * A compliance control, not a dashboard. Two of these three tests decide
 * whether the Association is exempt at all and the third decides whether a
 * gift to it is deductible to the giver, so every figure shows the counts
 * behind it and every test says plainly what failing it costs.
 *
 * MEMBER_PII at AGGREGATE, and not row level. The report names nobody, so it
 * does not ask for a grant that can name anybody — which is what lets VP
 * Operations and both Treasurers see a failing exemption test without being
 * able to open the roster.
 */
export default async function CompositionPage() {
  const { subject, label: viewerLabel } = await currentActor();

  let report: CompositionReport | null = null;
  let refusal: string | null = null;
  try {
    report = await loadCompositionReport(membershipRepository(), subject);
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  return (
    <MembershipShell current="/board/membership/composition">
      <h1 className={styles.title}>Membership composition</h1>
      <p className={styles.lede}>
        Three tests. Two of them decide whether the Association is exempt at all; the third
        decides whether a gift to the Association is deductible to the person who gives it.
        They are easy to conflate and they are not the same test.
      </p>

      {refusal || !report ? (
        <Refused viewerLabel={viewerLabel} what="the composition report" detail={refusal ?? undefined} />
      ) : (
        <>
          <div className={styles.summary}>
            <span className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Members counted</span>
              <span className={styles.summaryValue}>{report.denominator}</span>
            </span>
            <span className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Records excluded</span>
              <span className={styles.summaryValue}>{report.excludedRecords}</span>
            </span>
            <span className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Tests passing</span>
              <span className={styles.summaryValue}>
                {report.tests.filter((t) => t.passes).length} of {report.tests.length}
              </span>
            </span>
            <span className={styles.summaryItem}>
              <span className={styles.summaryLabel}>As of</span>
              <span className={styles.summaryValue}>{report.asOf.slice(0, 10)}</span>
            </span>
          </div>

          <p className={styles.sectionNote}>
            Counted: members holding member access, which is{" "}
            {report.countedStates.map((s) => s.toLowerCase().replace(/_/g, " ")).join(" and ")}.
            Lapsed and revoked records are excluded. That choice moves the percentages, so it is
            stated rather than assumed.
          </p>

          {report.tests.map((test) => (
            <section
              key={test.key}
              className={`${styles.test} ${test.passes ? styles.testPass : styles.testFail}`}
            >
              <div className={styles.testHead}>
                <h2 className={styles.testLabel}>{test.label}</h2>
                <span
                  className={`${styles.verdict} ${
                    test.passes ? styles.verdictPass : styles.verdictFail
                  }`}
                >
                  {test.passes ? "Passes" : "Fails"}
                </span>
              </div>

              <div className={styles.figures}>
                <span className={styles.figure}>
                  {formatPercent(test.numerator, test.denominator)}
                </span>
                <span className={styles.against}>
                  {test.numerator} of {test.denominator} members
                </span>
                <span className={styles.against}>
                  threshold {formatThreshold(test.thresholdPermille)}
                </span>
                <span className={styles.against}>
                  {test.passes
                    ? `${surplus(test.numerator, test.denominator, test.thresholdPermille)} members of headroom`
                    : `${shortfall(test.numerator, test.denominator, test.thresholdPermille)} members short`}
                </span>
              </div>

              <p className={styles.testGoverns}>{test.governs}</p>

              <ul className={styles.breakdown}>
                {test.breakdown.map((line) => (
                  <li key={line.label}>
                    <span>{line.label}</span>
                    <span>{line.count}</span>
                  </li>
                ))}
              </ul>

              <span className={styles.authority}>{test.authority}</span>
            </section>
          ))}

          <h2 className={styles.sectionHead}>Records to fix</h2>
          <p className={styles.sectionNote}>
            These do not change the figures above. They are records the figures had to be
            computed around, and each one is a member somebody needs to call.
          </p>
          <ul className={styles.breakdown}>
            <li>
              <span>
                Self-attested war-veteran status disagreeing with the attested service dates
              </span>
              <span>{report.attestationMismatches}</span>
            </li>
            <li>
              <span>Veteran records with no service dates, which the 90% test cannot count</span>
              <span>{report.missingServiceDates}</span>
            </li>
            <li>
              <span>Non-qualifying members, against a ceiling of 2.5% of the roster</span>
              <span>{report.categoryCounts.NON_QUALIFYING}</span>
            </li>
          </ul>

          <div className={styles.held}>
            <strong>The 75% test is not a war-veteran test</strong>
            Treas. Reg. 1.501(c)(19)-1 still reads as though 75% of members must be war
            veterans. Congress deleted that in 1982 and the regulation was never conformed, so
            it is wrong on the page and wrong in most of the guidance that quotes it. This report
            builds the 75% test on armed-forces service, per the statute and Pub. 3386. Built
            the other way it would report this roster as not exempt.
          </div>

          <p className={styles.note}>
            A non-qualifying member class above 2.5% of the roster ends the exemption, which is
            why the second test and the non-qualifying count are two views of one line. The
            97.5% comparison is integer arithmetic in permille: 97.5% of 40 is exactly 39, and
            that is not a boundary to settle in floating point.
          </p>

          <p className={styles.note}>
            Research, not advice. The thresholds and the wartime periods are sourced to the
            statutes and Pub. 3386, and the treatment of this roster needs CPA sign-off before
            the board relies on it.
          </p>
        </>
      )}
    </MembershipShell>
  );
}

/** How many members could be lost before a passing test fails. */
function surplus(numerator: number, denominator: number, permille: number): number {
  let n = numerator;
  let count = 0;
  while (n > 0 && (n - 1) * 1000 >= permille * denominator) {
    n -= 1;
    count += 1;
  }
  return count;
}

/** How many more qualifying members a failing test needs, at this denominator. */
function shortfall(numerator: number, denominator: number, permille: number): number {
  if (denominator === 0) return 0;
  let n = numerator;
  let count = 0;
  while (n <= denominator && n * 1000 < permille * denominator) {
    n += 1;
    count += 1;
  }
  return count;
}
