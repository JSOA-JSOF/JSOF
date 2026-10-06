/**
 * The Fundraising and Foundation role workspace: the five spine tabs, read
 * through this module's own authorized actions.
 *
 * See docs/ROLE-WORKSPACE.md. Four of the five tabs are filters over shared
 * data, so nothing in this file stores a task, a calendar entry or a project.
 * Specifically:
 *
 *   - Tasks come from `readDonationsDashboard().actions`, which is computed
 *     from the gift register, the sponsor register and the publication states.
 *     Nothing is typed. If the data changes, the task list changes with it.
 *   - Calendar entries are derived from the dates that are actually recorded on
 *     the records this module owns. Where a date the role needs is not recorded
 *     anywhere, the entry is marked `unverified` and says so, rather than being
 *     invented or quietly dropped.
 *   - Projects are `projectsForRole("FUNDRAISING_CHAIR")` over the one
 *     org-level register. A filter, never a copy.
 *   - Planning items are the one thing a role does author: what it wants on the
 *     next agenda. Those are held here and flow to the Secretary's agenda
 *     builder.
 *
 * ## The split this module runs on
 *
 * The sponsor register is split across two data classes, and every function
 * below respects the split rather than routing around it:
 *
 *   - payments, benefit valuations and the gift register are FINANCIAL at row
 *     level;
 *   - the approved acknowledgment wording is PUBLIC_CONTENT.
 *
 * The Fundraising Chair holds FINANCIAL at AGGREGATE and PUBLIC_CONTENT at
 * WRITE, on both entities. The Treasurer holds FINANCIAL at WRITE on one
 * entity and no published-content grant at all. So the Chair sees more
 * entities and less detail, and the Treasurer sees more detail and fewer
 * entities, on every tab here. Nothing in this file widens a grant to fill a
 * screen: a figure, a task or a date the reader may not see comes back as a
 * stated withholding, which is a different state from absent and from zero.
 */

import type { Entity, Role } from "../authz/model";
import { entitiesFor } from "../authz/personas";
import { AuthzError, authorize, can, type Subject } from "../authz/policy";
import { projectsForRole, type Project } from "../projects/register";
import type {
  OutsideItem,
  OutsideSurface,
  PlanningItem,
  RoleCalendarItem,
  RoleTask,
} from "../workspace/types";
import { readDonationRegister, readSponsorAcknowledgments } from "./actions";
import { ENTITY_LABEL, readDonationsDashboard } from "./kpis";
import { formatCents } from "./money";
import { donationsRepository, type DonationsRepository } from "./repository";
import { PLACEMENT_LABEL } from "./types";

type Repo = DonationsRepository;

/** The role this workspace belongs to. */
export const WORKSPACE_ROLE: Role = "FUNDRAISING_CHAIR";

export const WORKSPACE_BASE = "/board/donations";

/* ================================================================== *
 * Function tabs
 *
 * The three screens that existed before the spine did, unchanged and at
 * their original routes. `/board/donations/gifts` in particular is the gift
 * register, which was already lost once to a rebuild and restored; it keeps
 * its route here.
 * ================================================================== */

export const FUNCTION_TAB_KEYS = ["gifts", "funds", "sponsors"] as const;
export type FunctionTabKey = (typeof FUNCTION_TAB_KEYS)[number];

const FUNCTION_TAB_LABELS: Record<FunctionTabKey, string> = {
  gifts: "Gifts",
  funds: "Funds",
  sponsors: "Sponsors",
};

export function functionTabHref(key: FunctionTabKey, qs = ""): string {
  return `${WORKSPACE_BASE}/${key}${qs}`;
}

/**
 * The `functionTabs` argument for `RoleTabs`.
 *
 * The dev `?as=` override travels on these, because the three function screens
 * already carried it. `RoleTabs` builds the five spine hrefs from `base` and
 * has no way to carry a query string, so an `?as=` override does not survive a
 * jump from a function tab to a spine tab. Noted in the report rather than
 * fixed here: the tab strip is shared code and is not this module's to edit.
 */
