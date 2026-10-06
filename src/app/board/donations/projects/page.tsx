import { ENTITY_LABEL } from "@/lib/donations/kpis";
import { DEV_SWITCHER_PARAM } from "@/lib/donations/devSubject";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import {
  entitiesInScope,
  fundraisingProjects,
  WORKSPACE_ROLE,
} from "@/lib/donations/workspace";
import { LINES_OF_EFFORT, PROJECTS, type Project } from "@/lib/projects/register";
import Chrome from "../Chrome";
import Denied from "../Denied";
import styles from "../donations.module.css";

export const metadata = {
  title: "Fundraising projects — board",
  robots: { index: false, follow: false },
};

function roleLabelOf(role: string): string {
  return role.toLowerCase().replace(/_/g, " ");
}

/**
 * Projects: the lines of effort this role owns and contributes to.
 *
 * A filter over `@/lib/projects/register`, never a copy. There is one
 * org-level register because most of this work crosses roles — the Ball is
 * Events plus Fundraising plus Treasury plus Communications — and a per-role
 * store would hide exactly the handoffs where this organization loses things.
 * So each row names the office accountable and the offices holding a part,
 * including on the two projects this role only contributes to.
 *
 * Nothing here is entity-scoped by authorization: the register holds no
 * financial or member data, only lines of effort the organization publishes.
 * The entity is shown on each row because the line of effort is carried by one
 * entity or the other, and two of the three are the Foundation's.
 */
function ProjectCard({ project }: { project: Project }) {
  const line = LINES_OF_EFFORT[project.lineOfEffort];
  const owned = project.ownerRole === WORKSPACE_ROLE;

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <h3 className={styles.cardTitle}>{project.title}</h3>
        <span className={styles.cardMeta}>
          <span
            className={`${styles.pill} ${
              project.status === "BLOCKED" ? styles.pillWarn : styles.pillHue
            }`}
          >
            {project.status.toLowerCase()}
          </span>{" "}
          <span className={styles.pill}>{ENTITY_LABEL[project.entity]}</span>
        </span>
      </div>
      <p className={styles.sectionNote}>
        {line.title} · {project.targetDate ? `target ${project.targetDate}` : "no target date set"}
      </p>
      <p className={styles.lede}>{project.outcome}</p>
      <p className={styles.sectionNote}>
        {owned ? "This role is accountable." : `Accountable: ${roleLabelOf(project.ownerRole)}.`}{" "}
        {project.contributorRoles.length > 0
          ? `Parts held by ${project.contributorRoles.map(roleLabelOf).join(", ")}.`
          : "No other office holds a part."}
      </p>
      {project.blockedBy && (
        <div className={styles.flag}>
          <span className={styles.flagHead}>Blocked</span>
          <p>{project.blockedBy}</p>
        </div>
      )}
    </article>
  );
}

export default async function FundraisingProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { subject, entity, roleLabel, qs } = await resolveScreenViewer(
    params[DEV_SWITCHER_PARAM],
  );
  const { owned, contributing } = fundraisingProjects();
  // The register is org-level rather than entity-scoped, but it carries the
  // reasons things are stuck, including "owned by an individual no longer
  // involved". That is not for a reader holding no seat.
  const inScope = entitiesInScope(subject).length > 0;

  return (
    <Chrome
      entity={entity}
      roleLabel={roleLabel}
      current="projects"
      qs={qs}
      statusWord="projects"
      title="Lines of effort"
      lede={
        <>
          Filtered from the one org-level register, which is why the offices
          holding the other parts are named on every row. {owned.length +
            contributing.length}{" "}
          of {PROJECTS.length} projects touch fundraising.
        </>
      }
    >
      {!inScope && (
        <Denied
          roleLabel={roleLabel}
          needs="an assignment on the Association or the Foundation"
        />
      )}

      {inScope && (
        <>
          <h2 className={styles.sectionHead}>Fundraising is accountable</h2>
          {owned.length === 0 ? (
            <p className={styles.sectionNote}>Nothing in the register names this role as owner.</p>
          ) : (
            owned.map((project) => <ProjectCard key={project.id} project={project} />)
          )}

          <h2 className={styles.sectionHead}>Fundraising holds a part</h2>
          <p className={styles.sectionNote}>
            Owned elsewhere. The office accountable is named, because this is where
            a handoff gets dropped.
          </p>
          {contributing.length === 0 ? (
            <p className={styles.sectionNote}>
              No other office has recorded fundraising as a contributor.
            </p>
          ) : (
            contributing.map((project) => <ProjectCard key={project.id} project={project} />)
          )}

          <p className={styles.note}>
            The three published lines of effort are the top of this register:{" "}
            {Object.values(LINES_OF_EFFORT)
              .map((line) => line.title.toLowerCase())
              .join("; ")}
            . A project with no target date is shown as having none rather than
            being given one here.
          </p>
        </>
      )}
    </Chrome>
  );
}
