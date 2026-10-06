import { notFound } from "next/navigation";

import { canReadGovernance, canWriteMinutes } from "@/lib/meetings/access";
import { buildAgendaNoticeAction } from "@/lib/meetings/actions";
import {
  NOTICE_BASIS_NOTE,
  NOTICE_ROLES_BY_ENTITY,
  REGULAR_NOTICE_HOURS,
  SPECIAL_NOTICE_HOURS,
  noticeRequiredHours,
  roleLabel,
} from "@/lib/meetings/distribution";
import { getCurrentPersona, subjectFor } from "@/lib/authz/session";
import { bookRefForMeeting } from "@/lib/meetings/reference";
import { meetingsRepository } from "@/lib/meetings/repository";
import { EntityBanner, Refused, Shell } from "../../Shell";
import styles from "../../meetings.module.css";
import { NoticeRecorder } from "./NoticeRecorder";

export const metadata = { title: "Send agenda — Secretary" };

export default async function DistributePage({
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
      <Shell entity={meeting.entity} meetingId={id} active="distribute" persona={persona}>
        <Refused
          reason={`${persona.label} holds no board grant on member data for ${meeting.entity}, so the ${meeting.entity} agenda and its notice are not readable by this role.`}
        />
      </Shell>
    );
  }

  const built = await buildAgendaNoticeAction(id);
  const writable = canWriteMinutes(subject, meeting.entity);

  return (
    <Shell entity={meeting.entity} meetingId={id} active="distribute" persona={persona}>
      <p className={styles.eyebrow}>Send agenda &middot; {bookRefForMeeting(meeting)}</p>
      <h1 className={styles.title}>Notice and agenda for {meeting.entity}</h1>
      <EntityBanner entity={meeting.entity} />

      <div className={styles.warn}>
        <div className={styles.warnHead}>Nothing here sends anything.</div>
        <p className={styles.rowNote}>
          Resend is named as the transactional mail provider and is not wired.
          Rather than show a confirmation that would be false, this page builds
          the exact payload that would be handed to it and shows it in full. Copy
          it out and send it yourself, then record the notice as issued below.
        </p>
      </div>

      <h2 className={styles.sectionHead}>Notice period</h2>
      <p className={styles.sectionNote}>
        {noticeRequiredHours(meeting) >= 24
          ? `${noticeRequiredHours(meeting) / 24} days`
          : `${noticeRequiredHours(meeting)} hours`}{" "}
        for this meeting, which is a{" "}
        {meeting.session > 1 ? "special" : "regular"} meeting. Regular meetings
        are set at {REGULAR_NOTICE_HOURS / 24} days and special meetings at{" "}
        {SPECIAL_NOTICE_HOURS} hours.
      </p>
      <div className={styles.quiet}>
        <strong>These figures are an assumption, not a statute.</strong>{" "}
        {NOTICE_BASIS_NOTE}
      </div>

      {built.ok ? (
        <>
          <div className={built.notice.startsWith("Notice period satisfied") ? styles.ok : styles.warn}>
            {built.notice}
          </div>

          <h2 className={styles.sectionHead}>Recipients</h2>
          <p className={styles.sectionNote}>
            Resolved as roles on {meeting.entity}, never as addresses. This module
            does not reach into member data to look an address up, which is why{" "}
            <span className={styles.mono}>to</span> is empty in the payload: it is
            filled at send time by whatever wires the mail provider.
          </p>
          <div className={styles.chipRow}>
            {NOTICE_ROLES_BY_ENTITY[meeting.entity].map((role) => (
              <span key={role} className={`${styles.chip} ${styles.chipHue}`}>
                {roleLabel(role)}
              </span>
            ))}
          </div>

          <h2 className={styles.sectionHead}>Plain text</h2>
          <pre className={styles.pre}>{built.payload.text}</pre>

          <h2 className={styles.sectionHead}>Email-ready HTML</h2>
          <p className={styles.sectionNote}>
            Table-based, inline styles, no external stylesheet, no image, no
            tracking pixel and no script. Colours are inlined literals here
            because an email client reads no custom properties; they are the same
            token values.
          </p>
          <pre className={styles.pre}>{built.payload.html}</pre>

          <h2 className={styles.sectionHead}>The payload, exactly</h2>
          <p className={styles.sectionNote}>{built.stubNote}</p>
          <pre className={styles.pre}>
            {JSON.stringify(
              {
                ...built.payload,
                text: `[${built.payload.text.length} characters, shown above]`,
                html: `[${built.payload.html.length} characters, shown above]`,
              },
              null,
              2,
            )}
          </pre>

          {writable ? (
            <NoticeRecorder meetingId={id} alreadySent={meeting.noticeSentAt} />
          ) : (
            <div className={styles.quiet}>
              Recording the notice as issued is a write to the {meeting.entity}{" "}
              book, so it is the Secretary of {meeting.entity} who records it.
            </div>
          )}
        </>
      ) : (
        <Refused reason={built.error} />
      )}

    </Shell>
  );
}
