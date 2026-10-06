/**
 * The VP Membership role workspace: Overview, Planning, Projects, Outside view.
 *
 * `docs/ROLE-WORKSPACE.md` is the spine and its central rule shapes this whole
 * file: four of the five tabs are FILTERED VIEWS of shared data, not per-role
 * copies. So there is no task store here, no project store, and no calendar
 * store.
 *
 *   Tasks       are the dashboard's own `actions` list, lifted. The same
 *               figures that appear on the Dashboard produce the work on the
 *               Overview, from one read of one snapshot. A second list would
 *               drift from the first within a cycle.
 *   Calendar    is derived from the dates the roster already carries — a
 *               cleared payment plus thirty days, a vouch window's expiry —
 *               plus the target dates on the one lines-of-effort register.
 *   Projects    is `projectsForRole` over `@/lib/projects`. A filter, never a
 *               copy.
 *   Planning    is derived from the composition report and the intake, except
 *               for one standing item that comes from two published statements
 *               contradicting each other. Planning is the one tab the spine
 *               does not require to be derived, because it is a person saying
 *               what they want on an agenda.
 *
 * Authorization is the same split the rest of the module uses, and it is the
 * interesting part. AGGREGATE buys the composition tests, which are counts and
 * name nobody. READ buys the records behind them. So a reader can legitimately
 * see that the 90% test is failing, and see the planning item that takes it to
 * the board, and still not be allowed to learn how many augmentee cases are
 * waiting. Those come back withheld — stated as withheld, with what it would
 * take — and nothing is widened to fill the gap.
 */

import type { Level, Role } from "../authz/model";
import { authorize, can, effectiveLevel, type Subject } from "../authz/policy";
import { projectsForRole, type Project } from "../projects/register";
import type {
  OutsideItem,
  OutsideSurface,
  PlanningItem,
  RoleCalendarItem,
  RoleTask,
} from "../workspace/types";
import { loadCompositionReport } from "./board";
import { requiredNumerator, type MembershipDashboard } from "./kpis";
import type { MembershipRepository } from "./repository";
import {
  type Application,
  type CompositionReport,
  AUDIT_WINDOW_DAYS,
  DUES_AMOUNT_CENTS,
  MEMBERSHIP_ENTITY,
} from "./types";

/** The office this workspace belongs to. The roster is this role's record. */
export const MEMBERSHIP_ROLE: Role = "VP_MEMBERSHIP";

/* ------------------------------------------------------------------ *
 * The guard
 *
 * The same shape as `board.ts` and `kpis.ts`: call the shared policy engine
 * with a data class, an entity and a required level, let it throw, and write
 * both the read and the denial to the module's append-only log. Those two keep
 * their copies module-private, so this is a deliberate third instance of one
 * mechanism rather than a second mechanism. If they ever diverge, that is a
 * bug in whichever one diverged.
 * ------------------------------------------------------------------ */

async function guard(
  repo: MembershipRepository,
  subject: Subject,
  options: { action: string; required: Level; rowLevel: boolean; subjectRef?: string | null },
): Promise<void> {
  const base = {
    at: new Date().toISOString(),
    personId: subject.personId,
    dataClass: "MEMBER_PII" as const,
    entity: MEMBERSHIP_ENTITY,
    rowLevel: options.rowLevel,
    subjectRef: options.subjectRef ?? null,
  };
  try {
    authorize({
      subject,
      dataClass: "MEMBER_PII",
      entity: MEMBERSHIP_ENTITY,
      required: options.required,
      rowLevel: options.rowLevel,
    });
  } catch (error) {
    await repo.appendAudit({ ...base, action: `${options.action}:DENIED` });
    throw error;
  }
  await repo.appendAudit({ ...base, action: options.action });
}

