import Link from "next/link";

import { CalendarStrip, TaskList } from "@/components/workspace-shell/RoleTabs";
import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import {
  storeCalendar,
  storeStockDrivingEvents,
  storeTasks,
} from "@/lib/store/workspace";

import styles from "./board.module.css";
import { Refused, StoreHeader, StoreScreen, StoreSodWarning } from "./parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Store overview — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The Store and Sales Chair's Overview: the landing tab, per
 * `docs/ROLE-WORKSPACE.md`. Two things only, both filtered to the signed-in
 * role: what needs doing, and what is dated.
 *
 * The tasks are DERIVED. `storeTasks` computes every one of them from the same
 * authorized read the Dashboard tiles use, and each is conditional on state —
 * there is no standing row that appears whatever the data says. A task list a
 * volunteer has to populate is dead within a cycle, which is the failure of
 * the spreadsheet this platform replaces.
 *
 * The figures moved to the Dashboard tab. This tab is the doing.
 */
export default async function StoreOverview() {
  const subject = await getCurrentSubject();
  const held = effectiveLevel(subject, "FINANCIAL", "JSOA");

  let tasks = null;
  let calendar = null;
  try {
    tasks = await storeTasks(subject);
    calendar = await storeCalendar(subject);
  } catch {
    tasks = null;
  }

  const events = storeStockDrivingEvents();
  const undatedEvents = events.filter((event) => !event.dated);

  return (
    <StoreScreen>
      <StoreHeader here="/board/store" title="Store and Sales" />

      <p className={styles.lede}>
        What is waiting on this seat, and what is dated. Every item below is
        computed from the store&rsquo;s own records rather than entered by hand,
        so the list empties itself when the work is done and fills itself when
        more arrives. The figures are on the Dashboard tab.
      </p>

      <StoreSodWarning subject={subject} />

      {tasks === null || calendar === null ? (
        <Refused
          what="The store&rsquo;s task list"
          needed="aggregate"
          held={held.toLowerCase()}
          because={
            subject.mfaSatisfied
              ? "Every task here is derived from the store's financial records, so a role that cannot read them in aggregate cannot be told what they imply. That is the role definition, not a missing feature."
              : "The TOTP challenge has not been satisfied this session. Every non-public read requires it."
          }
        />
      ) : (
        <>
          <h2 className={styles.sectionHead}>What needs doing</h2>
          <TaskList tasks={tasks} />

          <div className={styles.whyNote}>
            <strong>Why the quarterly count is the sharpest item here.</strong>{" "}
            The Treasurer also chairs the store, which puts authorize, custody,
            record and reconcile in one pair of hands. The physical count
            entered by somebody else is the compensating control for exactly
            that: it is the only thing in the store that checks the records
            against the goods rather than against themselves. It is a
            compensating control and not a fix. The fix is a board decision and
            it is on the{" "}
            <Link href="/board/store/planning">Planning tab</Link>.
          </div>

          <h2 className={styles.sectionHead}>Dated and mine</h2>
          <CalendarStrip items={calendar} />

          <p className={styles.note}>
            The sales-tax filing dates are marked unverified and counted as
            obligations nowhere. The 20th of the month after the period is the
            due date for a monthly filer, but NCDOR assigns the filing frequency
            when an organization registers, and the platform holds no
            registration number for the Association. Confirming it is a{" "}
            <Link href="/board/store/planning">Planning</Link> item. A date
            nobody has established is not a deadline.
          </p>

          {undatedEvents.length > 0 ? (
            <>
              <h3 className={styles.subHead}>
                Events that drive stock, with no date set
              </h3>
              <ul className={styles.plainList}>
                {undatedEvents.map(({ project }) => (
                  <li key={project.id}>
                    <Link href="/board/store/projects">{project.title}</Link>{" "}
                    <span className={styles.subtle}>
                      {project.status.toLowerCase()}, owned by{" "}
                      {project.ownerRole.toLowerCase().replace(/_/g, " ")}, no
                      target date in the register
                    </span>
                  </li>
                ))}
              </ul>
              <p className={styles.note}>
                These are above the calendar rather than in it because nobody
                has set a date. An event is what empties the shelves fastest, so
                a guessed date here would become a stock decision made against a
                number somebody invented. The register is the one place a date
                belongs, and when one is set this reads it.
              </p>
            </>
          ) : null}
        </>
      )}
    </StoreScreen>
  );
}
