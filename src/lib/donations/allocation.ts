/**
 * Allocation arithmetic.
 *
 * docs/ARCHITECTURE.md: "A donation may split across funds; allocations must
 * sum exactly to the total." Exactly means exactly — there is no tolerance, no
 * rounding, and no sweep of a leftover penny into the general fund. A mismatch
 * comes back with the shortfall named in dollars, because "allocations invalid"
 * tells the donor nothing about what to change.
 */

import type { Entity } from "../authz/model";
import { formatCents, isCents, sumCents } from "./money";
import type { Allocation, Fund } from "./types";

export type AllocationRefusalCode =
  | "NO_ALLOCATIONS"
  | "NOT_INTEGER_CENTS"
  | "NON_POSITIVE_ALLOCATION"
  | "UNKNOWN_FUND"
  | "FUND_WRONG_ENTITY"
  | "FUND_CLOSED_TO_GIFTS"
  | "DUPLICATE_FUND"
  | "SHORTFALL"
  | "OVERAGE";

export type AllocationResult =
  | { ok: true; allocations: Allocation[]; allocatedCents: number }
  | {
      ok: false;
      code: AllocationRefusalCode;
      message: string;
      /** allocated minus total. Negative is a shortfall, positive an overage. */
      differenceCents: number;
      allocatedCents: number;
    };

export type AllocationCheckInput = {
  entity: Entity;
  totalCents: number;
  allocations: Allocation[];
  /** The funds the caller is allowed to allocate to. */
  funds: Fund[];
  /**
   * Board-side entry may allocate to a fund that is closed to public gifts
   * (a legacy restricted fund, say). The public form may not.
   */
  allowClosedFunds?: boolean;
};

export function validateAllocations(input: AllocationCheckInput): AllocationResult {
  const { entity, totalCents, allocations, funds, allowClosedFunds = false } = input;
  const allocatedCents = sumCents(allocations.map((a) => a.amountCents));

  const refuse = (code: AllocationRefusalCode, message: string): AllocationResult => ({
    ok: false,
    code,
    message,
    differenceCents: allocatedCents - totalCents,
    allocatedCents,
  });

  if (!isCents(totalCents) || totalCents === 0) {
    return refuse(
      "NOT_INTEGER_CENTS",
      "The gift amount has to be a whole number of cents above zero.",
    );
  }

  if (allocations.length === 0) {
    return refuse(
      "NO_ALLOCATIONS",
      "Every gift needs at least one fund. Choose where this money should go.",
    );
  }

  const seen = new Set<string>();
  for (const allocation of allocations) {
    if (!isCents(allocation.amountCents)) {
      return refuse(
        "NOT_INTEGER_CENTS",
        "Each fund amount has to be a whole number of cents.",
      );
    }
    if (allocation.amountCents === 0) {
      return refuse(
        "NON_POSITIVE_ALLOCATION",
        "A fund allocated zero is not an allocation. Remove the fund or give it an amount.",
      );
    }
    const fund = funds.find((f) => f.id === allocation.fundId);
    if (!fund) {
      return refuse(
        "UNKNOWN_FUND",
        `There is no fund with the reference ${allocation.fundId}.`,
      );
    }
    if (fund.entity !== entity) {
      return refuse(
        "FUND_WRONG_ENTITY",
        `${fund.name} belongs to ${fund.entity}, and this gift is to ${entity}. ` +
          "The two entities never share a fund.",
      );
    }
    if (!fund.openToGifts && !allowClosedFunds) {
      return refuse(
        "FUND_CLOSED_TO_GIFTS",
        `${fund.name} is not open to new gifts.`,
      );
    }
    if (seen.has(allocation.fundId)) {
      return refuse(
        "DUPLICATE_FUND",
        `${fund.name} appears twice. Combine the two amounts into one line.`,
      );
    }
    seen.add(allocation.fundId);
  }

  if (allocatedCents < totalCents) {
    const shortfall = totalCents - allocatedCents;
    return refuse(
      "SHORTFALL",
      `Allocations come to ${formatCents(allocatedCents)} of a ` +
        `${formatCents(totalCents)} gift. ${formatCents(shortfall)} is unallocated. ` +
        `Add ${formatCents(shortfall)} to a fund, or lower the gift to ` +
        `${formatCents(allocatedCents)}.`,
    );
  }

  if (allocatedCents > totalCents) {
    const overage = allocatedCents - totalCents;
    return refuse(
      "OVERAGE",
      `Allocations come to ${formatCents(allocatedCents)}, which is ` +
        `${formatCents(overage)} more than the ${formatCents(totalCents)} gift. ` +
        `Take ${formatCents(overage)} off a fund, or raise the gift to ` +
        `${formatCents(allocatedCents)}.`,
    );
  }

  return { ok: true, allocations, allocatedCents };
}

/**
 * What is left to allocate. Shown live in the donate flow so the donor is
 * never surprised by the refusal at the end.
 */
export function remainingCents(totalCents: number, allocations: Allocation[]): number {
  return totalCents - sumCents(allocations.map((a) => a.amountCents));
}
