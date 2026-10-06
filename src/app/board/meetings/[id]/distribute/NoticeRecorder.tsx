"use client";

import { useActionState } from "react";

import { recordNoticeSentAction } from "@/lib/meetings/actions";
import styles from "../../meetings.module.css";

export function NoticeRecorder({
  meetingId,
  alreadySent,
}: {
  meetingId: string;
  alreadySent: string | null;
}) {
  const [state, action, pending] = useActionState(recordNoticeSentAction, null);
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Record that the notice went out</div>
      <p className={styles.rowNote}>
        This records what the Secretary did outside the platform. It sends
        nothing, because nothing here can send. Use it after you have mailed the
        payload above by hand.
        {alreadySent
          ? ` Currently recorded as issued ${new Date(alreadySent).toISOString().slice(0, 16).replace("T", " ")} UTC.`
          : " Not yet recorded as issued."}
      </p>
      <form action={action}>
        <input type="hidden" name="meetingId" value={meetingId} />
        <div className={styles.buttonRow}>
          <button type="submit" className={styles.button} disabled={pending}>
            Record the notice as issued
          </button>
        </div>
      </form>
      {state && (
        <p className={state.ok ? styles.ok : styles.warn}>
          {state.ok ? state.message : state.error}
        </p>
      )}
    </div>
  );
}
