/**
 * Minute validation.
 *
 * Two rules here are refusals rather than warnings:
 *
 *   1. A minute entry that does not name its entity cannot be saved. JSOA and
 *      JSOF meet the same evening with the same people, so an unlabelled
 *      minute is evidence against the separation rather than for it.
 *   2. A recusal with no stated reason cannot be saved. The scholarship
 *      conflict rule and the inter-entity transfer rule both depend on
 *      recusals being provable years later, not remembered.
 *
 * Everything else is a flag: the Secretary is told what is incomplete and the
 * record is still saveable, because a minute book that refuses partial work
 * during a live meeting is a minute book that gets kept in a notebook instead.
 */

import { ENTITIES, type Entity } from "../authz/model";
import type {
  AgendaItem,
  Meeting,
  MinuteEntry,
  MinuteEntryInput,
  Motion,
  Recusal,
} from "./types";

export class MinuteError extends Error {
  constructor(
    message: string,
    readonly code:
      | "ENTITY_REQUIRED"
      | "ENTITY_MISMATCH"
      | "RECUSAL_REASON_REQUIRED"
      | "ITEM_NOT_ON_AGENDA"
      | "MOTION_INCOMPLETE",
  ) {
    super(message);
    this.name = "MinuteError";
  }
}

export const MINUTE_FLAGS = {
  DECISION_WITHOUT_MOTION: "DECISION_WITHOUT_MOTION",
  MOTION_WITHOUT_TALLY: "MOTION_WITHOUT_TALLY",
  MOTION_WITHOUT_MOVER: "MOTION_WITHOUT_MOVER",
  MOTION_WITHOUT_SECONDER: "MOTION_WITHOUT_SECONDER",
  TALLY_EXCEEDS_PRESENT: "TALLY_EXCEEDS_PRESENT",
  RECUSED_PERSON_VOTED: "RECUSED_PERSON_VOTED",
  NO_QUORUM: "NO_QUORUM",
  UNREVIEWED_TRANSCRIPT_DRAFT: "UNREVIEWED_TRANSCRIPT_DRAFT",
  EMPTY_DISCUSSION: "EMPTY_DISCUSSION",
  MOVER_IS_SECONDER: "MOVER_IS_SECONDER",
} as const;

export type MinuteFlag = (typeof MINUTE_FLAGS)[keyof typeof MINUTE_FLAGS];

export const MINUTE_FLAG_TEXT: Record<MinuteFlag, string> = {
  DECISION_WITHOUT_MOTION:
    "This is a decision item and it is closed with no motion recorded. Either record the motion, the mover, the seconder and the vote, or change the item type to discussion. As it stands the minute does not show how the board decided.",
  MOTION_WITHOUT_TALLY:
    "A motion is recorded with no vote tally. Record the count for, against and abstaining.",
  MOTION_WITHOUT_MOVER:
    "A motion is recorded with nobody moving it. Record who moved it.",
  MOTION_WITHOUT_SECONDER:
    "A motion is recorded with no seconder. Record the second, or record the motion as having failed for want of a second. Either way the minute has to say which.",
  TALLY_EXCEEDS_PRESENT:
    "The vote tally counts more votes than there were people present and not recused. Check the count.",
  RECUSED_PERSON_VOTED:
    "Someone recorded as recused also appears as the mover or seconder. A recusal means taking no part in the matter.",
  NO_QUORUM:
    "Fewer people were present than quorum requires. Business taken without quorum is not board action.",
  UNREVIEWED_TRANSCRIPT_DRAFT:
    "Produced by the transcript parser and not yet reviewed. This is not a minute of record until the Secretary edits and clears it.",
  EMPTY_DISCUSSION: "Nothing is recorded as having been discussed under this item.",
  MOVER_IS_SECONDER:
    "The same person is recorded as moving and seconding. A motion needs a second from someone else to reach the floor.",
};

function isEntity(value: unknown): value is Entity {
  return typeof value === "string" && (ENTITIES as readonly string[]).includes(value);
}

/**
 * The hard gate. Called by the repository before any minute is written and
 * exported so a route can check before it tries.
 */
export function assertMinuteEntity(
  entity: Entity | null | undefined,
  meeting: Pick<Meeting, "entity" | "title">,
): Entity {
  if (entity === null || entity === undefined || entity === ("" as unknown)) {
    throw new MinuteError(
      "This minute does not name an entity. Every motion, vote and minute " +
        "records which entity's board was in session. Set the entity and save again.",
      "ENTITY_REQUIRED",
    );
  }
  if (!isEntity(entity)) {
    throw new MinuteError(
      `"${String(entity)}" is not one of ${ENTITIES.join(" or ")}.`,
      "ENTITY_REQUIRED",
    );
  }
  if (entity !== meeting.entity) {
    throw new MinuteError(
      `This minute names ${entity} but ${meeting.title} is a ${meeting.entity} ` +
        `meeting. The two boards keep separate books and a minute cannot be ` +
        `filed in the wrong one.`,
      "ENTITY_MISMATCH",
    );
  }
  return entity;
}

/** The second hard gate. A recusal without a reason is not evidence of anything. */
export function assertRecusalsStated(recusals: Recusal[]): void {
  for (const recusal of recusals) {
    if (!recusal.reason || recusal.reason.trim().length === 0) {
      throw new MinuteError(
        `The recusal recorded for ${recusal.displayName || recusal.personId} has ` +
          `no reason. Recusal is how the board proves a conflicted member took ` +
          `no part, so the reason is part of the record, not a note.`,
        "RECUSAL_REASON_REQUIRED",
      );
    }
    if (!recusal.personId || recusal.personId.trim().length === 0) {
      throw new MinuteError(
        "A recusal must name the person recusing.",
        "RECUSAL_REASON_REQUIRED",
      );
    }
  }
}

