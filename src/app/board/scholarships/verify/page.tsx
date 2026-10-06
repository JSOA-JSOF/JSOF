import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { loadVerificationQueue } from "@/lib/scholarships/verification";
import { VERIFICATION_METHOD_LABELS } from "@/lib/scholarships/types";
import styles from "@/components/workspace/workspace.module.css";
import { VerifyForm } from "./VerifyForm";

export const metadata = {
  title: "Verify — Scholarships",
  robots: { index: false, follow: false },
};

/**
 * Wounded Patriot verification. The chair only.
 *
 * This is the one step in the cycle that must never run without a person, and
 * the module has no auto-approve path at all — not a disabled button, an
 * absence, with a test asserting no function sets verified status without a
 * human actor id. The screen is deliberately slow: one claim, the words the
 * applicant used, and a record of who you spoke to.
 */
export default async function VerifyPage() {
  const subject = await getCurrentSubject();

  let queue: Awaited<ReturnType<typeof loadVerificationQueue>>;
  try {
    queue = await loadVerificationQueue(scholarshipRepository(), subject);
  } catch (error) {
    return (
      <div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>Verification</h1>
        <p style={{ color: "var(--warn)", maxWidth: "68ch" }}>
          {error instanceof AuthzError ? error.message : "This queue could not be opened."}
        </p>
        <p style={{ color: "var(--ink-2)", maxWidth: "68ch" }}>
          Only the Scholarships Chair verifies a disability claim. Scorers never
          see this evidence, which is why it decides nothing in their queue.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>Verification</h1>
        <p style={{ color: "var(--ink-2)", maxWidth: "72ch", margin: 0 }}>
          {queue.waiting.length} claim{queue.waiting.length === 1 ? "" : "s"} waiting.{" "}
          {queue.verified} verified and {queue.notVerified} not, so far this cycle.
          Every one of these is a conversation with a person; nothing here can
          decide a claim for you.
        </p>
      </div>

      {queue.waiting.length === 0 ? (
        <div className={styles.card}>
          <p className={styles.essay} style={{ margin: 0 }}>
            Nothing is waiting. Every Wounded Patriot claim in this cycle has
            been decided.
          </p>
        </div>
      ) : null}

      {queue.waiting.map((row) => (
        <div key={row.applicationId} className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.applicant}>{row.applicantName}</span>
            <span className={styles.position}>{row.reference}</span>
          </div>

          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>Relationship</dt>
              <dd>{row.serviceMemberRelationship}</dd>
            </div>
            <div className={styles.fact}>
              <dt>Claimed connection</dt>
              <dd>{row.claimedServiceConnection}</dd>
            </div>
            <div className={styles.fact}>
              <dt>Contact they named</dt>
              <dd>{row.verificationContact || "None given"}</dd>
            </div>
          </dl>

          {row.narrative ? <p className={styles.essay}>{row.narrative}</p> : null}

          <VerifyForm
            applicationId={row.applicationId}
            methods={Object.entries(VERIFICATION_METHOD_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </div>
      ))}

      {queue.decided.length > 0 ? (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.applicant}>Already decided</span>
            <span className={styles.position}>{queue.decided.length}</span>
          </div>
          <div className={styles.exceptions}>
            {queue.decided.slice(0, 12).map((row) => (
              <p key={row.applicationId} className={styles.exception}>
                <strong>{row.applicantName}</strong>
                <span>
                  {row.verification?.outcome === "VERIFIED" ? "Verified" : "Not verified"}
                  {row.verification
                    ? ` · ${VERIFICATION_METHOD_LABELS[row.verification.method]}`
                    : ""}
                </span>
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
