import Link from "next/link";

import { getCurrentSubject } from "@/lib/authz/session";
import { storeProjects } from "@/lib/store/workspace";
import type { Project } from "@/lib/projects/register";

import styles from "../board.module.css";
import { StoreHeader, StoreScreen, StoreSodWarning } from "../parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Store projects — JSOA board",
  robots: { index: false, follow: false },
};

function roleWords(role: string): string {
  return role.toLowerCase().replace(/_/g, " ");
}

function ProjectRow({ project }: { project: Project }) {
  return (
    <li className={styles.planItem}>
      <div className={styles.planHead}>
        <h3 className={styles.planTitle}>{project.title}</h3>
        <span className={styles.planMeta}>
          <span
            className={`${styles.chip} ${
              project.status === "BLOCKED" ? styles.chipWarn : styles.chipHue
            }`}
          >
            {project.status.toLowerCase()}
          </span>
          <span className={styles.chip}>{project.entity}</span>
          <span className={styles.chip}>
            {project.targetDate ?? "no target date"}
          </span>
        </span>
      </div>
      <p className={styles.planReason}>{project.outcome}</p>
      <p className={styles.planStatus}>
        Accountable: {roleWords(project.ownerRole)}
        {project.contributorRoles.length > 0 ? (
          <>
            {" · also held by "}
            {project.contributorRoles.map(roleWords).join(", ")}
          </>
        ) : null}
      </p>
      {project.blockedBy ? (
        <p className={styles.planStatus}>Blocked: {project.blockedBy}</p>
      ) : null}
    </li>
  );
}

/**
 * Lines of effort, filtered from the one org-level register.
 *
 * `storeProjects` filters `@/lib/projects/register`. It is not a copy and
 * there is no store-local project store, which is the rule
 * `docs/ROLE-WORKSPACE.md` is built on: most of this work crosses roles, and a
 * per-role silo would hide exactly the handoffs where this organization loses
 * things.
 *
 * The filter's honest answer today is that this role OWNS nothing. That is
 * stated rather than papered over with an empty panel, because it is a real
 * finding: the two questions the store most needs settled are Planning items
 * nobody has raised as a line of effort, and the one project the store holds a
 * part of is somebody else's.
 *
 * No `authorize()` call: the register carries no protected data class. It
 * holds titles, owning offices and outcomes, with no money, no member and no
 * applicant in it. Demanding a financial grant to read it would be widening
 * the grant to make a tab work, backwards.
 */
export default async function StoreProjects() {
  const subject = await getCurrentSubject();
  const { owned, contributing, linesTouched } = storeProjects();

  return (
    <StoreScreen>
      <StoreHeader here="/board/store/projects" title="Store projects" />

      <p className={styles.lede}>
        What this seat owns and what it holds a part of, filtered from the one
        register of lines of effort. Nothing here is a store-local copy, so when
        another chair moves a date or marks a project blocked, this reads it.
      </p>

      <StoreSodWarning subject={subject} />

      <h2 className={styles.sectionHead}>Owned by this seat</h2>
      {owned.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.findingBody}>
            The register carries no line of effort owned by the Store and Sales
            Chair. That is the filter&rsquo;s honest answer and not an empty
            screen: nothing has been dropped and nothing is loading.
          </p>
          <p className={styles.findingMitigation}>
            It is worth noticing rather than accepting. The store&rsquo;s two
            unsettled questions — whether it holds stock or prints to order, and
            whether the Treasurer keeps chairing it — are on the{" "}
            <Link href="/board/store/planning">Planning tab</Link> as board
            items, and neither has been raised as a line of effort. The register
            is the organization&rsquo;s, so adding one is a board act, not a
            store edit.
          </p>
        </div>
      ) : (
        <ul className={styles.plan}>
          {owned.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      )}

      <h2 className={styles.sectionHead}>Contributing to</h2>
      {contributing.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.findingBody}>
            No line of effort in the register names this seat as a contributor.
          </p>
        </div>
      ) : (
        <ul className={styles.plan}>
          {contributing.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      )}

      {linesTouched.length > 0 ? (
        <>
          <h2 className={styles.sectionHead}>The lines of effort this touches</h2>
          <ul className={styles.plainList}>
            {linesTouched.map((line) => (
              <li key={line.key}>
                {line.title}{" "}
                <span className={styles.subtle}>carried by {line.carriedBy}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className={styles.whyNote}>
        <strong>Where the store&rsquo;s part of this actually is.</strong> The
        golf tournament is the one line of effort that reaches the store, and
        the handoff is a tax one rather than a logistics one: entry fees have to
        be priced apart from merchandise, because bundling a shirt into an entry
        fee pulls the whole bundle into the sales tax base and into the
        non-member receipts record at the same time. That is a conversation
        between this seat, Events and the Treasurer, which is why it sits in one
        register and not three.
      </div>
    </StoreScreen>
  );
}
