"use client";

import { useActionState } from "react";

import styles from "@/components/workspace/workspace.module.css";
import { submitVerification, type VerifyResult } from "../actions";

/**
 * Recording a verification, not performing one.
 *
 * There is no "verify" shortcut and no bulk action, deliberately. The method
 * is required because the record of HOW a claim was checked is the thing that
 * makes an award defensible later, and a note nobody can reconstruct in two
 * years is worth less than the minute it took to type.
 */
export function VerifyForm({
  applicationId,
  methods,
}: {
  applicationId: string;
  methods: { value: string; label: string }[];
}) {
  const [result, action, pending] = useActionState<VerifyResult | null, FormData>(
    submitVerification,
    null,
  );

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input type="hidden" name="applicationId" value={applicationId} />

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: ".9rem" }}>How did you check it?</span>
        <select
          name="method"
          required
          defaultValue=""
          className={styles.score}
          style={{ minWidth: 280, textAlign: "left", padding: "8px 10px" }}
        >
          <option value="" disabled>
            Choose how you checked
          </option>
          {methods.map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: ".9rem" }}>
          What you were told, in your words
        </span>
        <textarea
          name="note"
          rows={3}
          required
          placeholder="Who you spoke to, when, and what they confirmed."
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
        <button
          type="submit"
          name="outcome"
          value="VERIFIED"
          className={styles.primary}
          disabled={pending}
        >
          Record as verified
        </button>
        <button
          type="submit"
          name="outcome"
          value="NOT_VERIFIED"
          className={styles.secondary}
          disabled={pending}
        >
          Record as not verified
        </button>
      </div>

      {result && !result.ok ? (
        <p className={styles.pause} style={{ margin: 0 }}>
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
