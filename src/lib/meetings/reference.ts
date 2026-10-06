/**
 * Minute references.
 *
 * This is the module's public contract with the rest of the platform. The
 * treasury module cannot persist an inter-entity transfer without a minute
 * reference on both sides (`assertTransferApprovable` in
 * `src/lib/authz/policy.ts`), and those references point here. So the format
 * is fixed, parseable, and carries the entity in the string itself — a bare
 * `min-4` would be exactly the ambiguity separate minute books exist to
 * prevent.
 *
 *     JSOA-2026-10-min-4
 *     └──┘ └──┘ └┘     └┘
 *      │    │    │      └ item number in that meeting's adopted agenda
 *      │    │    └─────── calendar month, two digits
 *      │    └──────────── calendar year, four digits
 *      └───────────────── entity, exactly as in ENTITIES
 *
 * An entity holding more than one meeting in a calendar month gets a session
 * suffix on the second and later meetings, so references stay unique without
 * disturbing the ordinary monthly form:
 *
 *     JSOF-2026-10-S2-min-2
 *
 * The book reference for a whole meeting drops the item part: `JSOA-2026-10`.
 */

import { ENTITIES, type Entity } from "../authz/model";

const ENTITY_ALTERNATION = ENTITIES.join("|");

/** `JSOA-2026-10` or `JSOF-2026-10-S2`. */
export const BOOK_REF_PATTERN = new RegExp(
  `^(${ENTITY_ALTERNATION})-(\\d{4})-(0[1-9]|1[0-2])(?:-S([2-9]|[1-9]\\d))?$`,
);

/** `JSOA-2026-10-min-4` or `JSOF-2026-10-S2-min-2`. */
export const MINUTE_REF_PATTERN = new RegExp(
  `^(${ENTITY_ALTERNATION})-(\\d{4})-(0[1-9]|1[0-2])(?:-S([2-9]|[1-9]\\d))?-min-([1-9]\\d{0,2})$`,
);

export const MINUTE_REF_FORMAT = "ENTITY-YYYY-MM[-Sn]-min-N";

export const MINUTE_REF_EXAMPLE = "JSOA-2026-10-min-4";

export type ParsedMinuteRef = {
  entity: Entity;
  year: number;
  month: number;
  session: number;
  itemNumber: number;
  bookRef: string;
};

export class MinuteRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinuteRefError";
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatBookRef(args: {
  entity: Entity;
  year: number;
  month: number;
  session?: number;
}): string {
  const { entity, year, month } = args;
  const session = args.session ?? 1;
  if (!ENTITIES.includes(entity)) {
    throw new MinuteRefError(`Unknown entity ${String(entity)}`);
  }
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new MinuteRefError(`Year must be four digits, got ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new MinuteRefError(`Month must be 1 to 12, got ${month}`);
  }
  if (!Number.isInteger(session) || session < 1 || session > 99) {
    throw new MinuteRefError(`Session must be 1 to 99, got ${session}`);
  }
  const suffix = session > 1 ? `-S${session}` : "";
  return `${entity}-${year}-${pad2(month)}${suffix}`;
}

export function formatMinuteRef(args: {
  entity: Entity;
  year: number;
  month: number;
  session?: number;
  itemNumber: number;
}): string {
  const { itemNumber } = args;
  if (!Number.isInteger(itemNumber) || itemNumber < 1 || itemNumber > 999) {
    throw new MinuteRefError(`Item number must be 1 to 999, got ${itemNumber}`);
  }
  return `${formatBookRef(args)}-min-${itemNumber}`;
}

/**
 * The form used everywhere in this module: derive the reference from the
 * meeting the item belongs to, so the entity in the string can never disagree
 * with the entity of the record.
 */
export function minuteRefForMeeting(
  meeting: { entity: Entity; scheduledStart: string; session: number },
  itemNumber: number,
): string {
  const start = new Date(meeting.scheduledStart);
  if (Number.isNaN(start.getTime())) {
    throw new MinuteRefError(`Meeting has an unparseable start: ${meeting.scheduledStart}`);
  }
  return formatMinuteRef({
    entity: meeting.entity,
    year: start.getUTCFullYear(),
    month: start.getUTCMonth() + 1,
    session: meeting.session,
    itemNumber,
  });
}

export function bookRefForMeeting(meeting: {
  entity: Entity;
  scheduledStart: string;
  session: number;
}): string {
  const start = new Date(meeting.scheduledStart);
  if (Number.isNaN(start.getTime())) {
    throw new MinuteRefError(`Meeting has an unparseable start: ${meeting.scheduledStart}`);
  }
  return formatBookRef({
    entity: meeting.entity,
    year: start.getUTCFullYear(),
    month: start.getUTCMonth() + 1,
    session: meeting.session,
  });
}

export function parseMinuteRef(ref: string): ParsedMinuteRef | null {
  const match = MINUTE_REF_PATTERN.exec(ref.trim());
  if (!match) return null;
  const [, entity, year, month, session, itemNumber] = match;
  return {
    entity: entity as Entity,
    year: Number(year),
    month: Number(month),
    session: session ? Number(session) : 1,
    itemNumber: Number(itemNumber),
    bookRef: formatBookRef({
      entity: entity as Entity,
      year: Number(year),
      month: Number(month),
      session: session ? Number(session) : 1,
    }),
  };
}

export function isMinuteRef(ref: string): boolean {
  return parseMinuteRef(ref) !== null;
}

/**
 * For the treasury module's benefit: a transfer reference pair is only valid
 * if the two sides name two DIFFERENT entities. Two references to the same
 * minute book are one board approving its own transfer twice.
 */
export function minuteRefsCrossEntities(refFrom: string, refTo: string): boolean {
  const from = parseMinuteRef(refFrom);
  const to = parseMinuteRef(refTo);
  if (!from || !to) return false;
  return from.entity !== to.entity;
}
