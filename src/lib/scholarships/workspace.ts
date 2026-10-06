/**
 * The Scholarships Chair's role workspace, as four authorized reads.
 *
 * One read per spine tab that needs data: Overview, Planning, Projects and
 * Outside view. The Dashboard tab keeps its own read in `kpis.ts`. Each one
 * guards through `guard()` like every other read in this module, and each one
 * is enumerated in tests/reviewer-boundary.test.ts with the reason it sits on
 * the side of the line it does.
 *
 * Two rules from docs/ROLE-WORKSPACE.md shape every line below.
 *
 * FILTER, NEVER COPY. The Projects tab filters `@/lib/projects/register`,
 * which is the one org-level register. There is no per-role project store here
 * and there must never be one: a second copy of the register is a second
 * source of truth that drifts from the first, and the handoffs between roles —
 * which is where this organization actually loses things — live in the
 * contributor lists of the shared record.
 *
 * TASKS ARE DERIVED, NEVER TYPED. Every `RoleTask` below is a function of
 * repository state or of a configuration flag. Nothing here reads a list that
 * a person has to maintain. A task list a volunteer must populate is dead
 * within a cycle, which is the same failure as the spreadsheet this platform
 * replaces.
 *
 * Where the reviewer boundary runs through this file: all four reads are the
 * chair's. A scholarship reviewer holds APPLICANT READ so they can open the
 * file they are scoring, and nothing on these four tabs is scoring. The
 * Overview carries the whole cycle's outstanding work including the cheque
 * run; Planning carries the unconfirmed award amount; Projects names what is
 * blocked and why; the Outside view is the ownership of published pages, which
 * is a PUBLIC_CONTENT grant a reviewer does not hold at all. A reviewer
 * reaching any of them is told the read was refused, which is a different
 * answer from an empty tab.
 */

import type { Role } from "../authz/model";
import type { Subject } from "../authz/policy";
import { projectsForRole, type Project } from "../projects/register";
import type {
  OutsideItem,
  OutsideSurface,
  PlanningItem,
  RoleCalendarItem,
  RoleTask,
  TaskUrgency,
} from "../workspace/types";

import { FULL_COMMITTEE } from "./board";
import { ELIGIBILITY_RULE, eligibilityIsPlaceholder } from "./eligibility";
import { guard } from "./guard";
import { countCycleWork, type CycleWorkCounts } from "./kpis";
import type { ScholarshipRepository } from "./repository";
import { PATRIOT_FOUNDATION, ROUTING_RULE } from "./routing";
import { WOUNDED_PATRIOT, formatCents } from "./scoring";
import { UNSUCCESSFUL_RETENTION_DAYS } from "./retention";
import { SCHOLARSHIP_ENTITY, type Cycle } from "./types";

/** The one role this workspace belongs to. */
export const ROLE: Role = "SCHOLARSHIPS_CHAIR";

/* ------------------------------------------------------------------ *
 * Dates that are somebody's claim rather than something computed.
 * ------------------------------------------------------------------ */

/**
 * When the next cycle opens.
 *
 * SOURCE: docs/ARCHITECTURE.md, from the chair's intake answer — "the next
 * cycle opens mid-December 2026". UNVERIFIED as a date: mid-December is a
 * fortnight, not a day, and the public page deliberately publishes no date at
 * all until the chair confirms one. It is carried here as the 15th so the
 * calendar can sort it, and it is marked unverified everywhere it renders so
 * nothing counts it as an obligation.
 */
export const NEXT_CYCLE_OPENS = "2026-12-15";

/** How long before an opening counts as the thing in front of her. */
const SOON_WINDOW_DAYS = 45;

/** "1 award" / "2 awards", so no row ships with a "(s)" on it. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ *
 * What each tab gets
 * ------------------------------------------------------------------ */

/**
 * A warning that gates the cycle.
 *
 * Both of these change what the cycle can do, so they render above the tasks
 * and above the figures rather than in a footnote under them. They are not
 * tasks: a task says what to do and links to where it happens, and neither of
 * these is resolved on a screen in this module — one is with counsel and one
 * needs a figure nobody has supplied.
 */
