import Link from "next/link";

import { CalendarStrip, TaskList } from "@/components/workspace-shell/RoleTabs";
import { ENTITIES } from "@/lib/authz/model";
import { getCurrentPersona, getCurrentSubject } from "@/lib/authz/session";
import { canReadMinutes, readableEntities } from "@/lib/meetings/access";
import { agendaTotals } from "@/lib/meetings/agenda";
import {
  ENTITY_LONG_NAME,
  NOTICE_BASIS_NOTE,
  formatMeetingDate,
} from "@/lib/meetings/distribution";
import { bookRefForMeeting } from "@/lib/meetings/reference";
import { meetingsRepository } from "@/lib/meetings/repository";
import {
  HORIZON_NOTE,
  secretaryCalendar,
  secretaryTasks,
  taskCountsByUrgency,
} from "@/lib/meetings/workspace";
import { Refused, Shell, hueFor } from "./Shell";
import styles from "./meetings.module.css";

export const metadata = { title: "Overview — Secretary" };

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Agenda in draft",
  NOTICED: "Noticed",
  IN_SESSION: "In session",
  MINUTES_DRAFT: "Minutes in draft",
  MINUTES_ADOPTED: "Minutes adopted",
};

/**
 * The Overview tab, and the landing screen for this office.
 *
 * Two things, both filtered to the signed-in role: what is waiting, and what is
 * dated. The figures moved to the Dashboard tab; this tab took the doing.
 *
 * Every task here is DERIVED from the state of the books. Nothing on this
 * screen can be typed in, which is deliberate: a task list a volunteer board
 * has to populate is dead within a cycle, and that is the same failure as the
 * spreadsheet this platform replaces.
 */
