import type { Metadata } from "next";

import { getLiveSession } from "@/lib/authz/session";

import { RequestForm } from "./RequestForm";
import styles from "./sign-in.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * The front of the sign-in flow.
 *
 * No password field, because there are no passwords: a link to the
 * address on file, then a code from an authenticator. That removes the
 * whole class of problems that come with storing passwords for an
 * organization whose volunteers will reuse one, and it means a leaver
 * is cut off by revoking a grant rather than by hoping they forget.
 *
 * There is no "create an account" link, and that is not an oversight.
 * Accounts are made by somebody who already holds one, or by the
 * membership workflow on approval. A sign-up form on a platform whose
 * roster is the sensitive thing is a way to enumerate it.
 */
export default async function SignInPage() {
  const live = await getLiveSession();

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>JSOA · JSOF</p>
        <h1 className={styles.title}>Sign in</h1>

        {live ? (
          <p className={styles.body}>
            You are already signed in.{" "}
            {live.subject.mfaSatisfied ? (
              <a className={styles.link} href="/board">
                Go to the board
              </a>
            ) : (
              <a className={styles.link} href="/sign-in/verify">
                Finish signing in
              </a>
            )}
          </p>
        ) : (
          <>
            <p className={styles.body}>
              Enter the address the Association holds for you and we will send a
              link. There is no password.
            </p>
            <RequestForm />
            <p className={styles.small}>
              Accounts are created by the board, or by the membership process on
              approval. If you think you should have one and do not, write to
              connect@thejsoa.org.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
