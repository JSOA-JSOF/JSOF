import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { startEnrolment } from "@/lib/auth/actions";
import { credentialFor } from "@/lib/auth/store";
import { totpUri } from "@/lib/auth/totp";
import { getLiveSession } from "@/lib/authz/session";

import { CodeForm } from "./CodeForm";
import styles from "../sign-in.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Second factor",
  robots: { index: false, follow: false },
};

/**
 * The second factor, and enrolment into it when there is none yet.
 *
 * One screen for both, because from here they are the same act: present
 * a code from the authenticator. The difference is whether we had to
 * show the secret first.
 *
 * The secret is shown exactly once and is never shown again, which is
 * why losing the phone means an administrator revokes the credential
 * rather than the owner recovering it. For a board of this size that is
 * the right trade: a self-service recovery path is a second way in, and
 * a second way in is the one an attacker uses.
 */
export default async function VerifyPage() {
  const live = await getLiveSession();
  if (!live) redirect("/sign-in");
  if (live.subject.mfaSatisfied) redirect("/board");

  const existing = await credentialFor(live.row.person_id);
  const enrolling = !existing?.confirmed_at;
  const started = enrolling ? await startEnrolment() : null;
  const secret = started?.secret ?? existing?.totp_secret ?? null;

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>JSOA · JSOF</p>
        <h1 className={styles.title}>
          {enrolling ? "Set up your authenticator" : "Enter your code"}
        </h1>

        {enrolling && secret ? (
          <>
            <p className={styles.body}>
              Open your authenticator app, add an account by hand, and type this
              key. Then enter the six digit code it shows.
            </p>
            <p className={styles.secret}>{secret.replace(/(.{4})/g, "$1 ").trim()}</p>
            <p className={styles.small}>
              This key is shown once and cannot be shown again. If you lose the
              phone, the Secretary or the President revokes the old one and you
              set up a new one.
            </p>
            <details className={styles.details}>
              <summary>The full setup link</summary>
              <code className={styles.code}>
                {totpUri(secret, `person-${live.row.person_id.slice(0, 8)}`)}
              </code>
            </details>
          </>
        ) : (
          <p className={styles.body}>
            Enter the six digit code from your authenticator app.
          </p>
        )}

        <CodeForm />
      </section>
    </main>
  );
}
