import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { treasuryRepository, treasurySubject, type SodPanel } from "@/lib/treasury/repository";
import { personName } from "@/lib/treasury/seed";

import {
  EntityTag,
  SodFindingList,
  TreasuryHeader,
  entityClass,
} from "../_components/chrome";
import styles from "../treasury.module.css";

export const metadata = {
  title: "Controls — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

/**
 * The separation-of-duties panel.
 *
 * Every finding on this page comes from `separationOfDutiesFindings` in
 * `@/lib/authz/policy`, run over the actual role assignments. Nothing is
 * hand-written here and nothing is suppressed: the critical finding about the
 * Treasurer who also chairs the store is the organization's real arrangement,
 * and the board is better off looking at it than not.
 *
 * A finding is not a block. A ten-person volunteer board cannot fully separate
 * authorize, custody, record and reconcile, and pretending otherwise would
 * just mean the platform lied about it. What the board can do is know, and
 * compensate. So each finding carries its mitigation, and the mitigations are
 * written as things a volunteer can actually do.
 */
export default async function ControlsPage() {
  const subject = treasurySubject(await getCurrentSubject());
  const repo = await treasuryRepository();
  const asOf = await repo.asOfDate();

  let panel: SodPanel | null = null;
  let refusal: string | null = null;
  try {
    panel = await repo.separationOfDuties(subject);
  } catch (error) {
    if (error instanceof AuthzError) {
      refusal =
        "The controls panel is not available to you. It needs a board seat: it " +
        "lists who holds which roles on which entity, which is governance " +
        "information rather than member or financial data.";
    } else {
      throw error;
    }
  }

  const critical = panel?.current.filter((f) => f.severity === "critical").length ?? 0;

  return (
    <div>
      <TreasuryHeader
        current="/board/treasury/controls"
        title="Separation of duties"
        period={`As of ${asOf}`}
        lede={
          "What one pair of hands can do without a second pair of eyes. These are " +
          "findings, not blocks: the board may accept them knowingly, and on a " +
          "volunteer board of this size it will have to accept some. What it should " +
          "not do is accept them without being told."
        }
      />

      {refusal ? (
        <p className={styles.refusal} role="status">
          {refusal}
        </p>
      ) : null}

      {panel ? (
        <>
          {critical > 0 ? (
            <p className={styles.refusal} role="status">
              {critical === 1
                ? "One critical finding on the board as it stands today."
                : `${critical} critical findings on the board as it stands today.`}{" "}
              A critical finding means one person can authorize, hold, record and
              reconcile the same money. Read the mitigation and minute a decision
              either way.
            </p>
          ) : null}

          <h2 className={styles.sectionHead}>
            The board as assigned{" "}
            <span className={styles.quiet}>({panel.current.length} findings)</span>
          </h2>

          <SodFindingList findings={panel.current} nameFor={personName} />

          {panel.withheldCount > 0 ? (
            <p className={styles.note}>
              {panel.withheldCount}{" "}
              {panel.withheldCount === 1 ? "finding is" : "findings are"} withheld:
              they concern other people, and reading a finding about someone else
              needs audit-log scope on that entity. Findings about you are always
              shown to you.
            </p>
          ) : null}

          <h2 className={styles.sectionHead}>Under consideration</h2>
          <section
            className={`${entityClass("JSOF")} ${styles.panel}`}
            aria-labelledby="proposed"
          >
            <div className={styles.panelHead}>
              <div>
                <span className={styles.eyebrow}>Not adopted</span>
                <h3 id="proposed" className={styles.panelTitle}>
                  {panel.proposed.label}
                </h3>
              </div>
            </div>
            <p className={styles.findingText}>{panel.proposed.rationale}</p>
            <dl className={styles.kv} style={{ margin: "14px 0" }}>
              <dt>Person</dt>
              <dd>{personName(panel.proposed.personId)}</dd>
              <dt>Would hold</dt>
              <dd>
                {panel.proposed.assignments.map((assignment, index) => (
                  <span key={`${assignment.role}-${assignment.entity}`}>
                    {index > 0 ? "; " : ""}
                    {assignment.role.replace(/_/g, " ")} on{" "}
                    <EntityTag entity={assignment.entity} />
                  </span>
                ))}
              </dd>
            </dl>
            <p className={styles.mitigation}>
              <span className={styles.mitigationLabel}>Why it is here</span>
              The same engine, run over a change the board is thinking about, before
              the vote rather than after it. One person holding both treasuries sits
              on both sides of every inter-entity transfer, and the transfer screen
              would then have nobody left to be the second approver.
            </p>
          </section>

          <div style={{ marginTop: 16 }}>
            <SodFindingList findings={panel.proposed.findings} nameFor={personName} />
          </div>

          <h2 className={styles.sectionHead}>Assignments this panel was run over</h2>
          <div className={styles.scroller}>
            <table className={styles.table}>
              <caption>
                Role assignments as seeded for this demo. The findings above are
                derived from this table, not stored alongside it.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Seat</th>
                  <th scope="col">Roles held</th>
                </tr>
              </thead>
              <tbody>
                {panel.people.map((person) => (
                  <tr key={person.id}>
                    <th scope="row">
                      {person.name}
                      {person.id === subject.personId ? (
                        <span className={styles.memo}>This is you</span>
                      ) : null}
                    </th>
                    <td className={styles.wrapCell}>{person.seatLabel}</td>
                    <td className={styles.wrapCell}>
                      {person.assignments.map((assignment, index) => (
                        <span key={`${assignment.role}-${assignment.entity}`}>
                          {index > 0 ? ", " : ""}
                          {assignment.role.replace(/_/g, " ")}{" "}
                          <EntityTag entity={assignment.entity} />
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={styles.note}>
            Names and assignments in this build are fictional. The role pattern is
            not: one person carrying a treasury and the store is the arrangement this
            panel was built to surface.
          </p>
        </>
      ) : null}
    </div>
  );
}
