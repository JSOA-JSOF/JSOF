"use client";

import { useActionState } from "react";

import styles from "@/components/workspace/workspace.module.css";
import { submitScoreSheet, type ScoreResult } from "../actions";
import type { ScoringCriterion } from "@/lib/scholarships/types";

/**
 * The scoring control, slotted into the workspace queue's chrome.
 *
 * Each criterion carries its published wording beside the field, because the
 * criteria are what the award is defensible on, and a scorer who has to
 * remember them scores against memory instead.
 */
export function ScoreSheet({
  applicationId,
  criteria,
  existing,
}: {
  applicationId: string;
  criteria: ScoringCriterion[];
  existing: { points: Record<string, number>; comment: string } | null;
}) {
  const [result, action, pending] = useActionState<ScoreResult | null, FormData>(
    submitScoreSheet,
    null,
  );

  const maxTotal = criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0);

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input type="hidden" name="applicationId" value={applicationId} />

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {criteria.map((criterion) => (
          <div key={criterion.key} className={styles.band}>
            <label
              htmlFor={`points.${criterion.key}`}
              style={{ fontWeight: 600, fontSize: ".92rem" }}
            >
              {criterion.label}
            </label>
            <span className={styles.bandRange} style={{ textAlign: "left" }}>
              {criterion.published}
            </span>
            <input
              id={`points.${criterion.key}`}
              name={`points.${criterion.key}`}
              type="number"
              min={0}
              max={criterion.maxPoints}
              step={1}
              required
              defaultValue={existing?.points?.[criterion.key] ?? ""}
              className={styles.score}
              style={{ minWidth: 80, padding: "6px 8px" }}
            />
            <span className={styles.bandCount}>of {criterion.maxPoints}</span>
          </div>
        ))}
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: ".92rem" }}>
          Note for the committee
        </span>
        <textarea
          name="comment"
          rows={3}
          defaultValue={existing?.comment ?? ""}
          placeholder="What stood out, or what you were unsure about."
          style={{
            font: "inherit",
            fontSize: ".95rem",
            color: "var(--ink)",
            background: "var(--ground)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "8px 10px",
            resize: "vertical",
          }}
        />
      </label>

      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? "Saving…" : existing ? "Update this score" : "Save and go to the next"}
        </button>
        <span className={styles.consequence} style={{ margin: 0 }}>
          Out of {maxTotal}. You can come back and change it until the committee closes.
        </span>
      </div>

      {result && !result.ok ? (
        <p className={styles.pause} style={{ margin: 0 }}>
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
