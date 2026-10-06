/**
 * Agenda arithmetic and validation. Pure functions, no repository, no request
 * context, so the overrun rule can be tested without standing anything up.
 */

import type { Entity } from "../authz/model";
import type { AgendaItem, AgendaItemType, Meeting } from "./types";

export class AgendaError extends Error {
  constructor(
    message: string,
    readonly code:
      | "ENTITY_MISMATCH"
      | "AGENDA_FROZEN"
      | "BAD_INPUT"
      | "NOT_FOUND",
  ) {
    super(message);
    this.name = "AgendaError";
  }
}

/** Beyond this, a meeting is not running long, it is running badly. */
export const OVERRUN_TOLERANCE_MINUTES = 0;

/** Business the board holds open regardless of the agenda: call, quorum, close. */
export const PROCEDURAL_OVERHEAD_MINUTES = 10;

export type AgendaTotals = {
  itemCount: number;
  /** Sum of every item's estimate. */
  estimatedMinutes: number;
  /** Estimate plus the fixed procedural overhead. */
  committedMinutes: number;
  scheduledMinutes: number;
  /** Positive when the agenda does not fit. */
  overrunMinutes: number;
  overruns: boolean;
  /** Minutes still unallocated. Zero when the agenda overruns. */
  slackMinutes: number;
  byType: Record<AgendaItemType, { count: number; minutes: number }>;
  /** Share of the scheduled time spent on decisions, 0 to 1. */
  decisionShare: number;
};

export function agendaTotals(meeting: Meeting, items: AgendaItem[]): AgendaTotals {
  const byType: AgendaTotals["byType"] = {
    DECISION: { count: 0, minutes: 0 },
    DISCUSSION: { count: 0, minutes: 0 },
    INFORMATION: { count: 0, minutes: 0 },
  };
  let estimatedMinutes = 0;
  for (const item of items) {
    const minutes = Math.max(0, Math.round(item.estimatedMinutes));
    estimatedMinutes += minutes;
    byType[item.type].count += 1;
    byType[item.type].minutes += minutes;
  }
  const committedMinutes = estimatedMinutes + PROCEDURAL_OVERHEAD_MINUTES;
  const overrunMinutes = committedMinutes - meeting.scheduledMinutes;
  return {
    itemCount: items.length,
    estimatedMinutes,
    committedMinutes,
    scheduledMinutes: meeting.scheduledMinutes,
    overrunMinutes: Math.max(0, overrunMinutes),
    overruns: overrunMinutes > OVERRUN_TOLERANCE_MINUTES,
    slackMinutes: Math.max(0, -overrunMinutes),
    byType,
    decisionShare:
      meeting.scheduledMinutes > 0
        ? byType.DECISION.minutes / meeting.scheduledMinutes
        : 0,
  };
}

/**
 * Running clock down the agenda, so the printed agenda can carry a start time
 * per item and the board can see which item is the one that gets cut.
 */
export type AgendaSchedule = {
  item: AgendaItem;
  /** Minutes from the start of the meeting at which this item is reached. */
  startsAtMinute: number;
  endsAtMinute: number;
  /** True when this item begins after the scheduled close. */
  pastScheduledClose: boolean;
};

export function agendaSchedule(meeting: Meeting, items: AgendaItem[]): AgendaSchedule[] {
  let clock = PROCEDURAL_OVERHEAD_MINUTES;
  return byPosition(items).map((item) => {
    const startsAtMinute = clock;
    const minutes = Math.max(0, Math.round(item.estimatedMinutes));
    clock += minutes;
    return {
      item,
      startsAtMinute,
      endsAtMinute: clock,
      pastScheduledClose: startsAtMinute >= meeting.scheduledMinutes,
    };
  });
}

export function byPosition(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => a.position - b.position);
}

export function byItemNumber(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => a.itemNumber - b.itemNumber);
}

/** Item numbers are frozen once the agenda is adopted. */
export function agendaIsFrozen(meeting: Meeting): boolean {
  return meeting.agendaAdoptedAt !== null || meeting.status !== "DRAFT";
}

export function assertAgendaEditable(meeting: Meeting): void {
  if (agendaIsFrozen(meeting)) {
    throw new AgendaError(
      `The ${meeting.entity} agenda for ${meeting.title} was adopted on ` +
        `${meeting.agendaAdoptedAt ?? "an earlier date"}. Item numbers are the ` +
        `minute references the treasury module points at, so they cannot be ` +
        `renumbered. Add a supplementary item instead.`,
      "AGENDA_FROZEN",
    );
  }
}

export function assertSameEntity(
  meeting: Meeting,
  entity: Entity | null | undefined,
  what: string,
): void {
  if (!entity) {
    throw new AgendaError(
      `${what} does not name an entity. Every minute, motion and vote records ` +
        `which board was in session; a record that does not is not saveable.`,
      "ENTITY_MISMATCH",
    );
  }
  if (entity !== meeting.entity) {
    throw new AgendaError(
      `${what} names ${entity} but the meeting is a ${meeting.entity} meeting. ` +
        `The two boards keep separate books.`,
      "ENTITY_MISMATCH",
    );
  }
}

export function validateAgendaItemInput(input: {
  title: string;
  estimatedMinutes: number;
  type: AgendaItemType;
}): void {
  if (input.title.trim().length === 0) {
    throw new AgendaError("An agenda item needs a title.", "BAD_INPUT");
  }
  if (
    !Number.isFinite(input.estimatedMinutes) ||
    input.estimatedMinutes < 1 ||
    input.estimatedMinutes > 480
  ) {
    throw new AgendaError(
      "Estimated minutes must be between 1 and 480.",
      "BAD_INPUT",
    );
  }
}

/** Renumber positions to 1..n, contiguous, preserving relative order. */
export function normalisePositions(items: AgendaItem[]): AgendaItem[] {
  return byPosition(items).map((item, index) => ({ ...item, position: index + 1 }));
}