export type CycleGate = {
  key: string;
  title: string;
  body: string;
  /** Where the decision is being tracked, which is Planning or the register. */
  href: string;
};

export type ScholarshipsOverview = {
  now: string;
  cycle: Cycle;
  gates: CycleGate[];
  tasks: RoleTask[];
  calendar: RoleCalendarItem[];
  /**
   * Why the calendar holds no award reception.
   *
   * Stated rather than left blank. A reception is an Events item on the shared
   * calendar; none is on file, and inventing one here would be the per-role
   * copy the spine forbids.
   */
  calendarNote: string;
};

export type ScholarshipsPlanning = {
  /** Items this role wants on the next board agenda. */
  items: PlanningItem[];
  /** Sum of the estimates, which is what the agenda builder budgets against. */
  totalMinutes: number;
};

export type ProjectHolding = {
  project: Project;
  /** Whether this role is accountable for it or holds a part of it. */
  stake: "OWNS" | "CONTRIBUTES";
  /** Every other role with a part in it, by office and never by name. */
  otherRoles: { role: Role; label: string; accountable: boolean }[];
};

export type ScholarshipsProjects = {
  /** Blocked first, because a blocked line of effort is the useful content. */
  blocked: ProjectHolding[];
  running: ProjectHolding[];
};

export type ScholarshipsOutside = {
  surface: OutsideSurface;
  /**
   * Part 2 of the Outside view: what is queued for release awaiting a second
   * approver. `awaiting` is filtered from the surface rather than held
   * separately, and `note` is what the tab says when it is empty — which it is.
   */
  release: { awaiting: OutsideItem[]; note: string };
};

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

