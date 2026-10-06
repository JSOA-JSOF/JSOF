/**
 * The reads and writes this module needs, plus an in-memory implementation
 * backed by seed data. No database: persistence lands in a later pass, and
 * swapping to Prisma should be one new file implementing this interface.
 *
 * The repository is where the entity rule is enforced rather than merely
 * documented. `saveMinute` refuses a minute that does not name its entity and
 * refuses one that names the wrong entity for its meeting, so there is no path
 * through this interface that produces an unattributed minute.
 *
 * Authorization is NOT here. It belongs at the handler boundary, in
 * `access.ts`, called from the server actions in `actions.ts`. A repository
 * that also authorizes ends up with two half-answers about who may do what.
 */

import type { Entity } from "../authz/model";
import {
  AgendaError,
  assertAgendaEditable,
  byPosition,
  normalisePositions,
  validateAgendaItemInput,
} from "./agenda";
import {
  assertMinuteEntity,
  assertMotionWellFormed,
  assertRecusalsStated,
  normaliseMinuteInput,
} from "./minutes";
import { minuteRefForMeeting } from "./reference";
import {
  SEED_AGENDA_ITEMS,
  SEED_COMPLIANCE,
  SEED_MEETINGS,
  SEED_MINUTES,
} from "./seed";
import type {
  AgendaItem,
  AgendaItemInput,
  ComplianceItem,
  DecisionRecord,
  FilingStatus,
  Meeting,
  MeetingStatus,
  MinuteEntry,
  MinuteEntryInput,
} from "./types";

export interface MeetingsRepository {
  /* reads */
  listMeetings(entity?: Entity): Meeting[];
  /** Meetings sharing a calendar date, keyed by date, to show the separation. */
  listSameDayPairs(): { date: string; meetings: Meeting[] }[];
  getMeeting(id: string): Meeting | null;
  listAgendaItems(meetingId: string): AgendaItem[];
  listMinutes(meetingId: string): MinuteEntry[];
  getMinuteByRef(ref: string): MinuteEntry | null;
  listDecisions(entity?: Entity): DecisionRecord[];
  listComplianceItems(entity?: Entity): ComplianceItem[];

  /* writes */
  saveAgendaItem(input: AgendaItemInput): AgendaItem;
  removeAgendaItem(meetingId: string, itemId: string): AgendaItem[];
  reorderAgenda(meetingId: string, orderedItemIds: string[]): AgendaItem[];
  adoptAgenda(meetingId: string, at: string): Meeting;
  markNoticeSent(meetingId: string, at: string): Meeting;
  setMeetingStatus(meetingId: string, status: MeetingStatus): Meeting;
  setAttendance(meetingId: string, personId: string, present: boolean): Meeting;
  saveMinute(input: MinuteEntryInput): MinuteEntry;
  /** Replaces every transcript-sourced draft for a meeting. Never touches a human minute. */
  replaceTranscriptDrafts(meetingId: string, inputs: MinuteEntryInput[]): MinuteEntry[];
  setComplianceStatus(itemId: string, status: FilingStatus): ComplianceItem;
}

export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "CONFLICT",
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export type SeedBundle = {
  meetings: Meeting[];
  agendaItems: AgendaItem[];
  minutes: MinuteEntry[];
  compliance: ComplianceItem[];
};

export function defaultSeed(): SeedBundle {
  return clone({
    meetings: SEED_MEETINGS,
    agendaItems: SEED_AGENDA_ITEMS,
    minutes: SEED_MINUTES,
    compliance: SEED_COMPLIANCE,
  });
}

