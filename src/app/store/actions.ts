"use server";

import { redirect } from "next/navigation";

import { parseCartParam, shipToFromParams } from "@/lib/store/cart";
import { resolveDevViewer } from "@/lib/store/dev";
import { createHostedCheckoutSession, markPaid, placeOrder } from "@/lib/store/orders";
import { storeRepository } from "@/lib/store/repository";
import { STORE_ENTITY } from "@/lib/store/types";

/**
 * Order placement, then a redirect to the provider.
 *
 * The order is written before the buyer reaches the payment page and is written
 * AWAITING_PAYMENT. That ordering matters: the buyer-type snapshot and the tax
 * figure are fixed by us, on our side, and the provider is told an amount. The
 * alternative, reading the buyer's membership back after the provider confirms,
 * would put a membership lookup between the sale and the tax record, which is
 * the thing the snapshot exists to prevent.
 *
 * `authorize()` is not called here, and that is correct rather than an
 * oversight: a buyer placing their own order is not a board subject and holds
 * no grant on FINANCIAL. Buyer-tier access is scoped by ownership of the
 * record, as ROLE_DEFINITIONS says of MEMBER and DONOR. Every board-side read
 * and write of these same rows goes through `src/lib/store/board.ts`, which
 * does call `authorize()`.
 */
export async function placeOrderAction(formData: FormData): Promise<void> {
  const viewerKey = String(formData.get("viewer") ?? "visitor");
  const items = parseCartParam(String(formData.get("items") ?? ""));
  const shipTo = shipToFromParams(
    String(formData.get("state") ?? "NC"),
    String(formData.get("county") ?? "Cumberland"),
    String(formData.get("postalCode") ?? ""),
  );

  const repo = storeRepository();
  const order = placeOrder({
    id: repo.nextId("SO-2026"),
    items,
    products: repo.listProducts(STORE_ENTITY),
    viewer: resolveDevViewer(viewerKey).viewer,
    shipTo,
    placedAt: new Date().toISOString(),
  });

  const session = createHostedCheckoutSession(order);
  repo.saveOrder({ ...order, checkoutSessionRef: session.sessionRef });

  redirect(`${session.redirectUrl}&viewer=${encodeURIComponent(viewerKey)}`);
}

/**
 * STUB. Stands in for the provider's webhook telling us the payment cleared.
 * A real implementation verifies the webhook signature and is the only thing
 * that may move an order to PAID; a button in our own UI must never be able to.
 */
export async function simulateProviderSuccessAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get("order") ?? "");
  const viewerKey = String(formData.get("viewer") ?? "visitor");
  const repo = storeRepository();
  const order = repo.findOrder(orderId);
  if (!order) redirect("/store");
  repo.saveOrder(markPaid(order, order.checkoutSessionRef ?? `stub_cs_${orderId}`));
  redirect(
    `/store/checkout/complete?order=${encodeURIComponent(orderId)}&viewer=${encodeURIComponent(viewerKey)}`,
  );
}
