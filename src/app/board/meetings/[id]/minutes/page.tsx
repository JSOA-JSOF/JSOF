import { notFound } from "next/navigation";

import { canReadGovernance, canReadMinutes, canWriteMinutes } from "@/lib/meetings/access";
import {
  ENTITY_LONG_NAME,
  formatMeetingDate,
  roleLabel,
} from "@/lib/meetings/distribution";
import { getCurrentPersona, subjectFor } from "@/lib/authz/session";
import {
  MINUTE_FLAG_TEXT,
  checkMinute,
  minuteBookReady,
  type MinuteFlag,
} from "@/lib/meetings/minutes";
import { bookRefForMeeting, minuteRefForMeeting } from "@/lib/meetings/reference";
import { meetingsRepository } from "@/lib/meetings/repository";
import { DRAFT_FLAG_TEXT } from "@/lib/meetings/transcript";
import {
  AGENDA_ITEM_TYPE_LABELS,
  RECUSAL_BASIS_LABELS,
} from "@/lib/meetings/types";
import { EntityBanner, Refused, Shell } from "../../Shell";
import styles from "../../meetings.module.css";
import { MinuteEditor } from "./MinuteEditor";

export const metadata = { title: "Minutes — Secretary" };

function flagText(flag: string): string {
  return (
    MINUTE_FLAG_TEXT[flag as MinuteFlag] ??
    DRAFT_FLAG_TEXT[flag] ??
    flag
  );
}

