/**
 * Compliance calendar logic.
 *
 * Two rules shape everything here:
 *
 *   1. An unverified obligation is never counted, sorted with, or presented
 *      alongside a real one. It is separated out and labelled. A calendar that
 *      mixes "you must file this" with "someone thinks this might exist" is
 *      worse than no calendar, because the board stops trusting the ones that
 *      are real.
 *   2. Nothing is summed across entities. Two entities, two columns. This file
 *      returns per-entity groupings and never a combined figure.
 */

import { ENTITIES, type Entity } from "../authz/model";
import type { ComplianceItem, FilingStatus } from "./types";

export const DUE_SOON_DAYS = 60;

export type ComplianceUrgency =
  | "OVERDUE"
  | "DUE_SOON"
  | "SCHEDULED"
  | "FILED"
  | "BLOCKED"
  | "UNVERIFIED";

export function daysUntil(dueDate: string, today: Date = new Date()): number {
  const due = Date.parse(`${dueDate}T00:00:00.000Z`);
  const now = Date.parse(
    `${today.toISOString().slice(0, 10)}T00:00:00.000Z`,
  );
  return Math.round((due - now) / 86_400_000);
}

export function urgencyOf(item: ComplianceItem, today: Date = new Date()): ComplianceUrgency {
  if (!item.verified) return "UNVERIFIED";
  if (item.status === "FILED") return "FILED";
  if (item.status === "BLOCKED") return "BLOCKED";
  const days = daysUntil(item.dueDate, today);
  if (days < 0) return "OVERDUE";
  if (days <= DUE_SOON_DAYS) return "DUE_SOON";
  return "SCHEDULED";
}

export const URGENCY_LABELS: Record<ComplianceUrgency, string> = {
  OVERDUE: "Overdue",
  DUE_SOON: `Due within ${DUE_SOON_DAYS} days`,
  SCHEDULED: "Scheduled",
  FILED: "Filed",
  BLOCKED: "Blocked",
  UNVERIFIED: "Unverified",
};

const URGENCY_ORDER: ComplianceUrgency[] = [
  "OVERDUE",
  "DUE_SOON",
  "BLOCKED",
  "SCHEDULED",
  "FILED",
  "UNVERIFIED",
];

export function sortForBoard(
  items: ComplianceItem[],
  today: Date = new Date(),
): ComplianceItem[] {
  return [...items].sort((a, b) => {
    const rank =
      URGENCY_ORDER.indexOf(urgencyOf(a, today)) - URGENCY_ORDER.indexOf(urgencyOf(b, today));
    if (rank !== 0) return rank;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/** Verified duties only. The unverified entry is returned separately. */
export function splitVerified(items: ComplianceItem[]): {
  duties: ComplianceItem[];
  unverified: ComplianceItem[];
} {
  return {
    duties: items.filter((i) => i.verified),
    unverified: items.filter((i) => !i.verified),
  };
}

/**
 * Per entity, never combined. `ENTITIES` order is fixed so the two columns
 * never swap places between renders.
 */
export function groupByEntity(
  items: ComplianceItem[],
): { entity: Entity; items: ComplianceItem[] }[] {
  return ENTITIES.map((entity) => ({
    entity,
    items: items.filter((i) => i.entity === entity),
  }));
}

export type ComplianceCounts = {
  overdue: number;
  dueSoon: number;
  blocked: number;
  scheduled: number;
  filed: number;
  /** Obligations that will not announce themselves. The ones that get missed. */
  notSelfDeclaring: number;
};

/** Counts for one entity. There is no combined count by design. */
export function countsFor(
  items: ComplianceItem[],
  today: Date = new Date(),
): ComplianceCounts {
  const duties = items.filter((i) => i.verified);
  const tally = (urgency: ComplianceUrgency) =>
    duties.filter((i) => urgencyOf(i, today) === urgency).length;
  return {
    overdue: tally("OVERDUE"),
    dueSoon: tally("DUE_SOON"),
    blocked: tally("BLOCKED"),
    scheduled: tally("SCHEDULED"),
    filed: tally("FILED"),
    notSelfDeclaring: duties.filter((i) => !i.selfDeclaring && i.status !== "FILED").length,
  };
}

export const STATUS_LABELS: Record<FilingStatus, string> = {
  OPEN: "Not started",
  IN_PROGRESS: "In progress",
  FILED: "Filed",
  BLOCKED: "Blocked",
};

export function formatDueDate(dueDate: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dueDate}T00:00:00.000Z`));
}