export function functionTabs(qs = ""): { href: string; label: string }[] {
  return FUNCTION_TAB_KEYS.map((key) => ({
    href: functionTabHref(key, qs),
    label: FUNCTION_TAB_LABELS[key],
  }));
}

/* ================================================================== *
 * Entity scope
 * ================================================================== */

/**
 * Entities this viewer holds any assignment on, Foundation first.
 *
 * The Foundation leads because it is the charitable entity and the one this
 * role's work is mostly about. The order is presentation only: no figure, task
 * or date is ever carried across the two.
 */
export function entitiesInScope(subject: Subject): Entity[] {
  const held = entitiesFor(subject);
  return (["JSOF", "JSOA"] as Entity[]).filter((entity) => held.includes(entity));
}

function financialRowRead(subject: Subject, entity: Entity): boolean {
  return can({ subject, dataClass: "FINANCIAL", entity, required: "READ", rowLevel: true });
}

function publicContentRead(subject: Subject, entity: Entity): boolean {
  return can({ subject, dataClass: "PUBLIC_CONTENT", entity, required: "READ" });
}

/* ================================================================== *
 * Overview: tasks
 * ================================================================== */

export type WorkspaceTasks = {
  tasks: RoleTask[];
  /** One line per thing this viewer cannot be shown, and why. */
  withheld: string[];
  /** Entities that produced any task list at all. */
  entitiesRead: Entity[];
};

/**
 * The task list, lifted from the dashboard's `actions` for every entity this
 * viewer holds.
 *
 * Each action already carries `because` and `urgency`, computed next to the
 * figure it follows from, so this is a mapping and not a second judgment about
 * what matters. A viewer who can see nothing on an entity gets a withholding
 * naming that entity, not an empty list implying there is nothing to do.
 */
export function fundraisingTasks(subject: Subject, repo: Repo = donationsRepository): WorkspaceTasks {
  const tasks: RoleTask[] = [];
  const withheld: string[] = [];
  const entitiesRead: Entity[] = [];

  for (const entity of entitiesInScope(subject)) {
    let board;
    try {
      board = readDonationsDashboard(subject, entity, repo);
    } catch (error) {
      withheld.push(
        `${ENTITY_LABEL[entity]}: ${
          error instanceof AuthzError
            ? "no financial or published-content scope, so no task on this entity " +
              "can be derived or counted."
            : String(error)
        }`,
      );
      continue;
    }

    entitiesRead.push(entity);
    for (const action of board.actions) {
      tasks.push({
        key: `${entity}-${action.key}`,
        label: action.label,
        because: action.because,
        count: action.count,
        urgency: action.urgency,
        href: action.href,
        entity,
      });
    }
    for (const line of board.withheld) {
      withheld.push(`${ENTITY_LABEL[entity]}: ${line}`);
    }
  }

  if (entitiesInScope(subject).length === 0) {
    withheld.push(
      "This viewer holds no assignment on either entity, so there is nothing to " +
        "filter a task list from.",
    );
  }

  return { tasks, withheld, entitiesRead };
}

/* ================================================================== *
 * Overview: calendar
 * ================================================================== */

export type WorkspaceCalendar = {
  items: RoleCalendarItem[];
  withheld: string[];
  /**
   * Dates this role's work runs on that are recorded nowhere. Stated rather
   * than guessed: an invented date on a compliance calendar is worse than a
   * missing one.
   */
  gaps: string[];
};

/** `2026-02-10T14:00:00Z` -> `2026-02-10`. No timezone arithmetic, no Date. */
function isoDateOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/** Same month and day, one year on. */
function oneYearOn(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  return `${year + 1}${isoDate.slice(4)}`;
}

export type SponsorshipDate = {
  sponsorshipId: string;
  sponsorName: string;
  tier: string;
  eventName: string;
  /** When the sponsorship payment was received. */
  receivedAt: string;
};

/**
 * When each sponsorship came in, and for which event.
 *
 * Gated on exactly what `readSponsorRegister` is gated on — FINANCIAL READ at
 * row level — because that is where these fields live. It is a narrower read,
 * never a lower one: no payment, no valuation and no safe-harbour figure comes
 * back through here, and no role reaches a date through this that could not
 * already open the whole money view.
 *
 * It exists because `SponsorRegisterRow` carries no date at all, so a renewal
 * cannot be derived from the register's own return shape. Widening that shape
 * would mean editing `actions.ts`, which is not this pass's to change.
 */
