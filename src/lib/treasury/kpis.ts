/**
 * The Treasurer's dashboard: the figures, the actions under them, and the one
 * second-tier row that did not earn a tile.
 *
 * Authorization, the same way the rest of this module does it. `gather()` is
 * the single read: it asks the repository, and the repository checks scope per
 * entity before it computes anything. The three reads that carry their own
 * hard gate — the subscription register, the transfer list, the controls panel
 * — are called through the repository so that gate still runs, and a refusal
 * is caught and turned into a withheld tile rather than worked around. Nothing
 * here widens a grant to make a tile render.
 *
 * Withheld is not zero. Zero is a claim about the entity's finances; withheld
 * is a claim about the reader's permissions. A Treasurer deciding whether a
 * figure is bad has to know which of the two they are looking at, so a column
 * the reader has no scope for says WITHHELD and says why.
 *
 * The no-blend rule shapes every tile on this screen. There is no figure here
 * that covers both entities: net assets and annual operating cost are each a
 * PAIR of tiles, one per entity, each labelled in its own label; and the
 * figures that are counts rather than money state their entity split instead
 * of a single total. `RenewalCommitment` is the only returned shape carrying
 * cents, and `assertUnblended` is called on it before it leaves this file.
 *
 * Integer cents throughout. Nothing here divides, multiplies or rounds a money
 * figure: the normalisation to an annual cost and the apportionment of a shared
 * invoice both happen in `money.ts`, which is the only place that is allowed to.
 *
 * Imports are relative, not `@/`: the test runner has no path alias.
 */

import { ENTITIES, type Entity } from "../authz/model";
import { AuthzError, type Subject } from "../authz/policy";
import { assertUnblended, formatCentsWithSymbol, sumCents, TreasuryError } from "./money";
import { statusFor } from "./reimbursements";
import {
  treasuryRepository,
  type InMemoryTreasuryRepository,
  type ReimbursementQueue,
  type SodPanel,
} from "./repository";
import { unmetTransferRules } from "./transfers";
import type {
  Period,
  PositionStatement,
  Reimbursement,
  SubscriptionRegister,
  Transfer,
} from "./types";
import type { TaskUrgency } from "../workspace/types";

/** Imported for the shape only. `@/components/dashboard/Kpi` is read-only. */
import type { Kpi } from "../../components/dashboard/Kpi";

export type { Kpi };

/* ------------------------------------------------------------------ *
 * Shapes the dashboard returns
 * ------------------------------------------------------------------ */

/**
 * One thing that needs doing, derived from state.
 *
 * This list is the Overview tab's task list rather than the Dashboard's: the
 * Dashboard keeps the figures and the Overview takes the doing, per
 * docs/ROLE-WORKSPACE.md. It stays in this file because every one of these is
 * computed from the same single authorized read as the tiles, and splitting
 * the read in two would mean asking the repository twice and risking two
 * different answers on one screen.
 *
 * `note` says which items and what happens if nobody acts. `because` says what
 * it BLOCKS, which is the question a volunteer deciding whether to open it
 * tonight is actually asking. They are different sentences on purpose.
 */
export type TreasuryAction = {
  key: string;
  /** What to do, in the imperative. */
  label: string;
  /** Which items, and what happens if nobody does it. */
  note: string;
  /** What this blocks, in one line. Becomes `RoleTask.because`. */
  because: string;
  /** Short enough for the count column. "3", not "3 Association, 1 Foundation". */
  count: string;
  /** Countable items behind the count, for `RoleTask.count`. */
  countValue: number;
  href: string;
  /** Urgent colours the count. Used sparingly, or it stops meaning anything. */
  urgent: boolean;
  /**
   * Sort order on the Overview. `overdue` is reserved for something that has
   * already run past the date or the tolerance it had, never for "important".
   */
  urgency: TaskUrgency;
  /**
   * Set only where the action belongs to ONE entity. An action covering both
   * is split into one per entity rather than carrying a blended count, which
   * is why the reimbursement queues produce two actions and not one.
   */
  entity?: Entity;
  /** Set when a date drives the urgency. */
  dueOn?: string;
};

