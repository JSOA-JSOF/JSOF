/**
 * The Treasurer's role workspace: the four spine tabs that are not the
 * Dashboard. See docs/ROLE-WORKSPACE.md, which is binding.
 *
 * The rule that shapes this file is "build a filter, not a copy". Nothing here
 * stores a calendar, a project or a task. The compliance calendar is read from
 * `@/lib/meetings`, the lines of effort from `@/lib/projects`, and every task
 * and planning item is computed from the treasury repository's own authorized
 * reads. If this file ever grows a seed array of its own, that is the mistake
 * the rule names.
 *
 * The no-blend rule is structural here too, and it is the reason several of
 * these functions return a list where a single value would have been shorter:
 *
 *   - A subscription shared by both entities produces TWO calendar rows and
 *     TWO planning items, each carrying that entity's apportioned share. There
 *     is no row anywhere holding the invoice total, because the invoice total
 *     is a figure about an organization that does not exist.
 *   - A figure the reader has no scope for is WITHHELD and counted, never
 *     rendered as zero or quietly dropped. Zero is a claim about the entity;
 *     withheld is a claim about the reader.
 *
 * Authorization: every read goes through the repository, which checks scope
 * per entity before it computes anything. A refusal is caught and turned into
 * a withheld count. Nothing here widens a grant to fill a tab.
 *
 * Imports are relative, not `@/`: the test runner has no path alias.
 */

import { ENTITIES, type Entity, type Role } from "../authz/model";
import { AuthzError, can, type Subject } from "../authz/policy";
import { meetingsRepository } from "../meetings/repository";
import type { ComplianceItem } from "../meetings/types";
import { projectsForRole, type Project } from "../projects/register";
import type {
  OutsideItem,
  OutsideSurface,
  PlanningItem,
  RoleCalendarItem,
  RoleTask,
  TaskUrgency,
} from "../workspace/types";
import { treasuryDashboard, type TreasuryAction } from "./kpis";
import { formatCentsWithSymbol, TreasuryError } from "./money";
import {
  treasuryRepository,
  type InMemoryTreasuryRepository,
  type SodPanel,
} from "./repository";
import { REVIEW_DECISION_LABELS, type SubscriptionRegister, type SubscriptionRow } from "./types";

/** The office this workspace belongs to. */
export const ROLE: Role = "TREASURER";

/**
 * The Treasurer's own work, appended after the five spine tabs.
 *
 * These keep the routes they already had: the spine was added in front of them
 * rather than over them, so no link anybody has saved or minuted breaks. The
 * ledger is two tabs rather than one with an entity picker, because a picker
 * implies there is a position you could reach by selecting "both", and there
 * is not.
 */
export const TREASURY_FUNCTION_TABS: readonly { href: string; label: string }[] = [
  { href: "/board/treasury/ledger/JSOA", label: "Ledger, JSOA" },
  { href: "/board/treasury/ledger/JSOF", label: "Ledger, JSOF" },
  { href: "/board/treasury/transfers", label: "Transfers" },
  { href: "/board/treasury/subscriptions", label: "Subscriptions" },
  { href: "/board/treasury/controls", label: "Controls" },
  { href: "/board/treasury/reimbursements", label: "Reimbursements" },
];

const ENTITY_NAME: Record<Entity, string> = {
  JSOA: "Association",
  JSOF: "Foundation",
};

/**
 * Offices in the words a minute would use.
 *
 * The role identifiers are the authorization model's and belong in code. A
 * board member reading "TREASURER and STORE_CHAIR" on their own agenda is
 * being shown the database, so the screens get these instead.
 */
export const ROLE_LABELS: Record<Role, string> = {
  PRESIDENT: "President",
  VP_OPERATIONS: "VP Operations",
  VP_MEMBERSHIP: "VP Membership",
  SECRETARY: "Secretary",
  TREASURER: "Treasurer",
  FUNDRAISING_CHAIR: "Fundraising Chair",
  SCHOLARSHIPS_CHAIR: "Scholarships Chair",
  SCHOLARSHIP_REVIEWER: "Scholarship reviewer",
  STORE_CHAIR: "Store and Sales Chair",
  MEMORIAL_CHAIR: "Memorial Chair",
  WEBMASTER: "Webmaster",
  COMMUNICATIONS_CHAIR: "Communications Chair",
  EVENTS_CHAIR: "Events Chair",
  FAMILY_SUPPORT_CHAIR: "Family Support Chair",
  FINANCE_REVIEW_OFFICER: "Finance Review Officer",
  MEMBER: "Member",
  DONOR: "Donor",
};