export function readSponsorshipDates(
  subject: Subject,
  entity: Entity,
  repo: Repo = donationsRepository,
): SponsorshipDate[] {
  authorize({ subject, dataClass: "FINANCIAL", entity, required: "READ", rowLevel: true });
  return repo.listSponsorships(entity).map((sponsorship) => ({
    sponsorshipId: sponsorship.id,
    sponsorName: sponsorship.sponsorName,
    tier: sponsorship.tier,
    eventName: sponsorship.eventName,
    receivedAt: sponsorship.receivedAt,
  }));
}

/**
 * The three kinds of date this role works to: pledge dates, sponsor renewals,
 * and the event dates that every sponsorship deadline hangs off.
 *
 * All three sit on FINANCIAL rows. The pledge is a gift awaiting payment, and
 * the sponsorship's `receivedAt` and `eventName` are fields on the sponsorship
 * record, which is the money view. So a viewer holding FINANCIAL only at
 * AGGREGATE — the Fundraising Chair, the role that actually chases renewals —
 * gets this tab withheld rather than filled. That is the honest answer and it
 * is a finding, not a bug in this function: see the report.
 */
export function fundraisingCalendar(
  subject: Subject,
  repo: Repo = donationsRepository,
): WorkspaceCalendar {
  const items: RoleCalendarItem[] = [];
  const withheld: string[] = [];
  const gaps: string[] = [];

  for (const entity of entitiesInScope(subject)) {
    if (!financialRowRead(subject, entity)) {
      withheld.push(
        `${ENTITY_LABEL[entity]}: pledge dates, sponsor renewal dates and event ` +
          `dates are all fields on financial rows — a pledge is a gift awaiting ` +
          `payment, and a sponsorship's date and event sit on the payment record. ` +
          `This role holds financial scope at aggregate, which carries no dates.`,
      );
      continue;
    }

    /* Pledge dates: a gift recorded and not yet cleared. */
    for (const { donation } of readDonationRegister(subject, entity, repo)) {
      if (donation.status !== "AWAITING_PAYMENT" && donation.status !== "INTENT") continue;
      items.push({
        key: `pledge-${donation.id}`,
        title:
          `Pledge from ${donation.donorDisplayName}, ` +
          `${formatCents(donation.amountCents)}, awaiting payment`,
        on: isoDateOf(donation.receivedAt),
        entity,
        // No PLEDGE kind exists on the shared type. CYCLE is the closest
        // honest member; the title carries the meaning.
        kind: "CYCLE",
        ownerRole: "TREASURER",
        href: functionTabHref("gifts"),
      });
    }

    /* Renewals and the events that drive the deadlines. */
    const sponsorships = readSponsorshipDates(subject, entity, repo);
    const eventYears = new Map<string, number | null>();

    for (const row of sponsorships) {
      const given = isoDateOf(row.receivedAt);
      items.push({
        key: `renewal-${row.sponsorshipId}`,
        title: `${row.sponsorName} · ${row.tier} · renewal, one year on from the gift`,
        on: oneYearOn(given),
        entity,
        kind: "RENEWAL",
        ownerRole: WORKSPACE_ROLE,
        href: functionTabHref("sponsors"),
        // Nothing on the record says the sponsorship is annual or when it
        // renews. The anniversary of the payment is an inference, so it is
        // never counted as an obligation.
        unverified: true,
      });

      const year = row.eventName.match(/\b(20\d{2})\b/);
      if (!eventYears.has(row.eventName)) {
        eventYears.set(row.eventName, year ? Number(year[1]) : null);
      }
    }

    if (sponsorships.length > 0) {
      gaps.push(
        `${ENTITY_LABEL[entity]}: nothing on a sponsorship says whether it is ` +
          `annual or when it renews. The renewal dates above are the anniversary ` +
          `of the payment, which is an inference, so they are counted nowhere.`,
      );
    }

    for (const [eventName, year] of eventYears) {
      if (year === null) {
        gaps.push(
          `${ENTITY_LABEL[entity]}: "${eventName}" carries no date and no year, so ` +
            `no sponsorship deadline can be worked back from it.`,
        );
        continue;
      }
      items.push({
        key: `event-${entity}-${eventName.replace(/\s+/g, "-").toLowerCase()}`,
        title:
          `${eventName} — no date is recorded. Placeholder, year taken from the ` +
          `event name; every sponsorship deadline is worked back from the real one`,
        on: `${year}-12-31`,
        entity,
        kind: "EVENT",
        ownerRole: "EVENTS_CHAIR",
        href: functionTabHref("sponsors"),
        unverified: true,
      });
      gaps.push(
        `${ENTITY_LABEL[entity]}: "${eventName}" has no recorded date anywhere in ` +
          `this module. The entry on the calendar is a placeholder at the end of ` +
          `the named year and is counted nowhere.`,
      );
    }
  }

  return { items, withheld, gaps };
}

