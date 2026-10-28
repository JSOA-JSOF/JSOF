import type { Metadata } from "next";
import Link from "next/link";

import styles from "./not-found.module.css";

/**
 * The 404.
 *
 * What was here was Next's default: a bare "404" on a white page with
 * no shell, no navigation and no way back. Somebody who mistypes a URL
 * or follows an old link from the Wix site got a dead end, and had no
 * reason to think the rest of the site existed.
 *
 * It does not use PublicShell, on purpose. A 404 can be reached from
 * anywhere, including the board tier and the drop pages, and a shell
 * that assumes an entity would pick one at random. So it offers both
 * doors and lets the reader choose.
 */

export const metadata: Metadata = {
  title: "Page not found · JSOA / JSOF",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>404</p>
        <h1 className={styles.title}>That page is not here</h1>
        <p className={styles.body}>
          It may have moved when the site was rebuilt, or the address may have a
          typo in it. Nothing is wrong on your end.
        </p>

        <ul className={styles.links}>
          <li>
            <Link href="/">Both organizations</Link>
            <span>Start at the front door</span>
          </li>
          <li>
            <Link href="/jsoa">The Association</Link>
            <span>Membership, events, the store</span>
          </li>
          <li>
            <Link href="/jsof">The Foundation</Link>
            <span>Scholarships, the memorial, giving</span>
          </li>
          <li>
            <Link href="/jsoa/contact">Contact</Link>
            <span>Every office, and what each one handles</span>
          </li>
        </ul>

        <p className={styles.small}>
          If you followed a link from somewhere and it brought you here, tell us
          at connect@thejsoa.org and we will fix it.
        </p>
      </section>
    </main>
  );
}
