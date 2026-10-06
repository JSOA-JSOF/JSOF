import { getCurrentSubject } from "@/lib/authz/session";
import { treasuryRepository, treasurySubject } from "@/lib/treasury/repository";
import { FICTIONAL_DATA_NOTE, treasurerPlanning } from "@/lib/treasury/workspace";
import type { PlanningItemType } from "@/lib/workspace/types";

import { ENTITY_LABELS, EntityTag, TreasuryHeader, entityClass } from "../_components/chrome";
import styles from "../treasury.module.css";

export const metadata = {
  title: "Planning — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

const TYPE_LABELS: Record<PlanningItemType, string> = {
  DECISION: "Decision",
  DISCUSSION: "Discussion",
  INFORMATION: "Information",
};

/**
 * What the Treasurer wants on the next agenda.
 *
 * These flow into the Secretary's agenda builder rather than being retyped
 * there, which is how agendas actually get built, and it has a second effect:
 * the communications material becomes a by-product of what every role already
 * filed instead of something nobody volunteers to write.
 *
 * Every item is DERIVED, the same way the Overview's tasks are. The critical
 * separation-of-duties finding comes from the authorization engine run over
 * the board's real assignments; the Finance Review Officer item is derived
 * from that finding, because the reviewer is the mitigation the finding itself
 * names; the renewal items come from the register, and only the ones that want
 * a decision rather than a silent charge appear. The renewals that correctly
 * do NOT need the board are listed too, with the reason, so their absence
 * reads as a judgement rather than a gap.
 *
 * Two entities, two agendas. Each board decides about its own money, so a tool
 * whose invoice is split produces one item on each agenda carrying that
 * entity's own apportioned share. There is no item here asking "the
 * organization" to decide about a combined figure, because there is no board
 * that could take it.
 */
export default async function TreasuryPlanningPage() {
  const subject = treasurySubject(await getCurrentSubject());
  const repo = treasuryRepository();
  const planning = treasurerPlanning(subject, repo);

  return (
    <div>
      <TreasuryHeader
        current="planning"
        title="My items for the next meeting"
        period={`As of ${repo.asOfDate()}`}
        lede={
          "What the Treasurer needs the board to decide, with the type, an estimate " +
          "and the reason it needs the board rather than the office. Derived from " +
          "the same data as everything else, so an item disappears when the thing " +
          "behind it is fixed and comes back if it regresses."
        }
      />

      <h2 className={styles.sectionHead}>
        {planning.items.length === 0
          ? "Nothing to raise"
          : `${planning.items.length} ${planning.items.length === 1 ? "item" : "items"}, about ${planning.totalEstimateMinutes} minutes`}
      </h2>

      {planning.items.length === 0 ? (
        <p className={styles.note}>
          Nothing in the scope you hold needs the board. That is the result of the
          checks, not an absence of them: a finding standing, a renewal nobody has
          reviewed, or a decision minuted and never actioned would each put an item
          here on its own.
        </p>
      ) : (
        <ul className={styles.rules}>
          {planning.items.map((item) => (
            <li key={item.id} className={`${entityClass(item.entity)} ${styles.rule}`}>
              <span className={styles.ruleState}>{item.estimateMinutes}m</span>
              <span className={styles.ruleRequirement}>
                {item.title}
                <span className={styles.ruleSource}>
                  <EntityTag entity={item.entity} /> {TYPE_LABELS[item.type]} ·{" "}
                  {ENTITY_LABELS[item.entity].long} board
                </span>
              </span>
              <p className={styles.ruleWhy}>{item.reason}</p>
            </li>
          ))}
        </ul>
      )}

      {planning.withheldCount > 0 ? (
        <p className={styles.note}>
          <strong>
            {planning.withheldCount}{" "}
            {planning.withheldCount === 1 ? "source is" : "sources are"} withheld
          </strong>{" "}
          rather than absent. Some of what would put an item on this agenda sits
          outside your scope: control findings about other seats need audit read, and
          register lines need financial scope on the entity bearing the cost. Those
          items exist and belong on somebody&rsquo;s agenda; they are not yours to
          raise, and the platform will not widen a grant to make this tab look fuller.
        </p>
      ) : null}

      <h2 className={styles.sectionHead}>Renewals that do not need the board</h2>
      <p className={styles.note}>
        Said out loud, because a short agenda should be a judgement rather than an
        oversight. A charge the board has already decided about, inside the year,
        with no finding above moderate, is a charge the Treasurer pays.
      </p>

      {planning.silentRenewals.length === 0 ? (
        <p className={styles.note}>
          Every committed line in your scope is on the agenda above. Nothing is being
          charged on a decision older than a year.
        </p>
      ) : (
        <ul className={styles.rules}>
          {planning.silentRenewals.map((row) => (
            <li
              key={`${row.entity}-${row.tool}`}
              className={`${entityClass(row.entity)} ${styles.rule}`}
            >
              <span className={`${styles.ruleState} ${styles.ruleStateMet}`}>ok</span>
              <span className={styles.ruleRequirement}>
                {row.tool}
                <span className={styles.ruleSource}>
                  <EntityTag entity={row.entity} /> share of this line
                </span>
              </span>
              <p className={styles.ruleWhy}>{row.why}</p>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.note}>{FICTIONAL_DATA_NOTE}</p>
    </div>
  );
}
