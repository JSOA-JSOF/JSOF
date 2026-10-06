/**
 * The shapes every role workspace is built from.
 *
 * Shared on purpose: six roles rendering six slightly different task objects
 * is how a platform stops being one platform. See docs/ROLE-WORKSPACE.md.
 */

import type { Entity, Role } from "../authz/model";

/* ------------------------------------------------------------------ *
 * Overview: derived tasks
 * ------------------------------------------------------------------ */

export type TaskUrgency = "overdue" | "soon" | "open";

/**
 * A task is DERIVED from state. Nobody types one.
 *
 * A task list people must populate is dead within a cycle on a volunteer
 * board — it is the same failure as the spreadsheet this platform replaces. If
 * it cannot be computed from the data, it is a note, not a task.
 */
export type RoleTask = {
  key: string;
  /** What to do, in the imperative. "Score 32 applications", not "32 pending". */
  label: string;
  /** Why it is here, and what it blocks. One line. */
  because: string;
  count?: number;
  urgency: TaskUrgency;
  /** Where the work actually happens. */
  href: string;
  entity?: Entity;
  /** Set when a date drives the urgency. */
  dueOn?: string;
};

/* ------------------------------------------------------------------ *
 * Overview: calendar
 * ------------------------------------------------------------------ */

export type RoleCalendarItem = {
  key: string;
  title: string;
  /** ISO date. */
  on: string;
  entity: Entity | null;
  kind: "FILING" | "RENEWAL" | "MEETING" | "EVENT" | "CYCLE";
  /** Who owns it, by office rather than by name. */
  ownerRole: Role | null;
  href?: string;
  /**
   * True when the date is a placeholder or the duty itself is unconfirmed.
   * These must never be counted as obligations — the compliance calendar
   * carries at least one entry nobody has established exists.
   */
  unverified?: boolean;
};

/* ------------------------------------------------------------------ *
 * Planning: what I want on the next agenda
 * ------------------------------------------------------------------ */

export type PlanningItemType = "DECISION" | "DISCUSSION" | "INFORMATION";

export type PlanningItem = {
  id: string;
  entity: Entity;
  title: string;
  type: PlanningItemType;
  /** Minutes. The agenda builder sums these against the meeting length. */
  estimateMinutes: number;
  /** Why it needs the board rather than the role. */
  reason: string;
  proposedByRole: Role;
  /** Set once the Secretary has taken it onto an agenda. */
  acceptedForMeetingId: string | null;
};

/* ------------------------------------------------------------------ *
 * Outside view: what the world sees of this function
 * ------------------------------------------------------------------ */

export type OutsideAudience = "PUBLIC" | "MEMBER_OR_DONOR";

export type OutsideProblem =
  | "STALE_DATE"
  | "YEAR_CONTRADICTS_CONTENT"
  | "DEAD_LINK"
  | "MISSING_OWNER"
  | "PLACEHOLDER_PUBLISHED"
  /**
   * Published copy that may be substantively untrue, rather than merely old
   * or broken. The live site's unqualified claim that gifts to the Association
   * are tax-deductible is the case this exists for: it rests on a membership
   * composition test nobody tracks per year, and the test currently fails.
   * Four roles were carrying this meaning inside a free-text note.
   */
  | "CLAIM_UNSUPPORTED"
  /**
   * A duty the organization has, with no path built for it. Distinct from a
   * dead link, which promises something and fails, and from a missing owner,
   * which has a path nobody holds. Answering a member's records-inspection
   * request is the case: the obligation is real and there is nothing to click.
   */
  | "NOT_BUILT"
  | "NONE";

export type OutsideItem = {
  key: string;
  /** What an outsider would call it. */
  title: string;
  href: string;
  audience: OutsideAudience;
  problem: OutsideProblem;
  /** Only when there is a problem: what is wrong, in one line. */
  note?: string;
  /**
   * What this is, for a row with nothing wrong with it. Without it a healthy
   * item renders as a bare title and roles were loading explanation into the
   * title itself to compensate.
   */
  detail?: string;
  /**
   * Which entity's surface this is. In a two-entity organization attribution
   * cannot be editorial: treasury was putting it in every title by hand and
   * asserting that in a test, which is a convention rather than a rule.
   * Null for something that genuinely belongs to neither.
   */
  entity?: "JSOA" | "JSOF" | null;
  /** Waiting on a second approver before it can be published. */
  awaitingRelease?: boolean;
};

/**
 * A role's whole external surface.
 *
 * `noExternalSurface` is a correct answer rather than a missing one. The
 * Secretary's output is the minute book and the Finance Review Officer's
 * independence depends on having no external voice at all. An empty screen
 * implies breakage; a stated reason does not.
 */
export type OutsideSurface = {
  noExternalSurface: boolean;
  /** Required when `noExternalSurface` is true. */
  whyEmpty?: string;
  items: OutsideItem[];
};

/* ------------------------------------------------------------------ *
 * The tab spine
 * ------------------------------------------------------------------ */

export const WORKSPACE_TABS = [
  "overview",
  "dashboard",
  "planning",
  "projects",
  "outside",
] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export const TAB_LABELS: Record<WorkspaceTab, string> = {
  overview: "Overview",
  dashboard: "Dashboard",
  planning: "Planning",
  projects: "Projects",
  outside: "Outside view",
};

export function urgencyRank(urgency: TaskUrgency): number {
  return { overdue: 0, soon: 1, open: 2 }[urgency];
}

/** Overdue first, then soonest, then everything else. */
export function sortTasks(tasks: RoleTask[]): RoleTask[] {
  return [...tasks].sort(
    (a, b) =>
      urgencyRank(a.urgency) - urgencyRank(b.urgency) ||
      (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
      a.label.localeCompare(b.label),
  );
}
