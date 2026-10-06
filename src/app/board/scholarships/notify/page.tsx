import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { awardNotificationFor, loadAwardRows, loadAwardsBoard } from "@/lib/scholarships/awards";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { WOUNDED_PATRIOT } from "@/lib/scholarships/scoring";
import { formatCents } from "@/components/workspace/types";
import styles from "@/components/workspace/workspace.module.css";
import { SendPanel } from "./SendPanel";

export const metadata = {
  title: "Notify — Scholarships",
  robots: { index: false, follow: false },
};

/**
 * The 183 messages.
 *
 * This is the task the chair named as most time-consuming: she retypes each
 * award amount into an email by hand. Here the amount is merged from the
 * record and the sponsoring member is a recipient with a stated reason, not a
 * bcc, because students frequently do not answer and chasing the sponsor from
 * outside the system is the failure this removes.
 *
 * Nothing is sent until she presses send, and the screen says so rather than
 * relying on a dialog nobody reads.
 */
export default async function NotifyPage() {
  const subject = await getCurrentSubject();
  const repo = scholarshipRepository();

  let board: Awaited<ReturnType<typeof loadAwardsBoard>>;
  let rows: Awaited<ReturnType<typeof loadAwardRows>>;
  try {
    board = await loadAwardsBoard(repo, subject);
    rows = await loadAwardRows(repo, subject);
  } catch (error) {
    return (
      <div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>Notify</h1>
        <p style={{ color: "var(--warn)", maxWidth: "68ch" }}>
          {error instanceof AuthzError ? error.message : "This screen could not be opened."}
        </p>
      </div>
    );
  }

  const pending = rows.filter((row) => row.award.status !== "NOTIFIED");
  const first = pending[0] ?? null;

  let preview: Awaited<ReturnType<typeof awardNotificationFor>> | null = null;
  if (first) {
    try {
      preview = await awardNotificationFor(repo, subject, first.award.id);
    } catch {
      preview = null;
    }
  }

  return (
    <div className={styles.shell}>
      <div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>Notify</h1>
        <p style={{ color: "var(--ink-2)", maxWidth: "72ch", margin: 0 }}>
          {board.notYetNotified} award
          {board.notYetNotified === 1 ? "" : "s"} still to tell someone about.
          The amount in each message is merged from the record, so it cannot
          drift from what the board approved.
        </p>
      </div>

      {!WOUNDED_PATRIOT.amountConfirmed ? (
        <div className={styles.pause}>
          <strong>Hold the Wounded Patriot messages.</strong> That award is a
          flat {formatCents(WOUNDED_PATRIOT.amountCents)} placeholder nobody has
          confirmed. Sending it would tell {board.woundedPatriotAwards} families
          a figure that is not yet real.
        </div>
      ) : null}

      {board.withTheBoard.length > 0 ? (
        <div className={styles.pause}>
          <strong>
            {board.withTheBoard.length} award
            {board.withTheBoard.length === 1 ? " is" : "s are"} with the full board.
          </strong>{" "}
          These are sponsored by board members, who are recused. Nothing here
          sends them until the board&rsquo;s decision is recorded.
        </div>
      ) : null}

      {first && preview ? (
        <SendPanel
          awardId={first.award.id}
          applicantName={first.applicantName}
          schoolName={first.schoolName}
          subjectLine={preview.subject}
          body={preview.body}
          amountCents={preview.mergedAmountCents}
          recipients={preview.recipients}
          queued={pending.length}
        />
      ) : (
        <div className={styles.card}>
          <p className={styles.essay} style={{ margin: 0 }}>
            Every award in this cycle has been notified. The cheque run is on the
            disbursement screen.
          </p>
        </div>
      )}
    </div>
  );
}