/**
 * The floor for every tab in this workspace, including the two that hold no
 * member data at all.
 *
 * The Projects and Outside tabs show a filter of the org-level register and a
 * list of public URLs, neither of which is member data. They are still gated,
 * because what they are is the membership function's workspace: a reader with
 * no grant on the Association's member records has no business reading this
 * role's agenda, lines of effort or external surface. That is a floor, not a
 * widening — it refuses, it never grants.
 */
export async function guardWorkspaceRead(
  repo: MembershipRepository,
  subject: Subject,
  action: string,
): Promise<void> {
  await guard(repo, subject, {
    action,
    required: "AGGREGATE",
    rowLevel: false,
    subjectRef: "aggregate",
  });
}

/** READ on member records, for this entity. False means records are withheld. */
function hasRecords(subject: Subject): boolean {
  return can({
    subject,
    dataClass: "MEMBER_PII",
    entity: MEMBERSHIP_ENTITY,
    required: "READ",
  });
}

const WITHHELD_WHY =
  "Reaching these needs READ on member records for the Association. This role holds " +
  "aggregate, which is enough for the composition tests and not for the records behind " +
  "them. Nothing was widened to fill the gap, and nothing here is reported as zero.";

/* ------------------------------------------------------------------ *
 * Overview: the work, and the dates
 * ------------------------------------------------------------------ */

export type MembershipOverview = {
  asOf: string;
  tasks: RoleTask[];
  /** What the viewer's grant kept off the list. Never rendered as zero tasks. */
  withheld: { why: string; items: string[] } | null;
  calendar: RoleCalendarItem[];
  scope: { records: boolean; decide: boolean };
};

/**
 * The derived tasks, lifted from the dashboard's actions.
 *
 * Two rules, both from the spine. A task is a function of the data, so nothing
 * here is typed by a person. And a count of zero is not a task: an action with
 * nothing waiting is a figure, and it already has a tile. What is left is work.
 *
 * A count the reader may not see is not rendered as a task at all, and is
 * reported separately as withheld. Rendering it with a zero or a blank would
 * tell a reader the work does not exist, which is the one answer that is
 * actually false.
 */
export function membershipTasks(dashboard: MembershipDashboard): {
  tasks: RoleTask[];
  withheldLabels: string[];
} {
  const tasks: RoleTask[] = [];
  const withheldLabels: string[] = [];

  for (const action of dashboard.actions) {
    if (action.n === null) {
      withheldLabels.push(action.label);
      continue;
    }
    if (action.n === 0) continue;

    tasks.push({
      key: `task-${action.key}`,
      label: action.label,
      because: action.because,
      count: action.n,
      urgency: action.urgency,
      href: action.href ?? "/board/membership/dashboard",
      entity: MEMBERSHIP_ENTITY,
      dueOn: action.dueOn,
    });
  }

  return { tasks, withheldLabels };
}

/**
 * Why this tab does not show a filing deadline.
 *
 * There is one compliance calendar and it lives in the Secretary's module, as
 * the minute book's neighbour. This workspace does not read it yet, so rather
 * than keep a membership copy of compliance items — which is precisely the
 * mistake the spine names — the tab says where the calendar is and shows only
 * dates it can derive itself.
 */
export const CALENDAR_PROVENANCE =
  "Dates this role's own data carries, plus the target dates on the shared lines-of-effort " +
  "register. The one compliance calendar is the Secretary's and this workspace does not read " +
  "it yet, so nothing here is a filing deadline. A membership copy of those items would be a " +
  "second source of truth, so there is not one.";

/**
 * The annual roster hygiene pass.
 *
 * The duty is real — the composition denominator is only as good as the last
 * time anybody walked the roster — and nothing in this organization has set a
 * date for it or named the month it falls in. So it is carried as unverified,
 * which is a state the shared calendar type has for exactly this: it appears,
 * it is visibly not established, and it is counted as an obligation nowhere.
 */
