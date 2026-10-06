/**
 * Hosted checkout handoff. A STUB, deliberately and permanently until an
 * acquirer has confirmed the applicable SAQ.
 *
 * docs/PRIVACY-AND-PAYMENTS.md: the short PCI questionnaire requires that
 * EVERY element of the payment page originate from the payment provider. One
 * merchant-side script on that page moves the organization to SAQ A-EP, which
 * is a far larger questionnaire. So:
 *
 *   - No Stripe SDK is imported here and no API call is made.
 *   - No card field, no payment element, no iframe of our own.
 *   - The payment step is a redirect and nothing else. No analytics tag, no
 *     session replay, no chat widget, no font host, no image from us.
 *   - Card data never reaches our servers or our logs, so nothing in this
 *     module accepts, returns or logs a card number, and the type it returns
 *     carries no payment instrument at all.
 *
 * What a real implementation adds: a server-side call to create a Checkout
 * Session against the correct entity's Stripe account, and a webhook handler
 * that records the FINANCIAL row once the payment clears. Both are out of
 * scope for this pass — see the report.
 */

import type { Entity } from "../authz/model";
import { formatCents } from "./money";
import type { DonationIntent } from "./types";

/** Separate accounts per entity. The two never share a processor account. */
export const STRIPE_ACCOUNT_PLACEHOLDER: Record<Entity, string> = {
  JSOA: "acct_placeholder_jsoa",
  JSOF: "acct_placeholder_jsof",
};

export type CheckoutHandoff = {
  /** Opaque reference for this attempt. Not a token and not a secret. */
  handoffRef: string;
  entity: Entity;
  stripeAccountPlaceholder: string;
  amountCents: number;
  currency: "usd";
  /** Line items as they would be sent to the provider. */
  lineItems: { description: string; amountCents: number }[];
  /**
   * Where the provider would send the donor back. Nothing sensitive in the
   * query string — see the privacy rules on URL parameters.
   */
  successPath: string;
  cancelPath: string;
  /**
   * Null in this build. A real integration replaces this with the URL the
   * provider returns, and the browser is sent straight there.
   */
  redirectUrl: null;
  stub: true;
  /** Why there is no card form here. Rendered on the page. */
  pciNote: string;
};

export const PCI_NOTE =
  "This payment step is a redirect and nothing else. Every element of the card page " +
  "comes from the payment provider, on the provider's own domain. A single script of " +
  "ours on that page would change which PCI questionnaire the organization has to " +
  "complete, so there is no form, no script and no tag here.";

let counter = 0;

/**
 * Builds the handoff. Takes a validated intent; it is not this function's job
 * to check the arithmetic, and it will not silently fix it.
 */
export function buildCheckoutHandoff(intent: DonationIntent): CheckoutHandoff {
  counter += 1;
  const handoffRef = `co_stub_${intent.entity.toLowerCase()}_${String(counter).padStart(4, "0")}`;

  const lineItems = intent.benefits.length === 0
    ? [
        {
          description: `Gift to ${intent.entity} — ${intent.allocations.length} ${
            intent.allocations.length === 1 ? "fund" : "funds"
          }`,
          amountCents: intent.amountCents,
        },
      ]
    : [
        // Benefits are priced as their own lines. Bundling a tee prize or a
        // shirt into an entry fee is what pulls the fee into the sales tax
        // base — see docs/ARCHITECTURE.md on ticketing.
        ...intent.benefits.map((benefit) => ({
          description: `${benefit.quantity} × ${benefit.description}`,
          amountCents: benefit.quantity * benefit.unitFairMarketValueCents,
        })),
        {
          description: "Contribution above the value received",
          amountCents:
            intent.amountCents - (intent.benefitFairMarketValueCents ?? 0),
        },
      ];

  return {
    handoffRef,
    entity: intent.entity,
    stripeAccountPlaceholder: STRIPE_ACCOUNT_PLACEHOLDER[intent.entity],
    amountCents: intent.amountCents,
    currency: "usd",
    lineItems,
    successPath: `/donate/checkout?ref=${handoffRef}&state=complete`,
    cancelPath: `/donate/checkout?ref=${handoffRef}&state=cancelled`,
    redirectUrl: null,
    stub: true,
    pciNote: PCI_NOTE,
  };
}

/** For the review step: what the donor is about to be charged, in words. */
export function describeHandoff(handoff: CheckoutHandoff): string {
  return (
    `${formatCents(handoff.amountCents)} to ${handoff.entity}, in ` +
    `${handoff.lineItems.length} ${handoff.lineItems.length === 1 ? "line" : "lines"}`
  );
}

/** Test seam. The counter is module state only because this is a demo stub. */
export function resetHandoffCounter(): void {
  counter = 0;
}
