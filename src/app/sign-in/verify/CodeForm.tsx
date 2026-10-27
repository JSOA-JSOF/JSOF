"use client";

import { useActionState } from "react";

import { submitCode, type MfaResult } from "@/lib/auth/actions";

import styles from "../sign-in.module.css";

export function CodeForm() {
  const [state, action, pending] = useActionState<MfaResult | null, FormData>(
    submitCode,
    null,
  );

  return (
    <form action={action}>
      <label className={styles.field}>
        <span className={styles.label}>Six digit code</span>
        <input
          name="code"
          required
          autoFocus
          // Not type=number: it strips leading zeros, and a third of
          // all codes start with one.
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          className={`${styles.input} ${styles.codeInput}`}
        />
      </label>
      <button type="submit" className={styles.button} disabled={pending}>
        {pending ? "Checking" : "Continue"}
      </button>
      {state?.error ? <p className={styles.error}>{state.error}</p> : null}
    </form>
  );
}
