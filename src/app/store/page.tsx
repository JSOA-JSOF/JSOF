import Link from "next/link";

import { publicCatalogue } from "@/lib/store/catalogue";
import { addToCart, serialiseCartParam, parseCartParam } from "@/lib/store/cart";
import { storeRepository } from "@/lib/store/repository";
import { STORE_ENTITY } from "@/lib/store/types";

import { PublicCard, Shell, TAX_LINE_NOTE } from "./parts";
import styles from "./store.module.css";

/**
 * The public catalogue.
 *
 * This page takes no viewer. It always renders `publicCatalogue()`, which is a
 * projection that structurally cannot carry a member-restricted product: the
 * projection function throws on one rather than redacting it. There is no
 * greyed-out row, no "members only" placeholder and no count of hidden items,
 * because each of those tells a visitor what the members have. If you are
 * looking for the member-restricted lines, they are at /store/members and they
 * are not named anywhere on this page.
 */

export const metadata = {
  title: "Store · Joint Special Operations Association",
  description:
    "Association merchandise. Prices exclude North Carolina sales tax, which is shown at checkout.",
};

export default async function PublicStorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawCart = typeof params.items === "string" ? params.items : null;
  const cart = parseCartParam(rawCart);

  const catalogue = publicCatalogue(storeRepository().listProducts(STORE_ENTITY));

  const cartHrefFor = (sku: string) =>
    `/store/cart?items=${encodeURIComponent(serialiseCartParam(addToCart(cart, sku)))}`;

  return (
    <Shell crumb="Association" crumbHref="/jsoa" status={`${STORE_ENTITY} store · public`}>
      <div className={styles.body}>
        <h1 className={styles.title}>Association store</h1>
        <p className={styles.lede}>
          Coins, caps, patches and prints. Everything here can be bought by
          anyone. Prices are before North Carolina sales tax, which is added as
          its own line at checkout.
        </p>

        <div className={styles.actionRow}>
          <Link
            href={cart.length > 0 ? `/store/cart?items=${encodeURIComponent(rawCart ?? "")}` : "/store/cart"}
            className={`${styles.action} ${styles.actionQuiet}`}
          >
            {cart.length > 0 ? `Cart (${cart.length})` : "Cart"}
          </Link>
          <Link href="/store/members" className={`${styles.action} ${styles.actionQuiet}`}>
            Members: sign in for the full catalogue
          </Link>
        </div>

        <h2 className={styles.sectionHead}>Catalogue</h2>
        {catalogue.items.length === 0 ? (
          <p className={styles.empty}>
            Nothing is on sale at the moment. The store reopens with the winter
            collection.
          </p>
        ) : (
          <ul className={styles.grid}>
            {catalogue.items.map((product) => (
              <PublicCard
                key={product.sku}
                product={product}
                cartHref={cartHrefFor(product.sku)}
              />
            ))}
          </ul>
        )}

        <p className={styles.note}>{TAX_LINE_NOTE}</p>
        <p className={styles.note}>
          Buying from the store is not a charitable contribution and no part of
          the price is deductible. Gifts intended to be tax-deductible go to the
          Foundation.
        </p>
      </div>
    </Shell>
  );
}
