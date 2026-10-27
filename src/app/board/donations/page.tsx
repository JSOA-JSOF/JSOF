import Link from "next/link";

import { CalendarStrip, TaskList } from "@/components/workspace-shell/RoleTabs";
import { ENTITY_LABEL } from "@/lib/donations/kpis";
import { DEV_SWITCHER_PARAM } from "@/lib/donations/devSubject";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import {
  entitiesInScope,
  fundraisingCalendar,
  fundraisingTasks,
} from "@/lib/donations/workspace";
import Chrome from "./Chrome";
import styles from "./donations.module.css";

export const metadata = {
  title: "Fundraising workspace — board",
  robots: { index: false, follow: false },
};

/**
 * Overview: what needs doing. The landing tab of the workspace.
 *
 * Two things, both filtered to the signed-in role and neither of them typed by
 * anybody:
 *
 * 1. **Tasks**, lifted from the dashboard's `actions`. Every one is a function
 *    of the data — a gift whose benefits carry no valuation, a sponsorship over
 *    the 2% ceiling, a flagged acknowledgment string, a placement waiting on a
 *    second approver. Each says what it blocks, because a count on its own
 *    ("4 pending") tells a volunteer nothing about whether to open it tonight.
 *    A task list people must populate is dead within a cycle on a volunteer
 *    board, which is the same failure as the spreadsheet this replaces.
 *
 * 2. **Calendar items** that are this role's: pledge dates, sponsor renewals,
 *    and the event dates every sponsorship deadline is worked back from.
 *
 * The role's scope decides the shape of this page, not the page. The
 * Fundraising Chair holds both entities and holds FINANCIAL only at AGGREGATE,
 * so the Chair gets tasks on two entities and a withheld calendar — every date
 * this role works to sits on a financial row. The Treasurer of one entity gets
 * the full calendar for that entity and nothing of the other. Neither view is
 * widened to look complete.
 */
export default async function FundraisingOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { subject, entity, roleLabel, qs } = await resolveScreenViewer(
    params[DEV_SWITCHER_PARAM],
  );

  const scope = entitiesInScope(subject);
  // Both are reads of the register behind the role's own authorized actions,
  // so both are awaited before anything renders.
  const [{ tasks, withheld: taskWithheld }, { items, withheld: calendarWithheld, gaps }] =
    await Promise.all([fundraisingTasks(subject), fundraisingCalendar(subject)]);

  const overdue = tasks.filter((task) => task.urgency === "overdue").length;

  return (
    <Chrome
      entity={entity}
      roleLabel={roleLabel}
      current="overview"
      qs={qs}
      statusWord="fundraising"
      title="Fundraising and the Foundation"
      lede={
        <>
          What is waiting on this role, derived from the gift register, the
          sponsor register and the publication states. Nothing on this list was
          entered by hand, and nothing is summed across the two entities.
        </>
      }
    >
      <h2 className={styles.sectionHead}>What needs doing</h2>
      <p className={styles.sectionNote}>
        {scope.length === 0
          ? "This role holds no assignment on either entity."
          : `Across ${scope.map((e) => ENTITY_LABEL[e]).join(" and ")}. ` +
            (overdue > 0
              ? `${overdue} of these should not still be sitting there.`
              : "Nothing here is overdue.")}
      </p>
      <TaskList tasks={tasks} />

      {taskWithheld.length > 0 && (
        <div className={styles.flag}>
          <span className={styles.flagHead}>Withheld from {roleLabel}</span>
          <ul className={styles.findingList}>
            {taskWithheld.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <p className={styles.sectionNote}>
            Withheld, not zero, and not &ldquo;nothing to do&rdquo;. The counts
            behind these are not reported either, and no grant has been widened
            to fill the list.
          </p>
        </div>
      )}

      <h2 className={styles.sectionHead}>Dated, and mine</h2>
      <p className={styles.sectionNote}>
        Pledges awaiting payment, sponsor renewals, and the event dates that
        every sponsorship deadline is worked back from. An entry marked
        unverified is a placeholder or an inference and is counted as an
        obligation nowhere.
      </p>
      {/* Withheld is not empty. When every date is behind a grant this role
          does not hold, the strip's "nothing is yours" message would be a
          false statement, so it is not rendered at all. */}
      {items.length === 0 && calendarWithheld.length > 0 ? null : (
        <CalendarStrip items={items} />
      )}

      {calendarWithheld.length > 0 && (
        <div className={styles.flag}>
          <span className={styles.flagHead}>Calendar withheld from {roleLabel}</span>
          <ul className={styles.findingList}>
            {calendarWithheld.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {gaps.length > 0 && (
        <div className={styles.clear}>
          <ul className={styles.findingList}>
            {gaps.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <p className={styles.note}>
        The figures these tasks follow from are on the{" "}
        <Link href={`/board/donations/dashboard${qs}`} className={styles.back}>
          Dashboard
        </Link>
        . What this role wants in front of the board is on{" "}
        <Link href={`/board/donations/planning${qs}`} className={styles.back}>
          Planning
        </Link>
        , and what the world currently sees of all this is on{" "}
        <Link href={`/board/donations/outside${qs}`} className={styles.back}>
          Outside view
        </Link>
        .
      </p>
    </Chrome>
  );
}
