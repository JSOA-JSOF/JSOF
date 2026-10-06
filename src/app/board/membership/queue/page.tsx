import { AuthzError } from "@/lib/authz/policy";
import { loadApplicationQueue, stateLabel, type ApplicationQueue } from "@/lib/membership/board";
import { membershipRepository } from "@/lib/membership/repository";
import { VOUCH_WINDOW_HOURS } from "@/lib/membership/state";
import { CATEGORY_LABELS, FLAG_LABELS, type Application } from "@/lib/membership/types";

import styles from "../board.module.css";
import { MembershipShell, Refused } from "../shell";
import { currentActor } from "../subject";

export const metadata = {
  title: "Application queue — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The application queue.
 *
 * `loadApplicationQueue` calls `authorize()` with MEMBER_PII at READ for JSOA
 * before it reads a row, and writes the read to the audit log. An application
 * carries a person's name and service dates, so aggregate is not enough to
 * open this page and the roles that hold aggregate are refused.
 */
export default async function ApplicationQueuePage() {
  const { persona, subject } = await currentActor();

  let queue: ApplicationQueue | null = null;
  let refusal: string | null = null;
  try {
    queue = await loadApplicationQueue(membershipRepository(), subject);
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  return (
    <MembershipShell current="queue">
      <h1 className={styles.title}>Application queue</h1>
      <p className={styles.lede}>
        Applications waiting on a sponsor, and applications waiting on dues. Anything a sponsor
        declined, did not recognise, or left unanswered for {VOUCH_WINDOW_HOURS} hours is in the
        chair exceptions tab instead.
      </p>

      {refusal || !queue ? (
        <Refused persona={persona} what="the application queue" detail={refusal ?? undefined} />
      ) : (
        <>
          {queue.sweptToChair > 0 && (
            <div className={styles.held}>
              <strong>
                {queue.sweptToChair === 1
                  ? "One vouch window closed"
                  : `${queue.sweptToChair} vouch windows closed`}
              </strong>
              Moved to the chair exceptions queue just now. In production a scheduled job does
              this; in this build the queue sweeps when it loads, so the demo needs no
              scheduler.
            </div>
          )}

          <h2 className={styles.sectionHead}>Awaiting a sponsor&rsquo;s answer</h2>
          <p className={styles.sectionNote}>
            No money has been asked for and none can be. The state machine has no path from here
            to a payment without a vouch or a chair approval.
          </p>
          <Rows
            items={queue.awaitingVouch}
            empty="Nothing is waiting on a sponsor."
            showWindow
          />

          <h2 className={styles.sectionHead}>Awaiting dues</h2>
          <p className={styles.sectionNote}>
            Vouched or approved, payment link sent. These become members when the provider&rsquo;s
            webhook confirms the payment, and not when the applicant says it went through.
          </p>
          <Rows items={queue.awaitingPayment} empty="Nobody currently owes dues." />
        </>
      )}
    </MembershipShell>
  );
}

function Rows({
  items,
  empty,
  showWindow = false,
}: {
  items: Application[];
  empty: string;
  showWindow?: boolean;
}) {
  if (items.length === 0) return <p className={styles.empty}>{empty}</p>;
  return (
    <ul className={styles.rows}>
      {items.map((application) => (
        <li key={application.id} className={styles.row}>
          <div className={styles.rowHead}>
            <span className={styles.rowName}>{application.applicantName}</span>
            <span className={styles.rowMeta}>
              {stateLabel(application.state)} &middot; {application.reference}
            </span>
          </div>
          <div className={styles.rowFacts}>
            <span>
              {application.membershipCategory
                ? CATEGORY_LABELS[application.membershipCategory]
                : "no category given"}
            </span>
            <span>
              Sponsor <span className={styles.num}>{application.sponsorMemberId || "none given"}</span>
            </span>
            {application.serviceFrom && (
              <span className={styles.num}>
                {application.serviceFrom} to {application.serviceTo ?? "serving"}
              </span>
            )}
            {showWindow && application.vouchExpiresAt && (
              <span className={styles.num}>
                window closes {application.vouchExpiresAt.slice(0, 16).replace("T", " ")}Z
              </span>
            )}
          </div>
          {application.flags.length > 0 && (
            <ul className={styles.flags}>
              {application.flags.map((flag) => (
                <li key={flag} className={styles.flag} title={FLAG_LABELS[flag]}>
                  {FLAG_LABELS[flag]}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
