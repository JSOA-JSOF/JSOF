/**
 * The Store and Sales Chair's workspace: tasks, calendar, planning, projects
 * and the outside view.
 *
 * Everything here is a filter or a derivation. There is no per-role store of
 * anything, which is the rule `docs/ROLE-WORKSPACE.md` is built on:
 *
 *   - Tasks come from `storeFacts`, the same authorized read the Dashboard
 *     tiles are built from. Nobody types a task. If a thing cannot be computed
 *     from the data it is not here.
 *   - The Projects tab filters `@/lib/projects/register`. It does not copy it,
 *     and the fact that the Store Chair OWNS nothing in that register is a
 *     finding rather than an empty screen.
 *   - The Outside view is two columns that are never merged, because for this
 *     role the member and public distinction is not a presentation choice: it
 *     is the product. A member-restricted line is ABSENT from the public
 *     column, not shown there as locked, for the same reason
 *     `catalogue.ts:toPublicProduct` throws instead of redacting. A label
 *     saying something exists tells a visitor what the members have.
 *
 * Two compliance controls shape the copy throughout, and neither is commerce:
 *
 *   1. Member gating is a tax control. Pub. 3386 ch. 9 requires separate
 *      records of receipts from members and non-members for an activity open
 *      to the public, and inadequate non-member records make ALL income from
 *      that activity taxable as unrelated business income. Every order carries
 *      its own snapshot of the buyer's status, so the record does not move
 *      when a membership does.
 *   2. North Carolina does not exempt the organization from COLLECTING sales
 *      tax. What is collected is the state's money held in trust and is
 *      reported beside the member split, never inside it. No figure here adds
 *      them.
 *
 * Print-on-demand is handled rather than assumed away. A print-on-demand line
 * has no shelf, so it has null stock figures, and nothing here reports that
 * null as a zero that would read as a shortage.
 */

import type { Entity } from "../authz/model";
import { authorize, can, separationOfDutiesFindings, type Subject } from "../authz/policy";
import {
  LINES_OF_EFFORT,
  projectsForRole,
  type Project,
} from "../projects/register";
import type {
  OutsideItem,
  OutsideSurface,
  PlanningItem,
  RoleCalendarItem,
  RoleTask,
} from "../workspace/types";

import { formatCents } from "./cart";
import { isMemberRestricted } from "./catalogue";
import { storeFacts, type StoreFacts } from "./kpis";
import { storeRepository } from "./repository";
import { STORE_ENTITY, type Product } from "./types";

const ENTITY: Entity = STORE_ENTITY;

/** NC sales and use tax returns are due the 20th of the month after the period. */
const FILING_DUE_DAY_OF_MONTH = 20;

/** A refund waiting this long on a second approver is a problem, not a queue. */
const REFUND_STALE_DAYS = 14;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `2026-Q4` to the last day of that quarter. */
function quarterEndDate(quarter: string): string {
  const [year, q] = quarter.split("-Q");
  const endMonth = Number(q) * 3; // 1-based; Date.UTC day 0 of the next month
  return isoDate(new Date(Date.UTC(Number(year), endMonth, 0)));
}

/* ------------------------------------------------------------------ *
 * Overview: the derived task list
 * ------------------------------------------------------------------ */

/**
 * The Overview's tasks. One authorized read, AGGREGATE on FINANCIAL for JSOA,
 * which is what STORE_CHAIR holds. Nothing is widened: the row-level order
 * task is emitted only for a subject who already holds READ, so the chair is
 * never sent to a screen that will refuse them.
 *
 * Every task is conditional on state. There is no standing row that fires
 * whatever the data says, because a list that is always the same length is a
 * menu and people stop reading it.
 */
