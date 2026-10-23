import Link from "next/link";

import { INTAKE_MESSAGE } from "@/lib/membership/state";

import styles from "../apply.module.css";
import { readReference } from "../draft";

export const metadata = {
  title: "Application received · JSOA",
  robots: { index: false, follow: false },
};

/**
 * The acknowledgment. One page, one message, for every submission.
 *
 * The text below is `INTAKE_MESSAGE` from the state machine, rendered
 * verbatim. Nothing on this page is computed from the application: not the
 * wording, not the next step it describes, not the presence of the reference.
 * An applicant whose sponsor does not exist sees exactly what an applicant
 * whose sponsor confirmed within the hour sees.
 *
 * That is deliberate and it is the point of the page. If this page could tell
 * the two apart, /apply would be a lookup service for "is this person a member
 * of JSOA", answerable by anyone with a browser and a list of member IDs.
 */
export default async function SubmittedPage() {
  const reference = await readReference();

  return (
    <div className={styles.page} style={{ ["--hue" as string]: "var(--jsoa)" }}>
      <header className={styles.bar}>
        <Link href="/jsoa" className={styles.back}>
          ← Association
        </Link>
        <span className={styles.status}>Application received</span>
      </header>

      <main className={styles.body}>
        <h1 className={styles.title}>Your application has been received</h1>

        {reference && (
          <>
            <p className={styles.amountNote}>Your reference</p>
            <p className={styles.reference}>{reference}</p>
          </>
        )}

        <p className={styles.lede}>{INTAKE_MESSAGE}</p>

        <p className={styles.note}>
          Keep the reference. The membership chair can find your application from it, and it is
          the only thing you need if you write to us. We will not confirm anything about your
          sponsor by email either, so please do not ask us to.
        </p>

        <p className={styles.note}>
          Nothing has been charged. Dues are $200 a year, they are due only after an
          application is accepted, and they are not a charitable contribution.
        </p>

        <div className={styles.actions}>
          <Link className={styles.secondary} href="/jsoa">
            Back to the Association
          </Link>
        </div>
      </main>
    </div>
  );
}