function rosterHygiene(now: Date): RoleCalendarItem {
  return {
    key: "cal-roster-hygiene",
    title:
      "Annual roster hygiene pass — walk every counted record against its attested dates",
    on: `${now.getUTCFullYear() + 1}-01-01`,
    entity: MEMBERSHIP_ENTITY,
    kind: "CYCLE",
    ownerRole: MEMBERSHIP_ROLE,
    href: "/board/membership/roster",
    // Nobody has established this date or this cadence. The date shown is the
    // start of the next calendar year and is a placeholder, not a deadline.
    unverified: true,
  };
}

/**
 * The calendar, filtered to this role.
 *
 * Built from the same dashboard snapshot as the tasks, deliberately: the audit
 * due date and the next closing vouch window are already carried on the
 * actions, so taking them from there costs no second row-level read of member
 * records and cannot disagree with the task list beside it.
 */
export function membershipCalendar(dashboard: MembershipDashboard, now: Date): RoleCalendarItem[] {
  const items: RoleCalendarItem[] = [rosterHygiene(now)];

  const audit = dashboard.actions.find((action) => action.key === "audit");
  if (audit?.dueOn) {
    items.push({
      key: "cal-cohort-audit",
      title: `${AUDIT_WINDOW_DAYS}-day record audit falls due in the probationary cohort`,
      on: audit.dueOn,
      entity: MEMBERSHIP_ENTITY,
      kind: "CYCLE",
      ownerRole: MEMBERSHIP_ROLE,
      href: "/board/membership/audit",
    });
  }

  const queue = dashboard.actions.find((action) => action.key === "queue");
  if (queue?.dueOn) {
    items.push({
      key: "cal-vouch-window",
      title: "Sponsor window closes on the next application awaiting a vouch",
      on: queue.dueOn,
      entity: MEMBERSHIP_ENTITY,
      kind: "CYCLE",
      ownerRole: MEMBERSHIP_ROLE,
      href: "/board/membership/queue",
    });
  }

  // From the one register. A line of effort this role carries a part of, with
  // a date on it, is this role's dated item too — and naming the office that
  // owns it is where the handoff becomes visible.
  const { owned, contributing } = projectsForRole(MEMBERSHIP_ROLE);
  for (const project of [...owned, ...contributing]) {
    if (!project.targetDate) continue;
    items.push({
      key: `cal-${project.id}`,
      title: project.title,
      on: project.targetDate,
      entity: project.entity,
      kind: "CYCLE",
      ownerRole: project.ownerRole,
      href: "/board/membership/projects",
    });
  }

  return items;
}

export async function loadMembershipOverview(
  repo: MembershipRepository,
  subject: Subject,
  dashboard: MembershipDashboard,
  now: Date = new Date(),
): Promise<MembershipOverview> {
  // The dashboard read is already authorized and already logged by
  // `loadMembershipDashboard`; the Overview is the same snapshot rendered as
  // work, so it does not read again. The parameter is the snapshot rather than
  // the repository for that reason.
  void repo;

  const { tasks, withheldLabels } = membershipTasks(dashboard);

  return {
    asOf: dashboard.asOf,
    tasks,
    withheld:
      withheldLabels.length > 0 ? { why: WITHHELD_WHY, items: withheldLabels } : null,
    calendar: membershipCalendar(dashboard, now),
    scope: { records: hasRecords(subject), decide: dashboard.scope.decide },
  };
}

/* ------------------------------------------------------------------ *
 * Planning: what this role wants on the next agenda
 * ------------------------------------------------------------------ */

export type MembershipPlanning = {
  items: PlanningItem[];
  /** Items that could not be derived because the reader may not see them. */
  withheld: { why: string; items: string[] } | null;
  /**
   * The Secretary's agenda builder does not read `PlanningItem` yet, so every
   * item here is a proposal with `acceptedForMeetingId: null`. Surfaced rather
   * than implied: a role filing an item and believing it is on an agenda is
   * worse than a role being told the handoff is not built.
   */
  handoffWired: false;
};

