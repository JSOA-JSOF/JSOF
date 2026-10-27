import Link from "next/link";
import { notFound } from "next/navigation";

import { canReadGovernance, canReadMinutes, canWriteMinutes } from "@/lib/meetings/access";
import { requireBoardViewer } from "@/lib/authz/session";
import { bookRefForMeeting } from "@/lib/meetings/reference";
import { meetingsRepository } from "@/lib/meetings/repository";
import { SAMPLE_TRANSCRIPT } from "@/lib/meetings/seed";
import {
  HEADING_THRESHOLD,
  MAX_EXTRACT_CHARS,
  TRANSCRIPT_METHOD_SUMMARY,
  keywordsForItem,
} from "@/lib/meetings/transcript";
import { EntityBanner, Refused, Shell } from "../../Shell";
import styles from "../../meetings.module.css";
import { TranscriptForm } from "./TranscriptForm";

export const metadata = { title: "Transcript intake — Secretary" };

export default async function TranscriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { subject, label: viewerLabel } = await requireBoardViewer();
  const repo = await meetingsRepository();
  const meeting = await repo.getMeeting(id);
  if (!meeting) notFound();

  if (!canReadMinutes(subject, meeting.entity)) {
    return (
      <Shell entity={meeting.entity} meetingId={id} active="transcript" viewerLabel={viewerLabel}>
        <Refused
          reason={
            canReadGovernance(subject, meeting.entity)
              ? `A transcript is the roll call and everything anyone said, so it sits with the minute book at row level. ${viewerLabel} holds aggregate access to member data on ${meeting.entity} and cannot open it.`
              : `${viewerLabel} holds no board grant on member data for ${meeting.entity}.`
          }
        />
      </Shell>
    );
  }

  const items = await repo.listAgendaItems(id);
  const writable = canWriteMinutes(subject, meeting.entity);
  const existingDrafts = (await repo.listMinutes(id)).filter(
    (entry) => entry.source === "TRANSCRIPT_DRAFT",
  );

  return (
    <Shell entity={meeting.entity} meetingId={id} active="transcript" viewerLabel={viewerLabel}>
      <p className={styles.eyebrow}>Transcript intake &middot; {bookRefForMeeting(meeting)}</p>
      <h1 className={styles.title}>Turn a transcript into a draft to edit</h1>
      <EntityBanner entity={meeting.entity} />

      <div className={styles.warn}>
        <div className={styles.warnHead}>This does not summarise anything.</div>
        <p className={styles.rowNote}>
          There is no model call here and none is wanted. What runs is a text
          parser: it splits the paste into speaker turns, assigns runs of turns
          to agenda items by matching the words in the item titles, and pulls
          motion, second, vote and recusal language out with patterns. The
          &quot;what was discussed&quot; field of every section it produces is a
          verbatim extract of the turns it assigned, cut at{" "}
          {MAX_EXTRACT_CHARS.toLocaleString("en-US")} characters. Nothing is
          paraphrased, condensed or interpreted, because a machine paraphrase of
          what a board said is a liability dressed up as a convenience.
        </p>
        <p className={styles.rowNote}>
          Every section it writes is an unreviewed draft, is marked as one in the
          text itself, and counts as incomplete in the register until the
          Secretary has rewritten it.
        </p>
      </div>

      <h2 className={styles.sectionHead}>How it actually works</h2>
      <ol className={styles.list}>
        {TRANSCRIPT_METHOD_SUMMARY.map((step) => (
          <li key={step}>
            <p className={styles.rowNote} style={{ margin: 0 }}>
              {step}
            </p>
          </li>
        ))}
      </ol>

      <h2 className={styles.sectionHead}>Where it will be wrong</h2>
      <ul className={styles.list}>
        <li>
          <p className={styles.rowNote} style={{ margin: 0 }}>
            Assignment is keyword overlap. An item titled &quot;Budget&quot; will
            collect every mention of a budget anywhere in the meeting, and an
            item discussed without using its title words will collect nothing at
            all.
          </p>
        </li>
        <li>
          <p className={styles.rowNote} style={{ margin: 0 }}>
            Segmentation is sequential. Once a turn opens an item, the turns
            after it stay with that item until another item scores higher, so a
            meeting that jumps back and forth will be mis-split. Going back up
            the agenda needs a stronger signal than moving down it, which
            prevents flip-flopping and also means a genuine return to an earlier
            item can be missed.
          </p>
        </li>
        <li>
          <p className={styles.rowNote} style={{ margin: 0 }}>
            A speaker the attendee list does not contain is recorded as unmatched
            rather than guessed at. A surname shared by two board members
            resolves to neither.
          </p>
        </li>
        <li>
          <p className={styles.rowNote} style={{ margin: 0 }}>
            Vote tallies are only read where the transcript states them in digits
            or small number words. A voice vote, a show of hands, &quot;any
            objection&quot; and &quot;carried unanimously&quot; all produce no
            tally, and the section is flagged for you to fill in from your notes.
          </p>
        </li>
        <li>
          <p className={styles.rowNote} style={{ margin: 0 }}>
            Motion text is the mover&apos;s own words from the motion phrase to
            the end of that sentence. It is frequently not the motion as finally
            amended.
          </p>
        </li>
        <li>
          <p className={styles.rowNote} style={{ margin: 0 }}>
            A recusal reason is the verbatim sentence in which the recusal was
            stated. It is a pointer to the passage, not a finding, and it must be
            rewritten before the draft is cleared.
          </p>
        </li>
        <li>
          <p className={styles.rowNote} style={{ margin: 0 }}>
            Crosstalk, overlapping speech and anything the meeting
            platform&apos;s own speech recognition dropped are invisible here.
          </p>
        </li>
      </ul>

      <h2 className={styles.sectionHead}>What it will match, per item</h2>
      <p className={styles.sectionNote}>
        A turn needs {HEADING_THRESHOLD} points to open a section. A keyword you
        added is worth two points, a word taken from the title is worth one. If
        an item below has thin keywords, add the phrases the board actually says
        out loud on the agenda page.
      </p>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Item</th>
              <th scope="col">Your keywords, 2 points each</th>
              <th scope="col">From the title, 1 point each</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const keywords = keywordsForItem(item);
              return (
                <tr key={item.id}>
                  <td className={styles.num}>{item.itemNumber}</td>
                  <td>{item.title}</td>
                  <td className={styles.mono}>
                    {keywords.strong.length > 0 ? keywords.strong.join(", ") : "none"}
                  </td>
                  <td className={styles.mono}>
                    {keywords.weak.length > 0 ? keywords.weak.join(", ") : "none"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {existingDrafts.length > 0 && (
        <div className={styles.quiet}>
          There {existingDrafts.length === 1 ? "is" : "are"} already{" "}
          {existingDrafts.length} unreviewed draft{" "}
          {existingDrafts.length === 1 ? "section" : "sections"} against this
          meeting. Running the parser again replaces every one of them. It never
          touches a minute the Secretary wrote.{" "}
          <Link href={`/board/meetings/${id}/minutes`} className={styles.refLink}>
            Open the minutes
          </Link>
        </div>
      )}

      <h2 className={styles.sectionHead}>Run it</h2>
      {writable ? (
        <TranscriptForm meetingId={id} sample={SAMPLE_TRANSCRIPT} />
      ) : (
        <div className={styles.quiet}>
          Producing a draft writes into the {meeting.entity} book, so it is the
          Secretary of {meeting.entity} who runs it.
        </div>
      )}

    </Shell>
  );
}
