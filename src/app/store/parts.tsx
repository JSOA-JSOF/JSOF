import Link from "next/link";

import { PublicShell } from "@/app/(public)/PublicShell";

import { formatCents } from "@/lib/store/cart";
import { DEV_SWITCHER_WARNING, DEV_VIEWERS } from "@/lib/store/dev";
import type { Product, PublicProduct } from "@/lib/store/types";

import styles from "./store.module.css";

/** The Association hue, set once so everything below reads var(--hue). */
export const HUE_STYLE = { ["--hue" as string]: "var(--jsoa)" };

/**
 * The store's shell, now the Association's shell.
 *
 * This used to render its own bar and its own chrome, which meant a member
 * clicking "Store" in the nav landed on something that looked like a
 * different website: no crest, no navigation, and no way back except the
 * browser button. The store is the Association's, so it uses the
 * Association's shell like every other page of it.
 *
 * `status` is kept in the signature and rendered as a breadcrumb tail, so the
 * seven pages calling this did not all have to change.
 */
export function Shell({
  crumb,
  crumbHref,
  status,
  children,
}: {
  crumb: string;
  crumbHref: string;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <PublicShell
      entity="JSOA"
      currentPath="/store"
      crumbs={crumbHref === "/jsoa" ? [{ href: "/store", label: "Store" }] : [
        { href: "/store", label: "Store" },
        { href: crumbHref, label: crumb },
      ]}
    >
      <div className={styles.page} style={HUE_STYLE}>
        {children}
      </div>
    </PublicShell>
  );
}

/**
 * The dev viewer strip. Labelled as a development affordance because that is
 * what it is: there is no sign-in behind it yet.
 */
export function ViewerStrip({
  current,
  basePath,
  extraQuery,
}: {
  current: string;
  basePath: string;
  extraQuery?: Record<string, string>;
}) {
  const href = (key: string) => {
    const params = new URLSearchParams({ ...(extraQuery ?? {}), viewer: key });
    return `${basePath}?${params.toString()}`;
  };
  return (
    <div className={styles.dev}>
      <span className={styles.devLabel}>Dev: viewing as</span>
      {DEV_VIEWERS.map((option) => (
        <Link
          key={option.key}
          href={href(option.key)}
          className={`${styles.devLink} ${option.key === current ? styles.devOn : ""}`}
        >
          {option.label}
        </Link>
      ))}
      <span className={styles.devNote}>{DEV_SWITCHER_WARNING}</span>
    </div>
  );
}

function fulfilmentChip(fulfilment: string): string {
  return fulfilment === "print_on_demand" ? "printed to order" : "in stock";
}

export function PublicCard({
  product,
  cartHref,
}: {
  product: PublicProduct;
  cartHref: string;
}) {
  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <Link href={`/store/item/${product.sku}`} className={styles.cardName}>
          {product.name}
        </Link>
        <span className={styles.price}>{formatCents(product.priceCents)}</span>
      </div>
      <p className={styles.blurb}>{product.blurb}</p>
      <div className={styles.meta}>
        <span className={styles.chip}>{product.category}</span>
        <span className={styles.chip}>{fulfilmentChip(product.fulfilment)}</span>
      </div>
      <Link href={cartHref} className={styles.action}>
        Add to the cart
      </Link>
    </li>
  );
}

export function MemberCard({
  product,
  cartHref,
}: {
  product: Product;
  cartHref: string;
}) {
  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <Link href={`/store/item/${product.sku}?viewer=good-standing`} className={styles.cardName}>
          {product.name}
        </Link>
        <span className={styles.price}>{formatCents(product.priceCents)}</span>
      </div>
      <p className={styles.blurb}>{product.blurb}</p>
      <div className={styles.meta}>
        <span className={styles.chip}>{product.category}</span>
        <span className={styles.chip}>{fulfilmentChip(product.fulfilment)}</span>
        {product.publiclyPurchasable ? null : (
          <span className={styles.chipHue}>members only</span>
        )}
        {product.collection ? (
          <span className={styles.chip}>{product.collection}</span>
        ) : null}
      </div>
      <Link href={cartHref} className={styles.action}>
        Add to the cart
      </Link>
    </li>
  );
}

export const TAX_LINE_NOTE =
  "North Carolina sales tax is shown as its own line and is not included in " +
  "the item prices. The Association is exempt from federal income tax; that is " +
  "not an exemption from collecting sales tax on merchandise.";
