"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { ingestTranscriptAction } from "@/lib/meetings/actions";
import styles from "../../meetings.module.css";

export function TranscriptForm({
  meetingId,
  sample,
}: {
  meetingId: string;
  sample: string;
}) {
  const [state, action, pending] = useActionState(ingestTranscriptAction, null);
  const [text, setText] = useState("");

  return (
    <>
      <form action={action} className={styles.form}>
        <input type="hidden" name="meetingId" value={meetingId} />
        <div className={`${styles.field} ${styles.fieldWide}`}>
          <label className={styles.label} htmlFor="transcript">
            Paste the transcript
          </label>
          <textarea
            id="transcript"
            name="transcript"
            className={`${styles.textarea} ${styles.textareaTall}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={"Alice Reyes: and that brings us to item three\nBob Vance: I move that..."}
          />
          <p className={styles.hint}>
            Teams and Zoom exports both work, as does a WebVTT file or plain
            lines of the form <span className={styles.mono}>Name: what they said</span>.
            Nothing is uploaded anywhere and nothing is sent to a third party:
            the parser runs on this server and the text is not stored beyond the
            draft it produces.
          </p>
        </div>

        <div className={styles.buttonRow}>
          <button type="submit" className={styles.button} disabled={pending || text.trim().length === 0}>
            Produce a draft from this transcript
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonQuiet}`}
            onClick={() => setText(sample)}
          >
            Load the example transcript
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonQuiet}`}
            onClick={() => setText("")}
          >
            Clear
          </button>
        </div>
      </form>

      {state && !state.ok && <p className={styles.warn}>{state.error}</p>}

      {state && state.ok && (
        <div className={styles.panel}>
          <div className={styles.panelTitle}>What the parser did</div>
          <p className={styles.rowNote}>{state.message}</p>
          <div className={styles.meterLegend}>
            <span>{state.turnCount} speaker turns parsed</span>
            <span>{Math.round(state.coverage * 100)} percent of turns placed</span>
            <span>{state.written} draft sections written</span>
          </div>
          {state.warnings.length > 0 && (
            <div className={styles.warn}>
              {state.warnings.map((warning) => (
                <p key={warning} className={styles.rowNote}>
                  {warning}
                </p>
              ))}
            </div>
          )}
          <div className={styles.buttonRow}>
            <Link
              href={`/board/meetings/${meetingId}/minutes`}
              className={styles.button}
            >
              Open the minutes and edit every section
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
