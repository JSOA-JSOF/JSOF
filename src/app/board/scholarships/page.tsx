import Link from "next/link";

import { CalendarStrip, TaskList } from "@/components/workspace-shell/RoleTabs";
import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { loadScholarshipsOverview } from "@/lib/scholarships/workspace";

import styles from "./workspace.module.css";

export const metadata = {
  title: "Scholarships",
  robots: { index: false, follow: false },
};

/**
 * Overview: what needs doing. The workspace's landing tab.
 *
 * Three bands, in this order and for this reason:
 *
 *   1. The two warnings that gate the cycle. Eligibility is with counsel and
 *      the Wounded Patriot amount is a placeholder. Each one changes what the
 *      cycle can do, so neither belongs under the work.
 *   2. The derived tasks. Every row is computed from repository state or from
 *      a configuration flag, and every row says what it blocks. Nothing on
 *      this screen can be typed in, which is the point: a task list a
 *      volunteer has to populate is dead within a cycle.
 *   3. Her dated items, filtered from the cycle record.
 *
 * The page holds no policy and no arithmetic. One authorized read,
 * `loadScholarshipsOverview`, guarded at APPLICANT WRITE because the tasks
 * carry the cheque run and the verification queue. A reviewer reaching this
 * route is told the read was refused and pointed at their own queue, which is
 * a different answer from an empty screen.
 */

export default async function ScholarshipsOverview() {
  const subject = await getCurrentSubject();

  let overview: Awaited<ReturnType<typeof loadScholarshipsOverview>> | null = null;
  let denial: string | null = null;
  try {
    overview = await loadScholarshipsOverview(scholarshipRepository(), subject);
  } catch (error) {
    denial = error instanceof AuthzError ? error.message : String(error);
  }

  if (!overview) {
    return (
      <div className={styles.page}>
        <div className={styles.head}>
          <h1 className={styles.title}>Scholarships</h1>
        </div>
        <div className={styles.withheld}>
          <p className={styles.withheldWhy}>{denial}</p>
          <p className={styles.note}>
            This tab is the whole cycle&rsquo;s outstanding work: the files short
            of a full committee, the Wounded Patriot verifications, the awards
            with the board, and the cheque run. It is read at the chair&rsquo;s
            level, so it is withheld rather than shown empty.
          </p>
          <p className={styles.note}>
            If you are scoring, your own queue is{" "}
            <Link href="/board/scholarships/review">Review</Link>. It holds the
            files that are yours and nothing else.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>What needs doing</h1>
        <p className={styles.lede}>
          Everything below is derived from the records, not entered by hand, and
          each row says what it is holding up. The {overview.cycle.label} is{" "}
          {overview.cycle.state.toLowerCase().replace("_", " ")}.
        </p>
      </div>

      {/* Above everything. Both of these gate the cycle. */}
      {overview.gates.length > 0 ? (
        <div className={styles.gates}>
          {overview.gates.map((gate) => (
            <div key={gate.key} className={styles.gate}>
              <span className={styles.gateTitle}>{gate.title}</span>
              <p className={styles.gateBody}>{gate.body}</p>
              <Link href={gate.href} className={styles.gateLink}>
                Where this is being decided
              </Link>
            </div>
          ))}
        </div>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Waiting on you</h2>
        <TaskList tasks={overview.tasks} />
        <p className={styles.note}>
          Derived from the cycle&rsquo;s own records. A row disappears when the
          work behind it is done, and no row can be added by typing one. Dates
          come from the cycle record; nothing here invents a deadline to make a
          row look urgent.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Dated, and yours</h2>
        <CalendarStrip items={overview.calendar} />
        <p className={styles.note}>{overview.calendarNote}</p>
      </section>
    </div>
  );
}