export function createInMemoryMeetingsRepository(
  seed: SeedBundle = defaultSeed(),
): MeetingsRepository {
  const meetings = new Map(seed.meetings.map((m) => [m.id, clone(m)]));
  const agendaItems = seed.agendaItems.map(clone);
  const minutes = seed.minutes.map(clone);
  const compliance = seed.compliance.map(clone);
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence}`;

  const requireMeeting = (id: string): Meeting => {
    const meeting = meetings.get(id);
    if (!meeting) throw new RepositoryError(`No meeting ${id}`, "NOT_FOUND");
    return meeting;
  };

  const itemsOf = (meetingId: string) =>
    agendaItems.filter((item) => item.meetingId === meetingId);

  const nextItemNumber = (meetingId: string) =>
    itemsOf(meetingId).reduce((max, item) => Math.max(max, item.itemNumber), 0) + 1;

  const api: MeetingsRepository = {
    listMeetings(entity) {
      return Array.from(meetings.values())
        .filter((m) => (entity ? m.entity === entity : true))
        .sort((a, b) =>
          a.scheduledStart === b.scheduledStart
            ? a.entity.localeCompare(b.entity)
            : a.scheduledStart < b.scheduledStart
              ? 1
              : -1,
        )
        .map(clone);
    },

    listSameDayPairs() {
      const byDate = new Map<string, Meeting[]>();
      for (const meeting of meetings.values()) {
        const date = meeting.scheduledStart.slice(0, 10);
        byDate.set(date, [...(byDate.get(date) ?? []), clone(meeting)]);
      }
      return Array.from(byDate.entries())
        .map(([date, list]) => ({
          date,
          meetings: list.sort((a, b) => (a.scheduledStart < b.scheduledStart ? -1 : 1)),
        }))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
    },

    getMeeting(id) {
      const meeting = meetings.get(id);
      return meeting ? clone(meeting) : null;
    },

    listAgendaItems(meetingId) {
      return byPosition(itemsOf(meetingId)).map(clone);
    },

    listMinutes(meetingId) {
      const order = new Map(itemsOf(meetingId).map((i) => [i.id, i.position]));
      return minutes
        .filter((entry) => entry.meetingId === meetingId)
        .sort(
          (a, b) =>
            (order.get(a.agendaItemId) ?? 999) - (order.get(b.agendaItemId) ?? 999),
        )
        .map(clone);
    },

    getMinuteByRef(ref) {
      const found = minutes.find((entry) => entry.ref === ref);
      return found ? clone(found) : null;
    },

    listDecisions(entity) {
      const records: DecisionRecord[] = [];
      for (const entry of minutes) {
        if (!entry.motion) continue;
        if (entity && entry.entity !== entity) continue;
        const meeting = meetings.get(entry.meetingId);
        const item = agendaItems.find((i) => i.id === entry.agendaItemId);
        if (!meeting || !item) continue;
        records.push(
          clone({
            ref: entry.ref,
            entity: entry.entity,
            meetingId: meeting.id,
            meetingTitle: meeting.title,
            date: meeting.scheduledStart,
            itemNumber: entry.itemNumber,
            itemTitle: item.title,
            itemType: item.type,
            motion: entry.motion,
            recusals: entry.recusals,
            provisional: entry.draft,
          }),
        );
      }
      return records.sort((a, b) =>
        a.date === b.date
          ? a.ref.localeCompare(b.ref)
          : a.date < b.date
            ? 1
            : -1,
      );
    },

    listComplianceItems(entity) {
      return compliance
        .filter((item) => (entity ? item.entity === entity : true))
        .map(clone);
    },

    saveAgendaItem(input) {
      const meeting = requireMeeting(input.meetingId);
      validateAgendaItemInput(input);
      const existing = input.id
        ? agendaItems.find((i) => i.id === input.id && i.meetingId === meeting.id)
        : undefined;

      if (!existing) assertAgendaEditable(meeting);

      if (existing) {
        // An adopted agenda may have its wording and estimates corrected. What
        // it may not have is its item numbers moved, because those are the
        // minute references the treasury module points at.
        existing.title = input.title.trim();
        existing.ownerRole = input.ownerRole;
        existing.estimatedMinutes = Math.round(input.estimatedMinutes);
        existing.type = input.type;
        existing.note = input.note?.trim() || undefined;
        existing.keywords = input.keywords?.filter((k) => k.trim().length > 0);
        return clone(existing);
      }

      const number = nextItemNumber(meeting.id);
      const created: AgendaItem = {
        id: nextId("i"),
        meetingId: meeting.id,
        entity: meeting.entity,
        position: itemsOf(meeting.id).length + 1,
        itemNumber: number,
        title: input.title.trim(),
        ownerRole: input.ownerRole,
        estimatedMinutes: Math.round(input.estimatedMinutes),
        type: input.type,
        note: input.note?.trim() || undefined,
        keywords: input.keywords?.filter((k) => k.trim().length > 0),
      };
      agendaItems.push(created);
      return clone(created);
    },

    removeAgendaItem(meetingId, itemId) {
      const meeting = requireMeeting(meetingId);
      assertAgendaEditable(meeting);
      const index = agendaItems.findIndex(
        (i) => i.id === itemId && i.meetingId === meetingId,
      );
      if (index === -1) throw new RepositoryError(`No agenda item ${itemId}`, "NOT_FOUND");
      if (minutes.some((entry) => entry.agendaItemId === itemId)) {
        throw new RepositoryError(
          "This item already has a minute against it. Remove the minute first, " +
            "or leave the item and record that it was not reached.",
          "CONFLICT",
        );
      }
      agendaItems.splice(index, 1);
      const renumbered = normalisePositions(itemsOf(meetingId));
      for (const item of renumbered) {
        const target = agendaItems.find((i) => i.id === item.id)!;
        target.position = item.position;
      }
      return byPosition(itemsOf(meetingId)).map(clone);
    },

    reorderAgenda(meetingId, orderedItemIds) {
      const meeting = requireMeeting(meetingId);
      assertAgendaEditable(meeting);
      const current = itemsOf(meetingId);
      const known = new Set(current.map((i) => i.id));
      const requested = orderedItemIds.filter((id) => known.has(id));
      if (requested.length !== current.length) {
        throw new AgendaError(
          "The reorder does not list every item on the agenda exactly once.",
          "BAD_INPUT",
        );
      }
      requested.forEach((id, index) => {
        const item = agendaItems.find((i) => i.id === id)!;
        item.position = index + 1;
      });
      return byPosition(itemsOf(meetingId)).map(clone);
    },

    adoptAgenda(meetingId, at) {
      const meeting = requireMeeting(meetingId);
      // Freezing renumbers item numbers to match the final adopted order, once,
      // and then they never move again.
      for (const item of byPosition(itemsOf(meetingId))) {
        const target = agendaItems.find((i) => i.id === item.id)!;
        target.itemNumber = item.position;
      }
      meeting.agendaAdoptedAt = at;
      if (meeting.status === "DRAFT") meeting.status = "NOTICED";
      // Any minute already written against these items takes the new reference.
      for (const entry of minutes.filter((e) => e.meetingId === meetingId)) {
        const item = agendaItems.find((i) => i.id === entry.agendaItemId);
        if (!item) continue;
        entry.itemNumber = item.itemNumber;
        entry.ref = minuteRefForMeeting(meeting, item.itemNumber);
      }
      return clone(meeting);
    },

    markNoticeSent(meetingId, at) {
      const meeting = requireMeeting(meetingId);
      meeting.noticeSentAt = at;
      if (meeting.status === "DRAFT") meeting.status = "NOTICED";
      return clone(meeting);
    },

    setMeetingStatus(meetingId, status) {
      const meeting = requireMeeting(meetingId);
      meeting.status = status;
      return clone(meeting);
    },

    setAttendance(meetingId, personId, present) {
      const meeting = requireMeeting(meetingId);
      const attendee = meeting.attendees.find((a) => a.personId === personId);
      if (!attendee) {
        throw new RepositoryError(
          `${personId} is not on the attendee list for this meeting`,
          "NOT_FOUND",
        );
      }
      attendee.present = present;
      return clone(meeting);
    },

    saveMinute(input) {
      const meeting = requireMeeting(input.meetingId);

      // The refusal. A minute that does not name its entity is not saveable,
      // and one that names the other entity is not filed in this book.
      const entity = assertMinuteEntity(input.entity, meeting);

      const item = agendaItems.find(
        (i) => i.id === input.agendaItemId && i.meetingId === meeting.id,
      );
      if (!item) {
        throw new RepositoryError(
          `Agenda item ${input.agendaItemId} is not on the ${meeting.entity} agenda ` +
            `for ${meeting.title}. A minute is filed against an item of the board ` +
            `that was in session.`,
          "NOT_FOUND",
        );
      }

      const normalised = normaliseMinuteInput(input);
      assertRecusalsStated(normalised.recusals);
      assertMotionWellFormed(normalised.motion);

      const existing = input.id
        ? minutes.find((e) => e.id === input.id)
        : minutes.find(
            (e) => e.meetingId === meeting.id && e.agendaItemId === item.id,
          );

      const ref = minuteRefForMeeting(meeting, item.itemNumber);

      if (existing) {
        Object.assign(existing, {
          entity,
          agendaItemId: item.id,
          itemNumber: item.itemNumber,
          ref,
          ...normalised,
        });
        return clone(existing);
      }

      const created: MinuteEntry = {
        id: nextId("min"),
        meetingId: meeting.id,
        entity,
        agendaItemId: item.id,
        itemNumber: item.itemNumber,
        ref,
        ...normalised,
      };
      minutes.push(created);
      return clone(created);
    },

    /**
     * All or nothing. This clears the previous drafts and writes the new ones,
     * and if any single input is refused it puts the previous drafts back and
     * rethrows. Without that, one bad section leaves the meeting with its old
     * drafts deleted and half a new set written, which is a worse state than
     * either the before or the after.
     */
    replaceTranscriptDrafts(meetingId, inputs) {
      const meeting = requireMeeting(meetingId);
      const snapshot = minutes.map(clone);

      try {
        for (let index = minutes.length - 1; index >= 0; index -= 1) {
          const entry = minutes[index];
          if (entry.meetingId === meetingId && entry.source === "TRANSCRIPT_DRAFT") {
            minutes.splice(index, 1);
          }
        }
        const written: MinuteEntry[] = [];
        for (const input of inputs) {
          // A transcript draft never overwrites a minute the Secretary wrote.
          const humanExists = minutes.some(
            (e) =>
              e.meetingId === meetingId &&
              e.agendaItemId === input.agendaItemId &&
              e.source === "SECRETARY",
          );
          if (humanExists) continue;
          written.push(
            api.saveMinute({
              ...input,
              id: undefined,
              meetingId,
              entity: meeting.entity,
              draft: true,
              source: "TRANSCRIPT_DRAFT",
            }),
          );
        }
        if (meeting.status === "IN_SESSION" || meeting.status === "NOTICED") {
          meeting.status = "MINUTES_DRAFT";
        }
        return written;
      } catch (error) {
        minutes.length = 0;
        minutes.push(...snapshot);
        throw error;
      }
    },

    setComplianceStatus(itemId, status) {
      const item = compliance.find((c) => c.id === itemId);
      if (!item) throw new RepositoryError(`No compliance item ${itemId}`, "NOT_FOUND");
      if (!item.verified && status === "FILED") {
        throw new RepositoryError(
          "This obligation is not confirmed to exist, so it cannot be marked filed. " +
            "Confirm the duty first and replace the entry.",
          "CONFLICT",
        );
      }
      item.status = status;
      return clone(item);
    },
  };

  return api;
}

/**
 * One in-memory repository for the running process, so the demo keeps edits
 * between requests without a database. Replaced by a Prisma-backed
 * implementation in a later pass; nothing outside this file knows which one it
 * is holding.
 */
const globalForRepository = globalThis as unknown as {
  __jsoaMeetingsRepository?: MeetingsRepository;
};

export function meetingsRepository(): MeetingsRepository {
  globalForRepository.__jsoaMeetingsRepository ??= createInMemoryMeetingsRepository();
  return globalForRepository.__jsoaMeetingsRepository;
}
