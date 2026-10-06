import Link from "next/link";
import { notFound } from "next/navigation";

import {
  DUES_NOT_DEDUCTIBLE,
  formatCents,
  loadPaymentView,
  PaymentNotAvailableError,
} from "@/lib/membership/payment";
import { membershipRepository } from "@/lib/membership/repository";
import { DUES_AMOUNT_CENTS } from "@/lib/membership/types";

import styles from "../../apply.module.css";
import { beginCheckout } from "./actions";

export const metadata = {
  title: "Membership dues — JSOA",
  robots: { index: false, follow: false },
};

/**
 * The dues page.
 *
 * Two things hold this route up.
 *
 * It is reachable in exactly one state. `loadPaymentView` asks
 * `mayRequestPayment()` from the state machine and this page renders a 404 for
 * every other answer — including for an application id that matches nothing, so
 * that a 404 tells a guesser nothing about which of the two it was. There is no
 * state in which this platform holds money for an applicant nobody has stood
 * behind, and this is where that is enforced rather than promised.
 *
 * Nothing on this page comes from anywhere but this server, and the page after
 * it comes entirely from the payment provider. No analytics tag, no
 * session-replay, no chat widget, no custom field, and no card input, here or
 * on the handoff page. That is PCI SAQ A, and one merchant-side script on the
 * payment page is the difference between SAQ A and a questionnaire several
 * times its size.
 */
export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let view;
  try {
    view = await loadPaymentView(membershipRepository(), id);
  } catch (error) {
    // Wrong state, or no such application. Same answer either way.
    if (error instanceof PaymentNotAvailableError) notFound();
    throw error;
  }

  return (
    <div className={styles.page} style={{ ["--hue" as string]: "var(--jsoa)" }}>
      <header className={styles.bar}>
        <Link href="/jsoa" className={styles.back}>
          ← Association
        </Link>
        <span className={styles.status}>Membership dues</span>
      </header>

      <main className={styles.body}>
        <h1 className={styles.title}>Your application has been accepted</h1>
        <p className={styles.lede}>
          A member has stood behind your application. Dues are the last step, and membership
          starts as soon as they clear. This is a one-time payment: membership is for life
          and you will not be billed again.
        </p>

        <p className={styles.amountNote}>Lifetime membership, Association</p>
        <p className={styles.amount}>{formatCents(DUES_AMOUNT_CENTS)}</p>

        <ul className={styles.lines}>
          <li>
            <span>Lifetime membership dues</span>
            <span>{formatCents(view.amountCents)}</span>
          </li>
          <li>
            <span>Charitable portion</span>
            <span>{formatCents(0)}</span>
          </li>
          <li>
            <span>Total due</span>
            <span>{formatCents(view.amountCents)}</span>
          </li>
        </ul>

        <div className={styles.caution}>
          <strong>Dues are not a charitable contribution</strong>
          {DUES_NOT_DEDUCTIBLE}
        </div>

        <form action={beginCheckout} className={styles.actions}>
          <input type="hidden" name="applicationId" value={view.application.id} />
          <button className={styles.primary} type="submit">
            Continue to the payment page
          </button>
        </form>

        <p className={styles.note}>
          The next page is run by our payment provider, not by us. Your card number is entered
          there and never reaches this platform or its logs. We are told whether the payment
          cleared and nothing else about the card.
        </p>

        <p className={styles.note}>
          Reference <span className={styles.mono}>{view.application.reference}</span>. If
          something goes wrong on the payment page, come back to this link and try again.
          Nothing is taken until you finish on the provider&rsquo;s page.
        </p>
      </main>
    </div>
  );
}
