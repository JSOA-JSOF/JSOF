/**
 * The reads and writes this module needs, plus an in-memory implementation
 * backed by seed data. The D1 implementation of the same interface is in
 * `repository.d1.ts`; `meetingsRepository()` at the bottom of this file picks
 * between them on whether a binding exists.
 *
 * Every method returns a Promise, including the ones the in-memory
 * implementation answers synchronously. That is not decoration: D1 is async,
 * and an interface with eleven synchronous reads on it cannot be implemented
 * against a database without changing every caller anyway. Paying it once here
 * is cheaper than discovering it per method.
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
import { database } from "../db";
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
  listMeetings(entity?: Entity): Promise<Meeting[]>;
  /** Meetings sharing a calendar date, keyed by date, to show the separation. */
  listSameDayPairs(): Promise<{ date: string; meetings: Meeting[] }[]>;
  getMeeting(id: string): Promise<Meeting | null>;
  listAgendaItems(meetingId: string): Promise<AgendaItem[]>;
  listMinutes(meetingId: string): Promise<MinuteEntry[]>;
  getMinuteByRef(ref: string): Promise<MinuteEntry | null>;
  listDecisions(entity?: Entity): Promise<DecisionRecord[]>;
  listComplianceItems(entity?: Entity): Promise<ComplianceItem[]>;

  /* writes */
  saveAgendaItem(input: AgendaItemInput): Promise<AgendaItem>;
  removeAgendaItem(meetingId: string, itemId: string): Promise<AgendaItem[]>;
  reorderAgenda(meetingId: string, orderedItemIds: string[]): Promise<AgendaItem[]>;
  adoptAgenda(meetingId: string, at: string): Promise<Meeting>;
  markNoticeSent(meetingId: string, at: string): Promise<Meeting>;
  setMeetingStatus(meetingId: string, status: MeetingStatus): Promise<Meeting>;
  setAttendance(
    meetingId: string,
    personId: string,
    present: boolean,
  ): Promise<Meeting>;
  saveMinute(input: MinuteEntryInput): Promise<MinuteEntry>;
  /** Replaces every transcript-sourced draft for a meeting. Never touches a human minute. */
  replaceTranscriptDrafts(
    meetingId: string,
    inputs: MinuteEntryInput[],
  ): Promise<MinuteEntry[]>;
  setComplianceStatus(itemId: string, status: FilingStatus): Promise<ComplianceItem>;
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
    async listMeetings(entity) {
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

    async listSameDayPairs() {
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

    async getMeeting(id) {
      const meeting = meetings.get(id);
      return meeting ? clone(meeting) : null;
    },

    async listAgendaItems(meetingId) {
      return byPosition(itemsOf(meetingId)).map(clone);
    },

    async listMinutes(meetingId) {
      const order = new Map(itemsOf(meetingId).map((i) => [i.id, i.position]));
      return minutes
        .filter((entry) => entry.meetingId === meetingId)
        .sort(
          (a, b) =>
            (order.get(a.agendaItemId) ?? 999) - (order.get(b.agendaItemId) ?? 999),
        )
        .map(clone);
    },

    async getMinuteByRef(ref) {
      const found = minutes.find((entry) => entry.ref === ref);
      return found ? clone(found) : null;
    },

    async listDecisions(entity) {
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

    async listComplianceItems(entity) {
      return compliance
        .filter((item) => (entity ? item.entity === entity : true))
        .map(clone);
    },

    async saveAgendaItem(input) {
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

    async removeAgendaItem(meetingId, itemId) {
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

    async reorderAgenda(meetingId, orderedItemIds) {
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

    async adoptAgenda(meetingId, at) {
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

    async markNoticeSent(meetingId, at) {
      const meeting = requireMeeting(meetingId);
      meeting.noticeSentAt = at;
      if (meeting.status === "DRAFT") meeting.status = "NOTICED";
      return clone(meeting);
    },

    async setMeetingStatus(meetingId, status) {
      const meeting = requireMeeting(meetingId);
      meeting.status = status;
      return clone(meeting);
    },

    async setAttendance(meetingId, personId, present) {
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

    async saveMinute(input) {
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
    async replaceTranscriptDrafts(meetingId, inputs) {
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
            await api.saveMinute({
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

    async setComplianceStatus(itemId, status) {
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
 * Which implementation this process is holding.
 *
 * D1 where there is a binding, the in-memory one where there is not. No
 * binding is a normal state and not an error — `next dev` with no Worker
 * behind it, a build, and the test runner are all cases of it — which is why
 * `database()` returns null rather than throwing and why the in-memory
 * implementation stays in the build.
 *
 * The D1 implementation loads with `import()` rather than at the top of this
 * file. That keeps `repository.d1.ts` and everything it pulls in out of the
 * module graph on the path that has no database, which is the path the test
 * suite and a build both take. `database()` itself is a static import: it is
 * the shared layer's job to answer this question and it already returns null
 * rather than throwing when there is no context.
 *
 * The in-memory implementation is held on `globalThis` so the demo keeps edits
 * between requests. The D1 one holds no state of its own, so it is built per
 * call; nothing outside this file knows which one it has.
 */
const globalForRepository = globalThis as unknown as {
  __jsoaMeetingsRepository?: MeetingsRepository;
};

export async function meetingsRepository(): Promise<MeetingsRepository> {
  if (database()) {
    const { createD1MeetingsRepository } = await import("./repository.d1");
    return createD1MeetingsRepository();
  }
  globalForRepository.__jsoaMeetingsRepository ??= createInMemoryMeetingsRepository();
  return globalForRepository.__jsoaMeetingsRepository;
}