function planningItem(
  item: Omit<PlanningItem, "entity" | "proposedByRole" | "acceptedForMeetingId">,
): PlanningItem {
  return {
    ...item,
    entity: MEMBERSHIP_ENTITY,
    proposedByRole: MEMBERSHIP_ROLE,
    acceptedForMeetingId: null,
  };
}

/** Augmentee applications still waiting on a decision. */
function undecidedAugmentees(applications: Application[]): Application[] {
  return applications.filter(
    (application) =>
      application.isAugmentee &&
      (application.state === "CHAIR_QUEUE" || application.state === "AWAITING_VOUCH"),
  );
}

/**
 * The agenda items this role has, derived where they can be.
 *
 * The composition items come from the report, which needs AGGREGATE and names
 * nobody, so a reader who may not open the roster still gets the board matter
 * that the roster produced. The augmentee item needs READ, because it is a
 * count of named applications; for an aggregate reader it is withheld rather
 * than guessed at or shown as none.
 */
export async function loadMembershipPlanning(
  repo: MembershipRepository,
  subject: Subject,
): Promise<MembershipPlanning> {
  // AGGREGATE, logged, through the module's own library.
  const report = await loadCompositionReport(repo, subject);
  const items: PlanningItem[] = [...compositionPlanning(report), duesPeriodPlanning()];
  const withheldItems: string[] = [];

  if (hasRecords(subject)) {
    await guard(repo, subject, {
      action: "READ_MEMBERSHIP_PLANNING_RECORDS",
      required: "READ",
      rowLevel: true,
    });
    const augmentees = undecidedAugmentees(await repo.listApplications());
    if (augmentees.length > 0) items.push(augmenteePlanning(augmentees.length));
  } else {
    withheldItems.push(
      "Augmentee cases awaiting a decision, which the public site says are decided " +
        "individually and which therefore need a documented decider",
    );
  }

  return {
    items,
    withheld: withheldItems.length > 0 ? { why: WITHHELD_WHY, items: withheldItems } : null,
    handoffWired: false,
  };
}

function compositionPlanning(report: CompositionReport): PlanningItem[] {
  const items: PlanningItem[] = [];

  const war = report.tests.find((test) => test.key === "WAR_VETERANS");
  if (war && !war.passes) {
    const short = requiredNumerator(war.thresholdPermille, war.denominator) - war.numerator;
    items.push(
      planningItem({
        id: "plan-war-veteran-test",
        title:
          "The 90% war-veteran test is failing. What may the Association tell a donor in " +
          "the meantime?",
        type: "DECISION",
        estimateMinutes: 20,
        reason:
          `${war.numerator} of ${war.denominator} counted members are war veterans, ` +
          `${short} short of the line. The test governs whether a gift to the Association ` +
          "is deductible to the giver, and the public pages currently say gifts are " +
          "deductible without qualifying it. The chair cannot fix this by correcting " +
          "records: the numerator moves when the board decides who is recruited, and the " +
          "wording moves when the board decides what the organization is willing to claim. " +
          "Both are the board's, which is why this is here rather than on the chair's queue.",
      }),
    );
  }

  const line = report.tests.find((test) => test.key === "MEMBERS_CADETS_RELATIVES");
  if (line) {
    const slack = line.numerator - requiredNumerator(line.thresholdPermille, line.denominator);
    if (line.passes && slack === 0) {
      items.push(
        planningItem({
          id: "plan-non-qualifying-ceiling",
          title:
            "The 97.5% test is exactly on the line. Admissions policy for a non-qualifying " +
            "applicant",
          type: "DECISION",
          estimateMinutes: 15,
          reason:
            `${line.numerator} of ${line.denominator} with nothing to spare. Unlike the 90% ` +
            "test this one governs the exemption itself, so the next admission in a " +
            "non-qualifying class ends it. The roster's owner should not be deciding that " +
            "application by application without a rule the board has set.",
        }),
      );
    }
  }

  if (report.attestationMismatches + report.missingServiceDates > 0) {
    items.push(
      planningItem({
        id: "plan-revocation-meaning",
        title: "What a revocation means, so the record audit has an outcome other than hold",
        type: "DISCUSSION",
        estimateMinutes: 10,
        reason:
          `${report.attestationMismatches + report.missingServiceDates} record findings are ` +
          "countable today and the audit can only record them and hold. NC's nonprofit " +
          "statute sets no notice period and no hearing requirement for expulsion, so what " +
          "revocation means here comes from the bylaws and the bylaws have not said. The " +
          "platform deliberately ships no revoke control until they do.",
      }),
    );
  }

  return items;
}

