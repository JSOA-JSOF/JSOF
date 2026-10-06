"use client";

import { useState } from "react";

import styles from "./workspace.module.css";
import { formatCents, type CycleSummary, type NotificationPreview } from "./types";

/**
 * The 183 emails.
 *
 * This is the task she named as most time-consuming, and the one with the most
 * fear attached: money, real families, a volunteer at 11pm. The answer is not a
 * confirmation dialog, which people click through without reading. It is a
 * persistent not-yet-sent state, an honest statement of what will happen and to
 * whom, and then a single deliberate act.
 *
 * The sponsoring member is a recipient, not a bcc. Students frequently do not
 * read or answer email, and leaving the system to chase the sponsor is the
 * failure this removes.
 */
export function SendGate({
  preview,
  queued,
  summary,
  onSend,
}: {
  preview: NotificationPreview;
  queued: number;
  summary: CycleSummary;
  onSend?: () => void;
}) {
  const [sent, setSent] = useState(false);

  const body = preview.bodyTemplate.split("{{award}}");

  if (sent) {
    // Peak-end: a cycle should end by saying what was done, not by a queue
    // going quiet. No celebration — this organization memorializes the fallen,
    // and reward mechanics would be grotesque here. Just the facts, stated.
    return (
      <div className={styles.closing}>
        <p style={{ margin: 0, fontWeight: 600 }}>{summary.cycleLabel} is sent.</p>
        <div className={styles.closingFigures}>
          <span className={styles.closingFigure}>
            <strong>{summary.studentsNotified}</strong>
            <span>students notified</span>
          </span>
          <span className={styles.closingFigure}>
            <strong>{formatCents(summary.totalAwardedCents)}</strong>
            <span>awarded</span>
          </span>
          <span className={styles.closingFigure}>
            <strong>{summary.schoolsPaid}</strong>
            <span>schools to pay</span>
          </span>
        </div>
        <p className={styles.consequence} style={{ margin: 0 }}>
          The cheque run for the Treasurer is ready on the disbursement screen.
          Every sponsoring member was copied on their student&rsquo;s notification.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.gate}>
      <p className={styles.gateState}>
        <span>Nothing has been sent.</span>
        <span style={{ fontWeight: 400 }}>
          {queued} notifications are drafted and waiting for you.
        </span>
      </p>

      <div className={styles.gateBody}>
        <div className={styles.preview}>
          <div className={styles.previewMeta}>
            <span>
              To: {preview.applicantName} &lt;{preview.applicantEmail}&gt;
            </span>
            <span>
              Copy: {preview.sponsorName} &lt;{preview.sponsorEmail}&gt; · sponsoring
              member
            </span>
            <span>Subject: {preview.subject}</span>
          </div>
          <p style={{ margin: 0 }}>
            {body[0]}
            <span className={styles.merged}>
              {formatCents(preview.awardAmountCents)}
            </span>
            {body[1]}
          </p>
        </div>

        <p className={styles.consequence}>
          The highlighted amount is merged from each student&rsquo;s record, so it
          is not retyped and cannot drift from what the board approved. Sending
          delivers {queued} messages, each copied to that student&rsquo;s
          sponsoring member. It cannot be undone once it leaves.
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              setSent(true);
              onSend?.();
            }}
          >
            Send {queued} notifications
          </button>
          <span className={styles.consequence} style={{ margin: 0 }}>
            Nothing goes out until you press this.
          </span>
        </div>
      </div>
    </div>
  );
}
