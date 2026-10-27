import { ENTITIES, type Entity } from "@/lib/authz/model";
import { canReadGovernance, canWriteMinutes } from "@/lib/meetings/access";
import {
  DUE_SOON_DAYS,
  STATUS_LABELS,
  URGENCY_LABELS,
  countsFor,
  daysUntil,
  formatDueDate,
  sortForBoard,
  splitVerified,
  urgencyOf,
} from "@/lib/meetings/calendar";
import { ENTITY_LONG_NAME, ENTITY_SUBSECTION, roleLabel } from "@/lib/meetings/distribution";
import { requireBoardViewer } from "@/lib/authz/session";
import { meetingsRepository } from "@/lib/meetings/repository";
import type { ComplianceItem } from "@/lib/meetings/types";
import { Refused, Shell, hueFor } from "../Shell";
import styles from "../meetings.module.css";
import { FilingStatusControl } from "./FilingStatus";

export const metadata = { title: "Compliance calendar — Secretary" };

const KIND_LABELS: Record<ComplianceItem["kind"], string> = {
  IRS: "Federal",
  STATE_CORPORATE: "NC corporate",
  STATE_CHARITABLE: "NC charitable",
  INSURANCE: "Insurance",
  INFRASTRUCTURE: "Infrastructure",
};

function Row({
  item,
  today,
  writable,
}: {
  item: ComplianceItem;
  today: Date;
  writable: boolean;
}) {
  const urgency = urgencyOf(item, today);
  const days = daysUntil(item.dueDate, today);
  const warn = urgency === "OVERDUE" || urgency === "DUE_SOON" || urgency === "BLOCKED";
  return (
    <li>
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.rowFigure}>
          {item.verified ? formatDueDate(item.dueDate) : "no confirmed date"}
        </span>
      </div>
      <div className={styles.chipRow}>
        <span className={`${styles.chip} ${warn ? styles.chipWarn : styles.chipHue}`}>
          {URGENCY_LABELS[urgency]}
        </span>
        <span className={styles.chip}>{KIND_LABELS[item.kind]}</span>
        <span className={styles.chip}>{roleLabel(item.ownerRole)}</span>
        <span className={styles.chip}>{STATUS_LABELS[item.status]}</span>
        {!item.selfDeclaring && item.verified && (
          <span className={`${styles.chip} ${styles.chipWarn}`}>
            nothing will remind you
          </span>
        )}
        {item.sharedInfrastructure && (
          <span className={styles.chip}>shared infrastructure</span>
        )}
      </div>
      {item.verified && (
        <p className={styles.rowNote}>
          {days < 0
            ? `${Math.abs(days)} days past the due date.`
            : `${days} days out.`}{" "}
          {item.cadence}
        </p>
      )}
      <p className={styles.rowNote}>{item.sourceNote}</p>
      <p className={styles.rowNote}>
        <span className={styles.rowMeta}>Confirmation filed at</span>{" "}
        {item.confirmationStore}
      </p>
      {writable && (
        <FilingStatusControl
          itemId={item.id}
          status={item.status}
          verified={item.verified}
        />
      )}
    </li>
  );
}

function EntityColumn({
  entity,
  items,
  today,
  writable,
}: {
  entity: Entity;
  items: ComplianceItem[];
  today: Date;
  writable: boolean;
}) {
  const counts = countsFor(items, today);
  const { duties } = splitVerified(items);
  return (
    <div className={styles.panel} style={hueFor(entity)}>
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>{ENTITY_LONG_NAME[entity]}</span>
        <span className={styles.entityMark}>
          {entity} &middot; {ENTITY_SUBSECTION[entity]}
        </span>
      </div>
      <div className={styles.meterLegend}>
        <span>{duties.length} confirmed duties</span>
        <span>{counts.overdue} overdue</span>
        <span>
          {counts.dueSoon} within {DUE_SOON_DAYS} days
        </span>
        <span>{counts.blocked} blocked</span>
        <span>{counts.notSelfDeclaring} nothing will remind you</span>
      </div>
      <ul className={styles.list}>
        {sortForBoard(duties, today).map((item) => (
          <Row key={item.id} item={item} today={today} writable={writable} />
        ))}
      </ul>
    </div>
  );
}

