import Link from "next/link";

import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { loadScholarshipsPlanning } from "@/lib/scholarships/workspace";

import styles from "../workspace.module.css";

export const metadata = {
  title: "Planning — Scholarships",
  robots: { index: false, follow: false },
};

const TYPE_LABEL: Record<string, string> = {
  DECISION: "Decision",
  DISCUSSION: "Discussion",
  INFORMATION: "Information",
};

/**
 * Planning: this role's items for the next board meeting.
 *
 * Three items, all decisions, all of them things the board owes rather than
 * work the chair can do. They are written to be handed to the Secretary as
 * they stand — a type, an estimate in minutes and the reason the board rather
 * than the role has to settle it — so the agenda is built from what each role
 * filed instead of being retyped from six emails.
 *
 * `acceptedForMeetingId` is null on all three. That is "filed, not yet taken
 * onto an agenda", which is a different state from rejected, and the row says
 * which one it is in.
 */

export default async function ScholarshipsPlanning() {
  const subject = await getCurrentSubject();

  let planning: Awaited<ReturnType<typeof loadScholarshipsPlanning>> | null = null;
  let denial: string | null = null;
  try {
    planning = await loadScholarshipsPlanning(scholarshipRepository(), subject);
  } catch (error) {
    denial = error instanceof AuthzError ? error.message : String(error);
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>My items for the next meeting</h1>
        <p className={styles.lede}>
          What this seat wants on the next agenda, with an estimate and the
          reason it needs the board. These flow into the Secretary&rsquo;s
          agenda builder rather than being retyped there.
        </p>
      </div>

      {denial ? (
        <div className={styles.withheld}>
          <p className={styles.withheldWhy}>{denial}</p>
          <p className={styles.note}>
            These items carry the unconfirmed award amount and the retention
            period for named applicants, and filing an item on the board&rsquo;s
            agenda is a board seat&rsquo;s act. Withheld rather than empty. If
            you are scoring, your work is on{" "}
            <Link href="/board/scholarships/review">Review</Link>.
          </p>
        </div>
      ) : planning ? (
        <>
          <div className={styles.budget}>
            <span className={styles.budgetFigure}>{planning.totalMinutes} min</span>
            <span>
              across {planning.items.length} items, all of them decisions. The
              agenda builder sums these against the meeting length, so an
              estimate here is a claim on the board&rsquo;s time and not a
              guess nobody reads.
            </span>
          </div>

          <ul className={styles.planning}>
            {planning.items.map((item) => (
              <li key={item.id} className={styles.planningItem}>
                <div className={styles.planningHead}>
                  <span className={styles.planningTitle}>{item.title}</span>
                  <span className={styles.planningMeta}>
                    <span className={styles.planningType}>
                      {TYPE_LABEL[item.type] ?? item.type}
                    </span>
                    <span>{item.estimateMinutes} min</span>
                    <span>{item.entity}</span>
                  </span>
                </div>
                <p className={styles.planningReason}>{item.reason}</p>
                <span className={styles.planningState}>
                  {item.acceptedForMeetingId
                    ? `On the agenda for ${item.acceptedForMeetingId}`
                    : "Filed, not yet taken onto an agenda"}
                </span>
              </li>
            ))}
          </ul>

          <p className={styles.note}>
            The third item is the one nobody asked for. One year for an
            unsuccessful applicant&rsquo;s personal data is an assumption this
            platform wrote into code because a purge has to run on a schedule
            and a schedule needs a number. It has never been signed off. The
            first time somebody asks how long a rejected applicant&rsquo;s
            disability narrative is kept, the answer should be a minute
            reference and not a constant in a file.
          </p>
        </>
      ) : null}
    </div>
  );
}
