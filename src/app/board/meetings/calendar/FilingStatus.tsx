"use client";

import { useActionState } from "react";

import { setFilingStatusAction } from "@/lib/meetings/actions";
import { FILING_STATUSES, type FilingStatus as Status } from "@/lib/meetings/types";
import { STATUS_LABELS } from "@/lib/meetings/calendar";
import styles from "../meetings.module.css";

export function FilingStatusControl({
  itemId,
  status,
  verified,
}: {
  itemId: string;
  status: Status;
  verified: boolean;
}) {
  const [state, action, pending] = useActionState(setFilingStatusAction, null);
  return (
    <>
      <form action={action} className={styles.controlRow} style={{ marginTop: 8 }}>
        <input type="hidden" name="itemId" value={itemId} />
        <div className={styles.field} style={{ marginTop: 0 }}>
          <label className={styles.label} htmlFor={`status-${itemId}`}>
            Status
          </label>
          <select
            id={`status-${itemId}`}
            name="status"
            className={styles.select}
            defaultValue={status}
          >
            {FILING_STATUSES.map((value) => (
              <option
                key={value}
                value={value}
                disabled={!verified && value === "FILED"}
              >
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className={`${styles.button} ${styles.buttonQuiet}`}
          disabled={pending}
        >
          Update
        </button>
      </form>
      {state && (
        <p className={state.ok ? styles.ok : styles.warn}>
          {state.ok ? state.message : state.error}
        </p>
      )}
    </>
  );
}
