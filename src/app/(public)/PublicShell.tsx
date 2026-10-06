import Link from "next/link";

import type { Entity } from "@/lib/authz/model";

import { ENTITY_PROFILES, POSTAL_ADDRESS } from "./entities";
import styles from "./public-shell.module.css";

/**
 * The shared public shell: header with the entity hue, nav, breadcrumb, footer.
 *
 * One component for both entities, because the two public tiers must be
 * structurally identical and differ only in hue, nav and language. If they
 * drift apart a reader cannot tell which organization they are dealing with,
 * which is the failure the split front door exists to prevent.
 *
 * The hue is set as a class that redefines `--hue`, rather than an inline
 * style, so no colour literal appears in a component and both themes follow
 * the tokens in `globals.css` automatically.
 */

export type Crumb = { href: string; label: string };

type PublicShellProps = {
  entity: Entity;
  /** The nav item that should read as current. Match on href. */
  currentPath?: string;
  /** Trail between the entity home and this page. Omit on the entity home. */
  crumbs?: Crumb[];
  children: React.ReactNode;
};

export function PublicShell({ entity, currentPath, crumbs, children }: PublicShellProps) {
  const profile = ENTITY_PROFILES[entity];
  const other = ENTITY_PROFILES[entity === "JSOA" ? "JSOF" : "JSOA"];

  return (
    <div className={`${styles.shell} ${styles[profile.hueClass]}`}>
      <header className={styles.masthead}>
        <div className={styles.identity}>
          <Link href={profile.home} className={styles.wordmark}>
            {profile.shortName}{" "}
            <span className={styles.wordmarkLong}>{profile.legalName}</span>
          </Link>
          <span className={styles.subsection}>
            {profile.entity === "JSOA" ? "Association" : "Foundation"} &middot;{" "}
            {profile.subsection}
          </span>
        </div>

        <nav className={styles.nav} aria-label={`${profile.shortName} sections`}>
          <ul className={styles.navList}>
            {profile.nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`${styles.navLink} ${
                    item.href === currentPath ? styles.navLinkCurrent : ""
                  }`}
                  aria-current={item.href === currentPath ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {crumbs && crumbs.length > 0 ? (
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <ol>
            <li>
              <Link href={profile.home}>{profile.shortName}</Link>
            </li>
            {crumbs.map((crumb, index) => (
              <li key={crumb.href}>
                {index === crumbs.length - 1 ? (
                  <span aria-current="page">{crumb.label}</span>
                ) : (
                  <Link href={crumb.href}>{crumb.label}</Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <main className={styles.main}>{children}</main>

      <footer className={styles.foot}>
        <div className={styles.footInner}>
          <div>
            <h2 className={styles.footHead}>{profile.shortName}</h2>
            <ul className={styles.footList}>
              {profile.nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className={styles.footHead}>The other entity</h2>
            <p className={styles.crossover}>
              {profile.crossover.because}
              <Link href={profile.crossover.href} className={styles.crossoverLink}>
                Go to the {other.entity === "JSOA" ? "Association" : "Foundation"}
              </Link>
            </p>
          </div>

          <div>
            <h2 className={styles.footHead}>Both entities</h2>
            <ul className={styles.footList}>
              <li>
                <Link href="/">Choose an entity</Link>
              </li>
              <li>
                <Link href={`${profile.home}/contact`}>Contact by office</Link>
              </li>
            </ul>
            <p className={`${styles.crossover} ${styles.crossoverSpaced}`}>
              We publish offices, not the people who hold them.
            </p>
          </div>
        </div>

        <div className={styles.legal}>
          <div className={styles.legalInner}>
            <span className={styles.address}>
              {profile.legalName} &middot; {profile.subsection} &middot;{" "}
              {POSTAL_ADDRESS}
            </span>
            <span className={styles.badge}>Demo build &middot; no live member data</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
