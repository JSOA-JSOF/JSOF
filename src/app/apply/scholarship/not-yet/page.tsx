import Link from "next/link";

import { MINIMUM_AGE, UNDER_THIRTEEN_NOTICE } from "@/lib/scholarships/minors";

import styles from "../scholarship.module.css";

export const metadata = {
  title: "We cannot take an application yet — JSOF",
  robots: { index: false, follow: false },
};

/**
 * The under-13 refusal.
 *
 * The draft was discarded before this rendered, so there is nothing held and
 * the page says so. It offers no way around itself and names a person to write
 * to, because a thirteen-year-old reading a refusal should not be left with
 * nowhere to go.
 */
export default function NotYetPage() {
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/jsof/scholarships" className={styles.back}>
          Back to the scholarships page
        </Link>
        <span className={styles.status}>Nothing was kept</span>
      </header>

      <main className={styles.body}>
        <h1 className={styles.title}>{UNDER_THIRTEEN_NOTICE.heading}</h1>
        {UNDER_THIRTEEN_NOTICE.body.map((paragraph) => (
          <p key={paragraph} className={styles.lede}>
            {paragraph}
          </p>
        ))}

        <p className={styles.note}>
          Write to <strong>{UNDER_THIRTEEN_NOTICE.contact}</strong>. We do not
          collect anything from anyone under {MINIMUM_AGE}, which is why this
          form stopped rather than saving what you had entered.
        </p>
      </main>
    </div>
  );
}
