import Link from "next/link";

import {
  formatCents,
  parseCartParam,
  removeFromCart,
  serialiseCartParam,
  shipToFromParams,
  totalCart,
} from "@/lib/store/cart";
import { resolveDevViewer } from "@/lib/store/dev";
import { storeRepository } from "@/lib/store/repository";
import { formatRate, jurisdictionByCode } from "@/lib/store/tax";
import { STORE_ENTITY } from "@/lib/store/types";

import { Shell, ViewerStrip } from "../parts";
import styles from "../store.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cart — Association store",
  robots: { index: false, follow: false },
};

/**
 * The cart lives in the query string. Pricing runs through
 * `purchasableForViewer`, so a member-restricted SKU typed into the URL by a
 * visitor is dropped here exactly as it is dropped from the catalogue. One
 * gate, used twice.
 */

const COUNTIES = ["Cumberland", "Wake", "Mecklenburg", "Onslow"];

export default async function CartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const option = resolveDevViewer(typeof params.viewer === "string" ? params.viewer : "visitor");
  const rawCart = typeof params.items === "string" ? params.items : null;
  const cart = parseCartParam(rawCart);
  const state = typeof params.state === "string" ? params.state : "NC";
  const county = typeof params.county === "string" ? params.county : "Cumberland";
  const shipTo = shipToFromParams(state, county);

  const products = storeRepository().listProducts(STORE_ENTITY);
  const totals = totalCart(cart, products, option.viewer, shipTo);
  const jurisdiction = jurisdictionByCode(totals.taxJurisdictionCode);

  const hrefWith = (items: string) => {
    const query = new URLSearchParams({ viewer: option.key, state, county });
    if (items.length > 0) query.set("items", items);
    return `/store/cart?${query.toString()}`;
  };

  const checkoutHref = (() => {
    const query = new URLSearchParams({
      viewer: option.key,
      state,
      county,
      items: serialiseCartParam(cart),
    });
    return `/store/checkout?${query.toString()}`;
  })();

  return (
    <Shell crumb="Catalogue" crumbHref="/store" status={`${STORE_ENTITY} store · cart`}>
      <ViewerStrip
        current={option.key}
        basePath="/store/cart"
        extraQuery={{ items: rawCart ?? "", state, county }}
      />

      <div className={styles.body}>
        <h1 className={styles.title}>Your cart</h1>

        {totals.lines.length === 0 ? (
          <>
            <p className={styles.empty}>
              There is nothing in the cart yet.
              {cart.length > 0
                ? " Nothing that was in it can be bought on this catalogue."
                : ""}
            </p>
            <div className={styles.actionRow}>
              <Link href="/store" className={styles.action}>
                Back to the catalogue
              </Link>
            </div>
          </>
        ) : (
          <>
            <table className={styles.lines}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className={styles.num}>Each</th>
                  <th className={styles.num}>Qty</th>
                  <th className={styles.num}>Line</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {totals.lines.map((line) => (
                  <tr key={line.sku}>
                    <td>
                      {line.name}
                      <br />
                      <span className="eyebrow">
                        {line.sku}
                        {line.taxTreatment === "exempt_service" ? " · no sales tax" : ""}
                      </span>
                    </td>
                    <td className={styles.num}>{formatCents(line.unitPriceCents)}</td>
                    <td className={styles.num}>{line.quantity}</td>
                    <td className={styles.num}>{formatCents(line.lineSubtotalCents)}</td>
                    <td className={styles.num}>
                      <Link
                        href={hrefWith(serialiseCartParam(removeFromCart(cart, line.sku)))}
                        className={styles.back}
                      >
                        Remove
                      </Link>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3}>Subtotal</td>
                  <td className={styles.num}>{formatCents(totals.subtotalCents)}</td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan={3}>Shipping</td>
                  <td className={styles.num}>{formatCents(totals.shippingCents)}</td>
                  <td></td>
                </tr>
                <tr className={styles.taxRow}>
                  <td colSpan={3}>
                    North Carolina sales tax, {formatRate(totals.taxRateBasisPoints)}
                    <br />
                    <span className="eyebrow">
                      {jurisdiction.label} · on {formatCents(totals.taxableBaseCents)} taxable
                    </span>
                  </td>
                  <td className={styles.num}>{formatCents(totals.taxCents)}</td>
                  <td></td>
                </tr>
                <tr className={styles.totalRow}>
                  <td colSpan={3}>Total</td>
                  <td className={styles.num}>{formatCents(totals.totalCents)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>

            <h2 className={styles.subHead}>Where is it going</h2>
            <p className={styles.blurb}>
              The rate follows the delivery address, so the county decides what
              is charged. Only the state, county and postal code are kept on the
              order: that is what the tax figure has to be justified by.
            </p>
            <form method="get" action="/store/cart" className={styles.actionRow}>
              <input type="hidden" name="viewer" value={option.key} />
              <input type="hidden" name="items" value={serialiseCartParam(cart)} />
              <label>
                <span className="eyebrow">State</span>{" "}
                <select name="state" defaultValue={state}>
                  <option value="NC">North Carolina</option>
                  <option value="SC">Somewhere else</option>
                </select>
              </label>
              <label>
                <span className="eyebrow">County</span>{" "}
                <select name="county" defaultValue={county}>
                  {COUNTIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={`${styles.action} ${styles.actionQuiet}`}>
                Update the tax
              </button>
            </form>

            {totals.taxRateBasisPoints === 0 ? (
              <div className={styles.warnNote}>
                No sales tax is charged on this order because the delivery
                address is outside North Carolina and the Association has not
                established a collection obligation in that state. Charging a
                rate the organisation is not registered to remit would be worse
                than charging none.
              </div>
            ) : null}

            <div className={styles.actionRow}>
              <Link href={checkoutHref} className={styles.action}>
                Go to checkout
              </Link>
              <Link href="/store" className={`${styles.action} ${styles.actionQuiet}`}>
                Keep shopping
              </Link>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
