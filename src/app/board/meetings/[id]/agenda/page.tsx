import { notFound } from "next/navigation";

import {
  agendaIsFrozen,
  agendaSchedule,
  agendaTotals,
  PROCEDURAL_OVERHEAD_MINUTES,
} from "@/lib/meetings/agenda";
import { canReadGovernance, canWriteMinutes, refusalMessage } from "@/lib/meetings/access";
import {
  formatClockOffset,
  formatMeetingDate,
  formatMeetingTime,
  noticeRequiredHours,
  roleLabel,
} from "@/lib/meetings/distribution";
import { getCurrentPersona, subjectFor } from "@/lib/authz/session";
import { bookRefForMeeting, minuteRefForMeeting } from "@/lib/meetings/reference";
import { meetingsRepository } from "@/lib/meetings/repository";
import { AGENDA_ITEM_TYPE_LABELS } from "@/lib/meetings/types";
import { EntityBanner, Refused, Shell } from "../../Shell";
import styles from "../../meetings.module.css";
import { AgendaEditor } from "./AgendaEditor";

export const metadata = { title: "Agenda — Secretary" };

export default async function AgendaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const persona = await getCurrentPersona();
  const subject = subjectFor(persona);
  const repo = meetingsRepository();
  const meeting = repo.getMeeting(id);
  if (!meeting) notFound();

  if (!canReadGovernance(subject, meeting.entity)) {
    return (
      <Shell entity={meeting.entity} meetingId={id} active="agenda" persona={persona}>
        <Refused
          reason={refusalMessage(
            new Error(
              `${persona.label} holds no board grant on member data for ${meeting.entity}, ` +
                `so the ${meeting.entity} agenda is not readable by this role.`,
            ),
          )}
        />
      </Shell>
    );
  }

  const items = repo.listAgendaItems(id);
  const totals = agendaTotals(meeting, items);
  const schedule = agendaSchedule(meeting, items);
  const writable = canWriteMinutes(subject, meeting.entity);
  const frozen = agendaIsFrozen(meeting);

  const fillPercent = Math.min(
    100,
    Math.round((Math.min(totals.committedMinutes, meeting.scheduledMinutes) / Math.max(1, meeting.scheduledMinutes)) * 100),
  );
  const overPercent = Math.min(
    100 - fillPercent,
    Math.round((totals.overrunMinutes / Math.max(1, meeting.scheduledMinutes)) * 100),
  );

  return (
    <Shell entity={meeting.entity} meetingId={id} active="agenda" persona={persona}>
      <p className={styles.eyebrow}>Agenda &middot; {bookRefForMeeting(meeting)}</p>
      <h1 className={styles.title}>{meeting.title}</h1>
      <EntityBanner entity={meeting.entity} />

      <div className={styles.chipRow}>
        <span className={`${styles.chip} ${styles.chipHue}`}>
          {formatMeetingDate(meeting.scheduledStart)}
        </span>
        <span className={styles.chip}>{formatMeetingTime(meeting.scheduledStart)}</span>
        <span className={styles.chip}>{meeting.location}</span>
        <span className={styles.chip}>quorum {meeting.quorum}</span>
        {meeting.session > 1 && (
          <span className={`${styles.chip} ${styles.chipWarn}`}>
            special meeting, session {meeting.session}
          </span>
        )}
      </div>

      <h2 className={styles.sectionHead}>Time against the meeting</h2>
      <div className={styles.meter}>
        <div
          className={styles.meterTrack}
          role="img"
          aria-label={
            totals.overruns
              ? `Agenda overruns by ${totals.overrunMinutes} minutes against a ${meeting.scheduledMinutes} minute meeting`
              : `${totals.committedMinutes} of ${meeting.scheduledMinutes} minutes committed`
          }
        >
          <div className={styles.meterFill} style={{ width: `${fillPercent}%` }} />
          {overPercent > 0 && (
            <div className={styles.meterOver} style={{ width: `${overPercent}%` }} />
          )}
        </div>
        <div className={styles.meterLegend}>
          <span>Scheduled {meeting.scheduledMinutes} min</span>
          <span>Items {totals.estimatedMinutes} min</span>
          <span>Procedural {PROCEDURAL_OVERHEAD_MINUTES} min</span>
          <span>Committed {totals.committedMinutes} min</span>
          {totals.overruns ? (
            <span>Over by {totals.overrunMinutes} min</span>
          ) : (
            <span>Unallocated {totals.slackMinutes} min</span>
          )}
        </div>
      </div>

      {totals.overruns ? (
        <div className={styles.warn}>
          <div className={styles.warnHead}>
            The agenda overruns by {totals.overrunMinutes} minutes.
          </div>
          <p className={styles.rowNote}>
            {totals.committedMinutes} minutes of business are scheduled into a{" "}
            {meeting.scheduledMinutes} minute meeting, counting{" "}
            {PROCEDURAL_OVERHEAD_MINUTES} minutes for call, roll, quorum and
            adoption. Either the meeting runs long or the items at the foot of
            the agenda are not reached. The items below marked as beginning after
            the scheduled close are the ones that will not be taken.
          </p>
        </div>
      ) : (
        <p className={styles.sectionNote}>
          {totals.committedMinutes} minutes committed of {meeting.scheduledMinutes}{" "}
          scheduled, with {totals.slackMinutes} minutes unallocated.{" "}
          {totals.byType.DECISION.count} of the {totals.itemCount} items are
          decisions, taking {Math.round(totals.decisionShare * 100)} percent of
          the meeting.
        </p>
      )}

      <h2 className={styles.sectionHead}>Running order</h2>
      <p className={styles.sectionNote}>
        Item numbers below are the minute references other modules point at.
        Reordering before adoption renumbers them; after adoption it does not,
        and cannot.
      </p>

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Item</th>
              <th scope="col">Type</th>
              <th scope="col">Owner role</th>
              <th scope="col" className={styles.num}>
                Est.
              </th>
              <th scope="col">Reached</th>
              <th scope="col">Minute reference</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((row) => (
              <tr key={row.item.id}>
                <td className={styles.num}>{row.item.position}</td>
                <td>{row.item.title}</td>
                <td>{AGENDA_ITEM_TYPE_LABELS[row.item.type]}</td>
                <td>{roleLabel(row.item.ownerRole)}</td>
                <td className={styles.num}>{row.item.estimatedMinutes}</td>
                <td className={styles.mono}>
                  {formatClockOffset(meeting.scheduledStart, row.startsAtMinute)}
                  {row.pastScheduledClose && (
                    <>
                      {" "}
                      <span className={`${styles.chip} ${styles.chipWarn}`}>
                        after close
                      </span>
                    </>
                  )}
                </td>
                <td className={styles.mono}>
                  {minuteRefForMeeting(meeting, row.item.itemNumber)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className={styles.sectionHead}>Build the agenda</h2>
      {writable ? (
        <AgendaEditor
          meetingId={id}
          items={items}
          editable={!frozen}
          frozenReason={
            frozen
              ? `Adopted ${meeting.agendaAdoptedAt ? new Date(meeting.agendaAdoptedAt).toISOString().slice(0, 10) : "earlier"}. ` +
                `The references ${minuteRefForMeeting(meeting, 1)} onward are already published to the board and, for a transfer item, to the other entity's treasurer.`
              : null
          }
        />
      ) : (
        <div className={styles.quiet}>
          This role can read the {meeting.entity} agenda but not build it. The
          minute book is kept by the Secretary of {meeting.entity}: custody of
          the book is an office, not an access level, and the President reading
          the book is not the President keeping it. Item owners propose items to
          the Secretary.
        </div>
      )}

      <h2 className={styles.sectionHead}>Notice</h2>
      <p className={styles.sectionNote}>
        {noticeRequiredHours(meeting) >= 24
          ? `${noticeRequiredHours(meeting) / 24} days`
          : `${noticeRequiredHours(meeting)} hours`}{" "}
        required for a {meeting.session > 1 ? "special" : "regular"} meeting.
        {meeting.noticeSentAt
          ? ` Recorded as issued ${new Date(meeting.noticeSentAt).toISOString().slice(0, 10)}.`
          : " Not yet recorded as issued."}{" "}
        The notice period is the platform&apos;s assumption and not a statutory
        figure; see the send page.
      </p>

    </Shell>
  );
}