/* ================================================================== *
 * Planning: what this role wants on the next agenda
 * ================================================================== */

/**
 * The one thing on the spine a role authors rather than derives.
 *
 * These are filed by the Fundraising Chair and flow into the Secretary's
 * agenda builder rather than being retyped there. Each one is a decision the
 * role cannot take alone, which is the test for being here at all.
 */
export const FUNDRAISING_PLANNING_ITEMS: PlanningItem[] = [
  {
    id: "plan-sponsor-ladder",
    entity: "JSOF",
    title: "Publish a sponsor ladder, and set the minimum gift that earns logo credit",
    type: "DECISION",
    estimateMinutes: 20,
    reason:
      "There is no published ladder and no stated minimum, so every sponsor " +
      "conversation starts from nothing and the benefits get agreed one at a time. " +
      "The board has to set the minimum because logo credit is a benefit with a " +
      "fair market value: the lower the minimum, the sooner a placement crosses " +
      "the 2% ceiling and carries its whole benefit value out of qualified " +
      "sponsorship. The register already carries this as a line of effort with no " +
      "target date.",
    proposedByRole: WORKSPACE_ROLE,
    acceptedForMeetingId: null,
  },
  {
    id: "plan-gift-acceptance",
    entity: "JSOF",
    title: "Decide who may decline a sponsor or a gift, and on what grounds",
    type: "DECISION",
    estimateMinutes: 25,
    reason:
      "There is no gift-acceptance policy, so a refusal today is one volunteer's " +
      "judgment against a donor who was not told the rule. The board needs to say " +
      "which grounds are available — the sponsor's trade, an exclusivity demand, " +
      "copy that cannot be made into an acknowledgment, a restriction the board " +
      "cannot honour — and who signs the refusal.",
    proposedByRole: WORKSPACE_ROLE,
    acceptedForMeetingId: null,
  },
  {
    id: "plan-corporate-to-jsof",
    entity: "JSOA",
    title: "Route every corporate gift and sponsorship to the Foundation",
    type: "DECISION",
    estimateMinutes: 20,
    reason:
      "A corporate donor wants a deduction it can rely on. The Foundation is the " +
      "charitable entity; a gift to the Association is deductible only if the " +
      "Association meets the war-veteran membership composition test in the year " +
      "of the gift, which is a test it may not pass and which nobody is tracking " +
      "per year. Deciding this at the board rather than per gift also removes the " +
      "entity choice from whoever happens to answer the sponsor's email.",
    proposedByRole: WORKSPACE_ROLE,
    acceptedForMeetingId: null,
  },
];

/**
 * Filed items, filtered to entities the viewer holds.
 *
 * Not a data-class read: an agenda request is not financial or published
 * content. It is still filtered, because an item filed against an entity a
 * viewer has no part in is not theirs to see on their own workspace.
 */
export function fundraisingPlanning(subject: Subject): PlanningItem[] {
  const scope = entitiesInScope(subject);
  return FUNDRAISING_PLANNING_ITEMS.filter((item) => scope.includes(item.entity));
}

/* ================================================================== *
 * Projects: a filter over the one register
 * ================================================================== */

