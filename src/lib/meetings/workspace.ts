/**
 * The Secretary's role workspace: the five spine tabs, built as FILTERS over
 * data that already exists. See `docs/ROLE-WORKSPACE.md`.
 *
 * Nothing in this file is a store. Every function here reads the module's own
 * repository or the org-level registers and narrows what it finds to this
 * office. A per-role copy of the compliance calendar, the minute book or the
 * lines-of-effort register would be a second source of truth that drifts from
 * the first, and six roles each with their own copy is six doors into one room,
 * five of which go stale.
 *
 * Five rules this file keeps, each of them a reaction to how this particular
 * office fails.
 *
 * 1. **Two books, never one count.** JSOA and JSOF meet the same evening with
 *    the same people. Separate minute books are the cheapest evidence the
 *    separation is real, so every list here is grouped or labelled per entity
 *    and nothing is summed across the two. A blended figure is exactly the
 *    ambiguity two books exist to prevent.
 *
 * 2. **Tasks are derived, never entered.** They come from `secretaryDashboard`,
 *    which computes them from the state of the books, plus the filings this
 *    office owns. A task list somebody has to populate is dead within a cycle
 *    on a volunteer board, which is the failure this platform replaces.
 *
 * 3. **An unverified or blocked calendar entry is never an obligation.** Not in
 *    a count, not in a due-soon list, not in anything the board could act on.
 *    It stays visible as work to resolve, because hiding it loses the question
 *    and counting it invents a duty. `RoleCalendarItem.unverified` carries it.
 *
 * 4. **The notice period is an assumption and says so wherever it is used.**
 *    NC supplies no statutory board-notice period for a nonprofit and the
 *    bylaws govern, so the 7-day and 48-hour figures are this platform's own.
 *    `NOTICE_BASIS_NOTE` travels with every screen that measures against them.
 *
 * 5. **Authorization is read through `access.ts` and never widened.** Agenda,
 *    meeting list and compliance calendar are governance reads (aggregate, no
 *    identity in the record). The minute book is a row-level read because it
 *    names who moved, who seconded and who recused. Writing anything requires
 *    the office of Secretary for that entity on top of `authorize()` — that
 *    additional requirement is this module's, and nothing here relaxes it. A
 *    figure or an item this reader may not see is WITHHELD, which is neither
 *    absent nor zero, and the caller is told which entity was withheld.
 */

import { ENTITIES, type Entity, type Role } from "../authz/model";
import type { Subject } from "../authz/policy";
import { PROJECTS, projectsForRole, type Project } from "../projects/register";
import type {
  OutsideSurface,
  PlanningItem,
  RoleCalendarItem,
  RoleTask,
  TaskUrgency,
} from "../workspace/types";
import {
  MINUTE_BOOK_CUSTODIAN,
  authorizeGovernanceRead,
  canReadGovernance,
} from "./access";
import { DUE_SOON_DAYS, daysUntil } from "./calendar";
import { NOTICE_BASIS_NOTE } from "./distribution";
import { DUE_HORIZON_DAYS, secretaryDashboard } from "./kpis";
import { meetingsRepository, type MeetingsRepository } from "./repository";
import type { AgendaItem, ComplianceItem, Meeting } from "./types";

/** The office this workspace belongs to. Taken from `access.ts`, not restated. */
export const WORKSPACE_ROLE: Role = MINUTE_BOOK_CUSTODIAN;

/**
 * One horizon for the whole module, re-exported so a screen never picks its
 * own. `kpis.ts` explains why it is 60 and where it came from.
 */
export const HORIZON_DAYS = DUE_HORIZON_DAYS;

/** Repeated on every screen that measures against the notice period. */
export { NOTICE_BASIS_NOTE };

/* ------------------------------------------------------------------ *
 * Shared, guarded reads
 * ------------------------------------------------------------------ */

/** Entities this subject may read at governance level, in fixed order. */
function governanceEntities(subject: Subject): Entity[] {
  return ENTITIES.filter((entity) => canReadGovernance(subject, entity));
}

/** Entities this subject may NOT read. Withheld is not the same as empty. */
function withheldEntities(subject: Subject): Entity[] {
  return ENTITIES.filter((entity) => !canReadGovernance(subject, entity));
}

/**
 * The compliance entries this office owns, per entity, guarded before the
 * first read. Ownership is by role, never by person: offices turn over and
 * duties do not.
 */
