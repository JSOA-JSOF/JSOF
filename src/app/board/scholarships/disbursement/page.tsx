import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { loadChequeRun } from "@/lib/scholarships/disbursement";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { formatCents } from "@/components/workspace/types";
import styles from "@/components/workspace/workspace.module.css";

export const metadata = {
  title: "Disbursement — Scholarships",
  robots: { index: false, follow: false },
};

/**
 * The cheque run. Payee is the school, never the student.
 *
 * Consolidation matters more than it looks: schools with several awards go in
 * one envelope, and mailing the envelopes is the chair's other
 * most-time-consuming task. The list and the grouping are automated; the
 * posting is not, and nothing here pretends otherwise.
 */
export default async function DisbursementPage() {
  const subject = await getCurrentSubject();

  let run: Awaited<ReturnType<typeof loadChequeRun>>;
  try {
    run = await loadChequeRun(scholarshipRepository(), subject);
  } catch (error) {
    return (
      <div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>Disbursement</h1>
        <p style={{ color: "var(--warn)", maxWidth: "68ch" }}>
          {error instanceof AuthzError ? error.message : "The cheque run could not be opened."}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>Disbursement</h1>
        <p style={{ color: "var(--ink-2)", maxWidth: "72ch", margin: 0 }}>
          {run.queued.length} cheque{run.queued.length === 1 ? "" : "s"} to write,{" "}
          {run.mailed.length} already mailed. Every payee is a school. No
          applicant name appears in this run or its export, which is why the
          Treasurer can open it without being handed the applicant roll.
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.closingFigures}>
          <span className={styles.closingFigure}>
            <strong>{formatCents(run.queuedTotalCents)}</strong>
            <span>queued</span>
          </span>
          <span className={styles.closingFigure}>
            <strong>{formatCents(run.mailedTotalCents)}</strong>
            <span>mailed</span>
          </span>
          <span className={styles.closingFigure}>
            <strong>{formatCents(run.totalCents)}</strong>
            <span>cycle total</span>
          </span>
          <span className={styles.closingFigure}>
            <strong>{run.consolidations.length}</strong>
            <span>schools with more than one</span>
          </span>
        </div>
        <div className={styles.actions}>
          <a className={styles.primary} href="/board/scholarships/disbursement/export">
            Download the cheque run
          </a>
          <span className={styles.consequence} style={{ margin: 0 }}>
            CSV for the Treasurer. Read via your {run.readVia === "FINANCIAL" ? "financial" : "applicant"} grant.
          </span>
        </div>
      </div>

      {run.consolidations.length > 0 ? (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.applicant}>One envelope each</span>
            <span className={styles.position}>{run.consolidations.length} schools</span>
          </div>
          <p className={styles.essay} style={{ marginTop: -6 }}>
            These schools have more than one cheque. Posting them together is
            fewer envelopes and fewer things to lose.
          </p>
          <div className={styles.bands}>
            {run.consolidations.map((group) => (
              <div key={group.payableTo} className={styles.band}>
                <span className={styles.bandRange}>{group.cheques} cheques</span>
                <span style={{ fontSize: ".92rem" }}>{group.payableTo}</span>
                <span className={styles.bandAmount}>{formatCents(group.totalCents)}</span>
                <span className={styles.bandCount} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.applicant}>To write</span>
          <span className={styles.position}>{run.queued.length}</span>
        </div>
        <div className={styles.bands}>
          {run.queued.slice(0, 25).map((row) => (
            <div key={row.cheque.id} className={styles.band}>
              <span className={styles.bandRange}>{row.cheque.memoReference}</span>
              <span style={{ fontSize: ".92rem" }}>
                {row.cheque.payableTo}
                <span style={{ color: "var(--mute)" }}> · {row.programLabel}</span>
              </span>
              <span className={styles.bandAmount}>{formatCents(row.cheque.amountCents)}</span>
              <span className={styles.bandCount}>{row.cheque.state}</span>
            </div>
          ))}
        </div>
        {run.queued.length > 25 ? (
          <p style={{ color: "var(--mute)", fontSize: ".86rem", margin: 0 }}>
            Showing 25 of {run.queued.length}. The export has them all.
          </p>
        ) : null}
      </div>
    </div>
  );
}