export default async function SecretaryOverview() {
  const persona = await getCurrentPersona();
  const subject = await getCurrentSubject();
  const visible = readableEntities(subject, ENTITIES);
  const repo = meetingsRepository();

  // Both reads are guarded per entity inside the library, before the first
  // repository call, and withhold rather than zero what this role cannot see.
  const tasks = secretaryTasks(subject);
  const calendar = secretaryCalendar(subject);

  const pairs = repo.listSameDayPairs();
  const noticeTasks = tasks.filter((task) => task.key.startsWith("notice-"));
  const urgency = taskCountsByUrgency(tasks);

  // Withheld, not empty. The shared task and calendar components say "nothing
  // is waiting on you" when handed an empty list, which is true for a reader
  // with scope and a lie for a reader without it. A reader who may see none of
  // this is told that instead of being shown a reassuring blank.
  if (visible.length === 0) {
    return (
      <Shell entity={null} meetingId={null} active="overview" persona={persona}>
        <p className={styles.eyebrow}>Secretary &middot; Overview</p>
        <h1 className={styles.title}>Two boards, two books</h1>
        <Refused
          reason={`${persona.label} holds no board grant on member data for either entity, so neither meeting list nor either minute book is readable. This page is not showing an empty task list or an empty calendar: both are withheld, which is a different answer from nothing being due, and a reader acting on a false zero is the failure these screens exist to prevent.`}
        />
      </Shell>
    );
  }

  return (
    <Shell entity={null} meetingId={null} active="overview" persona={persona}>
      <p className={styles.eyebrow}>Secretary &middot; Overview</p>
      <h1 className={styles.title}>Two boards, two books</h1>
      <p className={styles.lede}>
        The Association and the Foundation meet the same evening with largely
        the same people in the room. Separate minute books are the cheapest
        evidence that the separation is real, so every agenda, motion, vote and
        minute in here records which board was in session, and a minute that
        does not name its entity cannot be saved. Nothing on this page is ever
        counted across the two.
      </p>

      <h2 className={styles.sectionHead}>Waiting on you</h2>
      <p className={styles.sectionNote}>
        Derived from the state of the books, never entered by hand. Each row
        says what it blocks, because a count with a verb on it does not tell
        anyone whether to open it tonight.
      </p>
      {tasks.length > 0 && (
        <div className={styles.meterLegend} style={{ marginTop: 12 }}>
          <span>{urgency.overdue} overdue</span>
          <span>{urgency.soon} dated and close</span>
          <span>{urgency.open} open, with no date owed</span>
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <TaskList tasks={tasks} />
      </div>

      {noticeTasks.length > 0 && (
        <div className={styles.quiet}>
          <strong>The notice period those rows measure against is an assumption.</strong>{" "}
          {NOTICE_BASIS_NOTE}
        </div>
      )}

      <h2 className={styles.sectionHead}>Dated, and this office&rsquo;s</h2>
      <p className={styles.sectionNote}>
        The one shared compliance calendar, filtered to the entries this office
        owns, plus the meetings ahead. A filter rather than a copy: the
        Treasurer&rsquo;s filings and the Webmaster&rsquo;s renewals are on the
        same calendar and are not this office&rsquo;s to carry.{" "}
        <Link href="/board/meetings/calendar">The whole calendar is on the Compliance tab.</Link>
      </p>

      {calendar.obligations.length > 0 && (
        <div className={styles.meterLegend} style={{ marginTop: 12 }}>
          {calendar.obligations.map((book) => (
            <span key={book.entity}>
              {book.entity} {book.count} confirmed{" "}
              {book.count === 1 ? "obligation" : "obligations"}
            </span>
          ))}
          <span>
            {calendar.unresolved.length} not counted as{" "}
            {calendar.unresolved.length === 1 ? "an obligation" : "obligations"}
          </span>
        </div>
      )}

      <CalendarStrip items={calendar.items} />

      <div className={styles.quiet}>
        <strong>The window &ldquo;due&rdquo; means.</strong> {HORIZON_NOTE}
      </div>

      {calendar.withheld.length > 0 && (
        <div className={styles.quiet}>
          {calendar.withheld.join(" and ")}{" "}
          {calendar.withheld.length === 1 ? "is" : "are"} withheld from this
          role, so {calendar.withheld.length === 1 ? "that entity's" : "those entities'"}{" "}
          entries are absent from this list rather than counted as none.
        </div>
      )}

      {calendar.unresolved.length > 0 && (
        <>
          <h2 className={styles.sectionHead}>On the calendar, and not an obligation</h2>
          <div className={styles.warn}>
            <div className={styles.warnHead}>
              {calendar.unresolved.length} entries nobody owes yet, and they are
              counted in nothing.
            </div>
            <p className={styles.rowNote}>
              These are kept here so the question does not get lost, and kept out
              of every count so the question does not quietly become a deadline.
              None of them appears in a due-soon figure, an overdue figure or the
              obligation counts above. None may be put to the board as fact, and
              the unverified one cannot be marked filed at all. Each needs
              somebody to read the source and either replace the entry with the
              real duty or delete it.
            </p>
          </div>
          <ul className={styles.list}>
            {calendar.unresolved.map((entry) => (
              <li key={entry.key}>
                <div className={styles.rowHead}>
                  <Link href={entry.href} className={styles.rowTitle}>
                    {entry.title}
                  </Link>
                  <span className={`${styles.chip} ${styles.chipWarn}`}>
                    {entry.reason === "UNVERIFIED"
                      ? "Unverified duty"
                      : "Blocked, may not apply"}
                  </span>
                </div>
                <div className={styles.chipRow}>
                  <span className={styles.chip}>{entry.entity}</span>
                  <span className={styles.chip}>
                    {entry.reason === "UNVERIFIED"
                      ? `reported commencement ${entry.shownDate}`
                      : `placeholder date ${entry.shownDate}`}
                  </span>
                  <span className={styles.chip}>counted nowhere</span>
                </div>
                <p className={styles.rowNote}>{entry.note}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {visible.length > 0 && (
        <>
          <h2 className={styles.sectionHead}>Both books, meeting by meeting</h2>
          <p className={styles.sectionNote}>
            Listed by the evening the two boards sit, and never merged into one
            list. Each panel is one entity&rsquo;s own meeting, with its own
            reference series.
          </p>

          {pairs.map((pair) => {
            const shown = pair.meetings.filter((m) => visible.includes(m.entity));
            if (shown.length === 0) return null;
            return (
              <section key={pair.date}>
                <h3 className={styles.sectionHead}>
                  {formatMeetingDate(`${pair.date}T12:00:00.000Z`)}
                </h3>
                <p className={styles.sectionNote}>
                  {shown.length > 1
                    ? `${shown.length} separate meetings, one per entity, one after the other. Two books, two sets of references, nothing shared but the room.`
                    : "One meeting on this date within this role's reach."}
                </p>
                <div className={styles.split}>
                  {shown.map((meeting) => {
                    const items = repo.listAgendaItems(meeting.id);
                    const totals = agendaTotals(meeting, items);
                    const minutesReadable = canReadMinutes(subject, meeting.entity);
                    return (
                      <div
                        key={meeting.id}
                        className={styles.panel}
                        style={hueFor(meeting.entity)}
                      >
                        <div className={styles.panelHead}>
                          <span className={styles.panelTitle}>
                            {ENTITY_LONG_NAME[meeting.entity]}
                          </span>
                          <span className={styles.entityMark}>{meeting.entity}</span>
                        </div>
                        <p className={styles.rowNote}>{meeting.title}</p>
                        <div className={styles.chipRow}>
                          <span className={`${styles.chip} ${styles.chipHue}`}>
                            {bookRefForMeeting(meeting)}
                          </span>
                          <span className={styles.chip}>
                            {STATUS_LABEL[meeting.status] ?? meeting.status}
                          </span>
                          <span className={styles.chip}>
                            {totals.itemCount} items, {totals.committedMinutes} min
                          </span>
                          {meeting.noticeSentAt === null && (
                            <span className={`${styles.chip} ${styles.chipWarn}`}>
                              Notice not sent
                            </span>
                          )}
                          {totals.overruns && (
                            <span className={`${styles.chip} ${styles.chipWarn}`}>
                              Overruns {totals.overrunMinutes} min
                            </span>
                          )}
                        </div>
                        <div className={styles.buttonRow}>
                          <Link
                            href={`/board/meetings/${meeting.id}/agenda`}
                            className={`${styles.button} ${styles.buttonQuiet}`}
                          >
                            Agenda
                          </Link>
                          {minutesReadable ? (
                            <>
                              <Link
                                href={`/board/meetings/${meeting.id}/minutes`}
                                className={`${styles.button} ${styles.buttonQuiet}`}
                              >
                                Minutes
                              </Link>
                              <Link
                                href={`/board/meetings/${meeting.id}/transcript`}
                                className={`${styles.button} ${styles.buttonQuiet}`}
                              >
                                Transcript
                              </Link>
                            </>
                          ) : (
                            <span className={styles.hint}>
                              Minutes need row-level access to member data. This role
                              holds aggregate only.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}
    </Shell>
  );
}
