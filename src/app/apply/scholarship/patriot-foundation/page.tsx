import Link from "next/link";

import { PATRIOT_FOUNDATION, decideRouting } from "@/lib/scholarships/routing";

import styles from "../scholarship.module.css";

export const metadata = {
  title: "Apply to the Patriot Foundation · JSOF",
  robots: { index: false, follow: false },
};

/**
 * Where a North Carolina resident at a North Carolina school lands.
 *
 * Reached before any personal data has been asked for, so there is nothing to
 * delete and nothing to say about what we hold: we hold nothing. The
 * explanation comes from the routing rule rather than being retyped here, and
 * the link goes to the Patriot Foundation's own site, because an applicant
 * being sent elsewhere should land where the application actually is.
 */
export default function RoutedToPatriotFoundationPage() {
  const decision = decideRouting({
    ncResident: true,
    attendingNcSchool: true,
    applyingForWoundedPatriot: false,
  });
  const referral = decision.referral ?? PATRIOT_FOUNDATION;

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/jsof/scholarships" className={styles.back}>
          Back to the scholarships page
        </Link>
        <span className={styles.status}>Where to apply</span>
      </header>

      <main className={styles.body}>
        <h1 className={styles.title}>Your application goes to the Patriot Foundation</h1>
        <p className={styles.lede}>{decision.explanation}</p>

        <p className={styles.note}>{referral.note}</p>

        <a className={styles.outbound} href={referral.href} rel="noreferrer">
          Go to {referral.name}
        </a>

        <p className={styles.note}>
          If you think this is wrong, for instance because you are moving out of
          state before the academic year starts, write to the Scholarships Chair
          and say so. Do not fill this form in again on the chance of a
          different answer.
        </p>
      </main>
    </div>
  );
}