/**
 * A motion object with no text is not a partly-recorded motion, it is nothing,
 * so that one is refused. A missing mover or seconder is NOT refused: it is
 * flagged. That is deliberate and it is the rule stated at the top of this
 * file. During a live meeting the Secretary records the motion first and
 * catches up on who seconded it a moment later, and the transcript parser
 * routinely finds motion language with no second in reach. A save that throws
 * in either case is a save that drives the minute book back into a notebook.
 * `MOTION_WITHOUT_SECONDER` blocks adoption instead, which is where the
 * pressure belongs.
 */
export function assertMotionWellFormed(motion: Motion | null | undefined): void {
  if (!motion) return;
  if (motion.text.trim().length === 0) {
    throw new MinuteError(
      "This motion has no text. Record what was moved, or record that no motion " +
        "was made.",
      "MOTION_INCOMPLETE",
    );
  }
}

export type MinuteCheck = {
  flags: MinuteFlag[];
  /** Blocks adoption of the minutes as a whole. */
  incomplete: boolean;
};

/**
 * The soft checks. `incomplete` is what the minutes page surfaces per item and
 * what blocks the whole book from being adopted.
 */
export function checkMinute(
  entry: Pick<MinuteEntry, "discussion" | "motion" | "recusals" | "closed" | "draft">,
  item: Pick<AgendaItem, "type">,
  meeting: Pick<Meeting, "quorum" | "attendees">,
): MinuteCheck {
  const flags: MinuteFlag[] = [];

  if (entry.draft) flags.push(MINUTE_FLAGS.UNREVIEWED_TRANSCRIPT_DRAFT);

  if (entry.discussion.trim().length === 0) flags.push(MINUTE_FLAGS.EMPTY_DISCUSSION);

  // The rule the brief asks for: a DECISION item that closes with no motion.
  if (item.type === "DECISION" && entry.closed && !entry.motion) {
    flags.push(MINUTE_FLAGS.DECISION_WITHOUT_MOTION);
  }

  if (entry.motion) {
    if (!entry.motion.tally) {
      flags.push(MINUTE_FLAGS.MOTION_WITHOUT_TALLY);
    } else {
      const present = meeting.attendees.filter((a) => a.present).length;
      const recused = entry.recusals.length;
      const cast =
        entry.motion.tally.for + entry.motion.tally.against + entry.motion.tally.abstain;
      if (cast > Math.max(0, present - recused)) {
        flags.push(MINUTE_FLAGS.TALLY_EXCEEDS_PRESENT);
      }
    }
    if (entry.motion.movedByPersonId.trim().length === 0) {
      flags.push(MINUTE_FLAGS.MOTION_WITHOUT_MOVER);
    }
    if (entry.motion.secondedByPersonId.trim().length === 0) {
      flags.push(MINUTE_FLAGS.MOTION_WITHOUT_SECONDER);
    }
    if (
      entry.motion.movedByPersonId &&
      entry.motion.movedByPersonId === entry.motion.secondedByPersonId
    ) {
      flags.push(MINUTE_FLAGS.MOVER_IS_SECONDER);
    }
    const recusedIds = new Set(entry.recusals.map((r) => r.personId));
    if (
      recusedIds.has(entry.motion.movedByPersonId) ||
      recusedIds.has(entry.motion.secondedByPersonId)
    ) {
      flags.push(MINUTE_FLAGS.RECUSED_PERSON_VOTED);
    }
  }

  const presentCount = meeting.attendees.filter((a) => a.present).length;
  if (presentCount < meeting.quorum) flags.push(MINUTE_FLAGS.NO_QUORUM);

  const blocking: MinuteFlag[] = [
    MINUTE_FLAGS.DECISION_WITHOUT_MOTION,
    MINUTE_FLAGS.MOTION_WITHOUT_TALLY,
    MINUTE_FLAGS.MOTION_WITHOUT_MOVER,
    MINUTE_FLAGS.MOTION_WITHOUT_SECONDER,
    MINUTE_FLAGS.RECUSED_PERSON_VOTED,
    MINUTE_FLAGS.MOVER_IS_SECONDER,
    MINUTE_FLAGS.UNREVIEWED_TRANSCRIPT_DRAFT,
  ];

  return {
    flags,
    incomplete: flags.some((f) => blocking.includes(f)),
  };
}

/** True when every item on the agenda has a minute and none is incomplete. */
export function minuteBookReady(
  items: AgendaItem[],
  entries: MinuteEntry[],
  meeting: Pick<Meeting, "quorum" | "attendees">,
): { ready: boolean; missingItemNumbers: number[]; incompleteRefs: string[] } {
  const byItem = new Map(entries.map((e) => [e.agendaItemId, e]));
  const missingItemNumbers: number[] = [];
  const incompleteRefs: string[] = [];
  for (const item of items) {
    const entry = byItem.get(item.id);
    if (!entry) {
      missingItemNumbers.push(item.itemNumber);
      continue;
    }
    if (checkMinute(entry, item, meeting).incomplete) incompleteRefs.push(entry.ref);
  }
  return {
    ready: missingItemNumbers.length === 0 && incompleteRefs.length === 0,
    missingItemNumbers,
    incompleteRefs,
  };
}

/** Normalise an input into the shape the repository stores, minus id/ref. */
export function normaliseMinuteInput(input: MinuteEntryInput) {
  return {
    discussion: input.discussion ?? "",
    motion: input.motion ?? null,
    recusals: input.recusals ?? [],
    closed: input.closed ?? false,
    draft: input.draft ?? false,
    source: input.source ?? ("SECRETARY" as const),
    flags: input.flags ?? [],
  };
}
