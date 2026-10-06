import { AuthzError } from "@/lib/authz/policy";
import { loadChairQueue, stateLabel } from "@/lib/membership/board";
import { membershipRepository } from "@/lib/membership/repository";
import {
  CATEGORY_LABELS,
  FLAG_LABELS,
  RELATIONSHIP_LABELS,
  type Application,
} from "@/lib/membership/types";

import styles from "../board.module.css";
import { decide } from "../actions";
import { MembershipShell, Refused } from "../shell";
import { currentActor } from "../subject";

export const metadata = {
  title: "Chair exceptions — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The chair exception queue.
 *
 * Everything the vouch could not settle arrives here: a sponsor who declined, a
 * sponsor who did not recognise the name, a window that closed unanswered, a
 * sponsor ID that matched nobody, and every augmentee case regardless of what
 * the sponsor said.
 *
 * Reading the queue needs READ. Deciding in it needs WRITE, so the President
 * and the Secretary can see the queue and cannot decide in it. That is not a
 * technicality: the President holds aggregate only on applicant data precisely
 * so "the President leaned on the committee" cannot happen quietly, and the
 * same reasoning applies here.
 */
export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string; done?: string }>;
}) {
  const { refused, done } = await searchParams;
  const { persona, subject } = await currentActor();

  let queue: Application[] = [];
  let decided: Application[] = [];
  let refusal: string | null = null;
  try {
    const loaded = await loadChairQueue(membershipRepository(), subject);
    queue = loaded.queue;
    decided = loaded.decided;
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  return (
    <MembershipShell current="/board/membership/exceptions">
      <h1 className={styles.title}>Chair exceptions</h1>
      <p className={styles.lede}>
        Applications the vouch could not settle. A decline and a &ldquo;I do not know this
        person&rdquo; arrive here the same way, because they are not the same answer and neither
        one is a rejection.
      </p>

      {refusal ? (
        <Refused persona={persona} what="the chair exception queue" detail={refusal} />
      ) : (
        <>
          {done && (
            <div className={styles.held}>
              <strong>Decision recorded</strong>
              {done === "APPROVED"
                ? "The applicant has a payment link. Dues are the only remaining step."
                : "The applicant has been told. No payment was taken and none can be."}
            </div>
          )}
          {refused && (
            <div className={styles.refused}>
              <p className={styles.refusedTitle}>That decision was refused</p>
              <p className={styles.refusedBody}>
                Nothing was changed. Acting as {persona.label}: {persona.note ?? ""}
              </p>
              <p className={styles.refusedDetail}>{refused}</p>
            </div>
          )}

          <h2 className={styles.sectionHead}>Waiting on the chair</h2>
          {queue.length === 0 ? (
            <p className={styles.empty}>Nothing is waiting on a decision.</p>
          ) : (
            <ul className={styles.rows}>
              {queue.map((application) => (
                <li key={application.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowName}>{application.applicantName}</span>
                    <span className={styles.rowMeta}>
                      {application.reference} &middot; submitted{" "}
                      {(application.submittedAt ?? application.createdAt).slice(0, 10)}
                    </span>
                  </div>
                  <div className={styles.rowFacts}>
                    <span>
                      {application.membershipCategory
                        ? CATEGORY_LABELS[application.membershipCategory]
                        : "no category given"}
                    </span>
                    {application.qualifyingRelationship && (
                      <span>{RELATIONSHIP_LABELS[application.qualifyingRelationship]}</span>
                    )}
                    <span>
                      Sponsor given{" "}
                      <span className={styles.num}>
                        {application.sponsorMemberId || "none"}
                      </span>
                    </span>
                    {application.serviceFrom && (
                      <span className={styles.num}>
                        {application.serviceFrom} to {application.serviceTo ?? "serving"}
                      </span>
                    )}
                  </div>
                  {application.flags.length > 0 && (
                    <ul className={styles.flags}>
                      {application.flags.map((flag) => (
                        <li key={flag} className={styles.flag}>
                          {FLAG_LABELS[flag]}
                        </li>
                      ))}
                    </ul>
                  )}

                  <form action={decide} className={styles.decide}>
                    <input type="hidden" name="applicationId" value={application.id} />
                    <input
                      className={styles.reason}
                      name="reason"
                      placeholder="What you decided and why. Kept on the record."
                      aria-label="Reason"
                    />
                    <button className={styles.approve} name="outcome" value="APPROVED" type="submit">
                      Approve and ask for dues
                    </button>
                    <button className={styles.deny} name="outcome" value="DENIED" type="submit">
                      Decline the application
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <h2 className={styles.sectionHead}>Declined</h2>
          <p className={styles.sectionNote}>
            No payment was taken from any of these. There is no state in which this platform
            holds money for an application that was refused.
          </p>
          {decided.length === 0 ? (
            <p className={styles.empty}>Nothing has been declined.</p>
          ) : (
            <ul className={styles.rows}>
              {decided.map((application) => (
                <li key={application.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowName}>{application.applicantName}</span>
                    <span className={styles.rowMeta}>{stateLabel(application.state)}</span>
                  </div>
                  {application.chairDecision && (
                    <div className={styles.rowFacts}>
                      <span>{application.chairDecision.reason}</span>
                      <span className={styles.num}>
                        {application.chairDecision.at.slice(0, 10)} &middot;{" "}
                        {application.chairDecision.chairPersonId}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className={styles.note}>
            Approving moves the application to awaiting dues. Declining closes it. There is no
            revoke control anywhere in this module: NC&rsquo;s nonprofit statute sets no notice
            period and no hearing requirement for expulsion, so what a revocation means for
            this organization comes from the bylaws and the bylaws have not said yet.
          </p>
        </>
      )}
    </MembershipShell>
  );
}
