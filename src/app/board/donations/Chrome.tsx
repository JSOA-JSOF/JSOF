import Link from "next/link";
import type { ReactNode } from "react";

import { RoleTabs } from "@/components/workspace-shell/RoleTabs";
import type { Entity } from "@/lib/authz/model";
import { ENTITY_LABEL } from "@/lib/donations/kpis";
import { functionTabs, WORKSPACE_BASE } from "@/lib/donations/workspace";
import styles from "./donations.module.css";

/**
 * The frame every screen in this workspace shares: the entity bar, the title,
 * and the tab spine.
 *
 * The spine is `RoleTabs` and nothing else. The three function tabs — Gifts,
 * Funds, Sponsors — are the screens that existed before the spine did and keep
 * their routes, passed in as `functionTabs`.
 */
export default function Chrome({
  entity,
  roleLabel,
  current,
  qs,
  statusWord,
  title,
  lede,
  children,
}: {
  entity: Entity;
  roleLabel: string;
  /** A spine tab key, or the full href of a function tab. */
  current: string;
  qs: string;
  statusWord: string;
  title: string;
  lede: ReactNode;
  children: ReactNode;
}) {
  const hue = entity === "JSOA" ? "var(--jsoa)" : "var(--jsof)";
  const hueTint = entity === "JSOA" ? "var(--jsoa-tint)" : "var(--jsof-tint)";

  return (
    <div
      className={styles.page}
      style={{ ["--hue" as string]: hue, ["--hueTint" as string]: hueTint }}
    >
      <header className={styles.bar}>
        <Link href="/" className={styles.back}>
          ← Both entities
        </Link>
        <span className={styles.status}>
          Board · {statusWord} · {entity}
        </span>
      </header>

      <div className={styles.body}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.lede}>{lede}</p>

        <RoleTabs base={WORKSPACE_BASE} current={current} functionTabs={functionTabs(qs)} />

        <p className={styles.sectionNote}>
          {roleLabel} · {ENTITY_LABEL[entity]}
        </p>

        {children}
      </div>
    </div>
  );
}
