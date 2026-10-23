import Link from "next/link";

import { INTAKE_MESSAGE } from "@/lib/scholarships/intake";

import styles from "../scholarship.module.css";
import { readReference } from "../draft";

export const metadata = {
  title: "Application received · JSOF",
  robots: { index: false, follow: false },
};

/**
 * The acknowledgment.
 *
 * One destination, one message, whatever the sponsor check found. This page
 * does not know what it found and must not be given a way to say so: a
 * difference here is an answer, and whether a given person is a member of the
 * Association is the question this platform does not answer to a stranger.
 */
export default async function SubmittedPage() {
  const reference = await readReference();

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/jsof/scholarships" className={styles.back}>
          Back to the scholarships page
        </Link>
        <span className={styles.status}>Received</span>
      </header>

      <main className={styles.body}>
        <h1 className={styles.title}>Your application has been received</h1>
        <p className={styles.lede}>{INTAKE_MESSAGE}</p>

        {reference && (
          <>
            <p className={styles.note}>
              Your reference. Quote it if you write to the Scholarships Chair.
            </p>
            <p className={styles.reference}>{reference}</p>
          </>
        )}

        <p className={styles.note}>
          Your sponsoring member is copied on everything we send you. If your
          enrolment changes, or if your email address changes, tell the
          Scholarships Chair before decisions go out in the spring.
        </p>
      </main>
    </div>
  );
}
