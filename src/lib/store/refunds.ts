/**
 * Refunds.
 *
 * A refund is the easiest way to move money out of a store without anybody
 * noticing, because it looks like customer service. So above a small threshold
 * it needs a second person, and the second person cannot be the person who
 * raised it. The threshold is deliberately much lower than the platform's
 * general spend thresholds: a store refund is a cash-equivalent credit against
 * a receipt the same person may have recorded, which is a tighter risk than a
 * budgeted disbursement.
 *
 * The tax portion is carried separately because a refund of a taxable sale
 * reduces the sales tax the organization owes for the period. A refund that
 * silently credits the tax without reducing the reported figure overstates the
 * remittance; one that credits only the goods shortchanges the buyer.
 */

import { assertNotSelfApproval } from "../authz/policy";

import type { Order, Refund } from "./types";

/** $50. Below this one approver is enough. */
export const REFUND_SECOND_APPROVER_THRESHOLD_CENTS = 5_000;

export class RefundError extends Error {
  constructor(
    message: string,
    readonly code: "EXCEEDS_ORDER" | "NOT_PAID" | "NOT_POSITIVE",
  ) {
    super(message);
    this.name = "RefundError";
  }
}

export function refundRequiresSecondApprover(amountCents: number): boolean {
  return amountCents > REFUND_SECOND_APPROVER_THRESHOLD_CENTS;
}

/**
 * The share of a refund that reverses collected sales tax, pro rata on the
 * taxable base. Half-up to the cent, like the original charge.
 */
export function taxPortionOfRefund(order: Order, refundAmountCents: number): number {
  const chargedBase = order.subtotalCents + order.shippingCents;
  if (chargedBase <= 0 || order.taxCents <= 0) return 0;
  const goodsShare = Math.min(refundAmountCents, chargedBase);
  return Math.round((order.taxCents * goodsShare) / chargedBase);
}

export type RefundRequestInput = {
  id: string;
  order: Order;
  amountCents: number;
  reason: string;
  requestedByPersonId: string;
  requestedAt: string;
};

export function buildRefundRequest(input: RefundRequestInput): Refund {
  const { order } = input;
  if (input.amountCents <= 0) {
    throw new RefundError("A refund is a positive amount", "NOT_POSITIVE");
  }
  if (order.status === "AWAITING_PAYMENT" || order.status === "CANCELLED") {
    throw new RefundError(
      "Nothing has been collected on this order, so there is nothing to refund",
      "NOT_PAID",
    );
  }
  const chargedBase = order.subtotalCents + order.shippingCents;
  if (order.refundedCents + input.amountCents > chargedBase) {
    throw new RefundError(
      "That would refund more than was charged for the goods on this order",
      "EXCEEDS_ORDER",
    );
  }

  return {
    id: input.id,
    entity: order.entity,
    orderId: order.id,
    amountCents: input.amountCents,
    taxPortionCents: taxPortionOfRefund(order, input.amountCents),
    reason: input.reason,
    createdById: input.requestedByPersonId,
    requestedAt: input.requestedAt,
    approvedByPersonId: null,
    approvedAt: null,
    status: "REQUESTED",
  };
}

/**
 * Approval. Above the threshold the approver must differ from the requester,
 * enforced by `assertNotSelfApproval` from the shared policy, which throws an
 * AuthzError with code SELF_APPROVAL. It is not a warning and there is no
 * override path in this module.
 */
export function approveRefund(refund: Refund, approverPersonId: string, approvedAt: string): Refund {
  if (refundRequiresSecondApprover(refund.amountCents)) {
    assertNotSelfApproval(approverPersonId, refund);
  }
  return {
    ...refund,
    status: "APPROVED",
    approvedByPersonId: approverPersonId,
    approvedAt,
  };
}

/** The order's own status and refunded total after an approved refund. */
export function applyRefundToOrder(order: Order, refund: Refund): Order {
  const refundedCents = order.refundedCents + refund.amountCents;
  const chargedBase = order.subtotalCents + order.shippingCents;
  return {
    ...order,
    refundedCents,
    status: refundedCents >= chargedBase ? "REFUNDED" : "PARTIALLY_REFUNDED",
  };
}

export const REFUND_THRESHOLD_NOTE =
  "A refund above $50 needs a second approver, and the approver cannot be the " +
  "person who raised it. A refund is a credit against a receipt the store " +
  "chair may also have recorded, so a single pair of hands on both ends of it " +
  "is the same weakness the quarterly count is there to cover.";
