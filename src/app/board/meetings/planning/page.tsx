import Link from "next/link";

import { ENTITIES } from "@/lib/authz/model";
import { requireBoardViewer } from "@/lib/authz/session";
import { readableEntities } from "@/lib/meetings/access";
import {
  ENTITY_LONG_NAME,
  formatMeetingDate,
  roleLabel,
} from "@/lib/meetings/distribution";
import { AGENDA_ITEM_TYPE_LABELS } from "@/lib/meetings/types";
import { planningMinutes, secretaryPlanning } from "@/lib/meetings/workspace";
import type { PlanningItem } from "@/lib/workspace/types";
import { Refused, Shell, hueFor } from "../Shell";
import styles from "../meetings.module.css";

export const metadata = { title: "Planning — Secretary" };

function PlanningRow({ item, showProposer }: { item: PlanningItem; showProposer: boolean }) {
  return (
    <li>
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.rowFigure}>{item.estimateMinutes} min</span>
      </div>
      <div className={styles.chipRow}>
        <span className={`${styles.chip} ${styles.chipHue}`}>{item.entity}</span>
        <span className={styles.chip}>{AGENDA_ITEM_TYPE_LABELS[item.type]}</span>
        {showProposer && (
          <span className={styles.chip}>{roleLabel(item.proposedByRole)}</span>
        )}
        <span className={styles.chip}>
          {item.acceptedForMeetingId
            ? "on the adopted agenda"
            : "agenda still in draft, number not frozen"}
        </span>
      </div>
      <p className={styles.rowNote}>{item.reason}</p>
    </li>
  );
}

/**
 * The Planning tab, which is the odd one of the five for this office.
 *
 * Every other role's Planning tab is outbound: what I want on the next agenda,
 * filed once instead of retyped into an email. This role is the one those
 * items arrive at, so the tab has two halves, and only one of them exists.
 *
 * The Secretary's own half is real, and derived: items on the next meeting's
 * agenda whose owner is this office. The inbound half has no source. Nothing
 * outside this module exports a planning item — the shared shape is defined in
 * `src/lib/workspace/types.ts` and no module has filled it in — so rather than
 * reach into another module's internals to fake a queue, the tab says what is
 * missing and shows what can honestly be read instead: the items other offices
 * have already got onto the agenda.
 */