export async function loadScholarshipsOverview(
  repo: ScholarshipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<ScholarshipsOverview> {
  // WRITE, not AGGREGATE. `loadCycleOverview` is counts only and a reviewer
  // may reach it; this read adds the cheque run, the verification queue and
  // the applicants who are owed an outcome, which is the whole cycle's work
  // rather than one scorer's. rowLevel is false: every task is a count, and
  // nothing returned here names an applicant.
  await guard(repo, subject, {
    action: "READ_SCHOLARSHIPS_OVERVIEW",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: false,
  });

  const cycle = await repo.currentCycle();
  const cycles = await repo.listCycles();
  const applications = await repo.listApplications({ cycleId: cycle.id });
  const awards = await repo.listAwards({ cycleId: cycle.id });
  const cheques = await repo.listCheques(cycle.id);

  const sheetsByApplication = new Map<string, number>();
  for (const application of applications) {
    sheetsByApplication.set(
      application.id,
      (await repo.listScoreSheets(application.id)).length,
    );
  }

  let verificationsOutstanding = 0;
  for (const application of applications) {
    if (application.state === "WITHDRAWN") continue;
    if (!application.woundedPatriot) continue;
    if (!(await repo.getVerification(application.id))) verificationsOutstanding += 1;
  }

  const counts = countCycleWork({
    applications,
    sheetsByApplication,
    awards,
    cheques,
    verificationsOutstanding,
  });

  return {
    now: now.toISOString(),
    cycle,
    gates: gatesFor(),
    tasks: tasksFor(counts, cycle, cycles, now),
    calendar: calendarFor(cycle, now),
    calendarNote:
      "No award reception is on the shared calendar. If one is held it is an " +
      "Events item and will appear here from that calendar; it is not entered " +
      "twice, and a date typed into this module would be the second source of " +
      "truth the workspace exists to avoid.",
  };
}

/**
 * The two warnings that gate the cycle.
 *
 * Both are read from the configuration that holds them rather than restated,
 * so confirming either one is still a one-line change in its own file and this
 * screen stops showing the warning on its own.
 */
function gatesFor(): CycleGate[] {
  const gates: CycleGate[] = [];

  if (eligibilityIsPlaceholder()) {
    gates.push({
      key: "eligibility-with-counsel",
      title: "Eligibility is with counsel, and no rule is in force",
      body:
        `${ELIGIBILITY_RULE.marker}. Every application in the cycle is marked ` +
        `as needing a determination by a person, which is what happens today. ` +
        `${ELIGIBILITY_RULE.guidance} The cycle opens in the middle of ` +
        `December whatever counsel says, so this gates what can be published, ` +
        `not whether the machinery runs.`,
      href: "/board/scholarships/planning",
    });
  }

  if (!WOUNDED_PATRIOT.amountConfirmed) {
    gates.push({
      key: "wounded-patriot-amount",
      title: "The Wounded Patriot award amount is a placeholder",
      body:
        `It is a flat award standing at ${formatCents(WOUNDED_PATRIOT.amountCents)} ` +
        `and the real figure has never been supplied. It propagates into every ` +
        `Wounded Patriot notification, into the cumulative total and into the ` +
        `cheque run, so nothing should be sent until you confirm it.`,
      href: "/board/scholarships/planning",
    });
  }

  return gates;
}

/**
 * Days between two instants, rounded, or null when either does not parse.
 */
function daysUntil(from: Date, to: string): number | null {
  const end = Date.parse(to);
  if (Number.isNaN(end)) return null;
  return Math.round((end - from.getTime()) / 86_400_000);
}

/**
 * Urgency against the cycle's own decision date, never against an invented
 * one. docs/WORKSPACE-DESIGN.md: real deadlines are shown, invented ones are
 * not, so nothing here manufactures a deadline to make a row look urgent.
 */
function urgencyAgainst(now: Date, dueOn: string | null): TaskUrgency {
  if (!dueOn) return "open";
  const days = daysUntil(now, dueOn);
  if (days === null) return "open";
  if (days < 0) return "overdue";
  if (days <= SOON_WINDOW_DAYS) return "soon";
  return "open";
}

/**
 * The derived task list, lifted from the dashboard's `actions` and given the
 * one thing an action did not carry: what each count BLOCKS.
 *
 * "32 pending" tells a volunteer nothing about whether to open it tonight.
 * "Nothing can be banded until a file is scored, so this holds every award in
 * the cycle" does.
 */
function tasksFor(
  counts: CycleWorkCounts,
  cycle: Cycle,
  cycles: Cycle[],
  now: Date,
): RoleTask[] {
  const decisionsBy = cycle.decisionsBy.slice(0, 10);
  const tasks: RoleTask[] = [];

  if (counts.awaitingAFullCommittee > 0) {
    tasks.push({
      key: "score",
      label: `Get ${plural(counts.awaitingAFullCommittee, "file", "files")} to a full committee`,
      because:
        (counts.unscored > 0
          ? `${counts.unscored} have no sheet at all and ${counts.partlyScored} ` +
            `have started and are short of all ${FULL_COMMITTEE} reviewers. `
          : `All of them have started and none has all ${FULL_COMMITTEE} ` +
            `reviewers on it. `) +
        `A score is what produces the band, and the band is what produces the ` +
        `amount, so this holds every Merit award in the cycle.`,
      count: counts.awaitingAFullCommittee,
      urgency: urgencyAgainst(now, decisionsBy),
      dueOn: decisionsBy,
      href: "/board/scholarships/review",
      entity: SCHOLARSHIP_ENTITY,
    });
  }

  if (counts.verificationsOutstanding > 0) {
    tasks.push({
      key: "verify",
      label: `Verify ${plural(counts.verificationsOutstanding, "Wounded Patriot claim", "Wounded Patriot claims")}`,
      because:
        `Yours alone, and the one step that must never run without a person. ` +
        `No Wounded Patriot award can be proposed on an unverified claim, so ` +
        `this holds ${plural(counts.verificationsOutstanding, "award", "awards")} ` +
        `and the cheques behind them.`,
      count: counts.verificationsOutstanding,
      urgency: urgencyAgainst(now, decisionsBy),
      dueOn: decisionsBy,
      href: "/board/scholarships/verify",
      entity: SCHOLARSHIP_ENTITY,
    });
  }

  if (counts.awardsWithTheBoard > 0) {
    tasks.push({
      key: "board-review",
      label: `Take ${plural(counts.awardsWithTheBoard, "award", "awards")} back to the full board`,
      because:
        `The sponsoring member holds a board seat, so the award waits on a ` +
        `minuted decision with them recused. Nothing in this module can ` +
        `approve one, which means it waits on the agenda and not on you.`,
      count: counts.awardsWithTheBoard,
      urgency: urgencyAgainst(now, decisionsBy),
      dueOn: decisionsBy,
      href: "/board/scholarships/awards",
      entity: SCHOLARSHIP_ENTITY,
    });
  }

  if (counts.awardsAwaitingNotification > 0) {
    tasks.push({
      key: "notify",
      label: `Send ${plural(counts.awardsAwaitingNotification, "award notification", "award notifications")}`,
      because:
        `Each one merges the amount from the award record and copies the ` +
        `sponsoring member, so none of these is an amount you retype. Until ` +
        `one goes out the applicant does not know, and the cheque cannot be ` +
        `queued behind it.`,
      count: counts.awardsAwaitingNotification,
      urgency: urgencyAgainst(now, decisionsBy),
      dueOn: decisionsBy,
      href: "/board/scholarships/notify",
      entity: SCHOLARSHIP_ENTITY,
    });
  }

  // The one task the old actions list did not have, and the one with a real
  // failure behind it. An applicant with no award hears nothing, ever:
  // NOT_AWARDED_NOTICE exists as a message kind and no function sends one.
  //
  // Counted on applications holding no award at all, not on everything
  // undelivered: a decided applicant with an award and no notification yet is
  // the notification task above, and counting them twice would overstate this
  // one and understate what is actually broken.
  if (counts.decidedWithNoAwardAtAll > 0) {
    const awardedButUntold =
      counts.decidedWithNoOutcomeSent - counts.decidedWithNoAwardAtAll;
    tasks.push({
      key: "tell-unsuccessful",
      label: `Tell ${plural(counts.decidedWithNoAwardAtAll, "applicant", "applicants")} they were not awarded`,
      because:
        `Decided, holding no award, and there is no path in this module that ` +
        `tells them: NOT_AWARDED_NOTICE exists as a message kind and nothing ` +
        `sends it, so they hear nothing, ever. This is why the outcome figure ` +
        `on the Dashboard is short. ` +
        (awardedButUntold > 0
          ? `The other ${awardedButUntold} who have heard nothing do hold an ` +
            `award and are in the notification task.`
          : ``),
      count: counts.decidedWithNoAwardAtAll,
      urgency: "overdue",
      href: "/board/scholarships/notify",
      entity: SCHOLARSHIP_ENTITY,
    });
  }

  if (counts.chequesQueued > 0) {
    tasks.push({
      key: "disburse",
      label: `Mail ${plural(counts.chequesQueued, "cheque", "cheques")}`,
      because:
        `Grouped one envelope per school, so this is fewer envelopes than ` +
        `cheques. The money is not at the bursar until these are posted, and ` +
        `that wait is the only part of the timeline an applicant experiences.`,
      count: counts.chequesQueued,
      urgency: urgencyAgainst(now, decisionsBy),
      dueOn: decisionsBy,
      href: "/board/scholarships/disbursement",
      entity: SCHOLARSHIP_ENTITY,
    });
  }

  // Derived from the configuration flag, not from a note somebody left. It
  // disappears from this list the moment `amountConfirmed` becomes true.
  if (!WOUNDED_PATRIOT.amountConfirmed) {
    tasks.push({
      key: "confirm-wp-amount",
      label: "Confirm the Wounded Patriot award amount",
      because:
        `It stands at ${formatCents(WOUNDED_PATRIOT.amountCents)} as a ` +
        `placeholder. It blocks every Wounded Patriot notification, the ` +
        `cumulative total and its own line in the register, and it is one of ` +
        `your items for the next board meeting.`,
      urgency: "overdue",
      href: "/board/scholarships/planning",
      entity: SCHOLARSHIP_ENTITY,
    });
  }

  // Derived from the register of cycles: the one opening in December has no
  // record at all, so intake has nothing to accept an application into.
  if (!cycles.some((candidate) => candidate.state === "PLANNED")) {
    tasks.push({
      key: "open-next-cycle",
      label: "Open a record for the next cycle, with confirmed dates",
      because:
        `No cycle record exists for the one opening in the middle of December, ` +
        `so intake has nothing to accept an application into and the public ` +
        `page publishes season words with no date. Mid-December is a fortnight ` +
        `and nobody has named a day.`,
      urgency: urgencyAgainst(now, NEXT_CYCLE_OPENS),
      dueOn: NEXT_CYCLE_OPENS,
      href: "/board/scholarships/outside",
      entity: SCHOLARSHIP_ENTITY,
    });
  }

  return tasks;
}

/**
 * Her dated items, filtered from the cycle record.
 *
 * The cycle's own dates are facts on the record. The December opening is the
 * chair's own account of a fortnight and is marked unverified, so the strip
 * renders it without counting it as an obligation.
 */
function calendarFor(cycle: Cycle, now: Date): RoleCalendarItem[] {
  void now;
  return [
    {
      key: "next-cycle-opens",
      title: "The next cycle opens, and intake starts accepting applications",
      on: NEXT_CYCLE_OPENS,
      entity: SCHOLARSHIP_ENTITY,
      kind: "CYCLE",
      ownerRole: ROLE,
      href: "/apply/scholarship",
      // Mid-December is a fortnight. The 15th is here so the strip can sort,
      // and the date has never been confirmed by anyone.
      unverified: true,
    },
    {
      key: "applications-close",
      title: `Applications close for the ${cycle.label}`,
      on: cycle.closesAt.slice(0, 10),
      entity: SCHOLARSHIP_ENTITY,
      kind: "CYCLE",
      ownerRole: ROLE,
      href: "/board/scholarships/review",
    },
    {
      key: "decisions-by",
      title: "Award decisions due, and the committee's scoring has to be finished",
      on: cycle.decisionsBy.slice(0, 10),
      entity: SCHOLARSHIP_ENTITY,
      kind: "CYCLE",
      ownerRole: ROLE,
      href: "/board/scholarships/awards",
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

/**
 * What this role wants on the next board agenda.
 *
 * Three items, and each one is a decision the board owes rather than work the
 * chair can do. They are written to be handed to the Secretary as they stand:
 * a type, an estimate and a reason the board rather than the role has to
 * settle it. `acceptedForMeetingId` is null on all three, which is the state
 * "filed, not yet taken onto an agenda" rather than "rejected".
 *
 * The retention item is the one nobody has asked for. One year for an
 * unsuccessful applicant's personal data is an assumption this module wrote
 * into code because the purge has to run on a schedule and a schedule needs a
 * number. It has never been signed off, and it is the kind of assumption that
 * is discovered during a complaint rather than before one.
 */
export async function loadScholarshipsPlanning(
  repo: ScholarshipRepository,
  subject: Subject,
): Promise<ScholarshipsPlanning> {
  // WRITE on APPLICANT. These items carry the unconfirmed award amount and the
  // retention period for named applicants, and the tab is a board seat's view
  // of the next agenda. A scholarship reviewer is not a board seat.
  await guard(repo, subject, {
    action: "READ_SCHOLARSHIPS_PLANNING",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: false,
  });

  const items: PlanningItem[] = [
    {
      id: "plan-sch-eligibility",
      entity: SCHOLARSHIP_ENTITY,
      title: "Adopt the eligibility rule counsel reports, or decide how the cycle runs without one",
      type: "DECISION",
      estimateMinutes: 25,
      reason:
        "The published rule defines the eligible class by membership in the " +
        "Association, which is the fact pattern the IRS uses to deny or revoke " +
        "exemption. The platform applies no rule of its own and marks every " +
        "application as needing a determination by a person. That is defensible " +
        "for one cycle and it is not a position the board has actually taken. " +
        "The cycle opens in the middle of December either way, so the board " +
        "needs to adopt criteria or minute the decision to run the cycle on a " +
        "person's determination.",
      proposedByRole: ROLE,
      acceptedForMeetingId: null,
    },
    {
      id: "plan-sch-wounded-patriot-amount",
      entity: SCHOLARSHIP_ENTITY,
      title: "Confirm the flat Wounded Patriot award amount",
      type: "DECISION",
      estimateMinutes: 10,
      reason:
        `The figure was never supplied and stands at ` +
        `${formatCents(WOUNDED_PATRIOT.amountCents)} as a placeholder. It is a ` +
        `flat award, so one number settles 64 awards. It is the board's rather ` +
        `than the chair's because it is the size of a grant and it lands in the ` +
        `Foundation's cumulative totals. Nothing can be notified until it is ` +
        `confirmed.`,
      proposedByRole: ROLE,
      acceptedForMeetingId: null,
    },
    {
      id: "plan-sch-retention-period",
      entity: SCHOLARSHIP_ENTITY,
      title: `Approve ${UNSUCCESSFUL_RETENTION_DAYS} days as the retention period for unsuccessful applicants`,
      type: "DECISION",
      estimateMinutes: 15,
      reason:
        `This is currently an assumption and not a policy. The purge runs in ` +
        `code one year after the decision, which clears before the next cycle ` +
        `opens, and it deletes the application, the guardian consent, the score ` +
        `sheets and the verification. The selection record that survives it is ` +
        `kept five years and identifies nobody. Nobody has signed either number ` +
        `off. The board should adopt them or set its own, because the first time ` +
        `anybody asks how long we hold a rejected teenager's disability ` +
        `narrative, the answer should be a minute reference and not a constant ` +
        `in a file.`,
      proposedByRole: ROLE,
      acceptedForMeetingId: null,
    },
  ];

  return {
    items,
    totalMinutes: items.reduce((sum, item) => sum + item.estimateMinutes, 0),
  };
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

const ROLE_LABEL_OVERRIDES: Partial<Record<Role, string>> = {
  VP_OPERATIONS: "VP Operations",
  VP_MEMBERSHIP: "VP Membership",
  FINANCE_REVIEW_OFFICER: "Finance Review Officer",
  SCHOLARSHIP_REVIEWER: "Scholarship reviewer",
};

/** An office, in the words a board member would use for it. */
export function roleLabel(role: Role): string {
  const override = ROLE_LABEL_OVERRIDES[role];
  if (override) return override;
  return role
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * This role's slice of the one register, blocked work first.
 *
 * A FILTER over `@/lib/projects/register` and nothing else. Nothing is copied
 * into this module, nothing is restated, and a project's status, blocker and
 * contributor list come back exactly as the register holds them — so a line of
 * effort that another role unblocks stops being blocked here without anyone
 * editing this file.
 */
export async function loadScholarshipsProjects(
  repo: ScholarshipRepository,
  subject: Subject,
): Promise<ScholarshipsProjects> {
  // WRITE on APPLICANT, for the same reason as Planning: this is the board
  // seat's own view of what it is accountable for, and the entries name the
  // blocked eligibility rule and the unconfirmed award amount.
  await guard(repo, subject, {
    action: "READ_SCHOLARSHIPS_PROJECTS",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: false,
  });

  const { owned, contributing } = projectsForRole(ROLE);

  const holdings: ProjectHolding[] = [
    ...owned.map((project) => holding(project, "OWNS")),
    // A project can only be owned or contributed to, never both: the register's
    // own filter excludes the owner from the contributor list.
    ...contributing.map((project) => holding(project, "CONTRIBUTES")),
  ];

  return {
    blocked: holdings.filter((h) => h.project.status === "BLOCKED"),
    running: holdings.filter((h) => h.project.status !== "BLOCKED"),
  };
}

function holding(project: Project, stake: ProjectHolding["stake"]): ProjectHolding {
  const others: ProjectHolding["otherRoles"] = [];
  if (project.ownerRole !== ROLE) {
    others.push({ role: project.ownerRole, label: roleLabel(project.ownerRole), accountable: true });
  }
  for (const role of project.contributorRoles) {
    if (role === ROLE) continue;
    others.push({ role, label: roleLabel(role), accountable: false });
  }
  return { project, stake, otherRoles: others };
}

/* ------------------------------------------------------------------ *
 * Outside view
 * ------------------------------------------------------------------ */

/**
 * What an applicant and the public see of this function, in two columns.
 *
 * Guarded on PUBLIC_CONTENT rather than on APPLICANT, because that is what
 * this tab actually is: the ownership of published pages. The Scholarships
 * Chair holds PUBLIC_CONTENT WRITE and a scholarship reviewer holds no
 * PUBLIC_CONTENT grant at all, so the boundary falls out of the role table
 * without anything being tightened or widened to produce it.
 *
 * The two findings here are real and both are about the same failure the spine
 * names: nobody owns what this function looks like from outside.
 */
export async function loadScholarshipsOutside(
  repo: ScholarshipRepository,
  subject: Subject,
): Promise<ScholarshipsOutside> {
  await guard(repo, subject, {
    action: "READ_SCHOLARSHIPS_OUTSIDE",
    dataClass: "PUBLIC_CONTENT",
    required: "READ",
    rowLevel: false,
  });

  const items: OutsideItem[] = [
    /* ---- Anyone can see this -------------------------------------- */
    {
      key: "public-scholarships",
      title: "Scholarships: the three programmes and how decisions are made",
      href: "/jsof/scholarships",
      audience: "PUBLIC",
      problem: "PLACEHOLDER_PUBLISHED",
      note:
        `A marked eligibility placeholder is the first thing an applicant ` +
        `reads on this page. That is the right call while the rule is with ` +
        `counsel, and it is still a published placeholder on the page that ` +
        `decides whether somebody applies. It is yours until counsel reports.`,
    },
    {
      key: "public-application-window",
      title: "The application window, as published",
      href: "/jsof/scholarships#window",
      audience: "PUBLIC",
      problem: "STALE_DATE",
      note:
        `The live site still presents a February deadline that has already ` +
        `passed, with no indication it is last cycle's. This page publishes ` +
        `season words and no year instead, which cannot go stale but also ` +
        `cannot be planned around. Both are the same gap: no confirmed date ` +
        `for the cycle opening in the middle of December.`,
    },
    {
      key: "public-apply",
      title: "Start an application",
      href: "/apply/scholarship",
      audience: "PUBLIC",
      problem: "NONE",
    },
    {
      key: "public-patriot-routing",
      title: `Where North Carolina applicants are sent instead`,
      href: "/apply/scholarship/patriot-foundation",
      audience: "PUBLIC",
      problem: "PLACEHOLDER_PUBLISHED",
      note:
        `Live, and routing on residence and school alone, which is the broader ` +
        `reading of the rule. Under it an applicant who lives in North ` +
        `Carolina, studies in North Carolina and wants Merit only is sent to ` +
        `${PATRIOT_FOUNDATION.name} before giving a name. One line settles ` +
        `which reading is right (ROUTING_RULE.requiresWoundedPatriot, ` +
        `currently ${String(ROUTING_RULE.requiresWoundedPatriot)}) and it needs ` +
        `your answer before the cycle opens.`,
    },

    /* ---- Members and donors see this ----------------------------- */
    {
      // No note: the shared column renders one only where there is a problem,
      // and a sponsor receiving their own copy is not one. What it is for is
      // said in the tab's own copy instead.
      key: "member-sponsor-copy",
      title: "The sponsoring member's copy of an award letter",
      href: "/board/scholarships/notify",
      audience: "MEMBER_OR_DONOR",
      problem: "NONE",
    },
    {
      key: "member-eligibility-answer",
      title: "The answer a member gets when they ask whether their child can apply",
      href: "/jsof/contact",
      audience: "MEMBER_OR_DONOR",
      problem: "MISSING_OWNER",
      note:
        "Published as: write to the Scholarships Chair and you will get an " +
        "answer about your own situation. That is one volunteer answering every " +
        "eligibility question in the organization by hand for as long as the " +
        "rule is with counsel, and nothing records that it was answered.",
    },
  ];

  const surface: OutsideSurface = { noExternalSurface: false, items };

  return {
    surface,
    // Derived, not asserted. Nothing in this function carries
    // `awaitingRelease` today, and the honest answer is the empty list plus
    // the reason — not a row claiming a second approver is holding something
    // that was never drafted.
    release: {
      awaiting: items.filter((item) => item.awaitingRelease),
      note:
        "Nothing of this function's is waiting on a second approver. The " +
        "release queue is shared and lives outside this module, and this " +
        "module writes nothing into it: an award letter goes to one applicant " +
        "and their sponsor, which is not a release. The thing that will land " +
        "here is an announcement naming this cycle's recipients, because that " +
        "carries identity and so cannot be published by whoever wrote it.",
    },
  };
}
