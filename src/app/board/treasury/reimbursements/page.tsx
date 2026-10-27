import Link from "next/link";

import { getCurrentSubject } from "@/lib/authz/session";
import { formatCentsWithSymbol } from "@/lib/treasury/money";
import {
  approvalsRequired,
  previewApproval,
  secondApprovalReason,
  statusFor,
} from "@/lib/treasury/reimbursements";
import { treasuryRepository, treasurySubject } from "@/lib/treasury/repository";
import { personName } from "@/lib/treasury/seed";
import type { Reimbursement, ReimbursementStatus } from "@/lib/treasury/types";

import {
  ENTITY_LABELS,
  EntityTag,
  Money,
  TreasuryHeader,
  Withheld,
  entityClass,
} from "../_components/chrome";
import styles from "../treasury.module.css";

export const metadata = {
  title: "Reimbursements — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<ReimbursementStatus, string> = {
  SUBMITTED: "Submitted, no approval yet",
  AWAITING_SECOND_APPROVAL: "Awaiting a second approval",
  APPROVED: "Approved",
  REFUSED: "Refused",
  PAID: "Paid",
};

/**
 * Reimbursement approval.
 *
 * The approval count comes from `requiresSecondApproval` in
 * `@/lib/authz/policy`: one approval below the thresholds, two above them, and
 * a related-party claim crosses the threshold at a tenth of the amount. The
 * refusal of a self-approval comes from `assertNotSelfApproval` in the same
 * file, which throws rather than warning.
 *
 * The case worth looking at is the first claim on the Association's queue. The
 * Treasurer submitted it, and the Treasurer is the person who approves
 * reimbursements, so the obvious thing for the software to do is let them
 * through. Switch the role to Treasurer, JSOA and try it: the refusal names
 * the claim and says who has to approve it instead.
 *
 * Persistence is deferred in this build, so approving previews the outcome
 * rather than writing it. The decision itself is the real one.
 */
