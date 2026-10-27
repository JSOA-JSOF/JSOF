"use client";

import { useActionState } from "react";

import { requestLink, type LinkResult } from "@/lib/auth/actions";

import styles from "./sign-in.module.css";

export function RequestForm() {
  const [state, action, pending] = useActionState<LinkResult | null, FormData>(
    requestLink,
    null,
  );

  return (
    <form action={action}>
      <label className={styles.field}>
        <span className={styles.label}>Email address</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          autoFocus
          className={styles.input}
        />
      </label>
      <button type="submit" className={styles.button} disabled={pending}>
        {pending ? "Sending" : "Send me a link"}
      </button>
      {/*
        The same sentence whichever way it went. The form does not say
        whether the address is known, because who is on the roster is
        the thing this platform is most careful about.
      */}
      {state ? <p className={styles.sent}>{state.message}</p> : null}
    </form>
  );
}