export default async function SecretaryPlanningTab() {
  const { subject, label: viewerLabel } = await requireBoardViewer();
  const visible = readableEntities(subject, ENTITIES);
  const planning = await secretaryPlanning(subject);

  if (visible.length === 0) {
    return (
      <Shell entity={null} meetingId={null} active="planning" viewerLabel={viewerLabel}>
        <p className={styles.eyebrow}>Secretary &middot; Planning</p>
        <h1 className={styles.title}>The next agenda, each board separately</h1>
        <Refused
          reason={`${viewerLabel} holds no board grant on member data for either entity. An agenda names roles and titles rather than people, but it is still board-tier information about how the organizations are run. Both agendas are withheld, which is not the same as there being no items on them.`}
        />
      </Shell>
    );
  }

  return (
    <Shell entity={null} meetingId={null} active="planning" viewerLabel={viewerLabel}>
      <p className={styles.eyebrow}>Secretary &middot; Planning</p>
      <h1 className={styles.title}>The next agenda, each board separately</h1>
      <p className={styles.lede}>
        One agenda per entity, built per entity. The same evening and the same
        room does not make it one meeting, and an item of the Association&rsquo;s
        is not before the Foundation&rsquo;s board whatever the clock says.
      </p>

      <div className={styles.warn}>
        <div className={styles.warnHead}>
          The inbound half of this tab does not exist yet.
        </div>
        <p className={styles.rowNote}>{planning.inboundNote}</p>
      </div>

      {planning.meetings.length === 0 && (
        <p className={styles.sectionNote} style={{ marginTop: 20 }}>
          No meeting of either entity within this role&rsquo;s reach is still
          ahead, so there is no next agenda to plan against. A meeting has to be
          on the calendar before items can be filed for it.
        </p>
      )}

      {planning.meetings.map((book) => {
        const mineMinutes = planningMinutes(book.mine);
        const othersMinutes = planningMinutes(book.fromOtherRoles);
        return (
          <section
            key={book.meeting.id}
            className={styles.panel}
            style={{ ...hueFor(book.meeting.entity), marginTop: 22 }}
          >
            <div className={styles.panelHead}>
              <span className={styles.panelTitle}>
                {ENTITY_LONG_NAME[book.meeting.entity]}
              </span>
              <span className={styles.entityMark}>{book.meeting.entity}</span>
            </div>
            <p className={styles.rowNote}>
              {book.meeting.title} &middot;{" "}
              {formatMeetingDate(book.meeting.scheduledStart)}
            </p>
            <div className={styles.chipRow}>
              <span className={styles.chip}>
                {book.meeting.scheduledMinutes} min scheduled
              </span>
              <span className={styles.chip}>
                {mineMinutes + othersMinutes} min committed
              </span>
              <span
                className={
                  book.adopted ? styles.chip : `${styles.chip} ${styles.chipWarn}`
                }
              >
                {book.adopted
                  ? "agenda adopted, item numbers frozen"
                  : "agenda in draft, item numbers can still move"}
              </span>
            </div>

            <h2 className={styles.sectionHead} style={{ marginTop: 20 }}>
              This office&rsquo;s own items
            </h2>
            {book.mine.length === 0 ? (
              <p className={styles.sectionNote}>
                Nothing of this office&rsquo;s is on the{" "}
                {book.meeting.entity} agenda for this meeting. That is a
                legitimate answer rather than an empty list: most of what this
                office does on a meeting night is record what other offices
                bring.
              </p>
            ) : (
              <>
                <p className={styles.sectionNote}>
                  {book.mine.length}{" "}
                  {book.mine.length === 1 ? "item" : "items"}, {mineMinutes} min.
                  Filed here rather than retyped into the agenda builder, which
                  is the same list.
                </p>
                <ul className={styles.list}>
                  {book.mine.map((item) => (
                    <PlanningRow key={item.id} item={item} showProposer={false} />
                  ))}
                </ul>
              </>
            )}

            <h2 className={styles.sectionHead} style={{ marginTop: 24 }}>
              Already on this agenda from other offices
            </h2>
            <p className={styles.sectionNote}>
              {book.fromOtherRoles.length}{" "}
              {book.fromOtherRoles.length === 1 ? "item" : "items"},{" "}
              {othersMinutes} min, each owned by a role rather than a person.
              This is what reached the agenda, not a queue of proposals waiting
              to: nothing in the platform holds the second kind yet.
            </p>
            {book.fromOtherRoles.length > 0 && (
              <ul className={styles.list}>
                {book.fromOtherRoles.map((item) => (
                  <PlanningRow key={item.id} item={item} showProposer />
                ))}
              </ul>
            )}

            <div className={styles.buttonRow}>
              <Link
                href={`/board/meetings/${book.meeting.id}/agenda`}
                className={`${styles.button} ${styles.buttonQuiet}`}
              >
                Open the {book.meeting.entity} agenda builder
              </Link>
              <Link
                href={`/board/meetings/${book.meeting.id}/distribute`}
                className={`${styles.button} ${styles.buttonQuiet}`}
              >
                Send the {book.meeting.entity} notice
              </Link>
            </div>
          </section>
        );
      })}

      {planning.withheld.length > 0 && (
        <div className={styles.quiet}>
          The next meeting of {planning.withheld.join(" and ")} is withheld from
          this role rather than shown as having no items. An agenda this reader
          may not see is not an empty agenda.
        </div>
      )}
    </Shell>
  );
}
