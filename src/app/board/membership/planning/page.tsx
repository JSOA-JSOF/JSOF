import { AuthzError } from "@/lib/authz/policy";
import { loadMembershipPlanning, type MembershipPlanning } from "@/lib/membership/workspace";
import { membershipRepository } from "@/lib/membership/repository";
import type { PlanningItem } from "@/lib/workspace/types";

import styles from "../board.module.css";
import { MembershipShell, Refused } from "../shell";
import { currentActor } from "../subject";

export const metadata = {
  title: "Membership planning — JSOA board",
  robots: { index: false, follow: false },
};

const TYPE_LABELS: Record<PlanningItem["type"], string> = {
  DECISION: "Decision",
  DISCUSSION: "Discussion",
  INFORMATION: "Information",
};

/**
 * What this role wants on the next board agenda.
 *
 * The test of an item here is not importance, it is addressee: does it need the
 * board, or does it need the chair? Correcting a record that contradicts itself
 * is the chair's and lives on the Overview. A failing 90% test is the board's,
 * because it is not fixed by editing records — it is fixed by who the
 * organization recruits, and in the meantime by deciding what the organization
 * is willing to tell a donor. Those are two board decisions wearing one number.
 *
 * Most of these are derived, which is why the tab is not empty on a volunteer
 * board where nobody files agenda items. The composition items come from the
 * report and need only AGGREGATE, so a reader who may never open the roster
 * still sees the board matter the roster produced.
 */
export default async function MembershipPlanningPage() {
  const { persona, subject } = await currentActor();

  let planning: MembershipPlanning | null = null;
  let refusal: string | null = null;
  try {
    planning = await loadMembershipPlanning(membershipRepository(), subject);
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  const minutes = planning?.items.reduce((sum, item) => sum + item.estimateMinutes, 0) ?? 0;

  return (
    <MembershipShell current="planning">
      <h1 className={styles.title}>For the next board meeting</h1>
      <p className={styles.lede}>
        Items the membership office wants on the agenda, each with what it needs from the board
        and how long it should take. These are the ones that cannot be settled by the office
        that raised them.
      </p>

      {refusal || !planning ? (
        <Refused
          persona={persona}
          what="the membership planning items"
          detail={refusal ?? undefined}
        />
      ) : (
        <>
          <div className={styles.summary}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Items</span>
              <span className={styles.summaryValue}>{planning.items.length}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Agenda time asked for</span>
              <span className={styles.summaryValue}>{minutes} min</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Accepted onto an agenda</span>
              <span className={styles.summaryValue}>0</span>
            </div>
          </div>

          {planning.items.length === 0 ? (
            <p className={styles.empty}>
              Nothing this role holds needs the board right now. The exemption tests pass and
              the work that is outstanding is the chair&rsquo;s.
            </p>
          ) : (
            <ul className={styles.rows}>
              {planning.items.map((item) => (
                <li key={item.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowName}>{item.title}</span>
                    <span className={styles.rowMeta}>
                      {TYPE_LABELS[item.type]} &middot; {item.estimateMinutes} min &middot;{" "}
                      {item.entity}
                    </span>
                  </div>
                  <p className={styles.tierDetail}>{item.reason}</p>
                </li>
              ))}
            </ul>
          )}

          {planning.withheld && (
            <div className={styles.held}>
              <strong>
                {planning.withheld.items.length}{" "}
                {planning.withheld.items.length === 1 ? "item is" : "items are"} withheld, not
                absent
              </strong>
              <ul className={styles.findings}>
                {planning.withheld.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className={styles.sectionNote}>{planning.withheld.why}</p>
            </div>
          )}

          {/* Said plainly rather than implied. A role that files an item and
              believes it reached an agenda is worse off than a role that is
              told the handoff does not exist yet. */}
          <p className={styles.note}>
            Every item above is a proposal. The spine has these flowing into the
            Secretary&rsquo;s agenda builder instead of being retyped there, and that handoff
            is not built: nothing in the minute book reads these yet, so none of them is on an
            agenda until the Secretary puts it there.
          </p>
        </>
      )}
    </MembershipShell>
  );
}