async function ownedFilings(
  subject: Subject,
  repo: MeetingsRepository,
): Promise<{ entity: Entity; items: ComplianceItem[] }[]> {
  const books: { entity: Entity; items: ComplianceItem[] }[] = [];
  for (const entity of governanceEntities(subject)) {
    // Still before the first read, and still per entity. The await moved; the
    // order of the guard and the read did not.
    authorizeGovernanceRead(subject, entity);
    const items = await repo.listComplianceItems(entity);
    books.push({
      entity,
      items: items.filter((item) => item.ownerRole === WORKSPACE_ROLE),
    });
  }
  return books;
}

/** Meetings of one entity still ahead, soonest first. Guarded by the caller. */
async function upcomingMeetings(
  repo: MeetingsRepository,
  entity: Entity,
  now: Date,
): Promise<Meeting[]> {
  return (await repo.listMeetings(entity))
    .filter((meeting) => Date.parse(meeting.scheduledStart) >= now.getTime())
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
}

/* ------------------------------------------------------------------ *
 * Overview: derived tasks
 * ------------------------------------------------------------------ */

/**
 * Everything waiting on this office, derived from the state of the books.
 *
 * The dashboard already computes the doing — the outstanding minute books, the
 * unadopted agendas, the notice that has not gone out, the two quarantined
 * calendar questions — so this lifts that list rather than deriving it twice,
 * and adds the filings this office owns. `because` says what each one blocks,
 * because a bare count ("2 waiting") tells a volunteer nothing about whether
 * to open it tonight.
 */
export async function secretaryTasks(
  subject: Subject,
  now: Date = new Date(),
  repo?: MeetingsRepository,
): Promise<RoleTask[]> {
  const reader = repo ?? (await meetingsRepository());
  const dashboard = await secretaryDashboard(subject, now, reader);

  const tasks: RoleTask[] = dashboard.actions.map((action) => ({
    key: action.key,
    label: action.label,
    // `blocks` is written for this list; `note` is the dashboard's wording and
    // is the fallback rather than the first choice.
    because: action.blocks ?? action.note,
    count: action.count,
    urgency: action.urgency ?? (action.urgent ? "overdue" : "open"),
    href: action.href,
    entity: action.entity,
    dueOn: action.dueOn,
  }));

  for (const book of await ownedFilings(subject, reader)) {
    for (const item of book.items) {
      // Rule 3. The quarantine happens before anything becomes a task: an
      // unverified duty and a duty blocked pending confirmation that it applies
      // at all are both questions to resolve, and the dashboard already carries
      // them as exactly that. Neither becomes a filing task here.
      if (!item.verified || item.status === "BLOCKED" || item.status === "FILED") continue;
      const days = daysUntil(item.dueDate, now);
      if (days > HORIZON_DAYS) continue;
      tasks.push({
        key: `file-${item.id}`,
        label: `File ${item.title}`,
        because: item.selfDeclaring
          ? `Due in the ${book.entity} book of duties. The carrier or registrar sends a ` +
            "notice for this one, so the risk is the confirmation never being filed " +
            "rather than the date being missed."
          : "Nothing will remind you. This duty does not renew itself and sends no " +
            "notice when it lapses, and soliciting on a lapsed licence is the exposure. " +
            "The filed confirmation is the evidence, not the filing.",
        count: 1,
        urgency: days < 0 ? "overdue" : "soon",
        href: "/board/meetings/calendar",
        entity: book.entity,
        dueOn: item.dueDate,
      });
    }
  }

  return tasks;
}

/* ------------------------------------------------------------------ *
 * Overview: calendar
 * ------------------------------------------------------------------ */

/** A calendar entry nobody can act on yet, and why. Kept, never counted. */
export type UnresolvedEntry = {
  key: string;
  title: string;
  entity: Entity;
  /** The date shown on the entry, which is a placeholder rather than a deadline. */
  shownDate: string;
  reason: "UNVERIFIED" | "BLOCKED";
  /** One line: what is unresolved, and what resolving it would take. */
  note: string;
  href: string;
};

export type SecretaryCalendar = {
  /** Filings this office owns plus meetings ahead, both entities, labelled. */
  items: RoleCalendarItem[];
  /**
   * Entries that may legitimately be called obligations: verified, not filed,
   * not blocked. Reported per entity because the two books are never added.
   */
  obligations: { entity: Entity; count: number }[];
  /** Quarantined entries. Visible as work, absent from every count. */
  unresolved: UnresolvedEntry[];
  withheld: Entity[];
};

