import Link from "next/link";

import { OutsideColumns } from "@/components/workspace-shell/RoleTabs";
import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { loadScholarshipsOutside } from "@/lib/scholarships/workspace";

import styles from "../workspace.module.css";

export const metadata = {
  title: "Outside view — Scholarships",
  robots: { index: false, follow: false },
};

/**
 * Outside view: what the world sees of this function.
 *
 * Two audiences, side by side, never merged. Public and member-or-donor are
 * different readerships and blurring them into one "outside" is how the OPSEC
 * problems start, so the shared `OutsideColumns` renders them as two columns
 * and this page never flattens them into one list.
 *
 * Every finding here is the same failure the spine names: nobody owns what
 * their function looks like from outside. Two of them are real and current —
 * a published eligibility placeholder on the page that decides whether
 * somebody applies, and a February deadline on the live site that has already
 * passed and still reads as live.
 *
 * Guarded on PUBLIC_CONTENT rather than APPLICANT, because that is what this
 * tab is: the ownership of published pages. The boundary falls out of the role
 * table without anything being tightened to produce it.
 */

export default async function ScholarshipsOutside() {
  const subject = await getCurrentSubject();

  let outside: Awaited<ReturnType<typeof loadScholarshipsOutside>> | null = null;
  let denial: string | null = null;
  try {
    outside = await loadScholarshipsOutside(scholarshipRepository(), subject);
  } catch (error) {
    denial = error instanceof AuthzError ? error.message : String(error);
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>What the world sees of this function</h1>
        <p className={styles.lede}>
          The pages an applicant, a member and a donor actually reach, with
          staleness flagged. Two audiences, side by side and never merged: what
          anyone can see is not what a signed-in member sees, and treating them
          as one surface is how a name ends up on a public page.
        </p>
      </div>

      {denial ? (
        <div className={styles.withheld}>
          <p className={styles.withheldWhy}>{denial}</p>
          <p className={styles.note}>
            This tab is the ownership of published pages, which needs a public
            content grant. A scholarship reviewer holds none, so it is withheld
            rather than empty. Your work is on{" "}
            <Link href="/board/scholarships/review">Review</Link>.
          </p>
        </div>
      ) : outside ? (
        <>
          <section className={styles.section}>
            <OutsideColumns surface={outside.surface} />
            <p className={styles.note}>
              The member column is short because this function has almost no
              member-facing surface, and that is correct rather than missing. A
              sponsoring member is a named recipient on every message to their
              applicant, with the reason they are on it written into the
              message and never a bcc, and that is most of what a signed-in
              member ever sees of scholarships. The second row is the one with
              a problem in it.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Queued for release ({outside.release.awaiting.length})
            </h2>
            {outside.release.awaiting.length === 0 ? (
              <p className={styles.note}>{outside.release.note}</p>
            ) : (
              <ul className={styles.planning}>
                {outside.release.awaiting.map((item) => (
                  <li key={item.key} className={styles.planningItem}>
                    <span className={styles.planningTitle}>{item.title}</span>
                    <span className={styles.planningState}>
                      Awaiting a second approver
                    </span>
                    {item.note ? (
                      <p className={styles.planningReason}>{item.note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className={styles.note}>
            Both flagged problems are one gap: no confirmed date and no adopted
            rule for a cycle that opens in the middle of December. Neither is
            fixed on this screen. The eligibility rule is with counsel and the
            dates are yours to confirm, and both are already filed for the next
            board meeting on{" "}
            <Link href="/board/scholarships/planning">Planning</Link>.
          </p>
        </>
      ) : null}
    </div>
  );
}
