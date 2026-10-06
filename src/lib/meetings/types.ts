/**
 * Secretary module domain types.
 *
 * The governing constraint for this whole module: JSOA and JSOF are separate
 * legal entities that meet on the same evening with the same people. Separate
 * minute books are the cheapest available evidence that the separation is real.
 * So every record here carries `entity`, and a minute entry whose entity is
 * missing is not a draft to be fixed later — it is unsaveable. See
 * `validateMinute` in `minutes.ts`.
 */

import type { Entity, Role } from "../authz/model";

/* ------------------------------------------------------------------ *
 * Meetings
 * ------------------------------------------------------------------ */

export const MEETING_STATUSES = [
  /** Agenda is being built. Items may be added, removed and reordered. */
  "DRAFT",
  /** Agenda adopted and notice sent. Item numbers are frozen from here. */
  "NOTICED",
  "IN_SESSION",
  "MINUTES_DRAFT",
  "MINUTES_ADOPTED",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export type Attendee = {
  personId: string;
  displayName: string;
  /** The office this person holds on THIS entity. */
  role: Role;
  present: boolean;
  /** Chairs the meeting. Exactly one per meeting. */
  presiding?: boolean;
};

export type Meeting = {
  id: string;
  entity: Entity;
  title: string;
  /** ISO 8601, UTC. Rendered in America/New_York. */
  scheduledStart: string;
  /** Scheduled length of the meeting in minutes. The agenda is measured against this. */
  scheduledMinutes: number;
  location: string;
  /**
   * Which meeting of this entity this is within the calendar month. 1 is the
   * regular monthly meeting. Anything above 1 gets a session suffix in the
   * minute reference so references stay unique. See `reference.ts`.
   */
  session: number;
  status: MeetingStatus;
  /** Quorum required, as a head count of voting members. */
  quorum: number;
  attendees: Attendee[];
  /** Set when the agenda is adopted. Item numbers are immutable after this. */
  agendaAdoptedAt: string | null;
  /** Set when the notice and agenda went out. */
  noticeSentAt: string | null;
};

/* ------------------------------------------------------------------ *
 * Agenda
 * ------------------------------------------------------------------ */

export const AGENDA_ITEM_TYPES = ["DECISION", "DISCUSSION", "INFORMATION"] as const;
export type AgendaItemType = (typeof AGENDA_ITEM_TYPES)[number];

export const AGENDA_ITEM_TYPE_LABELS: Record<AgendaItemType, string> = {
  DECISION: "Decision",
  DISCUSSION: "Discussion",
  INFORMATION: "Request for information",
};

export const AGENDA_ITEM_TYPE_NOTES: Record<AgendaItemType, string> = {
  DECISION:
    "Closes with a motion, a mover, a seconder and a recorded vote. A decision item that closes with no motion is an incomplete minute.",
  DISCUSSION: "No motion expected. What was said is recorded; nothing is resolved.",
  INFORMATION:
    "The board is asking for something to be produced. Record who was asked and by when.",
};

export type AgendaItem = {
  id: string;
  meetingId: string;
  /** Denormalised from the meeting and checked on every write. */
  entity: Entity;
  /**
   * Display order, 1-based and contiguous. Changes when items are reordered.
   * NOT the minute reference number.
   */
  position: number;
  /**
   * The number this item carries in the minute book. Tracks `position` while
   * the meeting is DRAFT and is frozen when the agenda is adopted, because the
   * treasury module's inter-entity transfers point at
   * `JSOA-2026-10-min-4` and that reference must not move under them.
   */
  itemNumber: number;
  title: string;
  /** Owner is a role, never a person. Consistent with contact-by-function. */
  ownerRole: Role;
  estimatedMinutes: number;
  type: AgendaItemType;
  /** Optional context circulated with the agenda. */
  note?: string;
  /**
   * Extra terms the transcript parser should match for this item, on top of
   * the tokens it derives from the title. Secretary-maintained.
   */
  keywords?: string[];
};

export type AgendaItemInput = {
  id?: string;
  meetingId: string;
  title: string;
  ownerRole: Role;
  estimatedMinutes: number;
  type: AgendaItemType;
  note?: string;
  keywords?: string[];
};

/* ------------------------------------------------------------------ *
 * Minutes
 * ------------------------------------------------------------------ */

export type VoteTally = {
  for: number;
  against: number;
  abstain: number;
};

export const MOTION_OUTCOMES = ["CARRIED", "FAILED", "TABLED", "WITHDRAWN"] as const;
export type MotionOutcome = (typeof MOTION_OUTCOMES)[number];

export type Motion = {
  /** The motion as moved, in the mover's words where possible. */
  text: string;
  movedByPersonId: string;
  movedByName: string;
  /** A motion with no seconder did not reach the floor. Empty is invalid. */
  secondedByPersonId: string;
  secondedByName: string;
  tally: VoteTally | null;
  outcome: MotionOutcome;
};

/**
 * Why someone stood out of a vote. First-class and enumerated, because two
 * separate controls depend on recusals being provable rather than remembered:
 * the scholarship conflict rule (no reviewer related to an applicant) and the
 * inter-entity transfer rule (the President is recused on the receiving side).
 */
export const RECUSAL_BASES = [
  "SCHOLARSHIP_CONFLICT",
  "INTER_ENTITY_TRANSFER",
  "RELATED_PARTY",
  "FINANCIAL_INTEREST",
  "EMPLOYMENT",
  "OTHER",
] as const;
export type RecusalBasis = (typeof RECUSAL_BASES)[number];

export const RECUSAL_BASIS_LABELS: Record<RecusalBasis, string> = {
  SCHOLARSHIP_CONFLICT: "Related to a scholarship applicant",
  INTER_ENTITY_TRANSFER: "Sits on both sides of an inter-entity transfer",
  RELATED_PARTY: "Related party to the matter",
  FINANCIAL_INTEREST: "Financial interest in the matter",
  EMPLOYMENT: "Employment or business relationship",
  OTHER: "Other, stated in the reason",
};

export type Recusal = {
  personId: string;
  displayName: string;
  basis: RecusalBasis;
  /** Required, non-empty. A recusal with no stated reason is not provable. */
  reason: string;
  /** True when the person left the room rather than merely abstaining. */
  withdrewFromRoom: boolean;
};

export type MinuteSource = "SECRETARY" | "TRANSCRIPT_DRAFT";

export type MinuteEntry = {
  id: string;
  meetingId: string;
  /**
   * Never optional in a saved record. The input type below allows it to be
   * absent so that the refusal can be tested; the repository refuses the save.
   */
  entity: Entity;
  agendaItemId: string;
  itemNumber: number;
  /** Stable reference, e.g. `JSOA-2026-10-min-4`. See `reference.ts`. */
  ref: string;
  /** What was discussed. Verbatim or Secretary-written; never machine-paraphrased. */
  discussion: string;
  motion: Motion | null;
  recusals: Recusal[];
  /** The Secretary has closed this item. Validation tightens once closed. */
  closed: boolean;
  /**
   * True while the entry came from the transcript parser and no human has
   * signed off on it. A draft entry is never a minute of record.
   */
  draft: boolean;
  source: MinuteSource;
  /** Parser notes, unresolved questions, anything the Secretary must settle. */
  flags: string[];
};

/**
 * What a caller may hand to `saveMinute`. `entity` is deliberately optional so
 * the missing-entity case is expressible, reachable and testable.
 */
export type MinuteEntryInput = {
  id?: string;
  meetingId: string;
  entity?: Entity | null;
  agendaItemId: string;
  discussion: string;
  motion?: Motion | null;
  recusals?: Recusal[];
  closed?: boolean;
  draft?: boolean;
  source?: MinuteSource;
  flags?: string[];
};

/* ------------------------------------------------------------------ *
 * Decision and action register
 * ------------------------------------------------------------------ */

export type DecisionRecord = {
  /** `JSOA-2026-10-min-4`. What the treasury module stores as `minuteRefFrom`/`minuteRefTo`. */
  ref: string;
  entity: Entity;
  meetingId: string;
  meetingTitle: string;
  /** ISO 8601, UTC, the meeting's scheduled start. */
  date: string;
  itemNumber: number;
  itemTitle: string;
  itemType: AgendaItemType;
  motion: Motion;
  recusals: Recusal[];
  /** True while the underlying minute is an unreviewed transcript draft. */
  provisional: boolean;
};

/* ------------------------------------------------------------------ *
 * Compliance calendar
 * ------------------------------------------------------------------ */

export const FILING_KINDS = [
  "IRS",
  "STATE_CORPORATE",
  "STATE_CHARITABLE",
  "INSURANCE",
  "INFRASTRUCTURE",
] as const;
export type FilingKind = (typeof FILING_KINDS)[number];

export const FILING_STATUSES = ["OPEN", "IN_PROGRESS", "FILED", "BLOCKED"] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];

