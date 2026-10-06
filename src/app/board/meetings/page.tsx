import Link from "next/link";

import { KpiGrid } from "@/components/dashboard/Kpi";
import { ENTITIES } from "@/lib/authz/model";
import { agendaTotals } from "@/lib/meetings/agenda";
import { canReadMinutes, readableEntities } from "@/lib/meetings/access";
import {
  ENTITY_LONG_NAME,
  NOTICE_BASIS_NOTE,
  formatMeetingDate,
  formatMeetingTime,
} from "@/lib/meetings/distribution";
import { getCurrentPersona, subjectFor } from "@/lib/authz/session";
import { secretaryDashboard } from "@/lib/meetings/kpis";
import { bookRefForMeeting } from "@/lib/meetings/reference";
import { meetingsRepository } from "@/lib/meetings/repository";
import { Refused, Shell, hueFor } from "./Shell";
import styles from "./meetings.module.css";

export const metadata = { title: "Minute book and compliance — Secretary" };

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Agenda in draft",
  NOTICED: "Noticed",
  IN_SESSION: "In session",
  MINUTES_DRAFT: "Minutes in draft",
  MINUTES_ADOPTED: "Minutes adopted",
};

export default async function SecretaryDashboard() {
  const persona = await getCurrentPersona();
  const subject = subjectFor(persona);
  const visible = readableEntities(subject, ENTITIES);
  const repo = meetingsRepository();
  const pairs = repo.listSameDayPairs();

  // One authorized read. It calls through access.ts per entity before it
  // touches the repository, and withholds rather than zeroes what this role
  // cannot see.
  const dashboard = secretaryDashboard(subject);

  return (
    <Shell entity={null} meetingId={null} active="meetings" persona={persona}>
      <p className={styles.eyebrow}>Secretary</p>
      <h1 className={styles.title}>Two boards, two books</h1>
      <p className={styles.lede}>
        The Association and the Foundation meet the same evening with largely the
        same people in the room. Separate minute books are the cheapest evidence
        that the separation is real, so every agenda, motion, vote and minute in
        here records which board was in session. A minute that does not name its
        entity cannot be saved. These figures measure one thing: whether that
        record is actually complete, because an incomplete minute book is only
        ever discovered when somebody needs it.
      </p>
      <p className={styles.rowMeta}>
        As of {dashboard.asOf} &middot; every figure per entity, none blended
      </p>

      {visible.length === 0 ? (
        <Refused
          reason={`${persona.label} holds no board grant on member data for either entity, so neither meeting list nor either minute book is readable. Every figure on this page is withheld rather than shown as zero: the two are not the same answer.`}
        />
      ) : null}

      <h2 className={styles.sectionHead}>The record, as it stands</h2>
      <KpiGrid kpis={dashboard.kpis} />

      <div className={styles.quiet}>
        <strong>The standard the notice figure is measured against.</strong>{" "}
        {NOTICE_BASIS_NOTE}
      </div>

      {visible.length === 1 && (
        <div className={styles.quiet}>
          This role reaches {visible[0]} only. The other entity&apos;s figures are
          withheld, not counted as zero, and its book is not listed below. That is
          the boundary working rather than an error.
        </div>
      )}

      {dashboard.minuteEntities.length === 0 && visible.length > 0 && (
        <div className={styles.quiet}>
          This role reads the meeting list and the compliance calendar but not the
          minute book itself, which names who moved, who seconded and who recused.
          The four figures that come out of the book are withheld above. Custody of
          the book is a separate question again: writing in it requires the office
          of Secretary for that entity, not merely access to it.
        </div>
      )}

      <h2 className={styles.sectionHead}>What follows from this</h2>
      {dashboard.actions.length === 0 ? (
        <p className={styles.sectionNote}>
          Nothing is outstanding within this role&apos;s reach. That is either the
          record being complete or the record being out of view, and the figures
          above say which.
        </p>
      ) : (
        <ul className={styles.list}>
          {dashboard.actions.map((action) => (
            <li key={action.key}>
              <div className={styles.rowHead}>
                <Link href={action.href} className={styles.rowTitle}>
                  {action.label}
                </Link>
                <span
                  className={
                    action.urgent
                      ? `${styles.chip} ${styles.chipWarn}`
                      : styles.chip
                  }
                >
                  {action.count} waiting
                </span>
              </div>
              <p className={styles.rowNote}>{action.note}</p>
            </li>
          ))}
        </ul>
      )}

      {visible.length > 0 && (
        <>
          <h2 className={styles.sectionHead}>Both books, meeting by meeting</h2>
          <p className={styles.sectionNote}>
            Listed by the evening the two boards sit, and never merged into one
            list. Each panel is one entity&apos;s own meeting, with its own
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
                        <table className={styles.table} style={{ marginTop: 12 }}>
                          <tbody>
                            <tr>
                              <th scope="row">Time</th>
                              <td>{formatMeetingTime(meeting.scheduledStart)}</td>
                            </tr>
                            <tr>
                              <th scope="row">Scheduled</th>
                              <td className={styles.mono}>
                                {meeting.scheduledMinutes} min
                              </td>
                            </tr>
                            <tr>
                              <th scope="row">Agenda</th>
                              <td className={styles.mono}>
                                {totals.itemCount} items, {totals.committedMinutes} min
                                committed
                              </td>
                            </tr>
                            <tr>
                              <th scope="row">Quorum</th>
                              <td className={styles.mono}>
                                {meeting.attendees.filter((a) => a.present).length} present
                                of {meeting.quorum} required
                              </td>
                            </tr>
                          </tbody>
                        </table>
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

      <h2 className={styles.sectionHead}>Minute reference format</h2>
      <p className={styles.sectionNote}>
        Other modules point at minutes by reference, and an inter-entity transfer
        cannot be recorded without one on both sides. The format carries the
        entity in the string, because a bare item number is exactly the ambiguity
        two books exist to prevent.
      </p>
      <pre className={styles.pre}>
        {`JSOA-2026-10-min-4
└──┘ └──┘ └┘     └┘
 │    │    │      └ item number in that meeting's adopted agenda
 │    │    └─────── calendar month, two digits
 │    └──────────── calendar year
 └───────────────── entity

JSOF-2026-10-S2-min-2   second meeting of that entity in the month
JSOA-2026-10            the whole book for that meeting`}
      </pre>
    </Shell>
  );
}
