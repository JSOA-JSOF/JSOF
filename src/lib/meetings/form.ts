/**
 * Reading a minute out of a posted form.
 *
 * This lives apart from `actions.ts` so it can be tested. `actions.ts` is a
 * `"use server"` module that imports `next/cache`, so nothing in it is
 * reachable from a node test, and the field names here have to agree exactly
 * with the ones in `MinuteEditor.tsx` or a recusal ends up attached to the
 * wrong person. That is worth a test rather than a careful read.
 *
 * The recusal fields post as parallel lists, one entry per row. That is only
 * safe while every field in a row always posts. A checkbox does not: an
 * unchecked box sends nothing, which would shorten one list and silently shift
 * every reason onto the wrong board member. So `withdrewFromRoom` is carried by
 * a hidden input driven by React state rather than by the checkbox the
 * Secretary actually clicks, and `assertAlignedRows` refuses the parse if the
 * lists ever disagree. Misattributing a recusal is the one failure in this
 * module that would be worse than an error message.
 */

import type {
  Motion,
  MotionOutcome,
  Recusal,
  RecusalBasis,
  VoteTally,
} from "./types";
import { MOTION_OUTCOMES, RECUSAL_BASES } from "./types";

export class FormShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormShapeError";
  }
}

/** The field names, in one place, so the form and the parser cannot drift. */
export const MINUTE_FIELDS = {
  meetingId: "meetingId",
  minuteId: "minuteId",
  entity: "entity",
  agendaItemId: "agendaItemId",
  discussion: "discussion",
  closed: "closed",
  motionText: "motionText",
  movedByPersonId: "movedByPersonId",
  movedByName: "movedByName",
  secondedByPersonId: "secondedByPersonId",
  secondedByName: "secondedByName",
  tallyGiven: "tallyGiven",
  voteFor: "voteFor",
  voteAgainst: "voteAgainst",
  voteAbstain: "voteAbstain",
  outcome: "outcome",
  recusalPersonId: "recusalPersonId",
  recusalDisplayName: "recusalDisplayName",
  recusalBasis: "recusalBasis",
  recusalReason: "recusalReason",
  recusalWithdrew: "recusalWithdrew",
} as const;

const RECUSAL_ROW_FIELDS = [
  MINUTE_FIELDS.recusalPersonId,
  MINUTE_FIELDS.recusalDisplayName,
  MINUTE_FIELDS.recusalBasis,
  MINUTE_FIELDS.recusalReason,
  MINUTE_FIELDS.recusalWithdrew,
] as const;

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/** A checkbox posts its value when checked and nothing at all when not. */
function checked(formData: FormData, field: string): boolean {
  return formData.get(field) !== null;
}

function count(formData: FormData, field: string): number {
  const raw = Number(formData.get(field) ?? 0);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

function outcomeOf(value: string): MotionOutcome {
  return (MOTION_OUTCOMES as readonly string[]).includes(value)
    ? (value as MotionOutcome)
    : "CARRIED";
}

function basisOf(value: string): RecusalBasis {
  return (RECUSAL_BASES as readonly string[]).includes(value)
    ? (value as RecusalBasis)
    : "OTHER";
}

export function readTallyFromForm(formData: FormData): VoteTally | null {
  if (!checked(formData, MINUTE_FIELDS.tallyGiven)) return null;
  return {
    for: count(formData, MINUTE_FIELDS.voteFor),
    against: count(formData, MINUTE_FIELDS.voteAgainst),
    abstain: count(formData, MINUTE_FIELDS.voteAbstain),
  };
}

/**
 * No motion text means no motion. That is not the same as an incomplete
 * motion, and it is how the form says "nothing was moved under this item".
 */
export function readMotionFromForm(formData: FormData): Motion | null {
  const body = text(formData, MINUTE_FIELDS.motionText);
  if (body.length === 0) return null;
  return {
    text: body,
    movedByPersonId: text(formData, MINUTE_FIELDS.movedByPersonId),
    movedByName: text(formData, MINUTE_FIELDS.movedByName),
    secondedByPersonId: text(formData, MINUTE_FIELDS.secondedByPersonId),
    secondedByName: text(formData, MINUTE_FIELDS.secondedByName),
    tally: readTallyFromForm(formData),
    outcome: outcomeOf(text(formData, MINUTE_FIELDS.outcome)),
  };
}

/**
 * Refuses the parse rather than guessing when the parallel lists disagree.
 * See the note at the top of this file: a shifted list attaches a reason to
 * the wrong person, and this module's whole claim is that recusals are
 * provable.
 */
export function assertAlignedRows(formData: FormData): number {
  const lengths = RECUSAL_ROW_FIELDS.map((field) => ({
    field,
    length: formData.getAll(field).length,
  }));
  const expected = lengths[0].length;
  const mismatched = lengths.filter((entry) => entry.length !== expected);
  if (mismatched.length > 0) {
    throw new FormShapeError(
      `The recusal rows in this form do not line up: ` +
        lengths.map((entry) => `${entry.field}=${entry.length}`).join(", ") +
        `. A recusal could be attributed to the wrong person, so nothing was ` +
        `saved. Reload the minute and record the recusals again.`,
    );
  }
  return expected;
}

export function readRecusalsFromForm(formData: FormData): Recusal[] {
  const rows = assertAlignedRows(formData);
  const personIds = formData.getAll(MINUTE_FIELDS.recusalPersonId).map(String);
  const names = formData.getAll(MINUTE_FIELDS.recusalDisplayName).map(String);
  const bases = formData.getAll(MINUTE_FIELDS.recusalBasis).map(String);
  const reasons = formData.getAll(MINUTE_FIELDS.recusalReason).map(String);
  const withdrew = formData.getAll(MINUTE_FIELDS.recusalWithdrew).map(String);

  const out: Recusal[] = [];
  for (let index = 0; index < rows; index += 1) {
    const personId = personIds[index].trim();
    // An empty row is a row the Secretary added and did not fill in. Skipping
    // it does not shift the rows after it, because the loop is indexed.
    if (personId.length === 0) continue;
    out.push({
      personId,
      displayName: names[index].trim() || personId,
      basis: basisOf(bases[index].trim()),
      // Not trimmed away to nothing here: an empty reason has to reach
      // `assertRecusalsStated` so the refusal comes with its own message.
      reason: reasons[index].trim(),
      withdrewFromRoom: withdrew[index].trim() === "yes",
    });
  }
  return out;
}

export function readClosedFromForm(formData: FormData): boolean {
  return checked(formData, MINUTE_FIELDS.closed);
}

/**
 * The entity as the form declared it. `undefined` means the form carried no
 * entity field at all; `null` means it carried an empty one. Both have to
 * survive to the repository, because that is where the refusal lives and the
 * refusal is the point.
 */
export function readEntityFromForm(formData: FormData): string | null | undefined {
  if (!formData.has(MINUTE_FIELDS.entity)) return undefined;
  const value = text(formData, MINUTE_FIELDS.entity);
  return value.length === 0 ? null : value;
}