/**
 * The one standing item, and the reason it is not derived.
 *
 * Two published statements disagree about what membership costs and how often:
 * the dues figure is presented publicly as a one-time lifetime membership,
 * while this platform's own payment page bills it as annual dues. Nothing in
 * the data can be read to settle that, because both statements are copy. It is
 * on the agenda because the board sets dues and the difference is money
 * charged to members.
 */
function duesPeriodPlanning(): PlanningItem {
  const dollars = (DUES_AMOUNT_CENTS / 100).toFixed(2);
  return planningItem({
    id: "plan-dues-period",
    title: `Dues: $${dollars} once, or $${dollars} a year? The two published answers disagree`,
    type: "DECISION",
    estimateMinutes: 10,
    reason:
      "Membership is presented to the public as a lifetime membership at this figure, and " +
      "the platform's dues page bills the same figure as annual membership dues, three " +
      "times on one screen. Both cannot be right and the difference is money charged to " +
      "members. The board sets dues, so the correction is a minute first and a change to " +
      "the page second.",
  });
}

function augmenteePlanning(count: number): PlanningItem {
  return planningItem({
    id: "plan-augmentee-decider",
    title: "Augmentee cases: who decides, and against what written standard",
    type: "DECISION",
    estimateMinutes: 15,
    reason:
      `${count} augmentee ${count === 1 ? "case is" : "cases are"} waiting. The public site ` +
      "says augmentees are considered case by case, and the state machine routes every one " +
      "of them to the chair whatever the sponsor said. Nothing records who holds that " +
      "decision or what it turns on, so each case is currently decided by whoever opens the " +
      "queue, with no standard anyone could be held to and nothing an applicant could be " +
      "told. The board naming a decider and a standard is what makes the routing mean " +
      "something.",
  });
}

/* ------------------------------------------------------------------ *
 * Projects: a filter over the one register
 * ------------------------------------------------------------------ */

export type MembershipProjects = {
  owned: Project[];
  contributing: Project[];
};

/**
 * Filtered from `@/lib/projects`, which is the whole organization's register.
 *
 * Not a copy and not a membership subset held locally: if a project's owner
 * changes in the register, it changes here. This role owning nothing today is
 * a real answer and the tab says so rather than looking broken.
 */
export function membershipProjects(): MembershipProjects {
  return projectsForRole(MEMBERSHIP_ROLE);
}

export const PROJECTS_PROVENANCE =
  "Filtered from the one org-level register of lines of effort. Nothing on this tab is " +
  "stored by this module, so a project whose owner changes in the register changes here.";

/* ------------------------------------------------------------------ *
 * Outside view: what the world sees of this function
 * ------------------------------------------------------------------ */

export type MembershipOutside = {
  surface: OutsideSurface;
  /**
   * What this role may do about any of it. VP Membership holds no grant on
   * PUBLIC_CONTENT at all, so the role that owns the function these pages
   * describe cannot change a word of them. Computed from the subject rather
   * than asserted, so it stays true if the role table changes.
   */
  publicContentLevel: Level;
};

/** The open question on the member column. Deliberately not answered here. */
export const MEMBER_DIRECTORY_QUESTION =
  "Whether a member directory should exist at all is open, and it is not a feature " +
  "question. A searchable list of who belongs to this community is the one query the " +
  "intake is built never to answer to a stranger, and the exposure concerns that make " +
  "the roster private do not stop applying because the reader is signed in. Nobody has " +
  "decided, so nothing was built, and the absence is on this tab rather than in a backlog.";