/**
 * Renewals in the window, per entity. The cash figure sits inside an object
 * that names its entity, which is the only legal place for a cents field in
 * this module: see `assertUnblended` in money.ts.
 */
export type RenewalCommitment =
  | {
      entity: Entity;
      visible: true;
      lineCount: number;
      /** Annual cost of the lines renewing in the window, this entity's share. */
      committedAnnualCents: number;
      soonestRenewalDate: string | null;
    }
  | { entity: Entity; visible: false; withheldReason: string };

export type TreasuryDashboard = {
  period: Period;
  asOf: string;
  kpis: Kpi[];
  actions: TreasuryAction[];
  renewals: RenewalCommitment[];
  /** Window the renewal row covers, so the screen can say so. */
  renewalWindowDays: number;
  renewalWindowEndDate: string;
};

/** How far ahead a renewal counts as committed cash the board still controls. */
export const RENEWAL_WINDOW_DAYS = 90;

/** Past this, a volunteer waiting on their own money is a retention problem. */
export const REIMBURSEMENT_WAIT_PROBLEM_DAYS = 90;
export const REIMBURSEMENT_WAIT_WATCH_DAYS = 30;


const ENTITY_NAME: Record<Entity, string> = {
  JSOA: "Association",
  JSOF: "Foundation",
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function addDays(date: string, days: number): string {
  const at = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return at.toISOString().slice(0, 10);
}

/** A change figure has to carry its direction, or the tile says nothing. */
function signed(amountCents: number): string {
  const body = formatCentsWithSymbol(amountCents);
  return amountCents > 0 ? `+${body}` : body;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function withheldTile(key: string, label: string, reason: string): Kpi {
  // `withheld`, not `unmeasured`. The figure exists and is simply not this
  // reader's to see, which is a different fact from nobody being able to
  // measure it, and the tile renders the two differently.
  return { key, label, value: null, status: "withheld", from: reason };
}

/* Reader-facing withheld copy. Each one says what is withheld, why, and that
   the figure exists — because the one thing a withheld tile must not be
   mistaken for is a zero. */

const NO_REGISTER_SCOPE =
  "The subscription register needs financial scope on at least one entity and you " +
  "hold none, so this is withheld rather than shown as zero. The register exists.";

const NO_CONTROLS_SCOPE =
  "The controls panel needs a board seat or audit scope, and you hold neither, so " +
  "the findings are withheld. Withheld is not the same as none outstanding.";

const NO_QUEUE_SCOPE =
  "You hold no row-level financial scope on either entity, so both reimbursement " +
  "queues are withheld. There are claims; they are not yours to see.";

function noEntityScope(entity: Entity, what: string): string {
  return (
    `You hold no financial scope on ${entity}, so its ${what} is withheld. ` +
    `The ${entity} figure exists and is not zero.`
  );
}

/* ------------------------------------------------------------------ *
 * The read
 *
 * One pass over the repository. Each call either returns a scoped view or
 * refuses; a refusal is recorded against the read so the tile that depended on
 * it can say it is withheld, in its own words rather than the gate's.
 * ------------------------------------------------------------------ */

/**
 * A refusal carries its CODE, not its message. The gate's message is written
 * for a developer reading a stack trace and names whichever entity it happened
 * to check first; the tile writes its own sentence for the person looking at
 * the screen. The code is what a later audit log would want.
 */
type Refusable<T> = { ok: true; value: T } | { ok: false; refusalCode: string };

function attempt<T>(read: () => T): Refusable<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    if (error instanceof AuthzError || error instanceof TreasuryError) {
      return { ok: false, refusalCode: error.code };
    }
    throw error;
  }
}