export type WorkspaceProjects = { owned: Project[]; contributing: Project[] };

/**
 * `projectsForRole` over the org-level register, and nothing else.
 *
 * There is no donations-module copy of any of this on purpose: the Ball and
 * the golf tournament are Events plus Fundraising plus Treasury plus
 * Communications, and a per-role store would hide exactly those handoffs.
 */
export function fundraisingProjects(): WorkspaceProjects {
  return projectsForRole(WORKSPACE_ROLE);
}

/* ================================================================== *
 * Outside view
 * ================================================================== */

export type WorkspaceOutside = {
  surface: OutsideSurface;
  withheld: string[];
  /**
   * How loud the public column is. `flaggedApproved` is the state worth its
   * own sentence: copy that the validator flagged and that is nonetheless
   * cleared to publish.
   */
  counts: { publicProblems: number; flagged: number; flaggedApproved: number };
};

const DONATE_HREF = "/donate";
const PARTNERS_HREF = "/jsof/partners";
const FOUNDATION_CONTACT_HREF = "/jsof/contact";

/**
 * What the world sees of fundraising, in two columns that are never merged.
 *
 * This role has the largest external surface of any on the board: the donate
 * flow, the partners page, every sponsor acknowledgment, and the receipt. The
 * loudest thing on it is an acknowledgment string the validator flagged that is
 * ALSO approved for publication — that can go out as written today, and one
 * qualitative or comparative adjective takes the whole placement from
 * acknowledgment into taxable advertising. Those sort to the top.
 *
 * The wording comes from the PUBLIC_CONTENT read. No valuation is read off
 * those rows: doing so would hand the Chair the money through the content door
 * and quietly undo the split this module runs on.
 */
