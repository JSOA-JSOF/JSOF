import Link from "next/link";

import { ENTITIES, type Entity } from "@/lib/authz/model";
import { canReadMinutes, readableEntities } from "@/lib/meetings/access";
import { ENTITY_LONG_NAME, ENTITY_SUBSECTION } from "@/lib/meetings/distribution";
import { getCurrentPersona, subjectFor } from "@/lib/authz/session";
import {
  MINUTE_REF_EXAMPLE,
  MINUTE_REF_FORMAT,
  parseMinuteRef,
} from "@/lib/meetings/reference";
import { meetingsRepository } from "@/lib/meetings/repository";
import {
  AGENDA_ITEM_TYPE_LABELS,
  RECUSAL_BASIS_LABELS,
  type DecisionRecord,
} from "@/lib/meetings/types";
import { Refused, Shell, hueFor } from "../Shell";
import styles from "../meetings.module.css";

export const metadata = { title: "Decision register — Secretary" };

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function EntityColumn({
  entity,
  records,
}: {
  entity: Entity;
  records: DecisionRecord[];
}) {
  const recusalCount = records.reduce((sum, r) => sum + r.recusals.length, 0);
  return (
    <div className={styles.panel} style={hueFor(entity)}>
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>{ENTITY_LONG_NAME[entity]}</span>
        <span className={styles.entityMark}>
          {entity} &middot; {ENTITY_SUBSECTION[entity]}
        </span>
      </div>
      <div className={styles.meterLegend}>
        <span>{records.length} decisions</span>
        <span>{recusalCount} recusals</span>
        <span>
          {records.filter((r) => r.motion.outcome === "CARRIED").length} carried
        </span>
      </div>

      {records.length === 0 && (
        <p className={styles.rowNote}>
          No motion has yet been recorded in this book.
        </p>
      )}

      <ul className={styles.list}>
        {records.map((record) => (
          <li key={record.ref}>
            <div className={styles.rowHead}>
              <span className={styles.rowTitle}>
                {record.itemNumber}. {record.itemTitle}
              </span>
              <span className={styles.rowFigure}>{formatDate(record.date)}</span>
            </div>
            <div className={styles.chipRow}>
              <Link
                href={`/board/meetings/${record.meetingId}/minutes`}
                className={`${styles.chip} ${styles.chipHue}`}
              >
                {record.ref}
              </Link>
              <span className={styles.chip}>
                {AGENDA_ITEM_TYPE_LABELS[record.itemType]}
              </span>
              <span className={`${styles.chip} ${styles.chipSolid}`}>
                {record.motion.outcome.toLowerCase()}
              </span>
              {record.provisional && (
                <span className={`${styles.chip} ${styles.chipWarn}`}>
                  unreviewed draft
                </span>
              )}
              {!record.motion.tally && (
                <span className={`${styles.chip} ${styles.chipWarn}`}>no count</span>
              )}
            </div>

            <div className={styles.motion}>
              <p className={styles.motionText}>{record.motion.text}</p>
              <p className={styles.tally}>
                Moved by {record.motion.movedByName || "not recorded"} &middot;
                seconded by {record.motion.secondedByName || "not recorded"}
              </p>
              <p className={styles.tally}>
                {record.motion.tally
                  ? `${record.motion.tally.for} for · ${record.motion.tally.against} against · ${record.motion.tally.abstain} abstaining`
                  : "No vote count recorded against this motion"}
              </p>
            </div>

            {record.recusals.map((recusal, index) => (
              <div key={`${recusal.personId}-${index}`} className={styles.recusal}>
                <div className={styles.recusalWho}>
                  {recusal.displayName} recused
                  {recusal.withdrewFromRoom ? ", left the room" : ", took no part"}
                </div>
                <div className={styles.rowMeta}>
                  {RECUSAL_BASIS_LABELS[recusal.basis]}
                </div>
                <p className={styles.recusalReason}>{recusal.reason}</p>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function DecisionsPage() {
  const persona = await getCurrentPersona();
  const subject = subjectFor(persona);
  const repo = meetingsRepository();
  const visible = ENTITIES.filter((entity) => canReadMinutes(subject, entity));

  if (visible.length === 0) {
    const aggregate = readableEntities(subject, ENTITIES);
    return (
      <Shell entity={null} meetingId={null} active="decisions" persona={persona}>
        <h1 className={styles.title}>Decision and action register</h1>
        <Refused
          reason={
            aggregate.length > 0
              ? `${persona.label} holds aggregate access to member data and the register is row level: it names who moved, who seconded and who recused. A count of decisions would be aggregate; this is not a count.`
              : `${persona.label} holds no board grant on member data for either entity.`
          }
        />
      </Shell>
    );
  }

  const all = repo.listDecisions();
  const crossEntityRefs = all.filter((record) =>
    /transfer/i.test(`${record.itemTitle} ${record.motion.text}`),
  );

  return (
    <Shell entity={null} meetingId={null} active="decisions" persona={persona}>
      <p className={styles.eyebrow}>Register</p>
      <h1 className={styles.title}>Every decision, in the book it was taken in</h1>
      <p className={styles.lede}>
        Two columns, never one figure. Nothing here is combined across the two
        entities, because a combined decision register would be the single
        strongest piece of evidence that the two boards are one board. Each entry
        carries the minute reference that other modules point at.
      </p>

      <h2 className={styles.sectionHead}>The reference format</h2>
      <p className={styles.sectionNote}>
        <span className={styles.mono}>{MINUTE_REF_FORMAT}</span>, for example{" "}
        <span className={styles.mono}>{MINUTE_REF_EXAMPLE}</span>. The entity is
        in the string, so a reference cannot be read without knowing which board
        took the decision. An inter-entity transfer needs one of these on each
        side, and the two must name two different entities.
      </p>

      <div className={styles.split}>
        {visible.map((entity) => (
          <EntityColumn
            key={entity}
            entity={entity}
            records={all.filter((r) => r.entity === entity)}
          />
        ))}
      </div>

      {visible.length === 1 && (
        <div className={styles.quiet}>
          This role reaches the {visible[0]} book only, so one column is shown.
          The other entity&apos;s decisions are not summarised, counted or hinted
          at here.
        </div>
      )}

      {visible.length === ENTITIES.length && crossEntityRefs.length > 0 && (
        <>
          <h2 className={styles.sectionHead}>Transfers, paired</h2>
          <p className={styles.sectionNote}>
            An inter-entity transfer cannot be recorded by the treasury module
            without a minute reference on both sides. These are the decisions in
            either book that read as transfers, shown so that a missing other
            side is visible. Whether a transaction actually carries both
            references is the treasury module&apos;s check, not this
            module&apos;s: this register is what those references point at.
          </p>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Entity</th>
                  <th scope="col">Date</th>
                  <th scope="col">Item</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Recusals</th>
                </tr>
              </thead>
              <tbody>
                {crossEntityRefs.map((record) => (
                  <tr key={record.ref}>
                    <td className={styles.mono}>{record.ref}</td>
                    <td>{record.entity}</td>
                    <td>{formatDate(record.date)}</td>
                    <td>{record.itemTitle}</td>
                    <td>{record.motion.outcome.toLowerCase()}</td>
                    <td>
                      {record.recusals.length === 0
                        ? "none recorded"
                        : record.recusals
                            .map((r) => `${r.displayName} (${RECUSAL_BASIS_LABELS[r.basis]})`)
                            .join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.quiet}>
            A reference is well formed when{" "}
            <span className={styles.mono}>parseMinuteRef</span> returns a value
            for it. Of the references above,{" "}
            {crossEntityRefs.filter((r) => parseMinuteRef(r.ref)).length} of{" "}
            {crossEntityRefs.length} parse.
          </div>
        </>
      )}

    </Shell>
  );
}