export async function storeTasks(
  subject: Subject,
  now: Date = new Date(),
): Promise<RoleTask[]> {
  const f = await storeFacts(subject, now);
  const tasks: RoleTask[] = [];

  /* --- The compensating control, and the sharpest item on the tab. --- */
  if (f.uncountedThisQuarter.length > 0) {
    const lastQuarterShort = f.countedLastClosedQuarter < f.stockedRows.length;
    tasks.push({
      key: "quarterly-count",
      label: `Get ${f.quarter}'s physical inventory count recorded by somebody other than the store chair`,
      because:
        "This count is the compensating control for the Treasurer also chairing the store, " +
        "which puts authorize, custody, record and reconcile in one pair of hands. Until a " +
        "second person walks the shelves, nothing independent checks the unit figures the " +
        "receipts and sales-tax records are built on" +
        (lastQuarterShort
          ? `, and ${f.lastClosedQuarter} already closed at ` +
            `${f.countedLastClosedQuarter} of ${f.stockedRows.length} lines.`
          : ".") +
        (f.viewerHoldsBothRoles
          ? " You hold both seats, so you cannot enter it yourself: ask the Secretary, the" +
            " VP Operations or the Finance Review Officer, who hold the attestation" +
            " capability without ledger write."
          : ""),
      count: f.uncountedThisQuarter.length,
      urgency: lastQuarterShort ? "overdue" : "soon",
      href: "/board/store/inventory",
      entity: ENTITY,
      dueOn: quarterEndDate(f.quarter),
    });
  }

  /* --- A refund credits a receipt the same person may have recorded. --- */
  if (f.pendingSecondApproval.length > 0) {
    const oldest = f.oldestPendingDays ?? 0;
    tasks.push({
      key: "refunds-second-approver",
      label: "Approve or refuse the refunds waiting on a second approver",
      because:
        "Above $50 a refund needs a second person and not the one who raised it, because a " +
        "refund is a cash-equivalent credit against a receipt the store chair may also have " +
        `recorded. Until it is decided the buyer has no answer and the period's receipts stand ` +
        `overstated. The oldest has waited ${oldest} ${oldest === 1 ? "day" : "days"}, raised by ` +
        `${f.oldestPendingRaisedBy}, who cannot also approve it.`,
      count: f.pendingSecondApproval.length,
      urgency: oldest >= REFUND_STALE_DAYS ? "overdue" : "soon",
      href: "/board/store/refunds",
      entity: ENTITY,
    });
  }

  /* --- A hole in a period that gets filed. --- */
  if (f.taxRecordGaps.length > 0) {
    tasks.push({
      key: "tax-record-gaps",
      label: "Put a jurisdiction and a rate on the receipted orders that carry neither",
      because:
        "North Carolina sources a delivered sale to the destination, so the county on the order " +
        "is what decides the rate. A filed period cannot be reconstructed from an order that " +
        "does not record which county it was sourced to, and this blocks remitting the period " +
        "it falls in. An out-of-state order is not one of these: it carries an explicit zero " +
        "with the reason stored.",
      count: f.taxRecordGaps.length,
      urgency: "overdue",
      href: "/board/store/tax",
      entity: ENTITY,
    });
  }

  /* --- The separate records the public-activity rule asks for. Fires because
         there ARE non-member receipts in the period, not on a timer. --- */
  if (f.nonMemberOrderCount > 0) {
    tasks.push({
      key: "receipts-separate-records",
      label: `Export ${f.period.label}'s member and non-member receipts for the CPA`,
      because:
        `${f.nonMemberOrderCount} orders this period were placed by non-members, ` +
        `${f.nonMemberSharePercent}% of gross, so the separate records the public-activity ` +
        "rule asks for have to exist. If the non-member records are not adequate the " +
        "consequence is not tax on the non-member share: all income from the activity can be " +
        "treated as unrelated business income. This blocks the CPA's return.",
      count: f.nonMemberOrderCount,
      urgency: "open",
      href: "/board/store/receipts",
      entity: ENTITY,
    });
  }

  /* --- Collected tax is not the Association's money. --- */
  if (f.salesTaxCents > 0) {
    tasks.push({
      key: "reconcile-tax-periods",
      label: "Reconcile the sales-tax periods before anything is remitted",
      because:
        `${formatCents(f.salesTaxCents)} is collected and held in trust for the state across ` +
        `${f.taxMonths} ${f.taxMonths === 1 ? "period" : "periods"}. It is not a receipt of the ` +
        "Association and it is never added to the member split. A period cannot be remitted " +
        "until it reconciles to the rate and jurisdiction stored on each order.",
      count: f.taxMonths,
      urgency: "open",
      href: "/board/store/tax",
      entity: ENTITY,
    });
  }

  /* --- Stock, with print-on-demand absent rather than reported as zero. --- */
  if (f.thinCover.length > 0) {
    tasks.push({
      key: "stock-cover",
      label: "Reorder the stocked lines that will not see the next 90 days out",
      because:
        "These lines have sold more in the last 90 days than they now hold, so the next event " +
        `takes them to nothing. ${f.podRows.length} print-on-demand lines hold no stock at all ` +
        "and are not in this count: they have no shelf, so they are not short.",
      count: f.thinCover.length,
      urgency: "soon",
      href: "/board/store/inventory",
      entity: ENTITY,
    });
  }

  /* --- Derived from the role table, not from a note somebody left. --- */
  if (f.viewerHoldsBothRoles) {
    tasks.push({
      key: "sod-to-agenda",
      label: "Put moving Store and Sales off the Treasurer on the next board agenda",
      because:
        "You hold Treasurer and Store Chair on the same entity, which is the critical " +
        "separation-of-duties finding: one person sets the prices, holds the goods, records " +
        "the sales and reconciles them. The quarterly count is a compensating control, not a " +
        "fix, and it blocks you personally from entering the count the store needs.",
      urgency: "overdue",
      href: "/board/store/planning",
      entity: ENTITY,
    });
  }

  /* --- READ, which STORE_CHAIR does not hold. Emitted only to a subject who
         already has it; never widened to make the row appear. --- */
  if (
    f.awaitingPaymentCount > 0 &&
    can({ subject, dataClass: "FINANCIAL", entity: ENTITY, required: "READ" })
  ) {
    tasks.push({
      key: "orders-awaiting-payment",
      label: "Work the orders that are still awaiting payment",
      because:
        "An unpaid order is not a receipt, so it is absent from the split, the tax figure and " +
        "the refund queue, and it holds stock that nothing has paid for. The row-level list " +
        "needs read on financial records, which you hold and the Store Chair does not.",
      count: f.awaitingPaymentCount,
      urgency: "open",
      href: "/board/store/orders",
      entity: ENTITY,
    });
  }

  return tasks;
}

