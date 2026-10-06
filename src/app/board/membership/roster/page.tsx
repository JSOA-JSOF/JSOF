import { AuthzError } from "@/lib/authz/policy";
import { loadMembershipAudit, loadRoster, stateLabel, type RosterView } from "@/lib/membership/board";
import { membershipRepository } from "@/lib/membership/repository";
import type { MembershipAuditEntry } from "@/lib/membership/types";

import styles from "../board.module.css";
import { MembershipShell, Refused } from "../shell";
import { currentActor } from "../subject";

export const metadata = {
  title: "Roster — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The roster.
 *
 * MEMBER_PII at READ, row level, and the read is written to the audit log
 * before a single name is rendered. For this organization who opened the
 * roster matters more than who edited it, which is why the log records reads
 * and not only writes.
 *
 * Roles holding AGGREGATE are refused here and can still open the composition
 * report, which is the whole reason the report was built to need only
 * aggregate.
 *
 * Nothing on this page may ever appear on a public-tier page. There is no
 * rank field and no unit field on the record at all: neither traces to a
 * workflow in the spec, and a field that exists is a field that leaks.
 */
export default async function RosterPage() {
  const { persona, subject } = await currentActor();
  const repo = membershipRepository();

  let roster: RosterView | null = null;
  let refusal: string | null = null;
  try {
    roster = await loadRoster(repo, subject);
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  const log = await loadMembershipAudit(repo, subject, 14);

  return (
    <MembershipShell current="/board/membership/roster">
      <h1 className={styles.title}>Roster</h1>
      <p className={styles.lede}>
        Every member record on the Association. Opening this page is logged against your name.
      </p>

      {refusal || !roster ? (
        <Refused persona={persona} what="the roster" detail={refusal ?? undefined} />
      ) : (
        <>
          <div className={styles.summary}>
            <span className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Counted members</span>
              <span className={styles.summaryValue}>{roster.counted}</span>
            </span>
            <span className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Lapsed or revoked</span>
              <span className={styles.summaryValue}>{roster.offRoster}</span>
            </span>
            <span className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Records in all</span>
              <span className={styles.summaryValue}>{roster.members.length}</span>
            </span>
          </div>

          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Member ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">Category</th>
                  <th scope="col">Service</th>
                  <th scope="col">War veteran</th>
                  <th scope="col">Attested</th>
                  <th scope="col">Standing</th>
                  <th scope="col">Sponsor</th>
                </tr>
              </thead>
              <tbody>
                {roster.members.map((member) => (
                  <tr key={member.id} className={member.state === "GOOD_STANDING" ? "" : styles.off}>
                    <td className={styles.num}>{member.memberId}</td>
                    <td>{member.displayName}</td>
                    <td>{member.membershipCategory === "QUALIFYING_RELATIVE" && member.qualifyingRelationship ? `relative, ${member.qualifyingRelationship.toLowerCase().replace(/_/g, " ")}` : member.membershipCategory.toLowerCase().replace(/_/g, " ")}</td>
                    <td className={styles.num}>
                      {member.serviceFrom
                        ? `${member.serviceFrom} to ${member.serviceTo ?? "serving"}`
                        : "none recorded"}
                    </td>
                    <td>{member.isWarVeteran ? "yes" : "no"}</td>
                    <td className={member.attestedWarVeteran === member.isWarVeteran ? "" : styles.off}>
                      {member.attestedWarVeteran === member.isWarVeteran
                        ? "matches"
                        : "disagrees"}
                    </td>
                    <td>{stateLabel(member.state)}</td>
                    <td className={styles.num}>{member.sponsorMemberId ?? "founding"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={styles.note}>
            The war-veteran column is derived from the attested service dates, not copied from
            the applicant&rsquo;s checkbox. Where the two disagree the record is marked and the
            count appears on the composition report. A disagreement is a record to fix, not a
            number to adjust.
          </p>
        </>
      )}

      {log.length > 0 && (
        <>
          <h2 className={styles.sectionHead}>Recent access to member data</h2>
          <p className={styles.sectionNote}>
            Append-only. There is no delete path in the code and the interface offers no method
            for one. Refusals are recorded as well as reads.
          </p>
          <ul className={styles.log}>
            {log.map((entry: MembershipAuditEntry) => (
              <li
                key={entry.id}
                className={entry.action.endsWith(":DENIED") ? styles.logDenied : undefined}
              >
                <span>{entry.at.slice(0, 19).replace("T", " ")}Z</span>
                <span>{entry.personId}</span>
                <span>{entry.action}</span>
                <span>{entry.rowLevel ? "row level" : "aggregate"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </MembershipShell>
  );
}
