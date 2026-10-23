import type { Metadata } from "next";
import Link from "next/link";

import styles from "./soon.module.css";

/**
 * The holding page, for everything the MVP does not serve yet.
 *
 * It says which part is not ready rather than "coming soon", because
 * "coming soon" is what a site says when nobody is working on it. A date is
 * not promised: the two things actually blocking are a legal review and two
 * mailboxes, and neither is ours to schedule.
 */

export const metadata: Metadata = {
  title: "Coming shortly · JSOA / JSOF",
  description:
    "The Joint Special Operations Association and Foundation site is being " +
    "rebuilt. The front door and the two films are live now.",
  robots: { index: false, follow: false },
};

export default function SoonPage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>JSOA · JSOF</p>
        <h1 className={styles.title}>This part goes live shortly</h1>
        <p className={styles.body}>
          The site is being rebuilt. Membership, events, scholarships, the store
          and donations are written and working, and they are held back until the
          wording that carries tax consequences has been through counsel and the
          two public mailboxes answer.
        </p>
        <p className={styles.body}>
          The front door and both films are live now. Go and have a look.
        </p>
        <div className={styles.doors}>
          <Link className={styles.door} href="/">
            The front door
          </Link>
          <Link className={styles.door} href="/jsoa">
            The Association
          </Link>
          <Link className={styles.door} href="/jsof">
            The Foundation
          </Link>
        </div>
        <p className={styles.foot}>
          Joint Special Operations Association · 501(c)(19)
          <br />
          Joint Special Operations Foundation · 501(c)(3)
          <br />
          PO Box 72758, Fort Bragg, NC 28307
        </p>
      </div>
    </main>
  );
}