export const RELEASE_QUEUE_NOTE =
  "Nothing is queued for release under this role's name, and nothing can be. The " +
  "membership office holds no scope on public content: these pages are the Webmaster's " +
  "to change and need a second approver who is not the author. So the office that owns " +
  "the function cannot correct the page that describes it, which is the handoff to watch " +
  "rather than a gap in this tab.";

function publicItems(): OutsideItem[] {
  return [
    {
      key: "out-jsoa-membership",
      title: "Membership, on the Association page",
      href: "/jsoa#membership",
      audience: "PUBLIC",
      problem: "NONE",
    },
    {
      key: "out-apply",
      title: "Apply for membership — the four-step form",
      href: "/apply",
      audience: "PUBLIC",
      problem: "NONE",
    },
    {
      key: "out-membership-404",
      title: "/membership — the published membership URL",
      href: "/jsoa#membership",
      audience: "PUBLIC",
      problem: "DEAD_LINK",
      note:
        "On the live site this URL returns 404 while still being linked and shared, so a " +
        "prospective member who follows it concludes the Association is not taking " +
        "applications. The content lives in the Membership section of the Association page " +
        "here; the published address still has nothing behind it and nothing redirects it.",
    },
    {
      key: "out-dues-deductibility",
      title: "What the live site says dues are",
      href: "/jsoa#membership",
      audience: "PUBLIC",
      problem: "MISSING_OWNER",
      note:
        "The live site states the membership fee and stops there, with no line saying dues " +
        "are not a charitable contribution. A member who deducts them is relying on the " +
        "page. Nobody owns the tax wording on it, which is why it has stayed that way; the " +
        "rebuilt page carries the line, and the live one is still the page people read.",
    },
  ];
}

function memberItems(): OutsideItem[] {
  const dollars = (DUES_AMOUNT_CENTS / 100).toFixed(2);
  return [
    {
      key: "out-vouch",
      title: "The sponsor vouch page — what a member sees of someone else's application",
      href: "/apply",
      audience: "MEMBER_OR_DONOR",
      problem: "NONE",
    },
    {
      key: "out-acknowledgment",
      title: "The acknowledgment an applicant gets, identical whatever happened underneath",
      href: "/apply/submitted",
      audience: "MEMBER_OR_DONOR",
      problem: "NONE",
    },
    {
      key: "out-dues-page",
      title: "The dues page, after a sponsor has confirmed",
      href: "/apply",
      audience: "MEMBER_OR_DONOR",
      problem: "YEAR_CONTRADICTS_CONTENT",
      note:
        `This page bills $${dollars} as annual membership dues, three times on one screen, ` +
        "while membership is presented publicly as a lifetime membership at the same figure. " +
        "One of the two is wrong and the difference is whether a member is billed again next " +
        "year. It is on the Planning tab as a board item, because dues are the board's to set.",
    },
    {
      key: "out-own-record",
      title: "A member's own roster record",
      href: "/jsoa/contact",
      audience: "MEMBER_OR_DONOR",
      problem: "MISSING_OWNER",
      note:
        "There is no screen on which a signed-in member can read the record held about them, " +
        "and no way to correct it except writing to the membership office. That record " +
        "carries their category, their attested service dates and the war-veteran value " +
        "derived from those dates — the three fields the exemption tests count — so a member " +
        "cannot see the thing most likely to be wrong about them.",
    },
  ];
}

export function membershipOutside(subject: Subject): MembershipOutside {
  return {
    surface: { noExternalSurface: false, items: [...publicItems(), ...memberItems()] },
    publicContentLevel: effectiveLevel(subject, "PUBLIC_CONTENT", MEMBERSHIP_ENTITY),
  };
}