/* ------------------------------------------------------------------ *
 * Overview: the calendar, filtered to this role
 * ------------------------------------------------------------------ */

/**
 * The dated obligations that are this role's.
 *
 * There is no shared compliance-calendar module in the repository yet, so this
 * derives the store's own entries from the store's own data rather than
 * inventing a second register: the quarterly count from the quarter and the
 * stocked lines, and the sales-tax filing dates from the periods the orders
 * actually cover.
 *
 * The filing dates are marked `unverified`. The due date is the 20th of the
 * month after the period for a monthly filer, but NCDOR assigns the filing
 * frequency on registration and the platform holds no registration record for
 * the Association — which is why it is also a Planning item. An unverified
 * entry is counted as an obligation nowhere.
 */
export async function storeCalendar(
  subject: Subject,
  now: Date = new Date(),
): Promise<RoleCalendarItem[]> {
  const f = await storeFacts(subject, now);
  const items: RoleCalendarItem[] = [];

  const quarterEnd = quarterEndDate(f.quarter);
  items.push({
    key: `count-${f.quarter}`,
    title:
      `${f.quarter} physical inventory count, ${f.stockedRows.length} stocked lines, ` +
      "to be recorded by somebody other than the store chair",
    on: quarterEnd,
    entity: ENTITY,
    kind: "CYCLE",
    ownerRole: "STORE_CHAIR",
    href: "/board/store/inventory",
  });

  for (const period of monthlyFilingDueDates(f)) {
    items.push({
      key: `filing-${period.dueOn}`,
      title:
        `Sales and use tax return for ${period.label}, ` +
        `${formatCents(period.collectedCents)} collected, if the Association is registered ` +
        "with NCDOR as a monthly filer",
      on: period.dueOn,
      entity: ENTITY,
      kind: "FILING",
      ownerRole: "TREASURER",
      href: "/board/store/tax",
      // Neither the registration nor the assigned frequency is on record, so
      // the date is a reasonable guess and not an established duty.
      unverified: true,
    });
  }

  return items;
}

type FilingDue = { label: string; dueOn: string; collectedCents: number };