function roleList(roles: readonly Role[]): string {
  return roles.map((role) => ROLE_LABELS[role]).join(" and ");
}

/* ------------------------------------------------------------------ *
 * Scope
 * ------------------------------------------------------------------ */

/**
 * Entities this reader may be shown figures for.
 *
 * AGGREGATE, not READ: a renewal commitment or a filing date is a totals-level
 * fact, and the Secretary and the President legitimately see those without
 * holding row-level ledger scope. Row-level reads still gate separately in the
 * repository.
 */
export function entitiesInScope(subject: Subject): Entity[] {
  return ENTITIES.filter((entity) =>
    can({ subject, dataClass: "FINANCIAL", entity, required: "AGGREGATE" }),
  );
}

type Refusable<T> = { ok: true; value: T } | { ok: false; code: string };

function attempt<T>(read: () => T): Refusable<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    if (error instanceof AuthzError || error instanceof TreasuryError) {
      return { ok: false, code: error.code };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * How far ahead the Overview's calendar looks. Twelve months.
 *
 * A quarter was the first answer and it was wrong: this office's duties are
 * annual. The Treasurer's only filings are the two 990s, due the fifteenth day
 * of the fifth month after the year ends, and nobody sends a reminder for
 * either one. A horizon that cannot see them hides the single date on this
 * screen that has a penalty attached.
 */
export const CALENDAR_HORIZON_DAYS = 365;

/**
 * The monthly close: the books for the month that has just ended, closed by
 * the fifteenth of the next one.
 *
 * Derived from the as-of date rather than stored, because a stored list of
 * close dates is a per-role copy of something arithmetic already knows, and it
 * goes stale the first month nobody updates it.
 */
export function monthlyCloseDate(asOf: string): string {
  const [year, month] = asOf.split("-").map(Number);
  const closeThisMonth = `${asOf.slice(0, 7)}-15`;
  if (asOf <= closeThisMonth) return closeThisMonth;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-15`;
}

/** Which month's books the close on `closeOn` covers. */
function closedPeriodLabel(closeOn: string): string {
  const [year, month] = closeOn.split("-").map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${names[prevMonth - 1]} ${prevYear}`;
}

/* ------------------------------------------------------------------ *
 * 1. Overview: tasks
 * ------------------------------------------------------------------ */

/**
 * The dashboard's action list, lifted to the Overview as derived tasks.
 *
 * Not re-derived: `treasuryDashboard` already computes these from one
 * authorized read, and computing them twice would mean two screens could
 * disagree about how many claims are waiting. This function is the mapping and
 * nothing else.
 */
export function toRoleTask(action: TreasuryAction): RoleTask {
  return {
    key: action.key,
    label: action.label,
    because: action.because,
    count: action.countValue,
    urgency: action.urgency,
    href: action.href,
    entity: action.entity,
    dueOn: action.dueOn,
  };
}

export function treasurerTasks(
  subject: Subject,
  repo: InMemoryTreasuryRepository = treasuryRepository(),
): RoleTask[] {
  return treasuryDashboard(subject, repo).actions.map(toRoleTask);
}

/* ------------------------------------------------------------------ *
 * 1. Overview: calendar
 *
 * Three sources, one list. Filing dates come from the ONE compliance calendar
 * in the Secretary's module, filtered to the duties whose owning office is the
 * Treasurer — not copied, so when a date moves there it moves here. Renewals
 * come from the subscription register. The monthly close is arithmetic.
 * ------------------------------------------------------------------ */

export type TreasurerCalendar = {
  items: RoleCalendarItem[];
  /** Dated items in the window that the reader holds no scope for. */
  withheldCount: number;
  horizonEndDate: string;
  /** Entities whose dated items are withheld, so the screen can name them. */
  withheldEntities: Entity[];
};

/** Compliance duties owned by the Treasurer, from the shared calendar. */
function treasurerFilings(scope: Entity[]): ComplianceItem[] {
  let all: ComplianceItem[] = [];
  try {
    all = meetingsRepository().listComplianceItems();
  } catch {
    // The compliance calendar is another module's. If it cannot be read, the
    // Treasurer's own dated items still render; the tab says what is missing
    // rather than pretending there are no filings.
    return [];
  }
  return all.filter(
    (item) => item.ownerRole === ROLE && scope.includes(item.entity),
  );
}

export function treasurerCalendar(
  subject: Subject,
  repo: InMemoryTreasuryRepository = treasuryRepository(),
): TreasurerCalendar {
  const asOf = repo.asOfDate();
  const horizonEndDate = addDays(asOf, CALENDAR_HORIZON_DAYS);
  const scope = entitiesInScope(subject);
  const withheldEntities = ENTITIES.filter((entity) => !scope.includes(entity));
  const items: RoleCalendarItem[] = [];
  let withheldCount = 0;

  /* --- Filings that are the Treasurer's ---------------------------- */

  for (const filing of treasurerFilings(scope)) {
    items.push({
      key: `filing-${filing.id}`,
      title: filing.title,
      on: filing.dueDate,
      entity: filing.entity,
      kind: "FILING",
      ownerRole: filing.ownerRole,
      href: "/board/meetings/calendar",
      // An unverified duty is never counted as an obligation. The flag is the
      // shared calendar's, carried through rather than re-decided here.
      unverified: !filing.verified,
    });
  }

  // Filings owned by the Treasurer on an entity out of scope are counted, not
  // listed. The duty exists; the reader is not the one who owes it.
  for (const entity of withheldEntities) {
    withheldCount += treasurerFilings([entity]).length;
  }

  /* --- Renewals, with the cash each entity commits ----------------- */

  const register = attempt(() => repo.subscriptionRegister(subject));
  if (register.ok) {
    for (const row of register.value.rows) {
      const renewalDate = row.subscription.renewalDate;
      if (renewalDate === null) continue;
      if (renewalDate < asOf || renewalDate > horizonEndDate) continue;

      /* One row PER ENTITY bearing a share. A tool shared by both entities
         renews once and commits two different sums, so it appears twice with
         two labelled figures. There is no row carrying the invoice total. */
      for (const part of row.annualByEntity) {
        if (!scope.includes(part.entity)) {
          withheldCount += 1;
          continue;
        }
        if (part.amountCents === 0) continue;
        items.push({
          key: `renewal-${row.subscription.id}-${part.entity}`,
          title:
            `${row.subscription.tool} renews, committing ` +
            `${formatCentsWithSymbol(part.amountCents)} of ${ENTITY_NAME[part.entity]} money ` +
            `for the year` +
            (row.annualByEntity.length > 1
              ? ` (${ENTITY_NAME[part.entity]} share of one shared invoice)`
              : ""),
          on: renewalDate,
          entity: part.entity,
          kind: "RENEWAL",
          ownerRole: row.subscription.owningRole,
          href: "/board/treasury/subscriptions",
        });
      }
    }
  } else {
    withheldCount += 1;
  }

  /* --- The monthly close ------------------------------------------- */

  const closeOn = monthlyCloseDate(asOf);
  for (const entity of scope) {
    items.push({
      key: `close-${entity}-${closeOn}`,
      title:
        `Close the ${ENTITY_NAME[entity]} books for ${closedPeriodLabel(closeOn)}: ` +
        `bank and processor statements agreed to the ledger, and the reconciliation ` +
        `filed. Monthly; this is the next one`,
      on: closeOn,
      entity,
      kind: "CYCLE",
      ownerRole: ROLE,
      href: `/board/treasury/ledger/${entity}`,
    });
  }

  return {
    items: items
      .filter((item) => item.on >= asOf && item.on <= horizonEndDate)
      .sort((a, b) => a.on.localeCompare(b.on) || a.key.localeCompare(b.key)),
    withheldCount,
    horizonEndDate,
    withheldEntities,
  };
}

/* ------------------------------------------------------------------ *
 * 3. Planning: what the Treasurer wants on the next agenda
 *
 * Derived, like the tasks. An item here is a thing the board must decide that
 * the Treasurer cannot decide alone, and each one is computed from state the
 * other tabs already show rather than typed into a form.
 * ------------------------------------------------------------------ */

export type TreasurerPlanning = {
  items: PlanningItem[];
  /** Items whose source finding is outside the reader's audit scope. */
  withheldCount: number;
  /**
   * Renewals inside the window that deliberately did NOT become an agenda
   * item, and why. Said out loud so the absence reads as a judgement rather
   * than a gap.
   */
  silentRenewals: { entity: Entity; tool: string; why: string }[];
  totalEstimateMinutes: number;
};

/**
 * A renewal wants the board rather than a silent charge when the money is
 * committed AND one of three things is true: the line carries a serious
 * finding, nobody has reviewed it inside a year, or the board already decided
 * to stop paying for it and it is still being paid for.
 *
 * That last case is the one worth having. A register where "cancel" was
 * minuted in September and the line renews in November is not a register, it
 * is a direct debit with notes attached.
 */
function renewalWantsADecision(row: SubscriptionRow): string | null {
  const serious = row.findings.filter(
    (finding) => finding.severity === "critical" || finding.severity === "high",
  );
  if (serious.length > 0) return serious[0].finding;

  const decision = row.subscription.lastReviewDecision;
  if (decision === "cancel" || decision === "downgrade" || decision === "consolidate") {
    return (
      `The board's standing decision on this line is ` +
      `"${REVIEW_DECISION_LABELS[decision].toLowerCase()}" and it is still being paid for ` +
      `in full. A decision nobody actioned is not a decision.`
    );
  }

  const stale = row.findings.find((finding) => finding.code === "STALE_REVIEW");
  if (stale) return stale.finding;

  return null;
}

export function treasurerPlanning(
  subject: Subject,
  repo: InMemoryTreasuryRepository = treasuryRepository(),
): TreasurerPlanning {
  const scope = entitiesInScope(subject);
  const items: PlanningItem[] = [];
  const silentRenewals: TreasurerPlanning["silentRenewals"] = [];
  let withheldCount = 0;

  /* --- The separation-of-duties finding ----------------------------- */

  const sod: Refusable<SodPanel> = attempt(() => repo.separationOfDuties(subject));

  if (sod.ok) {
    withheldCount += sod.value.withheldCount;

    const treasuryFindings = sod.value.current.filter((finding) =>
      finding.roles.includes(ROLE),
    );

    for (const finding of treasuryFindings) {
      items.push({
        id: `plan-sod-${finding.personId}-${finding.entity}-${finding.roles.join("-")}`,
        entity: finding.entity,
        title:
          finding.severity === "critical"
            ? `Decide what to do about ${roleList(finding.roles)} sitting in one pair of hands`
            : `Decide what to do about the ${roleList(finding.roles)} finding`,
        type: "DECISION",
        estimateMinutes: finding.severity === "critical" ? 20 : 10,
        reason:
          `${finding.finding} ${finding.mitigation} The board either remedies it or ` +
          `accepts it knowingly in a minute; it cannot be left as a note on a screen, ` +
          `and the platform will keep raising it until one of those two things is on ` +
          `the record.`,
        proposedByRole: ROLE,
        acceptedForMeetingId: null,
      });
    }

    /* The Finance Review Officer is the named mitigation on the critical
       finding, so the appointment is DERIVED from the finding rather than
       being a wish somebody typed. Where the seat is already filled, the
       outstanding part is the thing that makes it real: statements arriving
       directly from the institution, unopened by either Treasurer. */
    const needsReviewer = treasuryFindings.filter((finding) =>
      finding.mitigation.includes("Finance Review Officer"),
    );
    for (const finding of needsReviewer) {
      const filled = repo
        .separationOfDuties(subject)
        .people.some((person) =>
          person.assignments.some(
            (assignment) =>
              assignment.role === "FINANCE_REVIEW_OFFICER" &&
              assignment.entity === finding.entity,
          ),
        );
      items.push({
        id: `plan-fro-${finding.entity}`,
        entity: finding.entity,
        title: filled
          ? `Confirm the Finance Review Officer receives ${ENTITY_NAME[finding.entity]} statements directly, unopened`
          : `Appoint a Finance Review Officer for the ${ENTITY_NAME[finding.entity]}`,
        type: "DECISION",
        estimateMinutes: 15,
        reason:
          `This is the mitigation the critical finding above names, and it only works if ` +
          `the statements arrive from the institution to the reviewer, not via the ` +
          `Treasurer. The seat holds read scope and audit read and the platform refuses ` +
          `it write scope anywhere, so the independence is mechanical rather than a ` +
          `promise` +
          (filled
            ? `. The seat is filled; what is not on the record is the direct delivery, ` +
              `and a reviewer who reads what the Treasurer hands them is not reviewing.`
            : `. Nobody holds it on the ${ENTITY_NAME[finding.entity]} today, so the ` +
              `finding has no mitigation in place at all.`) +
          ` The appointment needs the ${ENTITY_NAME[finding.entity]} board, not the Treasurer.`,
        proposedByRole: ROLE,
        acceptedForMeetingId: null,
      });
    }
  } else {
    // The findings exist. They are simply not this reader's to see, and a
    // planning tab that silently omitted the items they drive would read as
    // "nothing to raise".
    withheldCount += 1;
  }

  /* --- Renewals that commit money and want a decision --------------- */

  const register: Refusable<SubscriptionRegister> = attempt(() =>
    repo.subscriptionRegister(subject),
  );

  if (register.ok) {
    for (const row of register.value.rows) {
      const why = renewalWantsADecision(row);
      /* Per entity, never per invoice. A tool split across both entities
         yields one item on each agenda carrying that entity's own share, so
         neither board is asked to decide about money that is not its own. */
      for (const part of row.annualByEntity) {
        if (!scope.includes(part.entity)) {
          withheldCount += 1;
          continue;
        }
        if (part.amountCents === 0) continue;
        if (why === null) {
          silentRenewals.push({
            entity: part.entity,
            tool: row.subscription.tool,
            why:
              `Reviewed ${row.subscription.lastReviewedOn ?? "never"} with a standing ` +
              `decision to ${REVIEW_DECISION_LABELS[
                row.subscription.lastReviewDecision
              ].toLowerCase()}, and no finding above moderate. A charge the board has ` +
              `already decided about does not need deciding again.`,
          });
          continue;
        }
        items.push({
          id: `plan-renewal-${row.subscription.id}-${part.entity}`,
          entity: part.entity,
          title:
            `Decide on ${row.subscription.tool}: ` +
            `${formatCentsWithSymbol(part.amountCents)} of ${ENTITY_NAME[part.entity]} money ` +
            `a year` +
            (row.annualByEntity.length > 1
              ? `, the ${ENTITY_NAME[part.entity]} share of a shared invoice`
              : ""),
          type: "DECISION",
          estimateMinutes: 5,
          reason:
            `${why} ` +
            (row.subscription.renewalDate
              ? `It renews ${row.subscription.renewalDate}. `
              : `It is month to month with no fixed renewal, so it is charged again before ` +
                `the next meeting whatever happens. `) +
            `${formatCentsWithSymbol(part.amountCents)} is the ` +
            `${ENTITY_NAME[part.entity]}'s own share, apportioned on the stated basis; the ` +
            `other entity's share, where there is one, is on its own agenda.`,
          proposedByRole: ROLE,
          acceptedForMeetingId: null,
        });
      }
    }
  } else {
    withheldCount += 1;
  }

  const ordered = items.sort(
    (a, b) =>
      planningRank(a.type) - planningRank(b.type) ||
      b.estimateMinutes - a.estimateMinutes ||
      a.title.localeCompare(b.title),
  );

  return {
    items: ordered,
    withheldCount,
    silentRenewals: silentRenewals.sort(
      (a, b) => a.entity.localeCompare(b.entity) || a.tool.localeCompare(b.tool),
    ),
    totalEstimateMinutes: ordered.reduce((sum, item) => sum + item.estimateMinutes, 0),
  };
}

function planningRank(type: PlanningItem["type"]): number {
  return { DECISION: 0, DISCUSSION: 1, INFORMATION: 2 }[type];
}

/* ------------------------------------------------------------------ *
 * 4. Projects: a filter over the one register
 * ------------------------------------------------------------------ */

export type TreasurerProjects = {
  owned: Project[];
  contributing: Project[];
};

/**
 * A filter, never a copy. `projectsForRole` is the register's own function and
 * this wrapper exists only to name the role once.
 *
 * The Treasurer owns nothing and contributes to most of it, which is the
 * honest shape of a treasury: the money is a part of somebody else's project
 * nearly every time. The tab says so rather than inventing an owned column.
 */
export function treasurerProjects(): TreasurerProjects {
  return projectsForRole(ROLE);
}

/* ------------------------------------------------------------------ *
 * 5. Outside view
 *
 * This role's external surface is genuinely small, and padding it would be
 * worse than saying so. Four kinds of thing leave the building with the
 * Treasurer's name on them: donation receipts, the two 990s, the cheques that
 * go to schools, and one claim on the live site that should not be there.
 * ------------------------------------------------------------------ */

/**
 * The statutory spelling. North Carolina's Chapter 131F says "license"
 * throughout, and the disclosure sentence has to be reproduced as the statute
 * writes it. This platform writes "licence" in its own prose; a quotation is
 * not the platform's prose.
 */
export const NC_131F_STATUTORY_SPELLING = "license";

/** The disclosure, as it has to appear. Reproduced, not paraphrased. */
export const NC_131F_DISCLOSURE =
  "Financial information about this organization and a copy of its " +
  `${NC_131F_STATUTORY_SPELLING} are available from the State Solicitation ` +
  "Licensing Branch at 1-888-830-4989 (within North Carolina) or " +
  "(919) 814-5400. The license is not an endorsement by the State.";

export const NC_131F_TYPE_SIZE_POINTS = 9;

export type TreasurerOutside = {
  surface: OutsideSurface;
  /** Entities whose outward-facing items are withheld. */
  withheldEntities: Entity[];
  withheldCount: number;
  /**
   * The release queue, part two of the Outside tab. Treasury's artefacts do
   * not pass through it, and the tab says why rather than showing an empty box.
   */
  releaseQueueNote: string;
};

export function treasurerOutside(subject: Subject): TreasurerOutside {
  const scope = entitiesInScope(subject);
  const withheldEntities = ENTITIES.filter((entity) => !scope.includes(entity));
  const items: OutsideItem[] = [];
  let withheldCount = 0;

  /* Every item is built per entity and names its entity in its own title.
     `OutsideItem` has no entity field, so the title is the only place the
     attribution can live, and an item covering "the organization" would be a
     blend. Noted in the report. */
  for (const entity of ENTITIES) {
    const built = outsideItemsFor(entity);
    if (scope.includes(entity)) {
      items.push(...built);
    } else {
      withheldCount += built.length;
    }
  }

  /* The flagged claim is NOT scoped by entity, and that is deliberate.
     It is a sentence already published on a public page: a stranger reads it
     without any grant at all, so withholding it from a board member would be
     theatre, and it would mean the Foundation's Treasurer — whose entity is
     the one gifts actually are deductible to — never learns that the
     Association's pages are saying otherwise. The data class here is public
     content, not financial. */
  items.push(DEDUCTIBILITY_ITEM);

  return {
    surface: {
      // Small is not empty. The Secretary's tab is the one that says
      // `noExternalSurface`; the Treasurer's has four real things on it.
      noExternalSurface: false,
      items,
    },
    withheldEntities,
    withheldCount,
    releaseQueueNote:
      "Nothing of the Treasurer's is queued for release, and nothing of the " +
      "Treasurer's goes through the release queue. A receipt, a 990 and a cheque are " +
      "each addressed to one named party and are issued under a statute rather than " +
      "published, so a second release approver would be approving the law. The one " +
      "item below that IS published copy belongs to the Webmaster's queue, not this " +
      "one, which is exactly why nobody has fixed it.",
  };
}

function outsideItemsFor(entity: Entity): OutsideItem[] {
  const name = ENTITY_NAME[entity];
  const items: OutsideItem[] = [
    {
      key: `receipts-${entity}`,
      title:
        `${name} donation receipts, carrying the North Carolina Chapter 131F ` +
        `disclosure at ${NC_131F_TYPE_SIZE_POINTS}-point type`,
      href: entity === "JSOF" ? "/donate" : "/apply",
      // A receipt goes to one named donor. It is not public and never should be.
      audience: "MEMBER_OR_DONOR",
      problem: "NONE",
    },
    {
      key: `990-${entity}`,
      title: `IRS Form 990, ${name} return: a public document`,
      href: "/board/meetings/calendar",
      audience: "PUBLIC",
      problem: "MISSING_OWNER",
      note:
        `A document anyone may ask for, that this site does not publish and does not ` +
        `tell anyone how to obtain. The filing duty has an owner, the Treasurer; the ` +
        `publication of it has none. The ${name} return is filed separately and is ` +
        `never consolidated with the other entity's.`,
    },
  ];

  if (entity === "JSOF") {
    items.push({
      key: "cheque-run-JSOF",
      title:
        "Foundation scholarship cheques to schools: a named bursar's office, " +
        "not the public",
      href: "/board/scholarships/disbursement",
      audience: "MEMBER_OR_DONOR",
      problem: "NONE",
    });
  }

  return items;
}

/**
 * The flagged claim.
 *
 * `OutsideProblem` has no code for "a published legal claim that may be
 * untrue" — the vocabulary covers staleness, dead links, placeholders and
 * missing owners. This uses the nearest, which is true as far as it goes
 * (nobody owns the sentence), and states the real problem in the note, which
 * the shared component renders in place of the generic copy. The gap in the
 * shared shape is in the report rather than worked around with a colour.
 */
const DEDUCTIBILITY_ITEM: OutsideItem = {
  key: "deductibility-claim-JSOA",
  title: "The live site's claim that gifts to the Association are tax-deductible",
  href: "/jsoa/mission",
  audience: "PUBLIC",
  problem: "MISSING_OWNER",
  note:
    "Published without qualification, and nobody owns the sentence. A gift to a " +
    "501(c)(19) is deductible only where the organization meets the membership test, " +
    "which the Association may not pass. Until counsel says otherwise this is a " +
    "representation the Treasurer of whichever entity receives the gift would have " +
    "to stand behind.",
};

/**
 * Why the deductibility claim is flagged, at the length the question deserves.
 *
 * Kept as prose rather than squeezed into an `OutsideItem` note, because a
 * donor who relied on it and a board member who published it need different
 * amounts of detail and the column has room for neither.
 */
export const DEDUCTIBILITY_FLAG = {
  claim:
    "The live site tells visitors that their gifts to the Association are " +
    "tax-deductible. It says so flatly, with no qualification and no reference to " +
    "which entity receives the gift.",
  why:
    "The Foundation is a 501(c)(3) and gifts to it are deductible. The Association " +
    "is a 501(c)(19), and a gift to a 501(c)(19) is deductible only where the " +
    "organization meets a membership test resting on the proportion of members who " +
    "are war veterans. Nobody on the board has established that the Association " +
    "passes it, and the roster that would answer the question is the VP " +
    "Membership's, not the Treasurer's.",
  exposure:
    "A donor who claimed a deduction on the strength of that sentence relied on the " +
    "Association's representation. The Treasurer signs the return that would have to " +
    "be consistent with it.",
  remedy:
    "Until counsel confirms the membership test, say which entity a gift goes to and " +
    "claim deductibility only for the Foundation. The sentence is public copy, so the " +
    "change belongs to the Webmaster's release queue with the Treasurer as the second " +
    "approver.",
} as const;

/* ------------------------------------------------------------------ *
 * The fictional-data statement
 *
 * Every screen in this workspace carries it. It is not boilerplate: these
 * figures look exactly like real ones, and a screenshot of this demo in a
 * board pack would otherwise be quoted as fact.
 * ------------------------------------------------------------------ */

export const FICTIONAL_DATA_NOTE =
  "Figures in this build are fictional demo data. They are not either " +
  "organization's filed numbers and should not be quoted to the board as fact.";

/** Exported for the tests, so the urgency vocabulary stays one list. */
export const TASK_URGENCIES: readonly TaskUrgency[] = ["overdue", "soon", "open"];
