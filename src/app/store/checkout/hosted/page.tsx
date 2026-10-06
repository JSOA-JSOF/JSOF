import Link from "next/link";
import { notFound } from "next/navigation";

import { formatCents } from "@/lib/store/cart";
import { storeRepository } from "@/lib/store/repository";
import { STORE_ENTITY } from "@/lib/store/types";

import { simulateProviderSuccessAction } from "../../actions";
import { Shell } from "../../parts";
import styles from "../../store.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Payment — Association store",
  robots: { index: false, follow: false },
};

/**
 * The payment step. STUB, and deliberately empty.
 *
 * In the real build this page does not exist: the buyer is redirected to the
 * provider's hosted checkout, and every element of that page comes from the
 * provider. That is the condition for the short PCI questionnaire. A single
 * script of ours on the payment page moves the organisation from SAQ A to
 * SAQ A-EP, so this page carries no card field, no analytics tag, no session
 * replay, no chat widget and no font or script from anywhere. It states the
 * amount, and the button below stands in for the provider's webhook telling us
 * the payment cleared.
 *
 * The button is a demo affordance. In the real build only a signature-verified
 * webhook may move an order to PAID, never a control in our own interface.
 */
export default async function HostedPaymentStubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const orderId = typeof params.order === "string" ? params.order : "";
  const viewerKey = typeof params.viewer === "string" ? params.viewer : "visitor";
  const order = storeRepository().findOrder(orderId);
  if (!order) notFound();

  return (
    <Shell crumb="Checkout" crumbHref="/store/cart" status={`${STORE_ENTITY} · payment`}>
      <div className={styles.body}>
        <h1 className={styles.title}>Payment</h1>

        <div className={styles.payment}>
          <span className="eyebrow">Amount due</span>
          <div className={styles.paymentFigure}>{formatCents(order.totalCents)}</div>
          <p className={styles.blurb}>
            Of which {formatCents(order.taxCents)} is North Carolina sales tax.
          </p>
          <p className={styles.blurb}>
            Order {order.id}. Session {order.checkoutSessionRef}.
          </p>
        </div>

        <div className={styles.warnNote}>
          Stub. In the real build this is the payment provider&apos;s own hosted
          page and nothing on it comes from us. No card field, no tag and no
          script of ours may appear on a payment page, because every element has
          to originate with the provider for the short PCI questionnaire to
          apply. Card details never reach our servers or our logs.
        </div>

        <form action={simulateProviderSuccessAction} className={styles.actionRow}>
          <input type="hidden" name="order" value={order.id} />
          <input type="hidden" name="viewer" value={viewerKey} />
          <button type="submit" className={styles.action}>
            Stand in for the provider confirming the payment
          </button>
        </form>

        <div className={styles.actionRow}>
          <Link href="/store" className={`${styles.action} ${styles.actionQuiet}`}>
            Cancel and go back to the store
          </Link>
        </div>
      </div>
    </Shell>
  );
}
