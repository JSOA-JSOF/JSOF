import Link from "next/link";

import { grantsMemberAccess } from "@/lib/membership/state";
import { addToCart, parseCartParam, serialiseCartParam } from "@/lib/store/cart";
import { memberCatalogue, viewerHasMemberAccess } from "@/lib/store/catalogue";
import { resolveDevViewer } from "@/lib/store/dev";
import { storeRepository } from "@/lib/store/repository";
import { STORE_ENTITY } from "@/lib/store/types";

import { MemberCard, Shell, TAX_LINE_NOTE, ViewerStrip } from "../parts";
import styles from "../store.module.css";

/**
 * The member catalogue: the full list plus the seasonal collections.
 *
 * The gate is `grantsMemberAccess` from the membership module, used through
 * `viewerHasMemberAccess`. It is not reimplemented here and the two states that
 * pass are PROBATIONARY and GOOD_STANDING, which is the membership module's
 * decision: the 30-day audit is a check on the record, not a probation the
 * member serves, and a member who has paid gets what they paid for on day one.
 */

export const metadata = {
  title: "Member store · Joint Special Operations Association",
  robots: { index: false, follow: false },
};

export default async function MemberStorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const viewerKey = typeof params.viewer === "string" ? params.viewer : "visitor";
  const option = resolveDevViewer(viewerKey);
  const rawCart = typeof params.items === "string" ? params.items : null;
  const cart = parseCartParam(rawCart);

  const hasAccess = viewerHasMemberAccess(option.viewer);

  const cartHrefFor = (sku: string) => {
    const items = serialiseCartParam(addToCart(cart, sku));
    return `/store/cart?viewer=${option.key}&items=${encodeURIComponent(items)}`;
  };

  return (
    <Shell
      crumb="Public catalogue"
      crumbHref="/store"
      status={`${STORE_ENTITY} store · members`}
    >
      <ViewerStrip current={option.key} basePath="/store/members" />

      <div className={styles.body}>
        <h1 className={styles.title}>Member catalogue</h1>

        {!hasAccess ? (
          <>
            <p className={styles.lede}>
              This page is for current members. Sign in to see it, or use the
              public catalogue.
            </p>
            <div className={styles.warnNote}>
              {option.viewer.kind === "member" &&
              !grantsMemberAccess(option.viewer.membershipState)
                ? "This membership does not currently carry store access. If you have applied and paid, access follows the payment clearing. If your membership has lapsed, renewing restores it."
                : "You are not signed in. The public catalogue is open to everyone."}
            </div>
            <div className={styles.actionRow}>
              <Link href="/store" className={styles.action}>
                Go to the public catalogue
              </Link>
            </div>
            <p className={styles.note}>
              This page names nothing that is not on the public catalogue while
              you are without access. That is deliberate: a list of what you
              cannot buy is still a list.
            </p>
          </>
        ) : (
          <MemberCatalogueBody
            cartHrefFor={cartHrefFor}
            viewerKey={option.key}
            rawCart={rawCart}
          />
        )}
      </div>
    </Shell>
  );
}

function MemberCatalogueBody({
  cartHrefFor,
  viewerKey,
  rawCart,
}: {
  cartHrefFor: (sku: string) => string;
  viewerKey: string;
  rawCart: string | null;
}) {
  const catalogue = memberCatalogue(storeRepository().listProducts(STORE_ENTITY));
  const cartQuery = rawCart
    ? `?viewer=${viewerKey}&items=${encodeURIComponent(rawCart)}`
    : `?viewer=${viewerKey}`;

  return (
    <>
      <p className={styles.lede}>
        Everything in the store, including the lines that are not sold publicly
        and the seasonal collections. Prices are before North Carolina sales
        tax.
      </p>

      <div className={styles.actionRow}>
        <Link href={`/store/cart${cartQuery}`} className={`${styles.action} ${styles.actionQuiet}`}>
          Cart
        </Link>
      </div>

      {catalogue.collections.map((collection) => (
        <section key={collection.name}>
          <h2 className={styles.sectionHead}>{collection.name}</h2>
          <ul className={styles.grid}>
            {collection.items.map((product) => (
              <MemberCard
                key={product.sku}
                product={product}
                cartHref={cartHrefFor(product.sku)}
              />
            ))}
          </ul>
        </section>
      ))}

      <h2 className={styles.sectionHead}>Full catalogue</h2>
      <ul className={styles.grid}>
        {catalogue.items.map((product) => (
          <MemberCard
            key={product.sku}
            product={product}
            cartHref={cartHrefFor(product.sku)}
          />
        ))}
      </ul>

      <p className={styles.note}>{TAX_LINE_NOTE}</p>
    </>
  );
}
