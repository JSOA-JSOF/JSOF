import Link from "next/link";

import {
  formatCents,
  parseCartParam,
  serialiseCartParam,
  shipToFromParams,
  totalCart,
} from "@/lib/store/cart";
import { resolveDevViewer } from "@/lib/store/dev";
import { snapshotBuyerType } from "@/lib/store/orders";
import { storeRepository } from "@/lib/store/repository";
import { COLLECTION_POSTURE_NOTE, formatRate, jurisdictionByCode } from "@/lib/store/tax";
import { STORE_ENTITY } from "@/lib/store/types";

import { placeOrderAction } from "../actions";
import { Shell } from "../parts";
import styles from "../store.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Checkout — Association store",
  robots: { index: false, follow: false },
};

/**
 * The review step. This page carries no card field and never will: the card is
 * collected on the provider's own page, which the next step redirects to. See
 * docs/PRIVACY-AND-PAYMENTS.md. This is the last page of ours the buyer sees
 * before the handoff, so the tax figure and the buyer type recorded on the
 * order are both shown here rather than sprung on the receipt.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const option = resolveDevViewer(typeof params.viewer === "string" ? params.viewer : "visitor");
  const items = parseCartParam(typeof params.items === "string" ? params.items : null);
  const state = typeof params.state === "string" ? params.state : "NC";
  const county = typeof params.county === "string" ? params.county : "Cumberland";
  const shipTo = shipToFromParams(state, county);

  const totals = totalCart(items, storeRepository().listProducts(STORE_ENTITY), option.viewer, shipTo);
  const jurisdiction = jurisdictionByCode(totals.taxJurisdictionCode);
  const buyerType = snapshotBuyerType(
    option.viewer.kind === "member" ? option.viewer.membershipState : null,
  );

  if (totals.lines.length === 0) {
    return (
      <Shell crumb="Cart" crumbHref="/store/cart" status={`${STORE_ENTITY} store · checkout`}>
        <div className={styles.body}>
          <h1 className={styles.title}>Checkout</h1>
          <p className={styles.empty}>
            There is nothing to pay for. Add something to the cart and come
            back.
          </p>
          <div className={styles.actionRow}>
            <Link href="/store" className={styles.action}>
              Back to the catalogue
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      crumb="Cart"
      crumbHref={`/store/cart?viewer=${option.key}&items=${encodeURIComponent(serialiseCartParam(items))}`}
      status={`${STORE_ENTITY} store · checkout`}
    >
      <div className={styles.body}>
        <h1 className={styles.title}>Checkout</h1>
        <p className={styles.lede}>
          Check the order, then continue to the payment page. Card details are
          entered on the payment provider&apos;s own page and never on ours.
        </p>

        <table className={styles.lines}>
          <thead>
            <tr>
              <th>Item</th>
              <th className={styles.num}>Qty</th>
              <th className={styles.num}>Line</th>
            </tr>
          </thead>
          <tbody>
            {totals.lines.map((line) => (
              <tr key={line.sku}>
                <td>
                  {line.name}
                  <br />
                  <span className="eyebrow">
                    {line.fulfilment === "print_on_demand" ? "printed to order" : "from stock"}
                    {line.taxTreatment === "exempt_service" ? " · no sales tax" : ""}
                  </span>
                </td>
                <td className={styles.num}>{line.quantity}</td>
                <td className={styles.num}>{formatCents(line.lineSubtotalCents)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={2}>Subtotal</td>
              <td className={styles.num}>{formatCents(totals.subtotalCents)}</td>
            </tr>
            <tr>
              <td colSpan={2}>Shipping</td>
              <td className={styles.num}>{formatCents(totals.shippingCents)}</td>
            </tr>
            <tr className={styles.taxRow}>
              <td colSpan={2}>
                North Carolina sales tax, {formatRate(totals.taxRateBasisPoints)}
                <br />
                <span className="eyebrow">{jurisdiction.label}</span>
              </td>
              <td className={styles.num}>{formatCents(totals.taxCents)}</td>
            </tr>
            <tr className={styles.totalRow}>
              <td colSpan={2}>Total to pay</td>
              <td className={styles.num}>{formatCents(totals.totalCents)}</td>
            </tr>
          </tbody>
        </table>

        <h2 className={styles.subHead}>What the order will record</h2>
        <div className={styles.receipt}>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Entity</span>
            <span className={styles.receiptValue}>{STORE_ENTITY}</span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Buyer at time of sale</span>
            <span className={styles.receiptValue}>
              {buyerType === "MEMBER" ? "member" : "non-member"}
            </span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Sales tax to be collected</span>
            <span className={styles.receiptValue}>{formatCents(totals.taxCents)}</span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Delivery for tax purposes</span>
            <span className={styles.receiptValue}>
              {shipTo.county}, {shipTo.state}
            </span>
          </div>
        </div>
        <p className={styles.note}>
          Whether the buyer was a member is recorded on the order and is not
          looked up again afterwards. The Association has to keep separate
          records of what it takes in from members and from the public, and a
          figure that changes when somebody renews is not a record.
        </p>

        <form action={placeOrderAction} className={styles.actionRow}>
          <input type="hidden" name="viewer" value={option.key} />
          <input type="hidden" name="items" value={serialiseCartParam(items)} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="county" value={county} />
          <button type="submit" className={styles.action}>
            Continue to the payment page
          </button>
        </form>

        <p className={styles.note}>{COLLECTION_POSTURE_NOTE}</p>
      </div>
    </Shell>
  );
}