type Gathered = {
  period: Period;
  asOf: string;
  position: PositionStatement;
  register: Refusable<SubscriptionRegister>;
  transfers: Refusable<Transfer[]>;
  sod: Refusable<SodPanel>;
  queues: ReimbursementQueue[];
};

function gather(subject: Subject, repo: InMemoryTreasuryRepository): Gathered {
  return {
    period: repo.period(),
    asOf: repo.asOfDate(),
    // Checks FINANCIAL AGGREGATE per entity and withholds the column otherwise.
    position: repo.positionStatement(subject),
    register: attempt(() => repo.subscriptionRegister(subject)),
    transfers: attempt(() => repo.transfers(subject)),
    sod: attempt(() => repo.separationOfDuties(subject)),
    // Already withholds per entity rather than throwing.
    queues: repo.reimbursementQueues(subject),
  };
}

/* ------------------------------------------------------------------ *
 * Reimbursements: what is actually outstanding
 * ------------------------------------------------------------------ */

type OutstandingClaim = { claim: Reimbursement; ageDays: number };

function outstandingClaims(queues: ReimbursementQueue[], asOf: string): OutstandingClaim[] {
  const open: OutstandingClaim[] = [];
  for (const queue of queues) {
    if (!queue.visible) continue;
    for (const claim of queue.claims) {
      const status = statusFor(claim);
      if (status !== "SUBMITTED" && status !== "AWAITING_SECOND_APPROVAL") continue;
      open.push({ claim, ageDays: daysBetween(claim.incurredOn, asOf) });
    }
  }
  return open.sort((a, b) => b.ageDays - a.ageDays || a.claim.id.localeCompare(b.claim.id));
}

/** Per entity, labelled, so the queue depth is never one blended number. */
function queueSplitLabel(queues: ReimbursementQueue[], open: OutstandingClaim[]): string {
  return queues
    .map((queue) => {
      if (!queue.visible) return `${queue.entity} withheld`;
      const count = open.filter((o) => o.claim.entity === queue.entity).length;
      return `${queue.entity} ${count}`;
    })
    .join(", ");
}

/* ------------------------------------------------------------------ *
 * Renewals in the window
 * ------------------------------------------------------------------ */

function renewalsDue(
  register: Refusable<SubscriptionRegister>,
  asOf: string,
): RenewalCommitment[] {
  const windowEnd = addDays(asOf, RENEWAL_WINDOW_DAYS);

  const rows: RenewalCommitment[] = ENTITIES.map((entity) => {
    if (!register.ok) {
      return { entity, visible: false, withheldReason: NO_REGISTER_SCOPE };
    }
    const figure = register.value.annualOperatingCost.find((f) => f.entity === entity);
    if (!figure || !figure.visible) {
      return {
        entity,
        visible: false,
        withheldReason: noEntityScope(entity, "renewal commitment"),
      };
    }

    const due = register.value.rows.filter(
      (row) =>
        row.subscription.renewalDate !== null &&
        row.subscription.renewalDate >= asOf &&
        row.subscription.renewalDate <= windowEnd &&
        row.annualByEntity.some((part) => part.entity === entity && part.amountCents > 0),
    );

    const dates = due
      .map((row) => row.subscription.renewalDate)
      .filter((date): date is string => date !== null)
      .sort();

    return {
      entity,
      visible: true,
      lineCount: due.length,
      committedAnnualCents: sumCents(
        due.flatMap((row) =>
          row.annualByEntity
            .filter((part) => part.entity === entity)
            .map((part) => part.amountCents),
        ),
      ),
      soonestRenewalDate: dates.length > 0 ? dates[0] : null,
    };
  });

  // The guard, on the one shape here that carries cents. A figure covering both
  // entities would have nowhere to sit in this array, and this call proves it.
  assertUnblended(rows, "treasuryDashboard.renewals");
  return rows;
}

/* ------------------------------------------------------------------ *
 * Tiles
 * ------------------------------------------------------------------ */

