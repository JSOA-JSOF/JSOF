import styles from "./dashboard.module.css";

/**
 * A role's dashboard tile.
 *
 * Three rules, all of them reactions to how dashboards usually fail:
 *
 * 1. A figure that cannot be computed yet says so and says what it needs. It
 *    does not show zero. Zero is a measurement; "not yet measured" is the
 *    truth, and the difference matters when someone is deciding whether a
 *    number is bad or simply absent.
 *
 *    `withheld` is the sibling of that state and not the same one: the figure
 *    exists and is simply not this reader's to see. Both carry `value: null`,
 *    because neither is a number, and both must be distinguishable from zero —
 *    but a reader should know whether a figure is missing from the world or
 *    missing from their view, so they render differently.
 * 2. Every tile states what it was computed from, in one line. A figure whose
 *    provenance nobody can reconstruct gets argued about instead of acted on.
 * 3. Good is unremarkable. Only a problem takes colour. A wall of green ticks
 *    trains people to stop reading, and this organization's palette has no
 *    room for a fourth hue anyway.
 */

export type KpiStatus = "good" | "watch" | "problem" | "unmeasured" | "withheld";

export type Kpi = {
  key: string;
  label: string;
  /** null means not measurable yet. Never substitute zero. */
  value: string | null;
  target?: string;
  status: KpiStatus;
  /** One line: what this was computed from. */
  from: string;
  /** When unmeasured: what would have to exist to measure it. */
  needs?: string;
};

export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className={styles.grid}>
      {kpis.map((kpi) => (
        <KpiTile key={kpi.key} kpi={kpi} />
      ))}
    </div>
  );
}

export function KpiTile({ kpi }: { kpi: Kpi }) {
  const unmeasured = kpi.value === null;
  const withheld = kpi.status === "withheld";
  const tone =
    kpi.status === "problem"
      ? styles.problem
      : kpi.status === "watch"
        ? styles.watch
        : kpi.status === "unmeasured" || kpi.status === "withheld"
          ? styles.unmeasured
          : "";

  return (
    <div className={`${styles.tile} ${tone}`}>
      <span className={styles.label}>{kpi.label}</span>

      {unmeasured ? (
        <span className={styles.notMeasured}>
          {withheld ? "Withheld" : "Not measured yet"}
        </span>
      ) : (
        <span className={styles.value}>{kpi.value}</span>
      )}

      {kpi.target && !unmeasured ? (
        <span className={styles.target}>Target {kpi.target}</span>
      ) : null}

      {unmeasured && kpi.needs ? (
        <span className={styles.needs}>Needs {kpi.needs}</span>
      ) : null}

      <span className={styles.from}>{kpi.from}</span>
    </div>
  );
}
