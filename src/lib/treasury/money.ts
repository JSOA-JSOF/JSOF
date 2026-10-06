/**
 * Integer-cent arithmetic and the no-blend guard.
 *
 * Every figure in this module is an integer number of cents. There is no
 * float, no `toFixed` on a computed amount, and no division that does not go
 * through `apportion`, which distributes remainder cents deterministically so
 * the parts add back to the whole.
 */

import { ENTITIES, type Entity } from "../authz/model";
import type { Cadence, EntitySplit, Subscription } from "./types";

export class TreasuryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_AN_INTEGER"
      | "BAD_CADENCE_DATA"
      | "BAD_SPLIT"
      | "BLENDED_TOTAL"
      | "SELF_APPROVAL"
      | "ALREADY_APPROVED"
      | "NO_RECEIPT"
      | "NOT_APPROVABLE"
      | "TRANSFER_RULE_UNMET",
  ) {
    super(message);
    this.name = "TreasuryError";
  }
}

/* ------------------------------------------------------------------ *
 * Cents
 * ------------------------------------------------------------------ */

export function assertIntegerCents(value: number, what: string): number {
  if (!Number.isInteger(value)) {
    throw new TreasuryError(
      `${what} must be an integer number of cents, got ${value}`,
      "NOT_AN_INTEGER",
    );
  }
  return value;
}

/**
 * Render for display. Grouped, two decimals, no currency symbol on the figure
 * itself so the column header can carry "USD" once. Negative renders with a
 * leading minus, not parentheses: parentheses read as a footnote on screen.
 */
export function formatCents(amountCents: number): string {
  assertIntegerCents(amountCents, "amountCents");
  const negative = amountCents < 0;
  const abs = Math.abs(amountCents);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = dollars.toLocaleString("en-US");
  return `${negative ? "-" : ""}${grouped}.${String(cents).padStart(2, "0")}`;
}

/** As above, with the symbol, for prose rather than a column. */
export function formatCentsWithSymbol(amountCents: number): string {
  const body = formatCents(amountCents);
  return body.startsWith("-") ? `-$${body.slice(1)}` : `$${body}`;
}

export function sumCents(values: number[]): number {
  let total = 0;
  for (const value of values) total += assertIntegerCents(value, "value");
  return total;
}

/**
 * Split `amountCents` across weights in basis points, exactly.
 *
 * Largest-remainder: floor each share, then hand the leftover cents to the
 * largest fractional parts in order. The returned parts always sum to
 * `amountCents`, which is why the register can apportion a shared invoice
 * without a cent appearing or vanishing.
 */
export function apportion(amountCents: number, weightsBasisPoints: number[]): number[] {
  assertIntegerCents(amountCents, "amountCents");
  const totalWeight = weightsBasisPoints.reduce((a, b) => a + b, 0);
  if (totalWeight !== 10_000) {
    throw new TreasuryError(
      `Split must sum to 10,000 basis points, got ${totalWeight}`,
      "BAD_SPLIT",
    );
  }
  const raw = weightsBasisPoints.map((w) => (amountCents * w) / 10_000);
  const floors = raw.map((v) => Math.floor(v));
  let leftover = amountCents - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const parts = [...floors];
  for (const { i } of order) {
    if (leftover <= 0) break;
    parts[i] += 1;
    leftover -= 1;
  }
  return parts;
}

/* ------------------------------------------------------------------ *
 * Cadence normalisation
 * ------------------------------------------------------------------ */

export const CADENCE_MULTIPLIER: Record<Exclude<Cadence, "variable">, number> = {
  monthly: 12,
  quarterly: 4,
  annual: 1,
};

/**
 * The register's whole point is that every line is comparable, so every
 * cadence normalises to one annual figure.
 *
 * A variable cadence has no rate to multiply — a payment processor's fees are
 * whatever the year's volume was — so it reports the trailing twelve months of
 * actual spend, and a variable line with no observed figure is a data gap
 * rather than a zero.
 */
