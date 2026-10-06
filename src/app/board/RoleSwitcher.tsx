"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { DEV_COOKIE, type Persona } from "@/lib/authz/personas";
import styles from "./board.module.css";

/**
 * Dev affordance. Switching persona rewrites a cookie and refreshes, so every
 * server component re-resolves its Subject and the screens below re-render
 * under the new grants. This is how you check a screen denies correctly:
 * switch to Member and watch it refuse.
 */
export function RoleSwitcher({
  personas,
  currentId,
}: {
  personas: Pick<Persona, "id" | "label" | "note">[];
  currentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(id: string) {
    // Session cookie: it disappears when the browser closes, which is the
    // right lifetime for something that must never outlive a demo.
    document.cookie = `${DEV_COOKIE}=${encodeURIComponent(id)}; path=/; SameSite=Lax`;
    startTransition(() => router.refresh());
  }

  const current = personas.find((persona) => persona.id === currentId);

  return (
    <label className={styles.switcher}>
      <span className={styles.switcherLabel}>Viewing as</span>
      <select
        value={currentId}
        onChange={(event) => choose(event.target.value)}
        disabled={pending}
        aria-describedby={current?.note ? "persona-note" : undefined}
      >
        {personas.map((persona) => (
          <option key={persona.id} value={persona.id}>
            {persona.label}
          </option>
        ))}
      </select>
      {current?.note ? (
        <span id="persona-note" className={styles.switcherNote}>
          {current.note}
        </span>
      ) : null}
    </label>
  );
}