export default async function MinutesPage({
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

  if (!canReadMinutes(subject, meeting.entity)) {
    const aggregateOnly = canReadGovernance(subject, meeting.entity);
    return (
      <Shell entity={meeting.entity} meetingId={id} active="minutes" persona={persona}>
        <p className={styles.eyebrow}>Minutes &middot; {bookRefForMeeting(meeting)}</p>
        <h1 className={styles.title}>The {meeting.entity} minute book</h1>
        <Refused
          reason={
            aggregateOnly
              ? `${persona.label} holds aggregate access to member data on ${meeting.entity} and the minute book is row level. The book names who moved, who seconded, who recused and why, so aggregate access is not enough. The agenda and the compliance calendar, which name only roles, are readable by this role.`
              : `${persona.label} holds no board grant on member data for ${meeting.entity}, so no part of the ${meeting.entity} minute book is readable by this role.`
          }
        />
      </Shell>
    );
  }

  const items = repo.listAgendaItems(id);
  const entries = repo.listMinutes(id);
  const byItem = new Map(entries.map((e) => [e.agendaItemId, e]));
  const writable = canWriteMinutes(subject, meeting.entity);
  const readiness = minuteBookReady(items, entries, meeting);
  const present = meeting.attendees.filter((a) => a.present);

  return (
    <Shell entity={meeting.entity} meetingId={id} active="minutes" persona={persona}>
      <p className={styles.eyebrow}>Minutes &middot; {bookRefForMeeting(meeting)}</p>
      <h1 className={styles.title}>
        {ENTITY_LONG_NAME[meeting.entity]}, {formatMeetingDate(meeting.scheduledStart)}
      </h1>
      <EntityBanner entity={meeting.entity} />

      <h2 className={styles.sectionHead}>Roll</h2>
      <p className={styles.sectionNote}>
        {present.length} present of {meeting.attendees.length} on the board,
        against a quorum of {meeting.quorum}.
        {present.length < meeting.quorum &&
          " Business taken without quorum is not board action, and every item below is flagged accordingly."}
      </p>
      <div className={styles.chipRow}>
        {meeting.attendees.map((attendee) => (
          <span
            key={attendee.personId}
            className={`${styles.chip} ${attendee.present ? styles.chipHue : ""}`}
          >
            {attendee.displayName} &middot; {roleLabel(attendee.role)}
            {attendee.present ? "" : " · absent"}
          </span>
        ))}
      </div>

      <h2 className={styles.sectionHead}>Completeness</h2>
      {readiness.ready ? (
        <p className={styles.ok}>
          Every item on the agenda has a minute and none of them is incomplete.
          The book is ready to be put to the board for adoption.
        </p>
      ) : (
        <div className={styles.warn}>
          <div className={styles.warnHead}>
            This book is not ready for adoption.
          </div>
          <p className={styles.rowNote}>
            {readiness.missingItemNumbers.length > 0 && (
              <>
                No minute yet for item
                {readiness.missingItemNumbers.length > 1 ? "s " : " "}
                {readiness.missingItemNumbers.join(", ")}.{" "}
              </>
            )}
            {readiness.incompleteRefs.length > 0 && (
              <>Incomplete: {readiness.incompleteRefs.join(", ")}.</>
            )}
          </p>
        </div>
      )}

      {!writable && (
        <div className={styles.quiet}>
          This role can read the {meeting.entity} book but not write in it.
          Custody of a minute book is an office rather than an access level: the
          Secretary of {meeting.entity} keeps it. Everything below is read only.
        </div>
      )}

      {items.map((item) => {
        const entry = byItem.get(item.id);
        const check = entry
          ? checkMinute(entry, item, meeting)
          : { flags: [], incomplete: false };
        const allFlags = entry ? [...new Set([...check.flags, ...entry.flags])] : [];
        return (
          <section key={item.id} className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.panelTitle}>
                {item.itemNumber}. {item.title}
              </span>
              <span className={styles.mono}>
                {minuteRefForMeeting(meeting, item.itemNumber)}
              </span>
            </div>
            <div className={styles.chipRow}>
              <span className={`${styles.chip} ${styles.chipHue}`}>
                {AGENDA_ITEM_TYPE_LABELS[item.type]}
              </span>
              <span className={styles.chip}>{roleLabel(item.ownerRole)}</span>
              {entry?.draft && (
                <span className={`${styles.chip} ${styles.chipWarn}`}>
                  unreviewed draft
                </span>
              )}
              {entry?.closed && <span className={styles.chip}>closed</span>}
              {check.incomplete && (
                <span className={`${styles.chip} ${styles.chipWarn}`}>incomplete</span>
              )}
            </div>

            {allFlags.length > 0 && (
              <div className={styles.warn}>
                {allFlags.map((flag) => (
                  <p key={flag} className={styles.rowNote}>
                    {flagText(flag)}
                  </p>
                ))}
              </div>
            )}

            {!entry && (
              <p className={styles.rowNote}>
                Nothing recorded against this item yet.
              </p>
            )}

            {entry && (
              <>
                <details className={styles.disclose} open={!writable}>
                  <summary>As recorded</summary>
                  <p className={styles.rowNote} style={{ whiteSpace: "pre-wrap" }}>
                    {entry.discussion || "Nothing recorded as discussed."}
                  </p>
                  {entry.motion ? (
                    <div className={styles.motion}>
                      <div className={styles.rowMeta}>Motion</div>
                      <p className={styles.motionText}>{entry.motion.text}</p>
                      <p className={styles.tally}>
                        Moved by {entry.motion.movedByName || "not recorded"} &middot;
                        seconded by {entry.motion.secondedByName || "not recorded"}
                      </p>
                      <p className={styles.tally}>
                        {entry.motion.tally
                          ? `${entry.motion.tally.for} for, ${entry.motion.tally.against} against, ${entry.motion.tally.abstain} abstaining`
                          : "No count recorded"}{" "}
                        &middot; {entry.motion.outcome.toLowerCase()}
                      </p>
                    </div>
                  ) : (
                    <p className={styles.rowNote}>
                      No motion recorded under this item.
                    </p>
                  )}
                  {entry.recusals.map((recusal, index) => (
                    <div key={`${recusal.personId}-${index}`} className={styles.recusal}>
                      <div className={styles.recusalWho}>
                        {recusal.displayName} recused
                        {recusal.withdrewFromRoom
                          ? " and left the room"
                          : " and remained, taking no part"}
                      </div>
                      <div className={styles.rowMeta}>
                        {RECUSAL_BASIS_LABELS[recusal.basis]}
                      </div>
                      <p className={styles.recusalReason}>{recusal.reason}</p>
                    </div>
                  ))}
                </details>
              </>
            )}

            {writable && (
              <details className={styles.disclose} open={!entry || entry.draft}>
                <summary>{entry ? "Edit this minute" : "Write this minute"}</summary>
                <MinuteEditor
                  meetingId={id}
                  entity={meeting.entity}
                  item={item}
                  entry={entry}
                  attendees={meeting.attendees}
                />
              </details>
            )}
          </section>
        );
      })}

    </Shell>
  );
}
