import Link from "next/link";

import { AuthzError, type Subject } from "@/lib/authz/policy";
import { storeSodBanner } from "@/lib/store/board";
import { SECOND_COUNTER_NOTE } from "@/lib/store/inventory";
import { SEED_PEOPLE } from "@/lib/store/seed";

import styles from "./board.module.css";

/**
 * Chrome for the board store screens.
 *
 * The brand bar, the platform nav, the dev persona switcher and the global
 * separation-of-duties strip all come from the shared board shell in
 * `src/app/board/layout.tsx`, so none of them are repeated here. What is here
 * is the store section nav, the store-specific consequence of the Treasurer
 * and Store Chair overlap, and the panel a screen shows when the signed-in
 * role does not reach the data.
 */

export const HUE_STYLE = { ["--hue" as string]: "var(--jsoa)" };

const NAV = [
  { href: "/board/store", label: "Overview" },
  { href: "/board/store/orders", label: "Orders" },
  { href: "/board/store/receipts", label: "Member vs non-member receipts" },
  { href: "/board/store/tax", label: "Sales tax" },
  { href: "/board/store/inventory", label: "Inventory" },
  { href: "/board/store/refunds", label: "Refunds" },
];

export function StoreHeader({ here, title }: { here: string; title: string }) {
  return (
    <div style={HUE_STYLE}>
      <span className={styles.status}>JSOA store</span>
      <h1 className={styles.title}>{title}</h1>
      <nav className={styles.nav}>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.navLink} ${item.href === here ? styles.navOn : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Wraps a screen so everything beneath it reads the Association hue. */
export function StoreScreen({ children }: { children: React.ReactNode }) {
  return (
    <div style={HUE_STYLE} className={styles.screen}>
      {children}
    </div>
  );
}

/**
 * The store consequence of the separation-of-duties finding.
 *
 * The shared shell already prints the finding itself, from
 * `separationOfDutiesFindings`. This adds what it means on this screen: the
 * person reading these figures is the person who set the prices, holds the
 * goods and recorded the sales, so the quarterly count has to come from
 * somebody else. The brief asks for the warning here because here is where the
 * consequence lands.
 */
export function StoreSodWarning({ subject }: { subject: Subject }) {
  const banner = storeSodBanner(subject);
  const critical = banner.findings.filter((f) =>
    f.roles.includes("STORE_CHAIR") && f.roles.includes("TREASURER"),
  );
  if (!banner.holdsBoth || critical.length === 0) return null;
  const finding = critical[0];
  return (
    <div className={styles.finding}>
      <span className={styles.findingHead}>
        Separation of duties · {finding.severity} · store
      </span>
      <p className={styles.findingBody}>{finding.finding}</p>
      <p className={styles.findingMitigation}>{finding.mitigation}</p>
      <p className={styles.findingMitigation}>{SECOND_COUNTER_NOTE}</p>
    </div>
  );
}

/**
 * What a screen shows when the signed-in role does not reach the data. It
 * names the level that was needed rather than showing an empty table, because
 * an empty table reads as "there are no orders".
 */
export function Refused({
  what,
  needed,
  held,
  because,
}: {
  what: string;
  needed: string;
  held: string;
  because: string;
}) {
  return (
    <div className={styles.refused}>
      <span className={styles.refusedHead}>Not available to this role</span>
      <p className={styles.findingBody}>
        {what} needs {needed} on financial records for JSOA. This role holds {held}.
      </p>
      <p className={styles.findingMitigation}>{because}</p>
    </div>
  );
}

/**
 * A readable name for a person ID. Seeded people have one; a dev persona is
 * shown as the persona it is, because inventing a name for it would be worse.
 */
export function personLabel(personId: string): string {
  if (SEED_PEOPLE[personId]) return SEED_PEOPLE[personId];
  if (personId.startsWith("dev:")) return `${personId.slice(4).replace(/-/g, " ")} (dev persona)`;
  return personId;
}

export function describeAuthzError(error: unknown): string {
  if (error instanceof AuthzError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export { styles as boardStyles };
