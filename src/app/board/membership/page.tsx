import Link from "next/link";

import { CalendarStrip, TaskList } from "@/components/workspace-shell/RoleTabs";
import { AuthzError } from "@/lib/authz/policy";
import { loadMembershipDashboard } from "@/lib/membership/kpis";
import { membershipRepository } from "@/lib/membership/repository";
import {
  CALENDAR_PROVENANCE,
  loadMembershipOverview,
  type MembershipOverview,
} from "@/lib/membership/workspace";

import styles from "./board.module.css";
import { MembershipShell, Refused } from "./shell";
import { currentActor } from "./subject";

export const metadata = {
  title: "Membership — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The Overview: what needs doing, and what is dated.
 *
 * The landing tab, and the one that fails silently if it is built wrong. Every
 * task here is DERIVED from state — they are the Dashboard's own actions,
 * lifted. Nothing on this screen can be typed, ticked off or added, because a
 * task list people must populate is dead within a cycle on an all-volunteer
 * board, which is the same failure as the spreadsheet this platform replaces.
 *
 * A task with a count of zero is not shown: that is a figure, and it has a
 * tile. A task whose count this reader may not see is not shown either, and is
 * named as withheld underneath — because rendering it blank or as nought would
 * tell them the work does not exist, which is the one answer that is false.
 */
export default async function MembershipOverviewPage() {
  const { persona, subject } = await currentActor();

  let overview: MembershipOverview | null = null;
  let refusal: string | null = null;
  try {
    const repo = membershipRepository();
    const dashboard = await loadMembershipDashboard(repo, subject);
    overview = await loadMembershipOverview(repo, subject, dashboard);
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  return (
    <MembershipShell current="overview">
      <h1 className={styles.title}>Membership</h1>
      <p className={styles.lede}>
        The roster is the master record that scholarship eligibility, event invitations and the
        three exemption tests all key off. This tab is what is waiting on the office that owns
        it, worked out from the data rather than kept as a list.
      </p>

      {refusal || !overview ? (
        <Refused persona={persona} what="the membership workspace" detail={refusal ?? undefined} />
      ) : (
        <>
          <h2 className={styles.sectionHead}>What needs doing</h2>
          <p className={styles.sectionNote}>
            Derived from the roster, the intake and the composition report, as of{" "}
            {overview.asOf.slice(0, 10)}. Nothing here was entered by hand and nothing can be:
            each line is a count the data produced, and it disappears when the count does.
          </p>
          <TaskList tasks={overview.tasks} />

          {!overview.scope.decide && overview.tasks.length > 0 && (
            <p className={styles.note}>
              Read-only for this role. Every line above is real work and deciding in it needs
              write on member records, which the roster&rsquo;s owner holds.
            </p>
          )}

          {overview.withheld && (
            <div className={styles.held}>
              <strong>
                {overview.withheld.items.length}{" "}
                {overview.withheld.items.length === 1 ? "task is" : "tasks are"} withheld, not
                absent
              </strong>
              <ul className={styles.findings}>
                {overview.withheld.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className={styles.sectionNote}>{overview.withheld.why}</p>
            </div>
          )}

          <h2 className={styles.sectionHead}>Dated, and this role&rsquo;s</h2>
          <p className={styles.sectionNote}>{CALENDAR_PROVENANCE}</p>
          <CalendarStrip items={overview.calendar} />

          <p className={styles.note}>
            The figures behind all of this are on the{" "}
            <Link href="/board/membership/dashboard">Dashboard</Link>, and what needs the board
            rather than the chair is on <Link href="/board/membership/planning">Planning</Link>.
          </p>
        </>
      )}
    </MembershipShell>
  );
}