export type ComplianceItem = {
  id: string;
  entity: Entity;
  kind: FilingKind;
  title: string;
  /** ISO date, no time. Filing deadlines are dates, not instants. */
  dueDate: string;
  /** Who is accountable. A role, never a person: offices turn over, duties do not. */
  ownerRole: Role;
  /** Where the filed confirmation lives. An unfiled confirmation is an unmet duty. */
  confirmationStore: string;
  status: FilingStatus;
  /** How often this recurs, in plain words. */
  cadence: string;
  /**
   * False when the obligation does not renew itself and nobody will remind
   * you. The NC charitable solicitation licence is the reason this field
   * exists.
   */
  selfDeclaring: boolean;
  /**
   * False when the obligation itself is not confirmed. An unverified item is
   * rendered as unverified and is never presented to the board as fact.
   */
  verified: boolean;
  /** Where the duty comes from, or why it is not yet confirmed. */
  sourceNote: string;
  /** True when the underlying cost or asset is shared by both entities. */
  sharedInfrastructure?: boolean;
};

/* ------------------------------------------------------------------ *
 * Agenda distribution
 * ------------------------------------------------------------------ */

export type AgendaDistribution = {
  meetingId: string;
  entity: Entity;
  subject: string;
  /** Roles the notice goes to. The stub resolves no addresses. */
  recipientRoles: Role[];
  plainText: string;
  html: string;
  /** Hours between now and the meeting, as computed when the payload was built. */
  noticeHours: number;
  /** Hours required by the bylaws for this meeting class. */
  noticeRequiredHours: number;
  noticeSatisfied: boolean;
  /** Always true for now. Resend is not wired. */
  stubbed: true;
};
