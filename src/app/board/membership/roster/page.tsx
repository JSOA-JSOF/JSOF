import Link from "next/link";

import { AuthzError, can } from "@/lib/authz/policy";
import { loadMembershipAudit, loadRoster, stateLabel, type RosterView } from "@/lib/membership/board";
import { membershipRepository } from "@/lib/membership/repository";
import { MEMBERSHIP_STATES } from "@/lib/membership/state";
import {
  CATEGORY_LABELS,
  MEMBERSHIP_CATEGORIES,
  MEMBERSHIP_ENTITY,
  type MembershipAuditEntry,
} from "@/lib/membership/types";

import styles from "../board.module.css";
import { correctContact, filterRoster } from "../actions";
import { readRosterFilter } from "../filter";
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
export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string; done?: string; fix?: string }>;
}) {
  const { refused, done, fix } = await searchParams;
  const { subject, label: viewerLabel } = await currentActor();
  const repo = membershipRepository();
  const filter = await readRosterFilter();

  let roster: RosterView | null = null;
  let refusal: string | null = null;
  try {
    roster = await loadRoster(repo, subject, filter);
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  const log = await loadMembershipAudit(repo, subject, 14);
  const mayCorrect = can({
    subject,
    dataClass: "MEMBER_PII",
    entity: MEMBERSHIP_ENTITY,
    required: "WRITE",
  });
  const filtered =
    Boolean(filter.q) ||
    filter.state !== null ||
    filter.category !== null ||
    Boolean(filter.sponsorMemberId);
  const correcting = roster?.members.find((m) => m.id === fix) ?? null;

  return (
    <MembershipShell current="/board/membership/roster">
      <h1 className={styles.title}>Roster</h1>
      <p className={styles.lede}>
        Every member record on the Association. Opening this page is logged against your name.
      </p>

      {refusal || !roster ? (
        <Refused viewerLabel={viewerLabel} what="the roster" detail={refusal ?? undefined} />
      ) : (
        <>
          <form action={filterRoster} className={styles.search}>
            <label className={styles.searchField}>
              <span className={styles.searchLabel}>Find somebody</span>
              <input
                className={styles.searchInput}
                name="q"
                defaultValue={filter.q}
                placeholder="Part of a name, a member number, or an email"
              />
            </label>
            <label className={styles.searchField}>
              <span className={styles.searchLabel}>Standing</span>
              <select className={styles.searchInput} name="state" defaultValue={filter.state ?? ""}>
                <option value="">Any</option>
                {MEMBERSHIP_STATES.map((state) => (
                  <option key={state} value={state}>
                    {stateLabel(state)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.searchField}>
              <span className={styles.searchLabel}>Category</span>
              <select
                className={styles.searchInput}
                name="category"
                defaultValue={filter.category ?? ""}
              >
                <option value="">Any</option>
                {MEMBERSHIP_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.searchField}>
              <span className={styles.searchLabel}>Sponsor</span>
              <select
                className={styles.searchInput}
                name="sponsorMemberId"
                defaultValue={filter.sponsorMemberId ?? ""}
              >
                <option value="">Any</option>
                {roster.sponsorMemberIds.map((sponsor) => (
                  <option key={sponsor} value={sponsor}>
                    {sponsor}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.searchActions}>
              <button className={styles.approve} type="submit">
                Narrow the list
              </button>
              <button className={styles.deny} name="clear" value="yes" type="submit">
                Clear
              </button>
            </div>
          </form>

          {done === "CONTACT" && (
            <div className={styles.held}>
              <strong>Contact details corrected</strong>
              The change and the reason you gave are in the audit log. If the email address
              changed, a notice has gone to the address we held before it.
            </div>
          )}
          {refused && (
            <div className={styles.refused}>
              <p className={styles.refusedTitle}>That correction was refused</p>
              <p className={styles.refusedBody}>
                Nothing was changed. Acting as {viewerLabel}.
              </p>
              <p className={styles.refusedDetail}>{refused}</p>
            </div>
          )}

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
              <span className={styles.summaryLabel}>
                {filtered ? "Shown of all records" : "Records in all"}
              </span>
              <span className={styles.summaryValue}>
                {filtered ? `${roster.members.length} of ${roster.total}` : roster.total}
              </span>
            </span>
          </div>

          {filtered && (
            <p className={styles.sectionNote}>
              This list is narrowed. {roster.members.length} of {roster.total} records are
              shown, and somebody missing from it may simply be filtered out rather than
              absent from the roster. Clear the filter before concluding anybody is not a
              member.
            </p>
          )}

          {correcting && mayCorrect && (
            <form action={correctContact} className={styles.correct}>
              <input type="hidden" name="memberId" value={correcting.id} />
              <p className={styles.correctHead}>
                Correct the contact details for{" "}
                <span className={styles.num}>{correcting.memberId}</span>,{" "}
                {correcting.displayName}
              </p>
              <label className={styles.searchField}>
                <span className={styles.searchLabel}>Email</span>
                <input
                  className={styles.searchInput}
                  name="email"
                  type="email"
                  defaultValue={correcting.email}
                />
              </label>
              <label className={styles.searchField}>
                <span className={styles.searchLabel}>Phone</span>
                <input
                  className={styles.searchInput}
                  name="phone"
                  defaultValue={correcting.phone}
                />
              </label>
              <label className={styles.searchField}>
                <span className={styles.searchLabel}>Why</span>
                <input
                  className={styles.searchInput}
                  name="reason"
                  placeholder="Kept on the record. Say how you know."
                />
              </label>
              <div className={styles.searchActions}>
                <button className={styles.approve} type="submit">
                  Record the correction
                </button>
              </div>
              <p className={styles.note}>
                Only these two fields. Name, category, service dates, standing and sponsor are
                the compliance fields the composition report counts and they move with a
                decision behind them, not from here. Changing the email address also changes
                the sign-in address, in one transaction, and sends a notice to the address
                being replaced. Never act on an emailed request to change an email address:
                telephone the member first.
              </p>
            </form>
          )}

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
                  <th scope="col">Account</th>
                  {mayCorrect && <th scope="col">Contact</th>}
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
                    <td className={member.personId ? undefined : styles.off}>
                      {member.personId ? "linked" : "none"}
                    </td>
                    {mayCorrect && (
                      <td>
                        <Link
                          className={styles.rowLink}
                          href={`/board/membership/roster?fix=${encodeURIComponent(member.id)}`}
                        >
                          Correct
                        </Link>
                      </td>
                    )}
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

          <p className={styles.note}>
            A search that matches nothing and a search that matches everything write the same
            audit entry, and neither records what was typed. The log says the roster was
            opened, because that is the fact that matters here &mdash; a log of who the office
            searched for would be a second, searchable record of the same people, and a worse
            thing to hold than the roster. The search term is not in the address bar either,
            for the same reason.
          </p>

          <p className={styles.note}>
            The account column says whether a member can sign in. A record shows{" "}
            <em>none</em> where no identity is linked, which is every record imported from
            Submittable: those accounts are an invitation somebody has to send, not something
            this screen can assert. Members created through the dues payment are linked when
            their payment clears.
          </p>

          <p className={styles.note}>
            Filtering by sponsor does not mean the sponsor is current. The sponsor is held as
            the member number written on the record; it may now be lapsed, revoked, or not
            resolve at all after the import.
          </p>

          <p className={styles.note}>
            There is no export. A spreadsheet of this list is the single
            highest-consequence file this platform could produce, so whether one exists is a
            board decision with its own audit entry and probably a second approver, not a
            button somebody adds.
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
