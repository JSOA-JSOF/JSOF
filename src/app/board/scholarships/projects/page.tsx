import Link from "next/link";

import { AuthzError } from "@/lib/authz/policy";
import { LINES_OF_EFFORT } from "@/lib/projects/register";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { getCurrentSubject } from "@/lib/authz/session";
import {
  loadScholarshipsProjects,
  type ProjectHolding,
} from "@/lib/scholarships/workspace";

import styles from "../workspace.module.css";

export const metadata = {
  title: "Projects — Scholarships",
  robots: { index: false, follow: false },
};

/**
 * Projects: this role's slice of the one org-level register.
 *
 * A filter over `@/lib/projects/register`, never a copy. Nothing on this
 * screen is stored in the scholarships module, which is why a line of effort
 * that the President unblocks stops being blocked here without anyone editing
 * this module.
 *
 * Blocked work is first and marked, because a blocked line of effort with its
 * blocker named is the useful content — and two of this role's three are
 * blocked, one of them on a decision that is not hers to make. Every other
 * role with a part in a project is named by office, so the handoff is visible
 * rather than discovered.
 */

function Holding({ holding }: { holding: ProjectHolding }) {
  const { project, stake, otherRoles } = holding;
  const line = LINES_OF_EFFORT[project.lineOfEffort];
  const blocked = project.status === "BLOCKED";

  return (
    <article
      className={`${styles.project} ${blocked ? styles.projectBlocked : ""}`}
    >
      <div className={styles.projectHead}>
        <span className={styles.projectTitle}>{project.title}</span>
        <span className={styles.projectTags}>
          <span className={`${styles.tag} ${styles.tagStake}`}>
            {stake === "OWNS" ? "Yours" : "You hold a part"}
          </span>
          <span className={styles.tag}>{project.status.toLowerCase()}</span>
          <span className={styles.tag}>{project.entity}</span>
        </span>
      </div>

      <p className={styles.projectOutcome}>{project.outcome}</p>

      {project.blockedBy ? (
        <p className={styles.blockedBy}>
          <strong>Blocked:</strong> {project.blockedBy}
        </p>
      ) : null}

      <div className={styles.holders}>
        <span>{line.title}</span>
        <span className={styles.target}>
          {project.targetDate ? `target ${project.targetDate}` : "no target set"}
        </span>
        {otherRoles.length === 0 ? (
          <span>No other office holds a part of this.</span>
        ) : (
          <>
            <span>Also held by</span>
            {otherRoles.map((other) => (
              <span
                key={other.role}
                className={`${styles.holder} ${
                  other.accountable ? styles.holderAccountable : ""
                }`}
              >
                {other.label}
                {other.accountable ? " · accountable" : ""}
              </span>
            ))}
          </>
        )}
      </div>
    </article>
  );
}

export default async function ScholarshipsProjects() {
  const subject = await getCurrentSubject();

  let projects: Awaited<ReturnType<typeof loadScholarshipsProjects>> | null = null;
  let denial: string | null = null;
  try {
    projects = await loadScholarshipsProjects(scholarshipRepository(), subject);
  } catch (error) {
    denial = error instanceof AuthzError ? error.message : String(error);
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>Lines of effort</h1>
        <p className={styles.lede}>
          Filtered from the organization&rsquo;s one register of lines of
          effort. What this seat is accountable for, what it holds a part of,
          and which office holds the rest. Nothing here is a scholarships copy
          of the register, so a change made anywhere shows up here.
        </p>
      </div>

      {denial ? (
        <div className={styles.withheld}>
          <p className={styles.withheldWhy}>{denial}</p>
          <p className={styles.note}>
            Withheld rather than empty. The register names what is blocked and
            why, including the eligibility rule with counsel and the
            unconfirmed award amount, and it is a board seat&rsquo;s view of
            what it is accountable for. If you are scoring, your work is on{" "}
            <Link href="/board/scholarships/review">Review</Link>.
          </p>
        </div>
      ) : projects ? (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Blocked ({projects.blocked.length})
            </h2>
            {projects.blocked.length === 0 ? (
              <p className={styles.note}>Nothing of this role&rsquo;s is blocked.</p>
            ) : (
              <div className={styles.projects}>
                {projects.blocked.map((holding) => (
                  <Holding key={holding.project.id} holding={holding} />
                ))}
              </div>
            )}
            <p className={styles.note}>
              A blocker is stated as the register holds it, including when it is
              another office&rsquo;s to clear. Marking one resolved here would
              be editing a record that is not this module&rsquo;s.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              Running ({projects.running.length})
            </h2>
            {projects.running.length === 0 ? (
              <p className={styles.note}>
                Nothing of this role&rsquo;s is running, which with two blocked
                lines of effort is the finding rather than the gap.
              </p>
            ) : (
              <div className={styles.projects}>
                {projects.running.map((holding) => (
                  <Holding key={holding.project.id} holding={holding} />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
