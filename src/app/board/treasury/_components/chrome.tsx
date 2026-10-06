import { RoleTabs } from "@/components/workspace-shell/RoleTabs";
import type { Entity } from "@/lib/authz/model";
import type { SodFinding } from "@/lib/authz/policy";
import { formatCents } from "@/lib/treasury/money";
import { TREASURY_FUNCTION_TABS } from "@/lib/treasury/workspace";
import type { WorkspaceTab } from "@/lib/workspace/types";

import styles from "../treasury.module.css";

/* ------------------------------------------------------------------ *
 * Entity identity
 *
 * The hue is the label. Every figure on every treasury screen sits under a
 * wrapper carrying the entity's hue class, so a reader can tell at a glance
 * which entity a number belongs to without reading the header.
 * ------------------------------------------------------------------ */

export const ENTITY_LABELS: Record<Entity, { short: string; long: string; subsection: string }> = {
  JSOA: {
    short: "JSOA",
    long: "Joint Special Operations Association",
    subsection: "501(c)(19)",
  },
  JSOF: {
    short: "JSOF",
    long: "Joint Special Operations Foundation",
    subsection: "501(c)(3)",
  },
};

export function entityClass(entity: Entity): string {
  return entity === "JSOA" ? styles.jsoa : styles.jsof;
}

export function EntityTag({ entity }: { entity: Entity }) {
  return (
    <span className={`${entityClass(entity)} ${styles.entityTag}`}>
      {ENTITY_LABELS[entity].short}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Money
 *
 * One component, so tabular figures are not a thing each screen remembers to
 * do. `formatCents` never sees a float.
 * ------------------------------------------------------------------ */

export function Money({
  amountCents,
  lead = false,
  showCurrency = false,
}: {
  amountCents: number;
  lead?: boolean;
  showCurrency?: boolean;
}) {
  return (
    <span className={`${styles.num} ${lead ? styles.numLead : ""}`}>
      {showCurrency ? <span className={styles.currency}>USD</span> : null}
      {formatCents(amountCents)}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

/**
 * The tab strip is `RoleTabs` from the workspace shell, not a treasury one.
 *
 * It is shared on purpose: six roles each rendering their own slightly
 * different navigation is how a platform stops being one platform. This module
 * passes its own function tabs in and writes none of the strip itself.
 */
export function TreasuryNav({ current }: { current: WorkspaceTab | string }) {
  return (
    <RoleTabs
      base="/board/treasury"
      current={current}
      functionTabs={[...TREASURY_FUNCTION_TABS]}
    />
  );
}

export function TreasuryHeader({
  title,
  lede,
  period,
  current,
}: {
  title: string;
  lede: string;
  period?: string;
  /** A spine tab name for one of the five, or a function tab's href. */
  current: WorkspaceTab | string;
}) {
  return (
    <>
      <div className={styles.head}>
        <div>
          <span className={styles.eyebrow}>Treasury</span>
          <h1 className={styles.title}>{title}</h1>
        </div>
        {period ? <span className={styles.period}>{period}</span> : null}
      </div>
      <p className={styles.lede}>{lede}</p>
      <TreasuryNav current={current} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Withheld
 *
 * A column the reader has no scope for is withheld, never rendered as zero.
 * Zero is a claim about the entity's finances. This is a claim about the
 * reader's permissions, and the two must not look alike.
 * ------------------------------------------------------------------ */

export function Withheld({
  entity,
  reason,
  what,
}: {
  entity?: Entity;
  reason: string;
  what: string;
}) {
  return (
    <div className={`${entity ? entityClass(entity) : ""} ${styles.withheld}`}>
      <span className={styles.withheldTitle}>
        {entity ? `${ENTITY_LABELS[entity].short} · ` : ""}
        {what} withheld
      </span>
      <p className={styles.findingText}>{reason}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Severity and findings
 * ------------------------------------------------------------------ */

export type Severity = "critical" | "high" | "moderate";

const SEVERITY_CLASS: Record<Severity, string> = {
  critical: styles.sevCritical,
  high: styles.sevHigh,
  moderate: styles.sevModerate,
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return <span className={`${styles.sev} ${SEVERITY_CLASS[severity]}`}>{severity}</span>;
}

export function FindingItem({
  severity,
  heading,
  finding,
  mitigation,
  mitigationLabel = "Mitigation",
}: {
  severity: Severity;
  heading: React.ReactNode;
  finding: string;
  mitigation: string;
  mitigationLabel?: string;
}) {
  return (
    <li
      className={`${styles.findingItem} ${
        severity === "moderate" ? styles.findingItemModerate : ""
      }`}
    >
      <div className={styles.findingHead}>
        <SeverityChip severity={severity} />
        {heading}
      </div>
      <p className={styles.findingText}>{finding}</p>
      <p className={styles.mitigation}>
        <span className={styles.mitigationLabel}>{mitigationLabel}</span>
        {mitigation}
      </p>
    </li>
  );
}

export function SodFindingList({
  findings,
  nameFor,
}: {
  findings: SodFinding[];
  nameFor: (personId: string) => string;
}) {
  if (findings.length === 0) {
    return (
      <p className={styles.note}>
        No separation-of-duties finding on these assignments. That is a result, not
        an absence of checking.
      </p>
    );
  }
  return (
    <ul className={styles.findingList}>
      {findings.map((finding, index) => (
        <FindingItem
          key={`${finding.personId}-${finding.entity}-${index}`}
          severity={finding.severity}
          heading={
            <span>
              <strong>{nameFor(finding.personId)}</strong>{" "}
              <span className={styles.quiet}>
                holds {finding.roles.join(" and ")} on{" "}
              </span>
              <EntityTag entity={finding.entity} />
            </span>
          }
          finding={finding.finding}
          mitigation={finding.mitigation}
        />
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Refusal and confirmation copy
 * ------------------------------------------------------------------ */

export function Refusal({ children }: { children: React.ReactNode }) {
  return (
    <p className={styles.refusal} role="status">
      {children}
    </p>
  );
}

export function Confirmation({
  entity,
  children,
}: {
  entity?: Entity;
  children: React.ReactNode;
}) {
  return (
    <p
      className={`${entity ? entityClass(entity) : ""} ${styles.confirm}`}
      role="status"
    >
      {children}
    </p>
  );
}
