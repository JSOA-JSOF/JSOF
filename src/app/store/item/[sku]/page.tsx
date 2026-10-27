import Link from "next/link";
import { notFound } from "next/navigation";

import {
  addToCart,
  formatCents,
  parseCartParam,
  serialiseCartParam,
} from "@/lib/store/cart";
import { CatalogueError, findProductForViewer } from "@/lib/store/catalogue";
import { resolveDevViewer } from "@/lib/store/dev";
import { storeRepository } from "@/lib/store/repository";
import { STORE_ENTITY } from "@/lib/store/types";

import { Shell, TAX_LINE_NOTE, ViewerStrip } from "../../parts";
import styles from "../../store.module.css";

/**
 * One product.
 *
 * A member-restricted SKU fetched by somebody without member access is a 404,
 * not a 403. A 403 on a specific SKU confirms that the SKU exists, which is the
 * same disclosure the catalogue listing is careful to avoid. The distinction
 * lives in `findProductForViewer`, which returns NOT_FOUND for both the missing
 * and the restricted case.
 */

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sku } = await params;
  const query = await searchParams;
  const option = resolveDevViewer(typeof query.viewer === "string" ? query.viewer : "visitor");
  const cart = parseCartParam(typeof query.items === "string" ? query.items : null);

  const products = await storeRepository().listProducts(STORE_ENTITY);

  let product;
  try {
    product = findProductForViewer(products, sku, option.viewer);
  } catch (error) {
    if (error instanceof CatalogueError) notFound();
    throw error;
  }

  const cartHref = `/store/cart?viewer=${option.key}&items=${encodeURIComponent(
    serialiseCartParam(addToCart(cart, product.sku)),
  )}`;

  return (
    <Shell
      crumb={product.publiclyPurchasable ? "Catalogue" : "Member catalogue"}
      crumbHref={product.publiclyPurchasable ? "/store" : `/store/members?viewer=${option.key}`}
      status={`${STORE_ENTITY} store`}
    >
      <ViewerStrip current={option.key} basePath={`/store/item/${product.sku}`} />

      <div className={styles.body}>
        <h1 className={styles.title}>{product.name}</h1>
        <p className={styles.lede}>{product.blurb}</p>

        <div className={styles.receipt}>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Price, before tax</span>
            <span className={styles.receiptValue}>{formatCents(product.priceCents)}</span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Item code</span>
            <span className={styles.receiptValue}>{product.sku}</span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Fulfilment</span>
            <span className={styles.receiptValue}>
              {product.fulfilment === "print_on_demand" ? "printed to order" : "held in stock"}
            </span>
          </div>
          <div className={styles.receiptRow}>
            <span className={styles.receiptKey}>Sales tax</span>
            <span className={styles.receiptValue}>
              {product.taxTreatment === "tangible_goods" ? "charged at checkout" : "not charged"}
            </span>
          </div>
        </div>

        <div className={styles.actionRow}>
          <Link href={cartHref} className={styles.action}>
            Add to the cart
          </Link>
          <Link
            href={product.publiclyPurchasable ? "/store" : `/store/members?viewer=${option.key}`}
            className={`${styles.action} ${styles.actionQuiet}`}
          >
            Keep looking
          </Link>
        </div>

        <p className={styles.note}>{TAX_LINE_NOTE}</p>
      </div>
    </Shell>
  );
}
