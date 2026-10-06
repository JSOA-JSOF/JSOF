import { ENTITIES } from "@/lib/authz/model";
import { getCurrentPersona, getCurrentSubject } from "@/lib/authz/session";
import { readableEntities } from "@/lib/meetings/access";
import { roleLabel } from "@/lib/meetings/distribution";
import { secretaryProjects } from "@/lib/meetings/workspace";
import { LINES_OF_EFFORT, type Project, type ProjectStatus } from "@/lib/projects/register";
import { Refused, Shell, hueFor } from "../Shell";
import styles from "../meetings.module.css";

export const metadata = { title: "Projects — Secretary" };

const STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  BLOCKED: "Blocked",
  DONE: "Done",
};

function ProjectRow({ project }: { project: Project }) {
  return (
    <li>
      <div className={styles.rowHead}>
        <span className={styles.rowTitle}>{project.title}</span>
        <span className={styles.rowFigure}>
          {project.targetDate ?? "no target date set"}
        </span>
      </div>
      <div className={styles.chipRow}>
        <span className={`${styles.chip} ${styles.chipHue}`}>{project.entity}</span>
        <span
          className={
            project.status === "BLOCKED"
              ? `${styles.chip} ${styles.chipWarn}`
              : styles.chip
          }
        >
          {STATUS_LABEL[project.status]}
        </span>
        <span className={styles.chip}>
          {LINES_OF_EFFORT[project.lineOfEffort].title}
        </span>
      </div>
      <p className={styles.rowNote}>{project.outcome}</p>
      {project.blockedBy && (
        <p className={styles.rowNote}>
          <span className={styles.rowMeta}>Blocked by</span> {project.blockedBy}
        </p>
      )}
      <p className={styles.rowNote}>
        <span className={styles.rowMeta}>Accountable</span>{" "}
        {roleLabel(project.ownerRole)}
        {project.contributorRoles.length > 0 && (
          <>
            {" "}
            &middot; <span className={styles.rowMeta}>Holds a part</span>{" "}
            {project.contributorRoles.map((role) => roleLabel(role)).join(", ")}
          </>
        )}
      </p>
    </li>
  );
}

/**
 * The Projects tab: the one org-level register of lines of effort, filtered to
 * this office.
 *
 * A filter and not a copy. `src/lib/projects/register.ts` is the single
 * register and this screen selects from it; a per-role store would be a second
 * source of truth and would hide exactly the handoffs where this organization
 * loses things. Most of this work crosses roles, so each row names the office
 * accountable and the offices holding a part.
 */
export default async function SecretaryProjectsTab() {
  const persona = await getCurrentPersona();
  const subject = await getCurrentSubject();
  const visible = readableEntities(subject, ENTITIES);
  const projects = secretaryProjects(subject);

  if (visible.length === 0) {
    return (
      <Shell entity={null} meetingId={null} active="projects" persona={persona}>
        <p className={styles.eyebrow}>Secretary &middot; Projects</p>
        <h1 className={styles.title}>Lines of effort this office carries</h1>
        <Refused
          reason={`${persona.label} holds no board grant on member data for either entity. The register names roles, outcomes and dates and carries no figures, but which lines of effort the board is running and which of them are stuck is board-tier information. The whole register is withheld, which is not the same as this office holding nothing.`}
        />
      </Shell>
    );
  }

  return (
    <Shell entity={null} meetingId={null} active="projects" persona={persona}>
      <p className={styles.eyebrow}>Secretary &middot; Projects</p>
      <h1 className={styles.title}>Lines of effort this office carries</h1>
      <p className={styles.lede}>
        Filtered from the one register the whole board shares, never copied into
        this screen. The three published lines of effort are at the top of that
        register: memorialize the fallen, scholarships and grants for JSOC
        families, support JSOC family events. This office holds a part of some
        of that work and is accountable for none of it, which is what the lists
        below say rather than hide.
      </p>
      <p className={styles.rowMeta}>
        {projects.owned.length + projects.contributing.length} of{" "}
        {projects.registerSize} entries in the shared register touch this office
      </p>

      <h2 className={styles.sectionHead}>Accountable for</h2>
      {projects.owned.length === 0 ? (
        <p className={styles.sectionNote}>
          Nothing. No line of effort in the register is owned by this office,
          and that is right rather than a gap: the Secretary&rsquo;s work is the
          record of how the board decided, which is a standing duty rather than
          a project with an outcome and a target date. An entry invented here to
          make the list non-empty would be the kind of busywork that makes a
          register nobody checks.
        </p>
      ) : (
        <ul className={styles.list}>
          {projects.owned.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      )}

      <h2 className={styles.sectionHead}>Holds a part of</h2>
      {projects.contributing.length === 0 ? (
        <p className={styles.sectionNote}>
          Nothing in the register lists this office as a contributor within the
          entities this role can see.
        </p>
      ) : (
        <>
          <p className={styles.sectionNote}>
            Someone else is accountable for each of these and this office owns a
            piece. The handoff is the part that gets lost, so the office
            accountable is named on every row.
          </p>
          <ul className={styles.list}>
            {projects.contributing.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </ul>
        </>
      )}

      {projects.withheld.length > 0 && (
        <div className={styles.quiet}>
          {projects.withheld.join(" and ")} is withheld from this role, so any
          line of effort carried by {projects.withheld.length === 1 ? "it" : "them"}{" "}
          is absent from these lists rather than shown as none.
        </div>
      )}
    </Shell>
  );
}
