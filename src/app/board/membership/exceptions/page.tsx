import Link from "next/link";

import { AuthzError } from "@/lib/authz/policy";
import { PERSONAS } from "@/lib/authz/personas";
import { DEV_PERSONAS_AVAILABLE } from "@/lib/authz/session";
import {
  daysWaiting,
  eligibleReviewers,
  loadChairQueue,
  stateLabel,
  type ChairQueueView,
} from "@/lib/membership/board";
import { membershipRepository } from "@/lib/membership/repository";
import {
  CATEGORY_LABELS,
  FLAG_LABELS,
  RELATIONSHIP_LABELS,
  UNASSIGNED_FLAG_DAYS,
  type Application,
} from "@/lib/membership/types";

import styles from "../board.module.css";
import { assign, decide } from "../actions";
import { MembershipShell, Refused } from "../shell";
import { currentActor } from "../subject";

export const metadata = {
  title: "Chair exceptions — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The chair exception queue.
 *
 * Everything the vouch could not settle arrives here: a sponsor who declined, a
 * sponsor who did not recognise the name, a window that closed unanswered, a
 * sponsor ID that matched nobody, and every augmentee case regardless of what
 * the sponsor said.
 *
 * Reading the queue needs READ. Deciding in it needs WRITE, so the President
 * and the Secretary can see the queue and cannot decide in it. That is not a
 * technicality: the President holds aggregate only on applicant data precisely
 * so "the President leaned on the committee" cannot happen quietly, and the
 * same reasoning applies here.
 */
export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string; done?: string; show?: string }>;
}) {
  const { refused, done, show } = await searchParams;
  const { subject, label: viewerLabel } = await currentActor();

  let loaded: ChairQueueView | null = null;
  let refusal: string | null = null;
  try {
    loaded = await loadChairQueue(membershipRepository(), subject);
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  const mineOnly = show === "mine";
  const all: Application[] = loaded?.queue ?? [];
  const queue = mineOnly ? all.filter((a) => a.assignedTo === subject.personId) : all;
  const decided: Application[] = loaded?.decided ?? [];
  const stale = new Set(loaded?.staleUnassigned ?? []);
  const mayAssign = loaded?.mayAssign ?? false;
  const reviewers = reviewerOptions();

  return (
    <MembershipShell current="/board/membership/exceptions">
      <h1 className={styles.title}>Chair exceptions</h1>
      <p className={styles.lede}>
        Applications the vouch could not settle. A decline and a &ldquo;I do not know this
        person&rdquo; arrive here the same way, because they are not the same answer and neither
        one is a rejection.
      </p>

      {refusal ? (
        <Refused viewerLabel={viewerLabel} what="the chair exception queue" detail={refusal} />
      ) : (
        <>
          {done && (
            <div className={styles.held}>
              <strong>
                {done === "ASSIGNED" || done === "RELEASED" ? "Assignment recorded" : "Decision recorded"}
              </strong>
              {done === "APPROVED"
                ? "The applicant has a payment link. Dues are the only remaining step."
                : done === "DENIED"
                  ? "The applicant has been told. No payment was taken and none can be."
                  : done === "ASSIGNED"
                    ? "The item is now held by a named person, and who assigned it is in the audit log."
                    : "The item is unheld again. The release is in the audit log with the earlier assignment."}
            </div>
          )}
          {refused && (
            <div className={styles.refused}>
              <p className={styles.refusedTitle}>That decision was refused</p>
              <p className={styles.refusedBody}>
                Nothing was changed. Acting as {viewerLabel}.
              </p>
              <p className={styles.refusedDetail}>{refused}</p>
            </div>
          )}

          <h2 className={styles.sectionHead}>Waiting on the chair</h2>
          <p className={styles.sectionNote}>
            An item nobody holds is shown as unheld rather than as quietly everyone&rsquo;s.
            Anything unheld for {UNASSIGNED_FLAG_DAYS} days or more is marked here, on the
            row, because an aging figure in a report somebody has to open is an aging figure
            nobody reads.
          </p>
          <nav className={styles.filterRow} aria-label="Queue view">
            <Link
              className={mineOnly ? styles.filterLink : styles.filterLinkOn}
              href="/board/membership/exceptions"
            >
              Everything ({all.length})
            </Link>
            <Link
              className={mineOnly ? styles.filterLinkOn : styles.filterLink}
              href="/board/membership/exceptions?show=mine"
            >
              Mine ({loaded?.mine.length ?? 0})
            </Link>
          </nav>
          {queue.length === 0 ? (
            <p className={styles.empty}>
              {mineOnly
                ? "Nothing is assigned to you."
                : "Nothing is waiting on a decision."}
            </p>
          ) : (
            <ul className={styles.rows}>
              {queue.map((application) => (
                <li key={application.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowName}>{application.applicantName}</span>
                    <span className={styles.rowMeta}>
                      {application.reference} &middot; submitted{" "}
                      {(application.submittedAt ?? application.createdAt).slice(0, 10)}
                    </span>
                  </div>
                  <div className={styles.rowFacts}>
                    <span>
                      {application.membershipCategory
                        ? CATEGORY_LABELS[application.membershipCategory]
                        : "no category given"}
                    </span>
                    {application.qualifyingRelationship && (
                      <span>{RELATIONSHIP_LABELS[application.qualifyingRelationship]}</span>
                    )}
                    <span>
                      Sponsor given{" "}
                      <span className={styles.num}>
                        {application.sponsorMemberId || "none"}
                      </span>
                    </span>
                    {application.serviceFrom && (
                      <span className={styles.num}>
                        {application.serviceFrom} to {application.serviceTo ?? "serving"}
                      </span>
                    )}
                  </div>
                  {application.flags.length > 0 && (
                    <ul className={styles.flags}>
                      {application.flags.map((flag) => (
                        <li key={flag} className={styles.flag}>
                          {FLAG_LABELS[flag]}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className={styles.holder}>
                    {application.assignedTo ? (
                      <span className={styles.holderWho}>
                        Held by <span className={styles.num}>{application.assignedTo}</span>
                        {application.assignedAt && (
                          <> since {application.assignedAt.slice(0, 10)}</>
                        )}
                      </span>
                    ) : (
                      <span
                        className={
                          stale.has(application.id) ? styles.holderStale : styles.holderNone
                        }
                      >
                        Unheld
                        {stale.has(application.id) &&
                          ` — ${daysWaiting(application)} days, and nobody has it`}
                      </span>
                    )}
                  </div>

                  {mayAssign && (
                    <form action={assign} className={styles.decide}>
                      <input type="hidden" name="applicationId" value={application.id} />
                      {reviewers.length > 0 ? (
                        <select
                          className={styles.reason}
                          name="reviewerPersonId"
                          aria-label="Give this item to"
                          defaultValue="me"
                        >
                          <option value="me">Take it myself</option>
                          {reviewers.map((reviewer) => (
                            <option key={reviewer.personId} value={reviewer.personId}>
                              {reviewer.label}
                            </option>
                          ))}
                          <option value="">Release it</option>
                        </select>
                      ) : (
                        <select
                          className={styles.reason}
                          name="reviewerPersonId"
                          aria-label="Give this item to"
                          defaultValue="me"
                        >
                          <option value="me">Take it myself</option>
                          <option value="">Release it</option>
                        </select>
                      )}
                      <button className={styles.approve} type="submit">
                        Record who holds this
                      </button>
                    </form>
                  )}

                  <form action={decide} className={styles.decide}>
                    <input type="hidden" name="applicationId" value={application.id} />
                    <input
                      className={styles.reason}
                      name="reason"
                      placeholder="What you decided and why. Kept on the record."
                      aria-label="Reason"
                    />
                    <button className={styles.approve} name="outcome" value="APPROVED" type="submit">
                      Approve and ask for dues
                    </button>
                    <button className={styles.deny} name="outcome" value="DENIED" type="submit">
                      Decline the application
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <h2 className={styles.sectionHead}>Declined</h2>
          <p className={styles.sectionNote}>
            No payment was taken from any of these. There is no state in which this platform
            holds money for an application that was refused.
          </p>
          {decided.length === 0 ? (
            <p className={styles.empty}>Nothing has been declined.</p>
          ) : (
            <ul className={styles.rows}>
              {decided.map((application) => (
                <li key={application.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <span className={styles.rowName}>{application.applicantName}</span>
                    <span className={styles.rowMeta}>{stateLabel(application.state)}</span>
                  </div>
                  {application.chairDecision && (
                    <div className={styles.rowFacts}>
                      <span>{application.chairDecision.reason}</span>
                      <span className={styles.num}>
                        {application.chairDecision.at.slice(0, 10)} &middot;{" "}
                        {application.chairDecision.chairPersonId}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className={styles.note}>
            Approving moves the application to awaiting dues. Declining closes it. There is no
            revoke control anywhere in this module: NC&rsquo;s nonprofit statute sets no notice
            period and no hearing requirement for expulsion, so what a revocation means for
            this organization comes from the bylaws and the bylaws have not said yet.
          </p>

          <p className={styles.note}>
            Who an item may be given to is computed from the role table: anybody holding
            member records at read or better on the Association. Today that is a short list,
            because one role holds the write. Whether a membership committee exists is a
            board decision and the grants are the President&rsquo;s to make &mdash; this
            screen will offer whoever holds the grant, and does not keep a list of its own.
            Reassignment replaces who holds an item and overwrites nothing: every assignment
            and release is a row in the append-only membership audit log.
          </p>
        </>
      )}
    </MembershipShell>
  );
}

/**
 * Who this screen can offer an item to.
 *
 * Where the dev persona switcher exists, the personas filtered through
 * `eligibleReviewers`, which reads the role table rather than naming roles
 * here. Where it does not — a real session against a real database — the
 * answer is an empty list and the control offers "take it myself" and
 * "release it" only.
 *
 * That is a gap and it is named rather than papered over: offering a named
 * colleague requires reading people by role out of the identity tables, and
 * there is no such read in `src/lib/auth/store.ts`. This module must not grow
 * a directory of people of its own, so it waits on the identity lane.
 */
function reviewerOptions(): { personId: string; label: string }[] {
  if (!DEV_PERSONAS_AVAILABLE) return [];
  return eligibleReviewers(
    PERSONAS.map((persona) => ({
      personId: `dev:${persona.id}`,
      label: persona.label,
      assignments: persona.assignments,
    })),
  ).map(({ personId, label }) => ({ personId, label }));
}