/**
 * Net assets, per entity, with the direction of travel as the headline.
 *
 * The level is in the provenance line and the CHANGE is the figure, because
 * the level is on the position statement below and the direction is not. Two
 * tiles, never a sum: the Association and the Foundation are separate legal
 * persons and a combined movement describes an entity that does not exist.
 */
function netAssetTiles(position: PositionStatement): Kpi[] {
  return position.columns.map((column) => {
    const key = `net-assets-${column.entity}`;
    const label = `${column.entity} net assets, change over the period`;
    if (!column.visible) {
      return withheldTile(key, label, column.withheldReason);
    }
    const restrictedShare = column.restrictedClosingCents;
    return {
      key,
      label,
      value: signed(column.changeCents),
      status: column.changeCents < 0 ? "problem" : "good",
      from:
        `Closing ${formatCentsWithSymbol(column.closingNetAssetsCents)} against opening ` +
        `${formatCentsWithSymbol(column.openingNetAssetsCents)}, ${ENTITY_NAME[column.entity]} ` +
        `funds only, ${position.period.label}. ` +
        `${formatCentsWithSymbol(restrictedShare)} of the closing balance is restricted.`,
    };
  });
}

/**
 * Annual operating cost, per entity, normalised from mixed cadences.
 *
 * Monthly, quarterly, annual and variable lines are all normalised to a year
 * in `money.ts`, and a shared invoice is apportioned by its stated basis with
 * the remainder cents distributed so the parts add back to the whole. A line
 * with no observed annual figure is excluded and said so, not treated as zero.
 */
function operatingCostTiles(register: Refusable<SubscriptionRegister>): Kpi[] {
  return ENTITIES.map((entity) => {
    const key = `operating-cost-${entity}`;
    const label = `${entity} annual operating cost committed`;

    if (!register.ok) return withheldTile(key, label, NO_REGISTER_SCOPE);

    const figure = register.value.annualOperatingCost.find((f) => f.entity === entity);
    if (!figure || !figure.visible) {
      return withheldTile(key, label, noEntityScope(entity, "annual operating cost"));
    }

    const bearing = register.value.rows.filter((row) =>
      row.annualByEntity.some((part) => part.entity === entity),
    );
    const gaps = bearing.filter((row) =>
      row.findings.some((finding) => finding.code === "MISSING_OBSERVED_ANNUAL"),
    );

    return {
      key,
      label,
      value: formatCentsWithSymbol(figure.amountCents),
      status: gaps.length > 0 ? "watch" : "good",
      from:
        `${bearing.length} register ${plural(bearing.length, "line", "lines")} carrying a ` +
        `share for the ${ENTITY_NAME[entity]}, each cadence normalised to a year in integer cents` +
        (gaps.length > 0
          ? `. ${gaps.length} variable ${plural(gaps.length, "line has", "lines have")} no ` +
            `observed annual figure and ${plural(gaps.length, "is", "are")} not in this total.`
          : `, apportioned on the stated basis.`),
    };
  });
}

/**
 * Separation-of-duties findings outstanding, by severity.
 *
 * The engine is `separationOfDutiesFindings` in `@/lib/authz/policy`, run over
 * the board's assignments as they actually stand. A critical finding is a
 * problem tile: on this board the Treasurer of the Association also chairs the
 * store, which puts authorize, custody, record and reconcile in one pair of
 * hands.
 */
