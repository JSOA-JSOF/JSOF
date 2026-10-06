import Link from "next/link";

import {
  sortTasks,
  TAB_LABELS,
  WORKSPACE_TABS,
  type OutsideItem,
  type OutsideSurface,
  type RoleCalendarItem,
  type RoleTask,
  type WorkspaceTab,
} from "@/lib/workspace/types";
import styles from "./shell.module.css";

/**
 * The spine every role workspace hangs off. See docs/ROLE-WORKSPACE.md.
 *
 * Four of the five tabs are filtered views of shared data rather than per-role
 * copies, which is the rule that keeps six workspaces from becoming six
 * sources of truth.
 */

export function RoleTabs({
  base,
  current,
  functionTabs = [],
}: {
  /** e.g. "/board/scholarships" */
  base: string;
  current: WorkspaceTab | string;
  /** The role's own work, appended after the spine. */
  functionTabs?: { href: string; label: string }[];
}) {
  return (
    <nav className={styles.tabs} aria-label="Workspace">
      {WORKSPACE_TABS.map((tab) => {
        const href = tab === "overview" ? base : `${base}/${tab}`;
        return (
          <Link
            key={tab}
            href={href}
            aria-current={current === tab ? "page" : undefined}
            className={`${styles.tab} ${current === tab ? styles.tabOn : ""}`}
          >
            {TAB_LABELS[tab]}
          </Link>
        );
      })}
      {functionTabs.length > 0 ? <span className={styles.tabDivider} aria-hidden="true" /> : null}
      {functionTabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={current === tab.href ? "page" : undefined}
          className={`${styles.tab} ${current === tab.href ? styles.tabOn : ""}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Derived tasks. Overdue first, then soonest.
 *
 * Each row says what to do and what it blocks, because a count on its own
 * ("32 pending") tells a volunteer nothing about whether to open it tonight.
 */
export function TaskList({
  tasks,
  withheld,
}: {
  tasks: RoleTask[];
  /**
   * Why the reader is seeing nothing, when the reason is their scope rather
   * than the state of the work. "Nothing is waiting on you" is a claim about
   * the work; for a reader who cannot see the work it is false, and it is the
   * one confusion this platform never permits. Three roles suppressed this
   * component and wrote their own sentence rather than let it lie.
   */
  withheld?: string;
}) {
  if (tasks.length === 0 && withheld) {
    return <p className={styles.empty}>{withheld}</p>;
  }
  if (tasks.length === 0) {
    return (
      <p className={styles.empty}>
        Nothing is waiting on you. This list is derived from the data, so it
        fills itself as work arrives.
      </p>
    );
  }

  return (
    <ul className={styles.tasks}>
      {sortTasks(tasks).map((task) => (
        <li key={task.key} className={styles.task}>
          <Link href={task.href} className={styles.taskMain}>
            <span className={styles.taskLabel}>{task.label}</span>
            <span className={styles.taskBecause}>{task.because}</span>
          </Link>
          <span className={styles.taskMeta}>
            {typeof task.count === "number" && task.count > 0 ? (
              <span className={styles.taskCount}>{task.count}</span>
            ) : null}
            {task.entity ? <span className={styles.taskEntity}>{task.entity}</span> : null}
            <span
              className={`${styles.taskUrgency} ${
                task.urgency === "overdue"
                  ? styles.overdue
                  : task.urgency === "soon"
                    ? styles.soon
                    : ""
              }`}
            >
              {task.urgency === "overdue"
                ? "Overdue"
                : task.urgency === "soon"
                  ? task.dueOn
                    ? `Due ${task.dueOn}`
                    : "Soon"
                  : "Open"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CalendarStrip({
  items,
  withheld,
}: {
  items: RoleCalendarItem[];
  /** Same reason as TaskList: an empty list is not the same answer as a
   *  withheld one, and only the caller knows which this is. */
  withheld?: string;
}) {
  if (items.length === 0 && withheld) {
    return <p className={styles.empty}>{withheld}</p>;
  }
  if (items.length === 0) {
    return <p className={styles.empty}>Nothing dated is yours in the period ahead.</p>;
  }

  return (
    <ul className={styles.calendar}>
      {[...items]
        .sort((a, b) => a.on.localeCompare(b.on))
        .map((item) => (
          <li key={item.key} className={styles.calendarRow}>
            <span className={styles.calendarDate}>{item.on}</span>
            <span className={styles.calendarTitle}>
              {item.href ? <Link href={item.href}>{item.title}</Link> : item.title}
              {/* An unverified duty is never counted as an obligation: the
                  compliance calendar holds at least one entry nobody has
                  established exists. */}
              {item.unverified ? (
                <span className={styles.unverified}>unverified, counted nowhere</span>
              ) : null}
            </span>
            <span className={styles.calendarKind}>
              {item.entity ? `${item.entity} · ` : ""}
              {item.kind.toLowerCase()}
            </span>
          </li>
        ))}
    </ul>
  );
}

const PROBLEM_COPY: Record<OutsideItem["problem"], string> = {
  STALE_DATE: "A date in the past is still published as live",
  YEAR_CONTRADICTS_CONTENT: "The year on the page disagrees with the page",
  DEAD_LINK: "Goes nowhere",
  MISSING_OWNER: "No office owns this",
  PLACEHOLDER_PUBLISHED: "A placeholder is public",
  CLAIM_UNSUPPORTED: "This may not be true as published",
  NOT_BUILT: "The duty is real and nothing has been built for it",
  NONE: "",
};

/**
 * What the world sees of this function, in two columns.
 *
 * Public and member-or-donor are different audiences, and blurring them into
 * one "outside" is how the OPSEC problems start. They are never merged here.
 */
export function OutsideColumns({ surface }: { surface: OutsideSurface }) {
  if (surface.noExternalSurface) {
    return (
      <p className={styles.empty}>
        {surface.whyEmpty ??
          "This role has no external surface, which is correct rather than missing."}
      </p>
    );
  }

  const columns: { audience: OutsideItem["audience"]; heading: string }[] = [
    { audience: "PUBLIC", heading: "Anyone can see this" },
    { audience: "MEMBER_OR_DONOR", heading: "Members and donors see this" },
  ];

  return (
    <div className={styles.outside}>
      {columns.map((column) => {
        const items = surface.items.filter((item) => item.audience === column.audience);
        return (
          <section key={column.audience} className={styles.outsideColumn}>
            <h3 className={styles.outsideHeading}>{column.heading}</h3>
            {items.length === 0 ? (
              <p className={styles.empty}>Nothing of this role&rsquo;s is visible here.</p>
            ) : (
              <ul className={styles.outsideList}>
                {items.map((item) => (
                  <li key={item.key} className={styles.outsideItem}>
                    <span>
                      <Link href={item.href}>{item.title}</Link>
                      {item.entity ? (
                        <span className={styles.entityTag}>{item.entity}</span>
                      ) : null}
                    </span>
                    {item.awaitingRelease ? (
                      <span className={styles.awaiting}>awaiting a second approver</span>
                    ) : null}
                    {item.problem !== "NONE" ? (
                      <span className={styles.problem}>
                        {item.note ?? PROBLEM_COPY[item.problem]}
                      </span>
                    ) : item.detail ? (
                      <span className={styles.detail}>{item.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
