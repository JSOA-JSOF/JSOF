import { CalendarStrip, TaskList } from "@/components/workspace-shell/RoleTabs";
import { getCurrentSubject } from "@/lib/authz/session";
import { treasuryRepository, treasurySubject } from "@/lib/treasury/repository";
import {
  FICTIONAL_DATA_NOTE,
  entitiesInScope,
  treasurerCalendar,
  treasurerTasks,
} from "@/lib/treasury/workspace";

import { ENTITY_LABELS, TreasuryHeader } from "./_components/chrome";
import styles from "./treasury.module.css";

export const metadata = {
  title: "Overview — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

/**
 * The Treasurer's Overview: what needs doing, and what is dated.
 *
 * This is the landing tab now, and the Dashboard's figures have moved to their
 * own tab. The split is deliberate: a volunteer with forty minutes tonight
 * needs the doing, and the figures are what you open when somebody asks how it
 * is going. Mixing them produced a screen where neither was first.
 *
 * Every task here is DERIVED. Nobody types one. A task list a volunteer board
 * must populate by hand is dead inside a cycle, which is the same failure as
 * the spreadsheet this platform replaces, so each row below is a function of
 * the data: a claim counted from the day it was incurred, a renewal with no
 * second administrator, a transfer sitting on an unmet condition. If it cannot
 * be computed it is a note, and notes do not go here.
 *
 * The calendar is a FILTER over the one compliance calendar in the Secretary's
 * module, not a treasury copy of it. When a filing date moves there it moves
 * here, because there is only one of it.
 *
 * Two entities, and still two entities on this tab. A tool whose invoice is
 * shared renews once and commits two different sums, so it appears as two
 * dated rows carrying two labelled figures. There is no row anywhere on this
 * screen holding an invoice total, and a dated item on an entity the reader
 * holds no scope for is counted as withheld rather than dropped.
 */
export default async function TreasuryOverviewPage() {
  const subject = treasurySubject(await getCurrentSubject());
  const repo = await treasuryRepository();
  const asOf = await repo.asOfDate();

  const scope = entitiesInScope(subject);
  const tasks = await treasurerTasks(subject, repo);
  const calendar = await treasurerCalendar(subject, repo);

  const overdue = tasks.filter((task) => task.urgency === "overdue").length;

  return (
    <div>
      <TreasuryHeader
        current="overview"
        title="What needs doing"
        period={`As of ${asOf}`}
        lede={
          "Everything below is computed from the data rather than entered by hand, " +
          "so this list fills and empties itself as the work arrives and gets done. " +
          "Each row says what it blocks, because a count on its own does not tell " +
          "you whether to open it tonight."
        }
      />

      {scope.length === 0 ? (
        <p className={styles.refusal} role="status">
          You hold no financial scope on either entity, so there is no treasury
          work to show you. If you should be able to see this, the President can
          grant the scope; nothing on this screen is available on request.
        </p>
      ) : null}

      <h2 className={styles.sectionHead}>Waiting on you</h2>
      {/* With no scope at all, the shared empty state would read "nothing is
          waiting on you", which is a claim about the work rather than about the
          reader. Those are the two things this platform never lets look alike,
          so the refusal above stands alone and the list is not rendered. */}
      {scope.length === 0 ? (
        <p className={styles.note}>
          Nothing can be shown here, which is not the same as nothing being
          outstanding. There is treasury work on both entities; none of it is
          yours.
        </p>
      ) : (
        <>
          <p className={styles.note}>
            Derived from state, not a to-do list. Overdue first, then soonest.
            {overdue > 0 ? (
              <>
                {" "}
                {overdue === 1
                  ? "One item has run past the tolerance it had"
                  : `${overdue} items have run past the tolerance they had`}
                , which on this screen means a person has been waiting, or a
                control has stood open long enough to be a finding.
              </>
            ) : null}
          </p>

          <TaskList tasks={tasks} />
        </>
      )}

      <h2 className={styles.sectionHead}>
        Dated, to {calendar.horizonEndDate}
      </h2>
      <p className={styles.note}>
        The filings that are the Treasurer&rsquo;s own, the renewals and the
        cash each one commits, and the monthly close. Twelve months, not a
        quarter, because this office&rsquo;s duties are annual and the two 990s
        fall further out than a quarter can see. Filing dates come from the one
        compliance calendar the whole board uses; this is a filter over it, so a
        date corrected there is corrected here.
      </p>

      <CalendarStrip items={calendar.items} />

      {calendar.withheldCount > 0 ? (
        <p className={styles.note}>
          <strong>
            {calendar.withheldCount}{" "}
            {calendar.withheldCount === 1 ? "dated item is" : "dated items are"}{" "}
            withheld
          </strong>{" "}
          rather than hidden
          {calendar.withheldEntities.length > 0 ? (
            <>
              {" "}
              ·{" "}
              {calendar.withheldEntities
                .map((entity) => ENTITY_LABELS[entity].short)
                .join(" and ")}
            </>
          ) : null}
          . Those dates exist and somebody owes them; you hold no financial
          scope on the entity that does. Withheld is not none.
        </p>
      ) : null}

      <h2 className={styles.sectionHead}>What this tab does not hold</h2>
      <p className={styles.note}>
        No figures. They are on the Dashboard, cut to three. No agenda items
        either: what the Treasurer wants the board to decide is on Planning,
        where the Secretary&rsquo;s agenda builder reads it rather than asking
        for it to be retyped.
      </p>

      <p className={styles.note}>{FICTIONAL_DATA_NOTE}</p>
    </div>
  );
}