function sodTile(sod: Refusable<SodPanel>): Kpi {
  const key = "sod-findings";
  const label = "Separation-of-duties findings outstanding";

  if (!sod.ok) return withheldTile(key, label, NO_CONTROLS_SCOPE);

  const { current, withheldCount } = sod.value;
  const counts = {
    critical: current.filter((f) => f.severity === "critical").length,
    high: current.filter((f) => f.severity === "high").length,
    moderate: current.filter((f) => f.severity === "moderate").length,
  };

  if (current.length === 0 && withheldCount > 0) {
    return withheldTile(
      key,
      label,
      `${withheldCount} ${plural(withheldCount, "finding stands", "findings stand")} on the ` +
        `board as assigned. None of them is about you and you hold no audit scope over ` +
        `other seats, so the count is withheld rather than shown as none.`,
    );
  }

  if (current.length === 0) {
    return {
      key,
      label,
      value: "None",
      status: "good",
      target: "None outstanding",
      from:
        "The board's role assignments as they stand, run through the " +
        "separation-of-duties rules. That is a result, not an absence of checking.",
    };
  }

  const parts = [
    counts.critical > 0 ? `${counts.critical} critical` : null,
    counts.high > 0 ? `${counts.high} high` : null,
    counts.moderate > 0 ? `${counts.moderate} moderate` : null,
  ].filter((part): part is string => part !== null);

  return {
    key,
    label,
    value: parts.join(", "),
    status: counts.critical > 0 ? "problem" : "watch",
    target: "None outstanding",
    from:
      `The board's role assignments as they stand, by severity` +
      (withheldCount > 0
        ? `. ${withheldCount} more ${plural(withheldCount, "is", "are")} outside your audit scope.`
        : `. Accepting one is the board's decision to minute, not the platform's.`),
  };
}

/**
 * Subscriptions with no second administrator.
 *
 * The handover test, and the only tile here that answers "what breaks when a
 * volunteer moves away". A blank second administrator is a finding, not an
 * empty cell: if the owner is unreachable nobody can get into the account,
 * change the card on it, or switch it off.
 */
function secondAdministratorTile(register: Refusable<SubscriptionRegister>): Kpi {
  const key = "no-second-administrator";
  const label = "Subscriptions with no second administrator";

  if (!register.ok) return withheldTile(key, label, NO_REGISTER_SCOPE);

  const rows = register.value.rows;
  const missing = rows.filter((row) => !row.subscription.secondAdministratorPersonId);
  const withheldRows = register.value.withheldRowCount;

  return {
    key,
    label,
    value: `${missing.length} of ${rows.length}`,
    target: `0 of ${rows.length}`,
    status: missing.length > 0 ? "problem" : "good",
    from:
      `Register lines you hold scope for; a blank second administrator is a handover ` +
      `failure, not an empty cell` +
      (withheldRows > 0
        ? `. ${withheldRows} further ${plural(withheldRows, "line is", "lines are")} outside ` +
          `your scope and not counted either way.`
        : `.`),
  };
}

/**
 * The oldest reimbursement still waiting, in days.
 *
 * A volunteer who paid out of pocket and is still waiting is a retention
 * problem before it is an accounting one, and the age is the figure that says
 * so. The oldest claim belongs to exactly one entity, which is named, so this
 * is not a figure spanning both; the queue depths are stated per entity in the
 * provenance line for the same reason.
 */