function monthlyFilingDueDates(f: StoreFacts): FilingDue[] {
  const byMonth = new Map<string, FilingDue>();
  for (const order of f.receiptedInPeriod) {
    if (order.taxCents <= 0) continue;
    const placed = new Date(order.placedAt);
    const year = placed.getUTCFullYear();
    const month = placed.getUTCMonth(); // 0-based
    const key = `${year}-${month}`;
    const due = isoDate(new Date(Date.UTC(year, month + 1, FILING_DUE_DAY_OF_MONTH)));
    const existing = byMonth.get(key);
    if (existing) {
      existing.collectedCents += order.taxCents;
    } else {
      byMonth.set(key, {
        label: placed.toLocaleString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }),
        dueOn: due,
        collectedCents: order.taxCents,
      });
    }
  }
  return Array.from(byMonth.values()).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/**
 * The events that drive stock, and the reason none of them are on the calendar
 * above.
 *
 * The register is the one source for lines of effort and it holds the golf
 * tournament and the Ball with `targetDate: null` — nobody has set a date. A
 * placeholder date here would become an obligation somewhere, so these are
 * listed as undated rather than dated at a guess. There is no event-calendar
 * module to read a real date from; see the report.
 */
export function storeStockDrivingEvents(): { project: Project; dated: boolean }[] {
  const { contributing, owned } = projectsForRole("STORE_CHAIR");
  return [...owned, ...contributing]
    .filter((project) => project.lineOfEffort === "FAMILY_EVENTS")
    .map((project) => ({ project, dated: project.targetDate !== null }));
}

/* ------------------------------------------------------------------ *
 * Planning: what this role wants on the next agenda
 * ------------------------------------------------------------------ */

/**
 * The three items the store actually needs the board for. Each one is a board
 * decision rather than a chair decision, which is the test for being here.
 *
 * The reasons are built from live state, not from a stored sentence: the
 * fulfilment question counts the flag as it currently stands, and the
 * separation-of-duties item carries the finding `separationOfDutiesFindings`
 * raises for whoever is actually in the seats.
 *
 * `acceptedForMeetingId` is null on all three. The Secretary's agenda builder
 * sets it; this module does not, and there is no local store of agendas.
 */