export default async function CalendarPage() {
  const { subject, label: viewerLabel } = await requireBoardViewer();
  const repo = await meetingsRepository();
  const visible = ENTITIES.filter((entity) => canReadGovernance(subject, entity));
  const today = new Date();

  if (visible.length === 0) {
    return (
      <Shell entity={null} meetingId={null} active="calendar" viewerLabel={viewerLabel}>
        <h1 className={styles.title}>Compliance calendar</h1>
        <Refused
          reason={`${viewerLabel} holds no board grant on member data for either entity. The calendar names only roles and dates and carries no figures, but it is still board-tier information about how the organizations are run.`}
        />
      </Shell>
    );
  }

  const all = await repo.listComplianceItems();
  const { unverified } = splitVerified(all);
  const visibleUnverified = unverified.filter((i) => visible.includes(i.entity));

  return (
    <Shell entity={null} meetingId={null} active="calendar" viewerLabel={viewerLabel}>
      <p className={styles.eyebrow}>Compliance</p>
      <h1 className={styles.title}>Filings, renewals, and who owns each one</h1>
      <p className={styles.lede}>
        Two columns, never one total. Owners are roles rather than people,
        because offices turn over and duties do not. Every entry says where the
        confirmation is filed, because an unfiled confirmation is an unmet duty
        that looks met. No money figure appears on this page.
      </p>

      <div className={styles.quiet}>
        The chip reading <strong>nothing will remind you</strong> is the one worth
        reading twice. An obligation that does not renew itself and sends no
        notice is the obligation that lapses quietly, and the NC charitable
        solicitation licence is the example: it must be re-filed annually, it is
        not self-declaring, and nothing tells you when it has expired.
      </div>

      <div className={styles.split}>
        {visible.map((entity) => (
          <EntityColumn
            key={entity}
            entity={entity}
            items={all.filter((i) => i.entity === entity)}
            today={today}
            writable={canWriteMinutes(subject, entity)}
          />
        ))}
      </div>

      {visible.length === 1 && (
        <div className={styles.quiet}>
          This role reaches {visible[0]} only, so one column is shown. Nothing
          about the other entity&apos;s filings is shown or counted here.
        </div>
      )}

      {visibleUnverified.length > 0 && (
        <>
          <h2 className={styles.sectionHead}>Not confirmed, and not a duty</h2>
          <div className={styles.warn}>
            <div className={styles.warnHead}>
              Everything in this section is unverified.
            </div>
            <p className={styles.rowNote}>
              These are reports of obligations that nobody has confirmed. They
              are kept here so they are not lost and are kept out of the columns
              above so they are not mistaken for duties. They are not counted, do
              not appear in any total, cannot be marked filed, and must not be
              put in front of the board as fact. Each one needs someone to read
              the source and either replace it with the real duty or delete it.
            </p>
          </div>
          <ul className={styles.list}>
            {visibleUnverified.map((item) => (
              <li key={item.id}>
                <div className={styles.rowHead}>
                  <span className={styles.rowTitle}>{item.title}</span>
                  <span className={`${styles.chip} ${styles.chipWarn}`}>
                    Unverified
                  </span>
                </div>
                <div className={styles.chipRow}>
                  <span className={styles.chip}>{item.entity}</span>
                  <span className={styles.chip}>{KIND_LABELS[item.kind]}</span>
                  <span className={styles.chip}>{roleLabel(item.ownerRole)}</span>
                  <span className={styles.chip}>
                    reported commencement {formatDueDate(item.dueDate)}
                  </span>
                </div>
                <p className={styles.rowNote}>{item.sourceNote}</p>
                <p className={styles.rowNote}>
                  <span className={styles.rowMeta}>Confirmation</span>{" "}
                  {item.confirmationStore}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

    </Shell>
  );
}
