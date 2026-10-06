import { LINES_OF_EFFORT, type Project } from "@/lib/projects/register";
import { FICTIONAL_DATA_NOTE, ROLE_LABELS, treasurerProjects } from "@/lib/treasury/workspace";

import { ENTITY_LABELS, EntityTag, TreasuryHeader, entityClass } from "../_components/chrome";
import styles from "../treasury.module.css";

export const metadata = {
  title: "Projects — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<Project["status"], string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  BLOCKED: "Blocked",
  DONE: "Done",
};

/**
 * Lines of effort, filtered to the Treasurer.
 *
 * A FILTER over the one org-level register in `@/lib/projects`, never a copy.
 * Most of this work crosses roles — the Ball is Events plus Fundraising plus
 * Treasury plus Communications — and a per-role store would hide exactly the
 * handoffs where this organization loses things. If treasury ever grows its
 * own project list, that list will drift from the real one inside a cycle.
 *
 * The Treasurer owns nothing here and contributes to almost everything, which
 * is the honest shape of a treasury rather than a gap in the data: the money
 * is a part of somebody else's project nearly every time. So this tab leads
 * with who holds the other parts, because that is the thing a Treasurer
 * actually needs off this screen.
 *
 * No authorization gate: the register holds no money and no personal data,
 * only titles, owning offices and target dates, and every board role can see
 * the whole thing. Nothing here is read per entity, so there is no figure to
 * blend.
 */
export default function TreasuryProjectsPage() {
  const { owned, contributing } = treasurerProjects();

  return (
    <div>
      <TreasuryHeader
        current="projects"
        title="Lines of effort"
        lede={
          "The organization's one register, filtered to what the Treasurer owns and " +
          "what the Treasurer holds a part of. Not a treasury copy: a project moved " +
          "or finished by the office that owns it moves and finishes here."
        }
      />

      <h2 className={styles.sectionHead}>
        Owned by the Treasurer{owned.length > 0 ? ` · ${owned.length}` : ""}
      </h2>

      {owned.length === 0 ? (
        <p className={styles.note}>
          The Treasurer owns none of the organization&rsquo;s lines of effort, and
          that is correct rather than missing. Treasury is a part of other
          people&rsquo;s projects: the ticket price, the cheque, the sales tax
          question, the second signature. An owned column invented to fill this space
          would be a second source of truth about work somebody else is accountable
          for.
        </p>
      ) : (
        <ProjectList projects={owned} highlight="owner" />
      )}

      <h2 className={styles.sectionHead}>
        The Treasurer holds a part · {contributing.length}
      </h2>
      <p className={styles.note}>
        Who holds the other parts is the useful column here. These are the handoffs
        where things get lost, and the accountable office is named rather than a
        person, because offices turn over and duties do not.
      </p>

      <ProjectList projects={contributing} highlight="contributor" />

      <h2 className={styles.sectionHead}>The three published lines of effort</h2>
      <p className={styles.note}>
        The top of the register, and the organization&rsquo;s own words:{" "}
        {Object.entries(LINES_OF_EFFORT)
          .map(
            ([, line]) =>
              `${line.title.toLowerCase()} (${ENTITY_LABELS[line.carriedBy].short})`,
          )
          .join("; ")}
        . A project sits under one of them or it is not a line of effort.
      </p>

      <p className={styles.note}>{FICTIONAL_DATA_NOTE}</p>
    </div>
  );
}

function ProjectList({
  projects,
  highlight,
}: {
  projects: Project[];
  highlight: "owner" | "contributor";
}) {
  if (projects.length === 0) {
    return <p className={styles.note}>Nothing on the register in this column.</p>;
  }

  return (
    <ul className={styles.rules}>
      {[...projects]
        .sort(
          (a, b) =>
            statusRank(a.status) - statusRank(b.status) ||
            (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") ||
            a.title.localeCompare(b.title),
        )
        .map((project) => {
          /* The accountable office is already named above, so this lists only
             the OTHER parts: the handoffs. Repeating the owner here made
             "Accountable: Scholarships Chair / Other parts held by
             Scholarships Chair" on every single-contributor project. */
          const others = project.contributorRoles.filter((role) => role !== "TREASURER");
          return (
            <li
              key={project.id}
              className={`${entityClass(project.entity)} ${styles.rule}`}
            >
              <span
                className={`${styles.ruleState} ${
                  project.status === "BLOCKED" ? styles.ruleStateUnmet : styles.ruleStateMet
                }`}
              >
                {STATUS_LABELS[project.status].toLowerCase()}
              </span>
              <span className={styles.ruleRequirement}>
                {project.title}
                <span className={styles.ruleSource}>
                  <EntityTag entity={project.entity} />{" "}
                  {LINES_OF_EFFORT[project.lineOfEffort].title} ·{" "}
                  {highlight === "contributor"
                    ? `Accountable: ${ROLE_LABELS[project.ownerRole]}`
                    : `Accountable: Treasurer`}
                  {project.targetDate ? ` · target ${project.targetDate}` : " · no target date set"}
                </span>
              </span>
              <p className={styles.ruleWhy}>
                {project.outcome}
                {project.blockedBy ? (
                  <>
                    {" "}
                    <strong>Blocked:</strong> {project.blockedBy}
                  </>
                ) : null}
                {others.length > 0 ? (
                  <>
                    {" "}
                    <span className={styles.quiet}>
                      {others.length === 1 ? "Other part held by " : "Other parts held by "}
                      {others.map((role) => ROLE_LABELS[role]).join(", ")}.
                    </span>
                  </>
                ) : null}
              </p>
            </li>
          );
        })}
    </ul>
  );
}

function statusRank(status: Project["status"]): number {
  return { BLOCKED: 0, ACTIVE: 1, PLANNED: 2, DONE: 3 }[status];
}