function reimbursementWaitTile(queues: ReimbursementQueue[], asOf: string): Kpi {
  const key = "reimbursement-wait";
  const label = "Longest wait on an unapproved reimbursement";
  const visible = queues.filter((queue) => queue.visible);

  if (visible.length === 0) {
    return withheldTile(key, label, NO_QUEUE_SCOPE);
  }

  const open = outstandingClaims(queues, asOf);
  const split = queueSplitLabel(queues, open);

  if (open.length === 0) {
    return {
      key,
      label,
      value: "None waiting",
      status: "good",
      from: `No claim awaiting approval in the queues you can see. Outstanding: ${split}.`,
    };
  }

  const oldest = open[0];
  return {
    key,
    label,
    value: `${oldest.ageDays} days`,
    status:
      oldest.ageDays > REIMBURSEMENT_WAIT_PROBLEM_DAYS
        ? "problem"
        : oldest.ageDays > REIMBURSEMENT_WAIT_WATCH_DAYS
          ? "watch"
          : "good",
    from:
      `${oldest.claim.id} (${oldest.claim.entity}), incurred ${oldest.claim.incurredOn}, ` +
      `measured to ${asOf}. Outstanding: ${split}.`,
  };
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

function buildActions(data: Gathered): TreasuryAction[] {
  const actions: TreasuryAction[] = [];

  /* A transfer sitting on an unmet condition. The conditions come from
     `transferRuleStatuses`, which evaluates every one of them rather than
     stopping at the first, because a treasurer needs the whole list. */
  if (data.transfers.ok) {
    const blocked = data.transfers.value
      .filter((transfer) => transfer.status !== "REFUSED")
      .map((transfer) => ({ transfer, unmet: unmetTransferRules(transfer) }))
      .filter((entry) => entry.unmet.length > 0);

    if (blocked.length > 0) {
      const first = blocked[0];
      actions.push({
        key: "transfers-blocked",
        label: "Clear the inter-entity transfer waiting on a condition",
        note:
          `${first.transfer.id}, ${first.transfer.fromEntity} to ${first.transfer.toEntity}. ` +
          `Still outstanding: ` +
          first.unmet.map((rule) => rule.requirement).join(" ") +
          ` Until all of them are met it is not recordable on either book.`,
        because:
          `Blocks the money moving at all. ${first.transfer.id} is one transaction sitting ` +
          `on two ledgers, so until every condition is met neither the ${first.transfer.fromEntity} ` +
          `nor the ${first.transfer.toEntity} book can record it, and the purpose it was raised ` +
          `for is unfunded.`,
        count: `${blocked.length}`,
        countValue: blocked.length,
        href: "/board/treasury/transfers",
        urgent: true,
        urgency: "soon",
      });
    }
  }

  /* Reimbursements, one action per entity. A single combined queue count would
     be a figure spanning both entities, and the two queues are approved by
     different people anyway. */
  const open = outstandingClaims(data.queues, data.asOf);
  for (const queue of data.queues) {
    if (!queue.visible) continue;
    const mine = open.filter((entry) => entry.claim.entity === queue.entity);
    if (mine.length === 0) continue;
    const oldest = mine[0];
    actions.push({
      key: `reimbursements-${queue.entity}`,
      label: `Approve the ${ENTITY_NAME[queue.entity]} claims people are waiting on`,
      note:
        `Oldest is ${oldest.claim.id}, ${oldest.ageDays} days since it was incurred. ` +
        `Every one of these is a volunteer who paid out of their own pocket.`,
      /* The age is the whole point of this line. A volunteer who paid out of
         pocket and is still waiting is a retention problem before it is an
         accounting one, and a count with no age does not say that. */
      because:
        `${oldest.claim.claimantName} has been out of pocket ${oldest.ageDays} days on ` +
        `${oldest.claim.id} (${formatCentsWithSymbol(oldest.claim.amountCents)}). ` +
        (mine.length > 1
          ? `${mine.length - 1} other ${plural(mine.length - 1, "claim is", "claims are")} ` +
            `behind it, ${mine
              .slice(1)
              .map((entry) => `${entry.ageDays} days`)
              .join(", ")}. `
          : "") +
        `This blocks the person, not the books: the next time the ${ENTITY_NAME[queue.entity]} ` +
        `needs somebody to front a venue deposit, this is the wait they will remember.`,
      count: `${mine.length}`,
      countValue: mine.length,
      href: "/board/treasury/reimbursements",
      urgent: oldest.ageDays > REIMBURSEMENT_WAIT_PROBLEM_DAYS,
      urgency:
        oldest.ageDays > REIMBURSEMENT_WAIT_PROBLEM_DAYS
          ? "overdue"
          : oldest.ageDays > REIMBURSEMENT_WAIT_WATCH_DAYS
            ? "soon"
            : "open",
      entity: queue.entity,
    });
  }

  /* A claim with no receipt cannot be approved at all, so it is its own job. */
  const noReceipt = open.filter((entry) => !entry.claim.receiptOnFile);
  if (noReceipt.length > 0) {
    actions.push({
      key: "reimbursements-no-receipt",
      label: "Get the receipts for the claims that have none",
      note:
        `${noReceipt.map((entry) => entry.claim.id).join(", ")}. Approval is refused ` +
        `without one: a reimbursement with no receipt is an unsubstantiated payment ` +
        `to a board member.`,
      because:
        `Blocks the approval itself, so the claimant is waiting on a document rather than ` +
        `on a decision and nobody has told them. ` +
        `${noReceipt
          .map((entry) => `${entry.claim.id}, ${entry.ageDays} days`)
          .join("; ")}.`,
      count: `${noReceipt.length}`,
      countValue: noReceipt.length,
      href: "/board/treasury/reimbursements",
      urgent: false,
      urgency: "open",
    });
  }

  if (data.register.ok) {
    const rows = data.register.value.rows;

    const missing = rows.filter((row) => !row.subscription.secondAdministratorPersonId);
    if (missing.length > 0) {
      actions.push({
        key: "second-administrators",
        label: "Name a second administrator on the lines that have none",
        note:
          `${missing.map((row) => row.subscription.tool).join(", ")}. Record the credential ` +
          `in the shared password manager, not in one volunteer's personal inbox.`,
        because:
          `Blocks handover. If the one named owner of ${missing[0].subscription.tool} is ` +
          `unreachable, nobody on either board can get into the account, change the card ` +
          `on it or switch it off, and the renewal happens anyway.`,
        count: `${missing.length}`,
        countValue: missing.length,
        href: "/board/treasury/subscriptions",
        urgent: true,
        urgency: "soon",
      });
    }

    const windowEnd = addDays(data.asOf, RENEWAL_WINDOW_DAYS);
    const dueSoon = rows.filter(
      (row) =>
        row.subscription.renewalDate !== null &&
        row.subscription.renewalDate >= data.asOf &&
        row.subscription.renewalDate <= windowEnd,
    );
    if (dueSoon.length > 0) {
      const soonest = dueSoon
        .map((row) => row.subscription.renewalDate)
        .filter((date): date is string => date !== null)
        .sort()[0];
      actions.push({
        key: "renewals-due",
        label: `Decide the renewals falling due before ${windowEnd}`,
        note:
          `The first is ${soonest}. Each of these renews by default if nobody decides, ` +
          `and the cash it commits is on the row below.`,
        because:
          `Blocks nothing and that is the problem: silence is a yes. The first falls on ` +
          `${soonest}, and after that the board is committed for another term without ` +
          `having decided anything. The cash each entity commits is stated per entity on ` +
          `the Dashboard.`,
        count: `${dueSoon.length}`,
        countValue: dueSoon.length,
        href: "/board/treasury/subscriptions",
        urgent: false,
        urgency: "soon",
        dueOn: soonest,
      });
    }
  }

  if (data.sod.ok && data.sod.value.current.length > 0) {
    const findings = data.sod.value.current;
    const critical = findings.filter((finding) => finding.severity === "critical");
    const lead = critical[0] ?? findings[0];
    actions.push({
      key: "controls-findings",
      label:
        critical.length > 0
          ? `Answer the controls findings, starting with the ${plural(
              critical.length,
              "critical one",
              "critical ones",
            )}`
          : "Answer the controls findings on the record",
      note: `${lead.mitigation} Accepting a finding knowingly is a board decision to minute.`,
      because:
        (critical.length > 0
          ? `Blocks the board being able to say its money is controlled. ${lead.finding} `
          : `${lead.finding} `) +
        `Until it is either remedied or knowingly accepted in a minute, every other figure ` +
        `on these screens rests on one person's word.`,
      count: `${findings.length}`,
      countValue: findings.length,
      href: "/board/treasury/controls",
      urgent: critical.length > 0,
      urgency: critical.length > 0 ? "overdue" : "open",
      entity: lead.entity,
    });
  }

  return actions;
}

/* ------------------------------------------------------------------ *
 * The dashboard
 * ------------------------------------------------------------------ */

/**
 * One authorized read. Every figure on the Treasurer's dashboard, the actions
 * that follow from them, and the renewal row that sits below.
 */
export function treasuryDashboard(
  subject: Subject,
  repo: InMemoryTreasuryRepository = treasuryRepository(),
): TreasuryDashboard {
  const data = gather(subject, repo);
  const renewals = renewalsDue(data.register, data.asOf);

  const kpis: Kpi[] = [
    ...netAssetTiles(data.position),
    ...operatingCostTiles(data.register),
    sodTile(data.sod),
    secondAdministratorTile(data.register),
    reimbursementWaitTile(data.queues, data.asOf),
  ];

  return {
    period: data.period,
    asOf: data.asOf,
    kpis,
    actions: buildActions(data),
    renewals,
    renewalWindowDays: RENEWAL_WINDOW_DAYS,
    renewalWindowEndDate: addDays(data.asOf, RENEWAL_WINDOW_DAYS),
  };
}

/* ------------------------------------------------------------------ *
 * Headline figures
 *
 * docs/ROLE-WORKSPACE.md cuts the Dashboard to one to three figures. A
 * volunteer looking at seven numbers has none.
 *
 * Three IDEAS, not three tiles. Net assets is a per-entity PAIR, which is one
 * idea rendered twice because the Association and the Foundation are separate
 * legal persons and a combined movement describes an entity that does not
 * exist. Collapsing the pair into one tile to save a slot would be the exact
 * blend this module is built to refuse, so the pair costs one slot and renders
 * as two labelled figures.
 *
 * The three, and why each one would change what the Treasurer does next:
 *
 *   1. Net assets, change over the period, per entity. The only figure that
 *      says whether each treasury is going the right way. A negative change
 *      changes the next spending decision.
 *   2. Separation-of-duties findings outstanding. On this board the
 *      Association's Treasurer also chairs the store, which is authorize,
 *      custody, record and reconcile in one pair of hands. It changes whether
 *      the board appoints a Finance Review Officer this month or next year.
 *   3. Longest wait on an unapproved reimbursement. A volunteer who paid out
 *      of pocket and is still waiting is a retention problem, and the age is
 *      the figure that says so. It changes what gets opened tonight.
 *
 * Behind the disclosure: annual operating cost per entity, which is a planning
 * figure reviewed at renewal rather than a weekly one; and subscriptions with
 * no second administrator, which already drives a task on the Overview and a
 * finding on the Subscriptions tab and does not need a headline too.
 * ------------------------------------------------------------------ */

export const HEADLINE_KPI_KEYS: readonly string[] = [
  ...ENTITIES.map((entity) => `net-assets-${entity}`),
  "sod-findings",
  "reimbursement-wait",
];

/**
 * Split the tiles into the headline figures and the rest.
 *
 * Order follows `HEADLINE_KPI_KEYS` rather than the order the tiles were
 * built in, so the pair stays adjacent and the headline does not reshuffle
 * when a tile is added below.
 */
export function splitKpis(kpis: Kpi[]): { headline: Kpi[]; more: Kpi[] } {
  const byKey = new Map(kpis.map((kpi) => [kpi.key, kpi]));
  const headline = HEADLINE_KPI_KEYS.map((key) => byKey.get(key)).filter(
    (kpi): kpi is Kpi => kpi !== undefined,
  );
  const headlineKeys = new Set(headline.map((kpi) => kpi.key));
  return { headline, more: kpis.filter((kpi) => !headlineKeys.has(kpi.key)) };
}

/** The figures alone, for a caller that wants the tiles and nothing else. */
export function treasuryKpis(
  subject: Subject,
  repo: InMemoryTreasuryRepository = treasuryRepository(),
): Kpi[] {
  return treasuryDashboard(subject, repo).kpis;
}
