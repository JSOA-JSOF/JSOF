import Link from "next/link";

import type { Entity } from "@/lib/authz/model";
import { checkAllocations } from "@/lib/donations/actions";
import { buildCheckoutHandoff } from "@/lib/donations/checkout";
import {
  NC_131F_DISCLOSURE,
  NC_131F_STATUTE_LABEL,
} from "@/lib/donations/disclosure";
import { formatCents } from "@/lib/donations/money";
import type { Allocation } from "@/lib/donations/types";
import styles from "./checkout.module.css";

export const metadata = {
  title: "Payment · JSOA / JSOF",
  // The payment step is not somewhere a search engine should land a donor.
  robots: { index: false, follow: false },
};

/**
 * THE PAYMENT STEP. A REDIRECT STUB.
 *
 * docs/PRIVACY-AND-PAYMENTS.md, the hosted-checkout rule: the short PCI
 * questionnaire requires that every element of the payment page originate
 * directly from the payment provider. One merchant-side script on that page
 * moves the organization to SAQ A-EP, a dramatically larger questionnaire.
 *
 * So this page has, deliberately:
 *   - no card field and no form of any kind
 *   - no Stripe SDK, no payment element, no iframe of ours
 *   - no analytics tag, no session replay, no chat widget, no pixel
 *   - no external font, image or stylesheet
 *
 * When the integration lands, the only change here is that the server calls
 * the provider to create a Checkout Session and issues a redirect to the URL
 * it returns. This page then never renders at all.
 *
 * The query string carries the entity, the total and the fund split, and
 * nothing else. No donor name, no email address, no anything personal. See
 * the privacy rule about URL parameters.
 */

function parseAllocations(raw: string | undefined): Allocation[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => pair.split(":"))
    .filter((parts) => parts.length === 2)
    .map(([fundId, cents]) => ({ fundId, amountCents: Number(cents) }))
    .filter((a) => Number.isSafeInteger(a.amountCents) && a.amountCents > 0);
}

export default async function CheckoutStubPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; total?: string; alloc?: string; state?: string }>;
}) {
  const params = await searchParams;
  const entity: Entity | null =
    params.entity === "JSOA" || params.entity === "JSOF" ? params.entity : null;
  const totalCents = Number(params.total);
  const allocations = parseAllocations(params.alloc);

  const hue = entity === "JSOA" ? "var(--jsoa)" : "var(--jsof)";

  if (!entity || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return (
      <div className={styles.page} style={{ ["--hue" as string]: hue }}>
        <header className={styles.bar}>
          <Link href="/donate" className={styles.back}>
            ← Back to the gift
          </Link>
          <span className={styles.status}>Payment</span>
        </header>
        <div className={styles.body}>
          <h1 className={styles.title}>This payment link is incomplete</h1>
          <p className={styles.refusal}>
            The organization and the amount both have to be set before a payment
            can start. Go back and complete the gift.
          </p>
        </div>
      </div>
    );
  }

  const check = checkAllocations(entity, totalCents, allocations);

  if (!check.ok) {
    return (
      <div className={styles.page} style={{ ["--hue" as string]: hue }}>
        <header className={styles.bar}>
          <Link href="/donate" className={styles.back}>
            ← Back to the gift
          </Link>
          <span className={styles.status}>Payment refused</span>
        </header>
        <div className={styles.body}>
          <h1 className={styles.title}>This gift was not sent to payment</h1>
          <p className={styles.lede}>
            The allocation across funds has to match the gift exactly. The check
            runs again here, on the server, and this gift did not pass it.
          </p>
          <p className={styles.refusal}>{check.message}</p>
          <div className={styles.actions}>
            <Link href="/donate" className={styles.secondary}>
              Go back and fix the split
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handoff = buildCheckoutHandoff({
    entity,
    // The handoff needs no donor identity, so it is not given any.
    donorDisplayName: "",
    donorEmail: "",
    amountCents: totalCents,
    currency: "USD",
    allocations: check.allocations,
    benefits: [],
    benefitFairMarketValueCents: null,
    sponsorshipId: null,
  });

  return (
    <div className={styles.page} style={{ ["--hue" as string]: hue }}>
      <header className={styles.bar}>
        <Link href="/donate" className={styles.back}>
          ← Back to the gift
        </Link>
        <span className={styles.status}>Payment · {entity}</span>
      </header>

      <div className={styles.body}>
        <h1 className={styles.title}>
          You would now be on the payment provider&rsquo;s page
        </h1>
        <p className={styles.lede}>
          {formatCents(handoff.amountCents)} to {entity}. In the finished
          product this page does not render: the server asks the provider for a
          Checkout Session and sends your browser straight to it.
        </p>

        <div className={styles.stub}>
          <span className={styles.stubHead}>Stub · no payment will be taken</span>
          <p className={styles.stubBody}>{handoff.pciNote}</p>
        </div>

        <h2 className={styles.sectionHead}>What would be handed over</h2>
        <ul className={styles.handoff}>
          <li>
            <span className={styles.key}>Handoff reference</span>
            <span className={styles.value}>{handoff.handoffRef}</span>
          </li>
          <li>
            <span className={styles.key}>Processor account</span>
            <span className={styles.value}>{handoff.stripeAccountPlaceholder}</span>
          </li>
          <li>
            <span className={styles.key}>Amount</span>
            <span className={styles.value}>
              {handoff.amountCents} cents ({formatCents(handoff.amountCents)})
            </span>
          </li>
          <li>
            <span className={styles.key}>Currency</span>
            <span className={styles.value}>{handoff.currency}</span>
          </li>
          {handoff.lineItems.map((item, index) => (
            <li key={index}>
              <span className={styles.key}>{item.description}</span>
              <span className={styles.value}>{formatCents(item.amountCents)}</span>
            </li>
          ))}
          <li>
            <span className={styles.key}>Redirect URL from the provider</span>
            <span className={`${styles.value} ${styles.absent}`}>
              none, not integrated
            </span>
          </li>
        </ul>

        <h2 className={styles.sectionHead}>What is not on this page</h2>
        <ul className={styles.rules}>
          <li>No card field, and no form of any kind.</li>
          <li>No payment SDK, no payment element, no iframe of ours.</li>
          <li>No analytics tag, no session replay, no chat widget, no pixel.</li>
          <li>No external font, image or stylesheet.</li>
          <li>
            Nothing in the address bar but the organization, the amount and the
            fund split. No name and no email address.
          </li>
        </ul>

        <h2 className={styles.sectionHead}>Still to build</h2>
        <ul className={styles.rules}>
          <li>
            The server-side Checkout Session call, against the correct
            entity&rsquo;s processor account.
          </li>
          <li>
            The webhook that records the gift once the payment clears. That is
            the only thing that writes to the ledger, and it needs write scope
            on the entity&rsquo;s financial data.
          </li>
          <li>
            Written confirmation from the acquirer of which PCI questionnaire
            applies. The short one is not to be assumed.
          </li>
        </ul>

        <div className={styles.actions}>
          <Link href="/donate" className={styles.secondary}>
            Back to the gift
          </Link>
        </div>

        <div className={styles.disclosure}>
          <span className={styles.disclosureStatute}>
            North Carolina · {NC_131F_STATUTE_LABEL}
          </span>
          {NC_131F_DISCLOSURE}
        </div>
      </div>
    </div>
  );
}