const FILING_KIND: Record<ComplianceItem["kind"], RoleCalendarItem["kind"]> = {
  IRS: "FILING",
  STATE_CORPORATE: "FILING",
  STATE_CHARITABLE: "RENEWAL",
  INSURANCE: "RENEWAL",
  INFRASTRUCTURE: "RENEWAL",
};

/**
 * The shared compliance calendar, narrowed to what this office owns, plus the
 * meetings ahead.
 *
 * The quarantine is the whole point of this function. Three of the five entries
 * this office owns cannot be counted:
 *
 *   - One is UNVERIFIED. A new NC nonprofit annual reporting duty is reported
 *     to commence 1 January 2027 under a 2026 session law. Nobody has read the
 *     law. The date is a reported commencement, not a deadline the board owes.
 *   - Two are BLOCKED. The NC Secretary of State annual report sits in the
 *     business corporation act and may not carry across to nonprofits at all,
 *     so both entities' entries carry a placeholder date explicitly described
 *     in the source note as not a deadline.
 *
 * All three take `unverified: true`, which the shared type defines as "the date
 * is a placeholder or the duty itself is unconfirmed" — true of all three, by
 * different routes. They stay in `items` so they are visible, and they are
 * excluded from `obligations` so nothing can act on them.
 */
export async function secretaryCalendar(
  subject: Subject,
  now: Date = new Date(),
  repo?: MeetingsRepository,
): Promise<SecretaryCalendar> {
  const reader = repo ?? (await meetingsRepository());
  const items: RoleCalendarItem[] = [];
  const unresolved: UnresolvedEntry[] = [];
  const obligations: { entity: Entity; count: number }[] = [];

  for (const book of await ownedFilings(subject, reader)) {
    let count = 0;
    for (const item of book.items) {
      const quarantined = !item.verified || item.status === "BLOCKED";
      items.push({
        key: item.id,
        title: item.title,
        on: item.dueDate,
        entity: item.entity,
        kind: FILING_KIND[item.kind],
        ownerRole: item.ownerRole,
        href: "/board/meetings/calendar",
        unverified: quarantined || undefined,
      });
      if (quarantined) {
        unresolved.push({
          key: item.id,
          title: item.title,
          entity: item.entity,
          shownDate: item.dueDate,
          reason: item.verified ? "BLOCKED" : "UNVERIFIED",
          note: item.sourceNote,
          href: "/board/meetings/calendar",
        });
        continue;
      }
      if (item.status !== "FILED") count += 1;
    }
    obligations.push({ entity: book.entity, count });

    for (const meeting of await upcomingMeetings(reader, book.entity, now)) {
      items.push({
        key: meeting.id,
        title: meeting.title,
        on: meeting.scheduledStart.slice(0, 10),
        entity: meeting.entity,
        kind: "MEETING",
        ownerRole: WORKSPACE_ROLE,
        href: `/board/meetings/${meeting.id}/agenda`,
      });
    }
  }

  return { items, obligations, unresolved, withheld: withheldEntities(subject) };
}

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

export type PlanningForMeeting = {
  meeting: Meeting;
  /** Items on the next agenda that are this office's own to bring. */
  mine: PlanningItem[];
  /** Items other offices have already got onto that agenda. */
  fromOtherRoles: PlanningItem[];
  /** True once the agenda is adopted and item numbers are frozen. */
  adopted: boolean;
};

export type SecretaryPlanning = {
  /** One entry per entity whose next meeting this reader may see. Never merged. */
  meetings: PlanningForMeeting[];
  withheld: Entity[];
  /**
   * Whether any other module exposes its role's proposed items yet.
   *
   * False, and not a stub: nothing outside this module exports a
   * `PlanningItem`. `src/lib/workspace/types.ts` defines the shape and no
   * module has filled it in, so the inbound half of this tab has no source to
   * read. Reaching into another module's internals to fake it would build
   * exactly the cross-module coupling the module brief forbids, so the tab
   * says so instead.
   */
  inboundQueueAvailable: false;
  /** What the inbound half will read when a module publishes it. */
  inboundNote: string;
};

export const INBOUND_PLANNING_NOTE =
  "This is the one role that receives everyone else's planning items, and the " +
  "inbound half does not exist yet. No module outside this one exports a " +
  "planning item: the shared shape is defined and nothing fills it. What is " +
  "shown below as coming from other offices is items that have already reached " +
  "an agenda, which is the end of that journey rather than the queue before " +
  "it. A proposal filed by another role and not yet taken up has nowhere to " +
  "live, so for now it arrives the way it always has, by message.";

