import Link from "next/link";
import { notFound } from "next/navigation";

import { formatCents } from "@/lib/store/cart";
import { storeRepository } from "@/lib/store/repository";
import { formatRate, jurisdictionByCode } from "@/lib/store/tax";
import { STORE_ENTITY } from "@/lib/store/types";

import { Shell } from "../../parts";
import styles from "../../store.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Order recorded · Association store",
  robots: { index: false, follow: false },
};

/**
 * The receipt.
 *
 * It states the entity, the buyer type recorded at the sale, the tax collected
 * and the items, because those four are what the order row holds and a buyer is
 * entitled to see the record that was made about them. The dues-not-deductible
 * line is on it because this is an Association receipt: merchandise is not a
 * contribution and no part of it is deductible.
 */
export default async function OrderCompletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const orderId = typeof params.order === "string" ? params.order : "";
  const order = await storeRepository().findOrder(orderId);
  if (!order) notFound();

  const jurisdiction = jurisdictionByCode(order.taxJurisdictionCode);
  const placed = new Date(order.placedAt).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <Shell crumb="Catalogue" crumbHref="/store" status={`${STORE_ENTITY} · receipt`}>
      <div className={styles.body}>
        <h1 className={styles.title}>Order {order.id}</h1>
        <p className={styles.lede}>
          {order.status === "PAID"
            ? "The payment cleared and the order is recorded."
            : "The order is recorded and is waiting on the payment."}
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
            {order.lines.map((line) => (
              <tr key={line.sku}>
                <td>
                  {line.name}
                  <br />
                  <span className="eyebrow">
                    {line.sku} ·{" "}
                    {line.fulfilment === "print_on_demand" ? "printed to order" : "from stock"}
                  </span>
                </td>
                <td className={styles.num}>{line.quantity}</td>
                <td className={styles.num}>{formatCents(line.lineSubtotalCents)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={2}>Subtotal</td>
              <td className={styles.num}>{formatCents(order.subtotalCents)}</td>
            </tr>
            <tr>
              <td colSpan={2}>Shipping</td>
              <td className={styles.num}>{formatCents(order.shippingCents)}</td>
            </tr>
            <tr className={styles.taxRow}>
              <td colSpan={2}>
                North Carolina sales tax, {formatRate(order.taxRateBasisPoints)}
                <br />
                <span className="eyebrow">{jurisdiction.label}</span>
              </td>
              <td className={styles.num}>{formatCents(order.taxCents)}</td>
            </tr>
            <tr className={styles.totalRow}>
              <td colSpan={2}>Total</td>
              <td className={styles.num}>{formatCents(order.totalCents)}</td>
            </tr>
          </tbody>
        </table>

        <h2 className={styles.subHead}>What was recorded</h2>
        <div className={styles.receipt}>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Entity</span>
            <span className={styles.receiptValue}>
              {order.entity}, Joint Special Operations Association
            </span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Placed</span>
            <span className={styles.receiptValue}>{placed}</span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Buyer at time of sale</span>
            <span className={styles.receiptValue}>
              {order.buyerTypeAtSale === "MEMBER" ? "member" : "non-member"}
            </span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Sales tax collected</span>
            <span className={styles.receiptValue}>{formatCents(order.taxCents)}</span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Payment session</span>
            <span className={styles.receiptValue}>{order.checkoutSessionRef}</span>
          </div>
        </div>

        <p className={styles.note}>
          This is a purchase of merchandise from the Association, not a
          charitable contribution. No part of it is deductible as a charitable
          gift. Gifts intended to be deductible go to the Foundation.
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
