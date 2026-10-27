import { AuthzError } from "@/lib/authz/policy";
import { loadCohortAudit, REVOCATION_HELD_REASON } from "@/lib/membership/board";
import { membershipRepository } from "@/lib/membership/repository";
import { AUDIT_WINDOW_DAYS, type CohortAuditRow } from "@/lib/membership/types";

import styles from "../board.module.css";
import { audit } from "../actions";
import { MembershipShell, Refused } from "../shell";
import { currentActor } from "../subject";

export const metadata = {
  title: "30-day cohort audit — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The 30-day cohort audit.
 *
 * This is a check on the record, not a probation the member experiences.
 * PROBATIONARY and GOOD_STANDING grant identical access, so nobody on this
 * page is waiting for anything: what is being audited is whether the
 * organization wrote the record down properly, because those fields are what
 * the two exemption tests are computed from.
 *
 * There is no fail-and-revoke control. See REVOCATION_HELD_REASON.
 */
export default async function CohortAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string; done?: string }>;
}) {
  const { refused, done } = await searchParams;
  const { subject, label: viewerLabel } = await currentActor();

  let rows: CohortAuditRow[] = [];
  let dueCount = 0;
  let refusal: string | null = null;
  try {
    const loaded = await loadCohortAudit(membershipRepository(), subject);
    rows = loaded.rows;
    dueCount = loaded.dueCount;
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  return (
    <MembershipShell current="/board/membership/audit">
      <h1 className={styles.title}>30-day cohort audit</h1>
      <p className={styles.lede}>
        Every member whose dues cleared within the last {AUDIT_WINDOW_DAYS} days, and what their
        record is missing. Members keep full access throughout: this audits our paperwork, not
        the member.
      </p>

      {refusal ? (
        <Refused viewerLabel={viewerLabel} what="the cohort audit" detail={refusal} />
      ) : (
        <>
          {done && (
            <div className={styles.held}>
              <strong>{done === "PASSED" ? "Audit passed" : "Finding recorded and held"}</strong>
              {done === "PASSED"
                ? "The record is complete and the member moves to good standing. Their access does not change, because it never differed."
                : REVOCATION_HELD_REASON}
            </div>
          )}
          {refused && (
            <div className={styles.refused}>
              <p className={styles.refusedTitle}>That audit was refused</p>
              <p className={styles.refusedBody}>
                Nothing was changed. Acting as {viewerLabel}.
              </p>
              <p className={styles.refusedDetail}>{refused}</p>
            </div>
          )}

          <div className={styles.summary}>
            <span className={styles.summaryItem}>
              <span className={styles.summaryLabel}>In the cohort</span>
              <span className={styles.summaryValue}>{rows.length}</span>
            </span>
            <span className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Audit due now</span>
              <span className={styles.summaryValue}>{dueCount}</span>
            </span>
            <span className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Records with findings</span>
              <span className={styles.summaryValue}>
                {rows.filter((r) => r.recordFindings.length > 0).length}
              </span>
            </span>
          </div>

          {rows.length === 0 ? (
            <p className={styles.empty}>Nobody is in the probationary cohort.</p>
          ) : (
            <ul className={styles.rows}>
              {rows.map((row) => (
                <li
                  key={row.member.id}
                  className={`${styles.row} ${row.dueNow ? styles.rowDue : ""}`}
                >
                  <div className={styles.rowHead}>
                    <span className={styles.rowName}>{row.member.displayName}</span>
                    <span className={styles.rowMeta}>
                      {row.member.memberId} &middot; day {row.daysSincePayment}
                      {row.dueNow ? " · due" : " · inside the window"}
                    </span>
                  </div>
                  <div className={styles.rowFacts}>
                    <span>{row.member.membershipCategory.toLowerCase().replace(/_/g, " ")}</span>
                    <span className={styles.num}>
                      {row.member.serviceFrom
                        ? `${row.member.serviceFrom} to ${row.member.serviceTo ?? "serving"}`
                        : "no service dates"}
                    </span>
                    <span>war veteran: {row.member.isWarVeteran ? "yes" : "no"}</span>
                  </div>

                  {row.recordFindings.length > 0 && (
                    <ul className={styles.findings}>
                      {row.recordFindings.map((finding) => (
                        <li key={finding}>{finding}</li>
                      ))}
                    </ul>
                  )}

                  <form action={audit} className={styles.decide}>
                    <input type="hidden" name="memberId" value={row.member.id} />
                    <input
                      className={styles.reason}
                      name="note"
                      placeholder="What you checked. Kept on the record."
                      aria-label="Audit note"
                    />
                    <button className={styles.approve} name="outcome" value="PASSED" type="submit">
                      Record the audit as passed
                    </button>
                    <button className={styles.quiet} name="outcome" value="HELD" type="submit">
                      Record a finding and hold
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.held}>
            <strong>Why there is no fail-and-revoke control here</strong>
            {REVOCATION_HELD_REASON}
          </div>

          <p className={styles.note}>
            The state machine does have a path from a failed audit to revoked. This module does
            not call it, on purpose, and that is a departure worth knowing about rather than a
            gap: a button that expels a member on terms nobody has written down is worse than
            no button.
          </p>
        </>
      )}
    </MembershipShell>
  );
}