export function fundraisingOutside(
  subject: Subject,
  repo: Repo = donationsRepository,
): WorkspaceOutside {
  const withheld: string[] = [];
  const scope = entitiesInScope(subject);

  const flaggedApproved: OutsideItem[] = [];
  const flaggedElsewhere: OutsideItem[] = [];
  const cleanWording: OutsideItem[] = [];

  for (const entity of scope) {
    if (!publicContentRead(subject, entity)) {
      withheld.push(
        `${ENTITY_LABEL[entity]}: the sponsor acknowledgments as they will publish. ` +
          `The approved wording is published content, and this role holds no read ` +
          `on it for this entity.`,
      );
      continue;
    }

    for (const row of readSponsorAcknowledgments(subject, entity, repo)) {
      for (const view of row.placements) {
        const approved = view.placement.publicationState === "APPROVED";
        const state = view.placement.publicationState.toLowerCase().replace(/_/g, " ");
        const title =
          `${row.sponsorName} · ${PLACEMENT_LABEL[view.placement.kind]} · ` +
          `“${view.placement.approvedAcknowledgmentString}”`;
        const base = {
          key: `wording-${view.placement.id}`,
          title,
          href: functionTabHref("sponsors"),
          audience: "PUBLIC" as const,
          awaitingRelease: view.placement.publicationState === "AWAITING_RELEASE",
        };

        if (view.review.clean) {
          cleanWording.push({ ...base, problem: "NONE" });
          continue;
        }

        const categories = [...new Set(view.review.findings.map((f) => f.category))]
          .map((category) => category.toLowerCase().replace(/_/g, " "))
          .join(", ");
        const matches = [...new Set(view.review.findings.map((f) => f.match))].join(", ");

        const item: OutsideItem = {
          ...base,
          // No member of OutsideProblem describes copy that is substantively
          // wrong rather than stale or broken. The note is what renders, so it
          // carries the meaning. Flagged in the report.
          problem: "PLACEHOLDER_PUBLISHED",
          note: approved
            ? `Approved, so this publishes as written. Flagged for ${categories} ` +
              `on “${matches}”: one qualitative or comparative word converts the ` +
              `whole placement from acknowledgment into taxable advertising, and ` +
              `the validator warns rather than blocking.`
            : `Flagged for ${categories} on “${matches}”. Sitting at ${state}, so ` +
              `it cannot publish yet — approving it as written is what would ` +
              `convert the placement into taxable advertising.`,
        };
        (approved ? flaggedApproved : flaggedElsewhere).push(item);
      }
    }
  }

  const publicItems: OutsideItem[] = [
    ...flaggedApproved,
    ...flaggedElsewhere,
    {
      key: "foundation-contact",
      title: "A public way to reach the Foundation",
      href: FOUNDATION_CONTACT_HREF,
      audience: "PUBLIC",
      problem: "MISSING_OWNER",
      note:
        "On the live site the Foundation has no public contact path and no named " +
        "treasurer, so a donor who wants the charitable entity has nobody to ask " +
        "and lands on the Association instead. Contact by office exists here and " +
        "has not shipped.",
    },
    {
      key: "donate-flow",
      title: "The donate flow, and what it claims about deductibility",
      href: DONATE_HREF,
      audience: "PUBLIC",
      problem: "PLACEHOLDER_PUBLISHED",
      note:
        "The flow forces the entity choice and states each entity's status, and " +
        "says dues are not deductible. It says nothing about whether a GIFT to the " +
        "Association is, which is the claim the live site makes without " +
        "qualification. Association deductibility rests on a membership " +
        "composition test nobody is tracking per year.",
    },
    {
      key: "partners-page",
      title: "The partners page, as a sponsor reads it",
      href: PARTNERS_HREF,
      audience: "PUBLIC",
      problem: "NONE",
    },
    ...cleanWording,
  ];

  /* ---------------------------------------------------------------- *
   * The donor column. A different audience, never merged with the one
   * above: what a signed-in donor sees of their own giving.
   * ---------------------------------------------------------------- */

  const donorItems: OutsideItem[] = [
    {
      key: "donor-own-giving",
      title: "A donor's record of their own giving",
      href: FOUNDATION_CONTACT_HREF,
      audience: "MEMBER_OR_DONOR",
      problem: "MISSING_OWNER",
      note:
        "There is no signed-in donor area. A donor's only record of their giving " +
        "is the receipt that was emailed, so a donor who lost it has to write to " +
        "the Treasurer, and a donor who gave to both entities has two unrelated " +
        "records and no one place showing either.",
    },
    {
      key: "donor-receipt",
      title: "The receipt a gift produces, as the donor receives it",
      href: functionTabHref("gifts"),
      audience: "MEMBER_OR_DONOR",
      problem: "NONE",
    },
    {
      key: "donor-benefit-split",
      title: "What the donor is told before they pay: entity, fund, and benefit value",
      href: DONATE_HREF,
      audience: "MEMBER_OR_DONOR",
      problem: "NONE",
    },
  ];

  for (const entity of scope) {
    if (!financialRowRead(subject, entity)) {
      withheld.push(
        `${ENTITY_LABEL[entity]}: how many donors are waiting on a receipt that ` +
          `cannot be written. That is a gift-by-gift read of the register.`,
      );
      continue;
    }
    const blocked = readDonationRegister(subject, entity, repo).filter(
      ({ donation }) =>
        donation.benefits.length > 0 && donation.benefitFairMarketValueCents === null,
    );
    if (blocked.length === 0) continue;
    donorItems.push({
      key: `donor-no-receipt-${entity}`,
      title:
        `${blocked.length} ${ENTITY_LABEL[entity]} ` +
        `${blocked.length === 1 ? "donor sees" : "donors see"} nothing at all of ` +
        `their gift`,
      href: functionTabHref("gifts"),
      audience: "MEMBER_OR_DONOR",
      problem: "PLACEHOLDER_PUBLISHED",
      note:
        "The benefits on these gifts carry no fair market value, so no receipt " +
        "can be issued and each of these donors cannot claim. From the donor's " +
        "side the gift has produced nothing.",
    });
  }

  return {
    surface: {
      noExternalSurface: false,
      items: [...publicItems, ...donorItems],
    },
    withheld,
    counts: {
      publicProblems: publicItems.filter((item) => item.problem !== "NONE").length,
      flagged: flaggedApproved.length + flaggedElsewhere.length,
      flaggedApproved: flaggedApproved.length,
    },
  };
}