export async function storePlanningItems(
  subject: Subject,
  now: Date = new Date(),
): Promise<PlanningItem[]> {
  const f = await storeFacts(subject, now);
  const stocked = f.stockedRows.length;
  const pod = f.podRows.length;

  const banner = separationOfDutiesFindings(subject.personId, subject.assignments);
  const storeFinding = banner.find(
    (finding) => finding.roles.includes("STORE_CHAIR") && finding.roles.includes("TREASURER"),
  );

  return [
    {
      id: "store-plan-fulfilment",
      entity: ENTITY,
      title: "Hold stock, or move the store to print-on-demand",
      type: "DECISION",
      estimateMinutes: 20,
      reason:
        `The platform models this as a flag on each product precisely because the board has ` +
        `not decided: ${stocked} lines are held as stock and ${pod} are printed to order. That ` +
        `is a holding position, not an answer, and it decides real work. Held stock needs the ` +
        `quarterly physical count, carries shrinkage and ties up cash; printed to order has no ` +
        `shelf to count, no shrinkage and a thinner margin. The count that is the compensating ` +
        `control for the Treasurer chairing the store only exists because ${stocked} lines are ` +
        `held.`,
      proposedByRole: "STORE_CHAIR",
      acceptedForMeetingId: null,
    },
    {
      id: "store-plan-separation-of-duties",
      entity: ENTITY,
      title: "Move Store and Sales to a chair who is not the Treasurer",
      type: "DECISION",
      estimateMinutes: 15,
      reason:
        (storeFinding
          ? `Raised live against the person in the seat now: ${storeFinding.finding} ` +
            `${storeFinding.mitigation} `
          : "Nobody holds both seats as the roster stands, which is the state to keep. ") +
        "The quarterly count by a second person is a compensating control and not a fix: a " +
        "control the board has to remember to staff every quarter is weaker than a seat held " +
        "by a different person. This is the critical separation-of-duties finding on the " +
        "platform and only the board can close it.",
      proposedByRole: "STORE_CHAIR",
      acceptedForMeetingId: null,
    },
    {
      id: "store-plan-ncdor-registration",
      entity: ENTITY,
      title: "Confirm the Association's NCDOR sales and use tax registration, or register",
      type: "DECISION",
      estimateMinutes: 10,
      reason:
        `The store is collecting North Carolina sales tax now: ${formatCents(f.salesTaxCents)} ` +
        `across ${f.taxMonths} ${f.taxMonths === 1 ? "period" : "periods"} in ` +
        `${f.period.label}. Exemption from federal income tax is not exemption from collecting ` +
        "sales tax, and the annual-fundraising exemption cannot cover a catalogue open all " +
        "year. The platform holds no registration number and no assigned filing frequency, so " +
        "the filing dates on the Overview calendar are marked unverified and counted as " +
        "obligations nowhere. Collected tax is the state's money held in trust, and holding it " +
        "without a registration to remit it against is the exposure.",
      proposedByRole: "STORE_CHAIR",
      acceptedForMeetingId: null,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Projects: a filter over the one register
 * ------------------------------------------------------------------ */

export type StoreProjects = {
  owned: Project[];
  contributing: Project[];
  /** Resolved titles for the lines of effort the role touches. */
  linesTouched: { key: string; title: string; carriedBy: Entity }[];
};

/**
 * Filtered from `@/lib/projects/register`, never copied. The register carries
 * no project this role OWNS, which the tab states rather than hiding: the two
 * questions the store most needs settled — fulfilment and whose seat this is —
 * are Planning items, and nobody has raised them as lines of effort.
 */
export function storeProjects(): StoreProjects {
  const { owned, contributing } = projectsForRole("STORE_CHAIR");
  const keys = Array.from(
    new Set([...owned, ...contributing].map((project) => project.lineOfEffort)),
  );
  return {
    owned,
    contributing,
    linesTouched: keys.map((key) => ({
      key,
      title: LINES_OF_EFFORT[key].title,
      carriedBy: LINES_OF_EFFORT[key].carriedBy,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Outside view: two columns that are never merged
 * ------------------------------------------------------------------ */

/**
 * What the world sees of the store, by audience.
 *
 * For this role the member and public distinction is not a presentation
 * choice. It is the product, and it is the same control as the tax record: the
 * public catalogue is a projection that structurally cannot carry a
 * member-restricted line, and `toPublicProduct` throws on one rather than
 * returning a redacted version.
 *
 * So the public column names only what a visitor can actually see, and a
 * member-restricted line is ABSENT from it rather than present and locked.
 * There is no "4 more for members" row, because a label telling a visitor that
 * something exists tells them what the members have. The count of restricted
 * lines appears in the member column, where the reader is already inside the
 * gate.
 *
 * Reading this needs PUBLIC_CONTENT, which STORE_CHAIR holds at WRITE. It
 * deliberately does not need FINANCIAL: what the site shows is not a financial
 * record, and asking for a financial grant to read it would be the widening
 * the brief forbids.
 */
export async function storeOutsideSurface(subject: Subject): Promise<OutsideSurface> {
  authorize({ subject, dataClass: "PUBLIC_CONTENT", entity: ENTITY, required: "READ" });

  const all = await storeRepository().listProducts(ENTITY);
  const products = all.filter((p) => p.active);
  const publicLines = products.filter((p) => !isMemberRestricted(p));
  const memberOnlyLines = products.filter((p) => isMemberRestricted(p));
  const collections = Array.from(
    new Set(
      memberOnlyLines
        .map((p) => p.collection)
        .filter((collection): collection is string => collection !== null),
    ),
  ).sort();

  const items: OutsideItem[] = [
    /* ---- Anyone can see this ---- */
    {
      key: "public-catalogue",
      title: `The public catalogue, ${publicLines.length} lines`,
      href: "/store",
      audience: "PUBLIC",
      problem: "NONE",
      note:
        `What a visitor with no account sees: ${publicLines.length} lines, ` +
        `${describeFulfilment(publicLines)}. Prices exclude North Carolina sales tax, which ` +
        "is shown at checkout.",
    },
    {
      key: "public-nav-construction",
      title: "Store, as the live site's main navigation reaches it",
      href: "/store",
      audience: "PUBLIC",
      problem: "PLACEHOLDER_PUBLISHED",
      note:
        "On the live site the main navigation has a Store link and it lands on a page saying " +
        "the store is under construction. The nav promises a shop the visitor cannot reach, " +
        "which is worse than no link: a visitor who followed it once does not follow it again. " +
        "This catalogue is what the link should reach.",
    },
    {
      key: "public-item-pages",
      title: "The individual item pages a visitor can open",
      // Deliberately a SKU from the public projection, so this href cannot
      // become a board screen that links a member-restricted SKU in public
      // shape. A missing one falls back to the catalogue root.
      href: publicLines[0] ? `/store/item/${publicLines[0].sku}` : "/store",
      audience: "PUBLIC",
      problem: "NONE",
      note:
        "A member-restricted SKU typed into this URL answers not found, not forbidden. A 403 " +
        "on a specific SKU would confirm the SKU exists, which is the same disclosure as " +
        "listing it.",
    },

    /* ---- Members see this ---- */
    {
      key: "member-catalogue",
      title: `The member catalogue, ${products.length} lines`,
      href: "/store/members",
      audience: "MEMBER_OR_DONOR",
      problem: "NONE",
      note:
        `The full active catalogue. ${memberOnlyLines.length} of these ${products.length} ` +
        "lines exist only here and are named nowhere public, not even to say they are " +
        "unavailable. The gate is the membership module's own state check, not a second copy " +
        "of it.",
    },
    ...collections.map(
      (collection): OutsideItem => ({
        key: `member-collection-${collection.toLowerCase().replace(/\s+/g, "-")}`,
        title: `${collection}, a seasonal collection`,
        href: "/store/members",
        audience: "MEMBER_OR_DONOR",
        problem: "NONE",
        note:
          `${memberOnlyLines.filter((p) => p.collection === collection).length} lines, grouped a ` +
          "second way for members. Collections are a member-catalogue feature: a seasonal " +
          "grouping published publicly would advertise a calendar of things the public cannot buy.",
      }),
    ),
    {
      key: "member-purchase-is-a-tax-record",
      title: "What a member sees at checkout about their own status",
      href: "/store/members",
      audience: "MEMBER_OR_DONOR",
      problem: "NONE",
      note:
        "The order records whether the buyer was a member on the day of the sale, and that " +
        "answer is never recalculated afterwards. A member who lapses next year does not " +
        "change what this period's receipts were. It is a tax record, not a loyalty status.",
    },
  ];

  return { noExternalSurface: false, items };
}

/**
 * The counts the Outside view states in prose.
 *
 * `OutsideColumns` is shared and renders an item's note only when the item has
 * a problem, which is correct for the component and means the clean rows carry
 * no detail on screen. Rather than rewrite shared code, the tab states these
 * numbers underneath the columns. They are board-side figures: the count of
 * member-only lines appears here and on the member column, never on the
 * public one.
 */
export type StoreOutsideSummary = {
  publicLines: number;
  publicStockLines: number;
  publicPodLines: number;
  activeLines: number;
  memberOnlyLines: number;
  collections: string[];
};

export async function storeOutsideSummary(subject: Subject): Promise<StoreOutsideSummary> {
  authorize({ subject, dataClass: "PUBLIC_CONTENT", entity: ENTITY, required: "READ" });

  const all = await storeRepository().listProducts(ENTITY);
  const products = all.filter((p) => p.active);
  const publicLines = products.filter((p) => !isMemberRestricted(p));
  const memberOnlyLines = products.filter((p) => isMemberRestricted(p));
  return {
    publicLines: publicLines.length,
    publicStockLines: publicLines.filter((p) => p.fulfilment === "stock").length,
    publicPodLines: publicLines.filter((p) => p.fulfilment === "print_on_demand").length,
    activeLines: products.length,
    memberOnlyLines: memberOnlyLines.length,
    collections: Array.from(
      new Set(
        memberOnlyLines
          .map((p) => p.collection)
          .filter((collection): collection is string => collection !== null),
      ),
    ).sort(),
  };
}

function describeFulfilment(products: Product[]): string {
  const stock = products.filter((p) => p.fulfilment === "stock").length;
  const pod = products.filter((p) => p.fulfilment === "print_on_demand").length;
  return `${stock} held as stock and ${pod} printed to order`;
}

/**
 * The public column, as the surface itself reports it.
 *
 * Exported so the test can assert the control directly: no name, SKU or
 * collection of a member-restricted line may appear anywhere in the public
 * column, and the column may not carry a count of what is hidden.
 */
export function publicColumn(surface: OutsideSurface): OutsideItem[] {
  return surface.items.filter((item) => item.audience === "PUBLIC");
}

export function memberColumn(surface: OutsideSurface): OutsideItem[] {
  return surface.items.filter((item) => item.audience === "MEMBER_OR_DONOR");
}