/**
 * An agenda item read as a planning item.
 *
 * `acceptedForMeetingId` is set only once the agenda is ADOPTED. An item on a
 * draft agenda is a proposal the Secretary is still holding: its number can
 * still move, so nothing may cite it yet. Adoption is the moment it is taken
 * onto the record, and the item numbers freeze there.
 */
function asPlanningItem(item: AgendaItem, meeting: Meeting): PlanningItem {
  return {
    id: item.id,
    entity: item.entity,
    title: item.title,
    type: item.type,
    estimateMinutes: item.estimatedMinutes,
    reason:
      item.note ??
      (item.type === "DECISION"
        ? "Needs the board because it closes with a motion, a seconder and a recorded vote."
        : item.type === "INFORMATION"
          ? "The board is being asked to produce something. Who was asked, and by when."
          : "For discussion. Nothing is resolved and no motion is expected."),
    proposedByRole: item.ownerRole,
    acceptedForMeetingId: meeting.agendaAdoptedAt ? meeting.id : null,
  };
}

/**
 * This office's own items for the next meeting of each entity, and what other
 * offices have already got onto those agendas.
 *
 * Governance-level read: an agenda names roles and titles, never a person.
 */
export async function secretaryPlanning(
  subject: Subject,
  now: Date = new Date(),
  repo?: MeetingsRepository,
): Promise<SecretaryPlanning> {
  const reader = repo ?? (await meetingsRepository());
  const meetings: PlanningForMeeting[] = [];

  for (const entity of governanceEntities(subject)) {
    authorizeGovernanceRead(subject, entity);
    const next = (await upcomingMeetings(reader, entity, now))[0];
    if (!next) continue;
    const items = await reader.listAgendaItems(next.id);
    meetings.push({
      meeting: next,
      adopted: next.agendaAdoptedAt !== null,
      mine: items
        .filter((item) => item.ownerRole === WORKSPACE_ROLE)
        .map((item) => asPlanningItem(item, next)),
      fromOtherRoles: items
        .filter((item) => item.ownerRole !== WORKSPACE_ROLE)
        .map((item) => asPlanningItem(item, next)),
    });
  }

  return {
    meetings,
    withheld: withheldEntities(subject),
    inboundQueueAvailable: false,
    inboundNote: INBOUND_PLANNING_NOTE,
  };
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export type SecretaryProjects = {
  owned: Project[];
  contributing: Project[];
  /** The whole register's size, so the filter is visibly a filter. */
  registerSize: number;
  withheld: Entity[];
};

/**
 * The org-level lines-of-effort register, filtered to this office.
 *
 * A filter, never a copy: `PROJECTS` is the single register and this function
 * selects from it. Most of this work crosses roles, and a per-role store would
 * hide exactly the handoffs where this organization loses things.
 *
 * Entity scope still applies. A project belongs to an entity, and a reader with
 * no governance grant on that entity does not see it listed — withheld, not
 * absent.
 */
export function secretaryProjects(subject: Subject): SecretaryProjects {
  const visible = governanceEntities(subject);
  const { owned, contributing } = projectsForRole(WORKSPACE_ROLE);
  const inScope = (project: Project) => visible.includes(project.entity);
  return {
    owned: owned.filter(inScope),
    contributing: contributing.filter(inScope),
    registerSize: PROJECTS.length,
    withheld: withheldEntities(subject),
  };
}

/* ------------------------------------------------------------------ *
 * Outside view
 * ------------------------------------------------------------------ */

/**
 * The public pages this office owns: none, and that is the correct answer
 * rather than a missing one.
 *
 * The Secretary's output is the minute book, which is internal by design. A
 * minute names who moved, who seconded and who recused, and publishing that is
 * not transparency, it is an OPSEC problem with a byline. There is no page on
 * either public site whose staleness is this office's to fix, nothing of this
 * office's in the release queue, and nothing it would ever self-publish.
 *
 * Said plainly, because an empty screen implies breakage and a stated reason
 * does not.
 */
export const SECRETARY_OWNED_PAGES: OutsideSurface = {
  noExternalSurface: true,
  whyEmpty:
    "This office owns no public page, and that is by design rather than an " +
    "oversight. Its output is the minute book, which names who moved, who " +
    "seconded and who recused — the one record in this platform that is " +
    "internal on purpose. So there is nothing here to go stale, nothing of " +
    "this office's awaiting a second approver, and nothing it publishes. What " +
    "the outside world does get from this office is not a page: it is " +
    "documents produced on request and notices sent to the people entitled to " +
    "them, set out below.",
  items: [],
};

/**
 * What IS public, even though no page is.
 *
 * Two audiences, side by side and never blurred into one "outside", because
 * conflating them is how the OPSEC problems start. Nothing here is a page this
 * office maintains, so every link goes to where the duty or the record is
 * tracked inside the platform rather than pretending at a published document.
 *
 * `noticeHref` points at the next meeting's distribution screen when there is
 * one, so the member-facing row leads to the actual send rather than a tab.
 */
export function secretaryPublicRecord(noticeHref = "/board/meetings"): OutsideSurface {
  return {
    noExternalSurface: false,
    items: [
      {
        key: "990-jsoa",
        title: "IRS Form 990, Association, open to public inspection on request",
        href: "/board/meetings/calendar",
        audience: "PUBLIC",
        problem: "NONE",
      },
      {
        key: "990-jsof",
        title: "IRS Form 990, Foundation, open to public inspection on request",
        href: "/board/meetings/calendar",
        audience: "PUBLIC",
        problem: "NONE",
      },
      {
        key: "determination-jsoa",
        title: "IRS determination letter, Association, 501(c)(19)",
        href: "/board/meetings/calendar",
        audience: "PUBLIC",
        problem: "NONE",
      },
      {
        key: "determination-jsof",
        title: "IRS determination letter, Foundation, 501(c)(3)",
        href: "/board/meetings/calendar",
        audience: "PUBLIC",
        problem: "NONE",
      },
      {
        key: "notice-of-meeting",
        title: "Official notice of a board meeting, with the agenda, to the offices entitled to it",
        href: noticeHref,
        audience: "MEMBER_OR_DONOR",
        problem: "NONE",
      },
      {
        key: "members-inspection",
        title: "Records a member asks to inspect",
        href: "/board/meetings/decisions",
        audience: "MEMBER_OR_DONOR",
        problem: "MISSING_OWNER",
        note:
          "NC's nonprofit act gives members a records-inspection right, and which " +
          "of these records it reaches has not been settled here. Nothing is " +
          "asserted about it and no path exists to answer such a request. " +
          "Unresolved rather than built.",
      },
    ],
  };
}

/**
 * One line each, for the copy beside the two columns. Separated from the items
 * so the page never has to invent the reasoning.
 */
export const PUBLIC_RECORD_NOTES = {
  returns:
    "The 990s and the exemption determination letters are open to public " +
    "inspection on request. Filing the 990 is the Treasurer's duty and it is " +
    "on the compliance calendar under that office; producing the copy when " +
    "somebody asks for it is this one's. Two entities means two returns and " +
    "two letters, and they are never produced as a consolidated set.",
  notices:
    "Notice of a meeting and the agenda go to offices rather than to named " +
    "people, the same way the public tier lists contacts by function. The " +
    "notice period they are measured against is this platform's assumption " +
    "and not law.",
  gap:
    "Not built, and named rather than left as an empty space: there is no path " +
    "here for notice of a members' meeting, and no path for answering a " +
    "member's request to inspect records. Both are this office's work in a " +
    "real year.",
} as const;

/* ------------------------------------------------------------------ *
 * Small shared helpers for the tabs
 * ------------------------------------------------------------------ */

/** How many tasks sit at each urgency. A legend, never a score. */
export function taskCountsByUrgency(tasks: RoleTask[]): Record<TaskUrgency, number> {
  return tasks.reduce(
    (counts, task) => ({ ...counts, [task.urgency]: counts[task.urgency] + 1 }),
    { overdue: 0, soon: 0, open: 0 } as Record<TaskUrgency, number>,
  );
}

/** Minutes committed by a set of planning items. Never across two entities. */
export function planningMinutes(items: PlanningItem[]): number {
  return items.reduce((total, item) => total + item.estimateMinutes, 0);
}

/** The window every screen in this module measures "due soon" over. */
export const HORIZON_NOTE =
  `Due within ${DUE_SOON_DAYS} days throughout this module, from one constant. ` +
  "The dashboard figure and the compliance page now mean the same window; they " +
  "did not before, when the dashboard used 90 days and the page used 60.";
