"use server";

import { redirect } from "next/navigation";

import { AuthzError } from "@/lib/authz/policy";
import { boardApproveRefund, boardRecordPhysicalCount } from "@/lib/store/board";
import { getCurrentSubject } from "@/lib/authz/session";
import { InventoryError } from "@/lib/store/inventory";
import { RefundError } from "@/lib/store/refunds";

/**
 * Board store server actions.
 *
 * Both call into `src/lib/store/board.ts`, which calls `authorize()` before it
 * touches anything, so neither action carries its own permission logic. What
 * they do carry is the translation of a refusal into something a person can
 * read: a refused count or refund comes back to the screen as a sentence
 * saying what was refused and what to do, not as a stack trace and not as a
 * silent no-op.
 *
 * The refusals these can surface:
 *   - DENIED, when the role does not hold write on financial records.
 *   - SELF_APPROVAL, when the store chair tries to enter the quarterly count,
 *     or when the person who raised a refund above the threshold tries to
 *     approve it. Both come from `assertNotSelfApproval` in the shared policy.
 */

function backTo(path: string, message: string | null, ok?: string): never {
  const query = new URLSearchParams();
  if (message) query.set("refused", message);
  if (ok) query.set("done", ok);
  const suffix = query.toString();
  redirect(suffix.length > 0 ? `${path}?${suffix}` : path);
}

export async function recordCountAction(formData: FormData): Promise<void> {
  const subject = await getCurrentSubject();
  const sku = String(formData.get("sku") ?? "");
  const quarter = String(formData.get("quarter") ?? "");
  const countedUnits = Number.parseInt(String(formData.get("countedUnits") ?? ""), 10);

  if (!Number.isInteger(countedUnits) || countedUnits < 0) {
    backTo(
      "/board/store/inventory",
      "A count is a whole number of units, zero or more. Nothing was recorded.",
    );
  }

  try {
    await boardRecordPhysicalCount(subject, { sku, quarter, countedUnits });
  } catch (error) {
    if (error instanceof AuthzError && error.code === "SELF_APPROVAL") {
      backTo(
        "/board/store/inventory",
        "The store chair cannot enter the quarterly count. The count is the one point " +
          "in the cycle where somebody other than the person who records the sales " +
          "observes the goods, so it has to be entered by somebody else. Ask the " +
          "assistant treasurer or the Finance Review Officer to count and enter it.",
      );
    }
    if (error instanceof AuthzError) {
      backTo(
        "/board/store/inventory",
        "This role cannot write financial records for JSOA, so it cannot record a count.",
      );
    }
    if (error instanceof InventoryError) {
      backTo("/board/store/inventory", error.message + ".");
    }
    throw error;
  }

  backTo("/board/store/inventory", null, `Count recorded for ${sku}.`);
}

export async function approveRefundAction(formData: FormData): Promise<void> {
  const subject = await getCurrentSubject();
  const refundId = String(formData.get("refund") ?? "");

  try {
    await boardApproveRefund(subject, refundId);
  } catch (error) {
    if (error instanceof AuthzError && error.code === "SELF_APPROVAL") {
      backTo(
        "/board/store/refunds",
        "This refund was raised by the same person, and above the threshold a refund " +
          "needs a second approver. Nothing was approved. Somebody else has to approve it.",
      );
    }
    if (error instanceof AuthzError) {
      backTo(
        "/board/store/refunds",
        "This role cannot write financial records for JSOA, so it cannot approve a refund.",
      );
    }
    if (error instanceof RefundError) {
      backTo("/board/store/refunds", error.message + ".");
    }
    throw error;
  }

  backTo("/board/store/refunds", null, `Refund ${refundId} approved.`);
}
