"use client";

import { useActionState } from "react";

import styles from "@/components/workspace/workspace.module.css";
import { formatCents } from "@/components/workspace/types";
import { sendOneNotification, type SendResult } from "../actions";
import type { Recipient } from "@/lib/scholarships/types";

/**
 * One message, shown in full, with every recipient and why they are on it.
 *
 * The merged amount is highlighted because it is the one part of the message
 * that is not typed, and the whole point of this screen is that it is not
 * typed. Nothing goes out until the button is pressed, and the panel says so
 * rather than putting a dialog in the way.
 */
export function SendPanel({
  awardId,
  applicantName,
  schoolName,
  subjectLine,
  body,
  amountCents,
  recipients,
  queued,
}: {
  awardId: string;
  applicantName: string;
  schoolName: string;
  subjectLine: string;
  body: string;
  amountCents: number;
  recipients: Recipient[];
  queued: number;
}) {
  const [result, action, pending] = useActionState<SendResult | null, FormData>(
    sendOneNotification,
    null,
  );

  const amount = formatCents(amountCents);
  const parts = body.split(amount);

  return (
    <div className={styles.gate}>
      <p className={`${styles.gateState} ${result?.ok ? styles.gateStateSent : ""}`}>
        {result?.ok ? (
          <>
            <span>Sent to {applicantName}.</span>
            <span style={{ fontWeight: 400 }}>
              {queued - 1} left in this cycle.
            </span>
          </>
        ) : (
          <>
            <span>Nothing has been sent.</span>
            <span style={{ fontWeight: 400 }}>
              {queued} award{queued === 1 ? "" : "s"} waiting, starting with this one.
            </span>
          </>
        )}
      </p>

      <div className={styles.gateBody}>
        <div className={styles.preview}>
          <div className={styles.previewMeta}>
            {recipients.map((recipient) => (
              <span key={`${recipient.role}-${recipient.address}`}>
                {recipient.role === "APPLICANT" ? "To" : "Copy"}: {recipient.name} &lt;
                {recipient.address}&gt; · {recipient.because}
              </span>
            ))}
            <span>Subject: {subjectLine}</span>
          </div>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {parts.length > 1 ? (
              <>
                {parts[0]}
                <span className={styles.merged}>{amount}</span>
                {parts.slice(1).join(amount)}
              </>
            ) : (
              body
            )}
          </p>
        </div>

        <p className={styles.consequence}>
          {applicantName} is at {schoolName}, and payment goes to the school
          rather than to them. The highlighted figure is merged from the award
          record, so it is not retyped and cannot drift from what was approved.
        </p>

        <form action={action}>
          <input type="hidden" name="awardId" value={awardId} />
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={pending || result?.ok}>
              {pending ? "Sending…" : result?.ok ? "Sent" : `Send to ${applicantName}`}
            </button>
            <span className={styles.consequence} style={{ margin: 0 }}>
              {result?.ok
                ? "Reload for the next one."
                : "Nothing goes out until you press this, and it cannot be recalled."}
            </span>
          </div>
        </form>

        {result && !result.ok ? (
          <p className={styles.pause} style={{ margin: 0 }}>
            {result.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
