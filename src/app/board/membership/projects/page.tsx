import { AuthzError } from "@/lib/authz/policy";
import { LINES_OF_EFFORT, type Project } from "@/lib/projects/register";
import { membershipRepository } from "@/lib/membership/repository";
import {
  guardWorkspaceRead,
  membershipProjects,
  PROJECTS_PROVENANCE,
} from "@/lib/membership/workspace";

import styles from "../board.module.css";
import { MembershipShell, Refused } from "../shell";
import { currentActor } from "../subject";

export const metadata = {
  title: "Membership lines of effort — JSOA board",
  robots: { index: false, follow: false },
};

function roleLabel(role: string): string {
  return role.toLowerCase().replace(/_/g, " ");
}

/**
 * This role's slice of the one lines-of-effort register.
 *
 * A filter, never a copy. Most of this organization's work crosses roles and a
 * per-role store would hide exactly the handoffs where things get lost — so
 * what is interesting on this tab is not the projects, it is the other offices
 * named beside them.
 *
 * VP Membership owns none of the published lines of effort, and that is the
 * honest answer rather than a missing one: this office supplies the record that
 * the scholarship cycle keys off, and the cycle belongs to the Scholarships
 * Chair. The tab says so instead of showing an empty box.
 */
export default async function MembershipProjectsPage() {
  const { persona, subject } = await currentActor();

  let refusal: string | null = null;
  try {
    await guardWorkspaceRead(membershipRepository(), subject, "READ_MEMBERSHIP_PROJECTS");
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  const { owned, contributing } = membershipProjects();

  return (
    <MembershipShell current="projects">
      <h1 className={styles.title}>Lines of effort</h1>
      <p className={styles.lede}>
        What the membership office owns, and what it holds a part of. The three published lines
        of effort are the top of the register: {LINES_OF_EFFORT.MEMORIAL.title.toLowerCase()},{" "}
        {LINES_OF_EFFORT.SCHOLARSHIPS.title.toLowerCase()}, and{" "}
        {LINES_OF_EFFORT.FAMILY_EVENTS.title.toLowerCase()}.
      </p>

      {refusal ? (
        <Refused persona={persona} what="this role's lines of effort" detail={refusal} />
      ) : (
        <>
          <h2 className={styles.sectionHead}>Owned by this office</h2>
          {owned.length === 0 ? (
            <p className={styles.empty}>
              None. The membership office carries no line of effort of its own in the register,
              which is correct rather than missing: what it produces is the roster, and the
              roster is the input other lines of effort depend on rather than a project with an
              end state.
            </p>
          ) : (
            <ul className={styles.rows}>
              {owned.map((project) => (
                <ProjectRow key={project.id} project={project} />
              ))}
            </ul>
          )}

          <h2 className={styles.sectionHead}>Holding a part of</h2>
          <p className={styles.sectionNote}>
            Someone else is accountable for each of these. The office named is where the rest
            of it sits, which is the handoff to watch.
          </p>
          {contributing.length === 0 ? (
            <p className={styles.empty}>
              Nothing in the register names this office as a contributor.
            </p>
          ) : (
            <ul className={styles.rows}>
              {contributing.map((project) => (
                <ProjectRow key={project.id} project={project} showOwner />
              ))}
            </ul>
          )}

          <p className={styles.note}>{PROJECTS_PROVENANCE}</p>
        </>
      )}
    </MembershipShell>
  );
}

function ProjectRow({ project, showOwner }: { project: Project; showOwner?: boolean }) {
  return (
    <li className={`${styles.row} ${project.status === "BLOCKED" ? styles.rowDue : ""}`}>
      <div className={styles.rowHead}>
        <span className={styles.rowName}>{project.title}</span>
        <span className={styles.rowMeta}>
          {project.status.toLowerCase()} &middot; {project.entity} &middot;{" "}
          {project.targetDate ?? "no target date set"}
        </span>
      </div>
      <div className={styles.rowFacts}>
        <span>{LINES_OF_EFFORT[project.lineOfEffort].title}</span>
        {showOwner && <span>Accountable: {roleLabel(project.ownerRole)}</span>}
      </div>
      <p className={styles.tierDetail}>{project.outcome}</p>
      {project.blockedBy && (
        <ul className={styles.findings}>
          <li>{project.blockedBy}</li>
        </ul>
      )}
      {project.contributorRoles.length > 0 && (
        <div className={styles.rowFacts}>
          <span>
            Also held by: {project.contributorRoles.map(roleLabel).join(", ")}
          </span>
        </div>
      )}
    </li>
  );
}
