import Link from "next/link";
import { notFound } from "next/navigation";

import { mayRequestPayment } from "@/lib/membership/state";
import { DUES_NOT_DEDUCTIBLE, formatCents } from "@/lib/membership/payment";
import { membershipRepository } from "@/lib/membership/repository";

import styles from "../../../apply.module.css";
import { simulateWebhook } from "../actions";

export const metadata = {
  title: "Redirecting to the payment provider — JSOA",
  robots: { index: false, follow: false },
};

/**
 * The redirect boundary, stubbed.
 *
 * In production this page does not exist: `beginCheckout` returns the
 * provider's session URL and the server redirects straight to it. It is here so
 * the boundary is visible in the demo — the URL that would be handed over, the
 * fact that the next page is entirely the provider's, and the webhook that is
 * the only thing allowed to clear the payment.
 *
 * Stripe is not integrated. The session id is generated locally and the URL
 * goes nowhere.
 */
export default async function HandoffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cleared?: string }>;
}) {
  const { id } = await params;
  const { cleared } = await searchParams;

  const repo = membershipRepository();
  const application = await repo.getApplication(id);
  const handoff = await repo.getCheckoutHandoffForApplication(id);

  // Reachable while dues are owed, or once this session has cleared them.
  if (!application || !handoff) notFound();
  if (handoff.status !== "CLEARED" && !mayRequestPayment(application.state)) notFound();

  const done = handoff.status === "CLEARED" || cleared === "1";

  return (
    <div className={styles.page} style={{ ["--hue" as string]: "var(--jsoa)" }}>
      <header className={styles.bar}>
        <Link href="/jsoa" className={styles.back}>
          ← Association
        </Link>
        <span className={styles.status}>{done ? "Dues cleared" : "Payment provider"}</span>
      </header>

      <main className={styles.body}>
        {done ? (
          <>
            <h1 className={styles.title}>You are a member</h1>
            <p className={styles.lede}>
              Your dues cleared and your membership starts now. Your member ID and sign-in
              details go to the address on your application.
            </p>
            <p className={styles.note}>
              The board checks every new record thirty days in. That is a check on our
              paperwork, not a probationary period for you: your access is the same today as it
              will be then.
            </p>
            <p className={styles.note}>
              Your receipt carries the same note as this page: {DUES_NOT_DEDUCTIBLE}
            </p>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Handing you to our payment provider</h1>
            <p className={styles.lede}>
              Everything on the next page comes from the provider. Your card number is entered
              there, on their page, and this platform never sees it and never logs it.
            </p>

            <ul className={styles.lines}>
              <li>
                <span>Amount</span>
                <span>{formatCents(handoff.amountCents)}</span>
              </li>
              <li>
                <span>Currency</span>
                <span>{handoff.currency}</span>
              </li>
              <li>
                <span>Entity</span>
                <span>{handoff.entity}</span>
              </li>
            </ul>

            <div className={styles.dev}>
              <span className={styles.devLabel}>Stubbed in this build</span>
              Stripe is not integrated. In production the server redirects to the provider&rsquo;s
              hosted Checkout session and this page does not exist. The URL it would hand over:
              <span className={styles.devUrl}>{handoff.hostedUrl}</span>
              The only thing permitted to clear a payment is a verified webhook from the
              provider. The applicant returning to a success URL is a claim about a payment,
              not a payment.
              <form action={simulateWebhook} className={styles.actions}>
                <input type="hidden" name="handoffId" value={handoff.id} />
                <input type="hidden" name="applicationId" value={id} />
                <button className={styles.destructive} type="submit">
                  Simulate the provider&rsquo;s webhook
                </button>
              </form>
            </div>
          </>
        )}

        <div className={styles.actions}>
          <Link className={styles.secondary} href="/jsoa">
            Back to the Association
          </Link>
        </div>
      </main>
    </div>
  );
}