export default async function ReimbursementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const approveIdRaw = Array.isArray(query.approve) ? query.approve[0] : query.approve;
  const subject = treasurySubject(await getCurrentSubject());
  const repo = await treasuryRepository();
  const asOf = await repo.asOfDate();
  const period = await repo.period();
  const queues = await repo.reimbursementQueues(subject);

  const allVisible = queues.flatMap((queue) => (queue.visible ? queue.claims : []));
  const target = approveIdRaw ? allVisible.find((c) => c.id === approveIdRaw) : undefined;
  const outcome = target ? previewApproval(subject, target, asOf) : null;

  return (
    <div>
      <TreasuryHeader
        current="/board/treasury/reimbursements"
        title="Reimbursements"
        period={period.label}
        lede={
          "Claims from volunteers who paid out of pocket. One approval under " +
          `${formatCentsWithSymbol(100_000)}, two above it, and two above ` +
          `${formatCentsWithSymbol(25_000)} where the payee is a related party. ` +
          "Nobody approves their own claim."
        }
      />

      {target && outcome ? (
        outcome.allowed ? (
          <p className={`${entityClass(target.entity)} ${styles.confirm}`} role="status">
            Approval recorded for {target.id}, {personName(target.createdById)},{" "}
            {formatCentsWithSymbol(target.amountCents)}. The claim is now{" "}
            <strong>{STATUS_LABELS[outcome.resultingStatus]}</strong>
            {outcome.remainingApprovals > 0
              ? `, and needs ${outcome.remainingApprovals} more approval from a different person.`
              : "."}{" "}
            <span className={styles.quiet}>
              Persistence is deferred in this build, so nothing was written.
            </span>
          </p>
        ) : (
          <p className={styles.refusal} role="status">
            <strong>Approval refused.</strong> {outcome.refusal}
            {outcome.code === "SELF_APPROVAL" ? (
              <>
                {" "}
                Holding the treasury does not make this one an exception. Ask the
                President, or the other officer holding spend approval on{" "}
                {ENTITY_LABELS[target.entity].short}, to approve it instead, and note
                in the minutes that you were the claimant.
              </>
            ) : null}
            {outcome.code === "NO_RECEIPT" ? (
              <> Attach the receipt to the claim, then approve it.</>
            ) : null}
          </p>
        )
      ) : null}

      <div className={styles.stack}>
        {queues.map((queue) => {
          if (!queue.visible) {
            return (
              <Withheld
                key={queue.entity}
                entity={queue.entity}
                what="Reimbursement queue"
                reason={queue.withheldReason}
              />
            );
          }
          const labels = ENTITY_LABELS[queue.entity];
          return (
            <section
              key={queue.entity}
              className={entityClass(queue.entity)}
              aria-labelledby={`rb-${queue.entity}`}
            >
              <div className={styles.panelHead}>
                <div>
                  <span className={styles.eyebrow}>{labels.subsection}</span>
                  <h2 id={`rb-${queue.entity}`} className={styles.panelTitle}>
                    <EntityTag entity={queue.entity} />{" "}
                    <span className={styles.entityName}>{labels.long}</span>
                  </h2>
                </div>
                <span className={styles.panelNote}>
                  {queue.claims.length}{" "}
                  {queue.claims.length === 1 ? "claim" : "claims"}, this entity only
                </span>
              </div>

              {queue.claims.length === 0 ? (
                <p className={styles.note}>
                  No claim on the {labels.short} queue for this period.
                </p>
              ) : (
                <div className={styles.stack}>
                  {queue.claims.map((claim) => (
                    <ClaimCard
                      key={claim.id}
                      claim={claim}
                      subjectPersonId={subject.personId}
                      canAct={previewApproval(subject, claim, asOf)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <p className={styles.note}>
        Claims and names in this build are fictional demo data.
      </p>
    </div>
  );
}

function ClaimCard({
  claim,
  subjectPersonId,
  canAct,
}: {
  claim: Reimbursement;
  subjectPersonId: string;
  canAct: ReturnType<typeof previewApproval>;
}) {
  const status = statusFor(claim);
  const needed = approvalsRequired(claim);
  const reason = secondApprovalReason(claim);
  const isOwnClaim = claim.createdById === subjectPersonId;
  const settled = status === "APPROVED" || status === "PAID" || status === "REFUSED";

  return (
    <article className={styles.panel} aria-labelledby={`claim-${claim.id}`}>
      <div className={styles.panelHead}>
        <div>
          <span className={styles.eyebrow}>{claim.id}</span>
          <h3 id={`claim-${claim.id}`} className={styles.panelTitle}>
            <Money amountCents={claim.amountCents} showCurrency />{" "}
            <span className={styles.quiet}>to {claim.claimantName}</span>
          </h3>
        </div>
        <span
          className={`${styles.chip} ${
            status === "APPROVED" || status === "PAID" ? styles.chipHue : styles.chipWarn
          }`}
        >
          {STATUS_LABELS[status]}
        </span>
      </div>

      <dl className={styles.kv}>
        <dt>Purpose</dt>
        <dd>{claim.purpose}</dd>
        <dt>Incurred</dt>
        <dd className={styles.num}>{claim.incurredOn}</dd>
        <dt>Approvals</dt>
        <dd>
          {claim.approvals.length} of {needed} recorded
          {claim.approvals.length > 0
            ? `: ${claim.approvals
                .map((a) => `${personName(a.approverId)} on ${a.approvedOn}`)
                .join("; ")}`
            : ""}
          {reason ? <span className={styles.memo}>{reason}</span> : null}
        </dd>
        <dt>Receipt</dt>
        <dd>
          {claim.receiptOnFile ? (
            "On file"
          ) : (
            <>
              <span className={`${styles.sev} ${styles.sevHigh}`}>not on file</span>
              <span className={styles.memo}>
                A reimbursement without a receipt is an unsubstantiated payment to a
                board member. It cannot be approved until the receipt is attached.
              </span>
            </>
          )}
        </dd>
        {claim.relatedParty ? (
          <>
            <dt>Related party</dt>
            <dd>{claim.relatedPartyNote}</dd>
          </>
        ) : null}
      </dl>

      {isOwnClaim ? (
        <p className={styles.mitigation}>
          <span className={styles.mitigationLabel}>Your claim</span>
          You submitted this one, so you cannot approve it however many other roles
          you hold. It needs{" "}
          {needed === 1 ? "an approval" : `${needed} approvals`} from someone else.
        </p>
      ) : null}

      {settled ? (
        <p className={styles.mitigation}>
          <span className={styles.mitigationLabel}>Settled</span>
          No further approval is needed on this claim.
        </p>
      ) : (
        <div className={styles.actions}>
          {canAct.allowed ? (
            <Link
              className={styles.actionLink}
              href={`/board/treasury/reimbursements?approve=${claim.id}`}
            >
              Approve {claim.id}
            </Link>
          ) : (
            <>
              <button className={styles.button} type="button" disabled>
                Approve {claim.id}
              </button>
              <span className={styles.quiet}>{canAct.refusal}</span>
            </>
          )}
        </div>
      )}
    </article>
  );
}