export function annualCostCents(input: {
  cadence: Cadence;
  costCents: number | null;
  observedAnnualCents: number | null;
}): number {
  if (input.cadence === "variable") {
    if (input.observedAnnualCents === null) {
      throw new TreasuryError(
        "A variable cadence needs an observed annual figure: there is no rate to multiply",
        "BAD_CADENCE_DATA",
      );
    }
    return assertIntegerCents(input.observedAnnualCents, "observedAnnualCents");
  }
  if (input.costCents === null) {
    throw new TreasuryError(
      `A ${input.cadence} cadence needs a cost per period`,
      "BAD_CADENCE_DATA",
    );
  }
  assertIntegerCents(input.costCents, "costCents");
  return input.costCents * CADENCE_MULTIPLIER[input.cadence];
}

export function subscriptionAnnualCents(subscription: Subscription): number {
  return annualCostCents(subscription);
}

/** The annual invoice apportioned across the entities that share it. */
export function annualByEntity(
  subscription: Subscription,
): { entity: Entity; amountCents: number }[] {
  const annual = subscriptionAnnualCents(subscription);
  const split = normaliseSplit(subscription.split);
  const parts = apportion(
    annual,
    split.map((s) => s.shareBasisPoints),
  );
  return split.map((s, i) => ({ entity: s.entity, amountCents: parts[i] }));
}

function normaliseSplit(split: EntitySplit[]): EntitySplit[] {
  if (split.length === 0) {
    throw new TreasuryError("A subscription must name at least one entity", "BAD_SPLIT");
  }
  // Stable order, so apportioned remainder cents do not move between renders.
  return [...split].sort((a, b) => ENTITIES.indexOf(a.entity) - ENTITIES.indexOf(b.entity));
}

export function basisPointsToPercentLabel(basisPoints: number): string {
  const whole = basisPoints / 100;
  return Number.isInteger(whole) ? `${whole}%` : `${whole.toFixed(2)}%`;
}

/* ------------------------------------------------------------------ *
 * The no-blend guard
 *
 * The rule from docs/ARCHITECTURE.md is that any aggregate spanning both
 * entities renders as two labelled columns and is never summed into one
 * figure. That is easy to honour on the day and easy to break six months
 * later, when somebody adds a "total" to the top of the page because it
 * looked unfinished without one.
 *
 * So the aggregate containers this module returns are checked before they
 * leave the repository: inside an aggregate, a number-valued key ending in
 * `Cents` is only legal where an enclosing object says which entity it belongs
 * to. A combined figure has nowhere to sit.
 * ------------------------------------------------------------------ */

const ENTITY_NAMES: string[] = [...ENTITIES];

function isEntityScoped(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "entity" in value &&
    typeof (value as { entity: unknown }).entity === "string" &&
    ENTITY_NAMES.includes((value as { entity: string }).entity)
  );
}

/**
 * Throws if `aggregate` carries a money figure that is not attributed to one
 * entity. Call it on views that span both entities; per-row records that
 * already carry `entity` satisfy it trivially.
 */
export function assertUnblended(aggregate: unknown, path = "aggregate"): void {
  walk(aggregate, path, false);
}

function walk(value: unknown, path: string, scoped: boolean): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, scoped));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const here = scoped || isEntityScoped(value);
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (typeof child === "number" && /Cents$/.test(key)) {
      if (!here) {
        throw new TreasuryError(
          `${childPath} is a money figure that names no entity. JSOA and JSOF are ` +
            `presented as two columns and are never summed; attribute the figure ` +
            `to one entity or remove it.`,
          "BLENDED_TOTAL",
        );
      }
      continue;
    }
    // An entity-keyed map is a legal way to scope figures too.
    if (ENTITY_NAMES.includes(key)) {
      walk(child, childPath, true);
      continue;
    }
    walk(child, childPath, here);
  }
}
