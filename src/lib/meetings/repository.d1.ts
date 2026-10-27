import "server-only";

/**
 * `MeetingsRepository` against D1. Same interface, same refusals, same
 * messages; the behaviour that differs does so because the schema enforces
 * something the in-memory implementation cannot.
 *
 * Read `migrations/0005_meetings.sql` alongside this file. Four of its
 * decisions shape the code here and none of them are worked around:
 *
 * 1. **Approved minutes cannot be edited or deleted.** Two triggers:
 *    `minute_entry_no_edit_once_approved` aborts any UPDATE whose existing row
 *    has `draft = 0`, and `minute_entry_no_delete` aborts every DELETE. So
 *    `adoptAgenda` only issues an UPDATE for a minute whose reference actually
 *    moves — re-adopting an agenda that did not renumber touches nothing — and
 *    if an approved minute's reference would move, the write aborts. That is
 *    the correct outcome: a correction to the record is a new entry at the next
 *    meeting citing the old one, which is what the trigger says.
 *
 * 2. **A minute entry is never deleted**, which `replaceTranscriptDrafts`
 *    collides with. See the long note on that method: it upserts, and refuses
 *    loudly rather than quietly leaving a stale draft behind.
 *
 * 3. **Attendee `display_name` and `role` are copied, not joined.** Nothing
 *    here reads them from an identity table. Who attended under what title is
 *    a fact about that evening and an officer who changes role later must not
 *    silently change what the minutes say they were.
 *
 * 4. **`UNIQUE (entity, ref)`.** Renumbering an agenda can swap two
 *    references, and a direct swap would collide halfway through. So
 *    `adoptAgenda` parks the affected rows on a temporary reference first and
 *    writes the final one second, both inside the one batch.
 *
 * Objects that span tables — a meeting and its attendees, a minute entry and
 * its recusals and flags, an agenda item and its keywords — are written with
 * `atomic`, never as separate awaits. The agenda item whose keywords failed to
 * land is the bug that nothing ever reports.
 */

import {
  atomic,
  int,
  many,
  newId,
  nextInSequence,
  one,
  requireDatabase,
  text,
  toBool,
  toInt,
} from "../db";
import type { Entity, Role } from "../authz/model";
import {
  AgendaError,
  assertAgendaEditable,
  byPosition,
  validateAgendaItemInput,
} from "./agenda";
import {
  assertMinuteEntity,
  assertMotionWellFormed,
  assertRecusalsStated,
  normaliseMinuteInput,
} from "./minutes";
import { minuteRefForMeeting } from "./reference";
import { RepositoryError, type MeetingsRepository } from "./repository";
import type {
  AgendaItem,
  AgendaItemType,
  Attendee,
  ComplianceItem,
  DecisionRecord,
  FilingKind,
  FilingStatus,
  Meeting,
  MeetingStatus,
  MinuteEntry,
  MinuteEntryInput,
  MinuteSource,
  Motion,
  Recusal,
  RecusalBasis,
} from "./types";

/* ------------------------------------------------------------------ *
 * Rows, and the shapes they become
 * ------------------------------------------------------------------ */

type MeetingRow = {
  id: string;
  entity: string;
  title: string;
  scheduled_start: string;
  scheduled_minutes: number;
  location: string;
  session: number;
  status: string;
  quorum: number;
  agenda_adopted_at: string | null;
  notice_sent_at: string | null;
};

type AttendeeRow = {
  meeting_id: string;
  person_id: string;
  display_name: string;
  role: string;
  present: number;
  presiding: number;
};

type AgendaItemRow = {
  id: string;
  meeting_id: string;
  entity: string;
  position: number;
  item_number: number;
  title: string;
  owner_role: string;
  estimated_minutes: number;
  type: string;
  note: string | null;
};

type MinuteRow = {
  id: string;
  meeting_id: string;
  entity: string;
  agenda_item_id: string;
  item_number: number;
  ref: string;
  discussion: string;
  motion_text: string | null;
  moved_by_person_id: string | null;
  moved_by_name: string | null;
  seconded_by_person_id: string | null;
  seconded_by_name: string | null;
  votes_for: number | null;
  votes_against: number | null;
  votes_abstain: number | null;
  motion_outcome: string | null;
  closed: number;
  draft: number;
  source: string;
};

type RecusalRow = {
  minute_entry_id: string;
  person_id: string;
  display_name: string;
  basis: string;
  reason: string;
  withdrew_from_room: number;
};

type ComplianceRow = {
  id: string;
  entity: string;
  kind: string;
  title: string;
  due_date: string;
  owner_role: string;
  confirmation_store: string;
  status: string;
  cadence: string;
  self_declaring: number;
  verified: number;
  source_note: string;
  shared_infrastructure: number;
};

const MEETING_COLUMNS =
  "id, entity, title, scheduled_start, scheduled_minutes, location, session, " +
  "status, quorum, agenda_adopted_at, notice_sent_at";

const AGENDA_COLUMNS =
  "id, meeting_id, entity, position, item_number, title, owner_role, " +
  "estimated_minutes, type, note";

const MINUTE_COLUMNS =
  "id, meeting_id, entity, agenda_item_id, item_number, ref, discussion, " +
  "motion_text, moved_by_person_id, moved_by_name, seconded_by_person_id, " +
  "seconded_by_name, votes_for, votes_against, votes_abstain, motion_outcome, " +
  "closed, draft, source";

const COMPLIANCE_COLUMNS =
  "id, entity, kind, title, due_date, owner_role, confirmation_store, status, " +
  "cadence, self_declaring, verified, source_note, shared_infrastructure";

function toAttendee(row: AttendeeRow): Attendee {
  return {
    personId: text(row.person_id),
    // Copied columns, read back as copies. Nothing here joins to a person.
    displayName: text(row.display_name),
    role: text(row.role) as Role,
    present: toBool(row.present),
    ...(toBool(row.presiding) ? { presiding: true } : {}),
  };
}

function toMeeting(row: MeetingRow, attendees: Attendee[]): Meeting {
  return {
    id: text(row.id),
    entity: text(row.entity) as Entity,
    title: text(row.title),
    scheduledStart: text(row.scheduled_start),
    scheduledMinutes: int(row.scheduled_minutes),
    location: text(row.location),
    session: int(row.session),
    status: text(row.status) as MeetingStatus,
    quorum: int(row.quorum),
    attendees,
    agendaAdoptedAt: row.agenda_adopted_at ?? null,
    noticeSentAt: row.notice_sent_at ?? null,
  };
}

function toAgendaItem(row: AgendaItemRow, keywords: string[]): AgendaItem {
  return {
    id: text(row.id),
    meetingId: text(row.meeting_id),
    entity: text(row.entity) as Entity,
    position: int(row.position),
    itemNumber: int(row.item_number),
    title: text(row.title),
    ownerRole: text(row.owner_role) as Role,
    estimatedMinutes: int(row.estimated_minutes),
    type: text(row.type) as AgendaItemType,
    // `note` and `keywords` are optional on the domain type rather than
    // nullable, so an absent one is absent and not an empty string.
    ...(row.note ? { note: row.note } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
  };
}

/**
 * The motion, inline on the row.
 *
 * A row carries a motion when `motion_text` is set; everything else about it
 * is part of the same motion or is not there. The tally is separately nullable
 * because a motion withdrawn before the vote has a mover, a seconder and no
 * numbers.
 */
function toMotion(row: MinuteRow): Motion | null {
  if (row.motion_text === null) return null;
  const hasTally =
    row.votes_for !== null || row.votes_against !== null || row.votes_abstain !== null;
  return {
    text: text(row.motion_text),
    movedByPersonId: text(row.moved_by_person_id),
    movedByName: text(row.moved_by_name),
    secondedByPersonId: text(row.seconded_by_person_id),
    secondedByName: text(row.seconded_by_name),
    tally: hasTally
      ? {
          for: int(row.votes_for),
          against: int(row.votes_against),
          abstain: int(row.votes_abstain),
        }
      : null,
    outcome: text(row.motion_outcome, "CARRIED") as Motion["outcome"],
  };
}

function toRecusal(row: RecusalRow): Recusal {
  return {
    personId: text(row.person_id),
    displayName: text(row.display_name),
    basis: text(row.basis) as RecusalBasis,
    reason: text(row.reason),
    withdrewFromRoom: toBool(row.withdrew_from_room),
  };
}

function toMinute(row: MinuteRow, recusals: Recusal[], flags: string[]): MinuteEntry {
  return {
    id: text(row.id),
    meetingId: text(row.meeting_id),
    entity: text(row.entity) as Entity,
    agendaItemId: text(row.agenda_item_id),
    itemNumber: int(row.item_number),
    ref: text(row.ref),
    discussion: text(row.discussion),
    motion: toMotion(row),
    recusals,
    closed: toBool(row.closed),
    draft: toBool(row.draft),
    source: text(row.source, "SECRETARY") as MinuteSource,
    flags,
  };
}

function toComplianceItem(row: ComplianceRow): ComplianceItem {
  return {
    id: text(row.id),
    entity: text(row.entity) as Entity,
    kind: text(row.kind) as FilingKind,
    title: text(row.title),
    dueDate: text(row.due_date),
    ownerRole: text(row.owner_role) as Role,
    confirmationStore: text(row.confirmation_store),
    status: text(row.status) as FilingStatus,
    cadence: text(row.cadence),
    selfDeclaring: toBool(row.self_declaring),
    verified: toBool(row.verified),
    sourceNote: text(row.source_note),
    ...(toBool(row.shared_infrastructure) ? { sharedInfrastructure: true } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * The implementation
 * ------------------------------------------------------------------ */

export function createD1MeetingsRepository(): MeetingsRepository {
  /** Attendees for a set of meetings, in one query rather than one per meeting. */
  async function attendeesFor(meetingIds: string[]): Promise<Map<string, Attendee[]>> {
    const byMeeting = new Map<string, Attendee[]>();
    for (const id of meetingIds) byMeeting.set(id, []);
    if (meetingIds.length === 0) return byMeeting;
    const holes = meetingIds.map(() => "?").join(", ");
    const rows = await many<AttendeeRow>(
      requireDatabase()
        .prepare(
          `SELECT meeting_id, person_id, display_name, role, present, presiding ` +
            `FROM meeting_attendee WHERE meeting_id IN (${holes}) ` +
            `ORDER BY meeting_id, display_name`,
        )
        .bind(...meetingIds),
    );
    for (const row of rows) {
      byMeeting.get(row.meeting_id)?.push(toAttendee(row));
    }
    return byMeeting;
  }

  async function hydrateMeetings(rows: MeetingRow[]): Promise<Meeting[]> {
    const attendees = await attendeesFor(rows.map((row) => row.id));
    return rows.map((row) => toMeeting(row, attendees.get(row.id) ?? []));
  }

  async function getMeetingRow(id: string): Promise<MeetingRow | null> {
    return one<MeetingRow>(
      requireDatabase()
        .prepare(`SELECT ${MEETING_COLUMNS} FROM meeting WHERE id = ?`)
        .bind(id),
    );
  }

  async function requireMeetingRow(id: string): Promise<MeetingRow> {
    const row = await getMeetingRow(id);
    if (!row) throw new RepositoryError(`No meeting ${id}`, "NOT_FOUND");
    return row;
  }

  async function keywordsFor(itemIds: string[]): Promise<Map<string, string[]>> {
    const byItem = new Map<string, string[]>();
    for (const id of itemIds) byItem.set(id, []);
    if (itemIds.length === 0) return byItem;
    const holes = itemIds.map(() => "?").join(", ");
    const rows = await many<{ agenda_item_id: string; keyword: string }>(
      requireDatabase()
        .prepare(
          `SELECT agenda_item_id, keyword FROM agenda_item_keyword ` +
            `WHERE agenda_item_id IN (${holes}) ORDER BY agenda_item_id, keyword`,
        )
        .bind(...itemIds),
    );
    for (const row of rows) byItem.get(row.agenda_item_id)?.push(row.keyword);
    return byItem;
  }

  async function hydrateAgendaItems(rows: AgendaItemRow[]): Promise<AgendaItem[]> {
    const keywords = await keywordsFor(rows.map((row) => row.id));
    return rows.map((row) => toAgendaItem(row, keywords.get(row.id) ?? []));
  }

  async function agendaRowsFor(meetingId: string): Promise<AgendaItemRow[]> {
    return many<AgendaItemRow>(
      requireDatabase()
        .prepare(
          `SELECT ${AGENDA_COLUMNS} FROM agenda_item WHERE meeting_id = ? ` +
            `ORDER BY position`,
        )
        .bind(meetingId),
    );
  }

  async function listAgendaItems(meetingId: string): Promise<AgendaItem[]> {
    return hydrateAgendaItems(await agendaRowsFor(meetingId));
  }

  async function recusalsFor(entryIds: string[]): Promise<Map<string, Recusal[]>> {
    const byEntry = new Map<string, Recusal[]>();
    for (const id of entryIds) byEntry.set(id, []);
    if (entryIds.length === 0) return byEntry;
    const holes = entryIds.map(() => "?").join(", ");
    const rows = await many<RecusalRow>(
      requireDatabase()
        .prepare(
          `SELECT minute_entry_id, person_id, display_name, basis, reason, ` +
            `withdrew_from_room FROM minute_recusal ` +
            `WHERE minute_entry_id IN (${holes}) ORDER BY minute_entry_id, display_name`,
        )
        .bind(...entryIds),
    );
    for (const row of rows) byEntry.get(row.minute_entry_id)?.push(toRecusal(row));
    return byEntry;
  }

  async function flagsFor(entryIds: string[]): Promise<Map<string, string[]>> {
    const byEntry = new Map<string, string[]>();
    for (const id of entryIds) byEntry.set(id, []);
    if (entryIds.length === 0) return byEntry;
    const holes = entryIds.map(() => "?").join(", ");
    const rows = await many<{ minute_entry_id: string; flag: string }>(
      requireDatabase()
        .prepare(
          `SELECT minute_entry_id, flag FROM minute_flag ` +
            `WHERE minute_entry_id IN (${holes}) ORDER BY minute_entry_id, flag`,
        )
        .bind(...entryIds),
    );
    for (const row of rows) byEntry.get(row.minute_entry_id)?.push(row.flag);
    return byEntry;
  }

  async function hydrateMinutes(rows: MinuteRow[]): Promise<MinuteEntry[]> {
    const ids = rows.map((row) => row.id);
    const [recusals, flags] = await Promise.all([recusalsFor(ids), flagsFor(ids)]);
    return rows.map((row) =>
      toMinute(row, recusals.get(row.id) ?? [], flags.get(row.id) ?? []),
    );
  }

  /**
   * The minute book for one meeting, in agenda order.
   *
   * Ordered by the agenda item's `position` rather than by the entry's own
   * `item_number`, which is what the in-memory implementation does: a book
   * reads in the order the evening ran, and an entry whose item has gone takes
   * the in-memory fallback position of 999, which `COALESCE` reproduces.
   */
  async function minuteRowsFor(meetingId: string): Promise<MinuteRow[]> {
    return many<MinuteRow>(
      requireDatabase()
        .prepare(
          `SELECT ${MINUTE_COLUMNS.split(", ")
            .map((column) => `m.${column}`)
            .join(", ")} FROM minute_entry m ` +
            `LEFT JOIN agenda_item a ON a.id = m.agenda_item_id ` +
            `WHERE m.meeting_id = ? ORDER BY COALESCE(a.position, 999), m.id`,
        )
        .bind(meetingId),
    );
  }

  /* --- Writes: statement builders ------------------------------------ *
   *
   * Each returns a statement rather than running one, so the caller can hand
   * the whole set to `atomic`. A parent written in one await and its children
   * in another is the shape that leaves half an object behind.
   */

  function insertAgendaItemStatements(item: AgendaItem): D1PreparedStatement[] {
    const db = requireDatabase();
    const statements = [
      db
        .prepare(
          `INSERT INTO agenda_item (${AGENDA_COLUMNS}) ` +
            `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          item.id,
          item.meetingId,
          item.entity,
          item.position,
          item.itemNumber,
          item.title,
          item.ownerRole,
          item.estimatedMinutes,
          item.type,
          item.note ?? null,
        ),
    ];
    for (const keyword of item.keywords ?? []) {
      statements.push(
        db
          .prepare(
            `INSERT INTO agenda_item_keyword (agenda_item_id, keyword) VALUES (?, ?) ` +
              `ON CONFLICT DO NOTHING`,
          )
          .bind(item.id, keyword),
      );
    }
    return statements;
  }

  /**
   * A minute entry and the two tables that hang off it.
   *
   * Recusals and flags are replaced wholesale rather than diffed, because the
   * input carries the complete set and a diff would need a notion of identity
   * these rows do not have. Deleting from `minute_recusal` and `minute_flag`
   * is allowed: the no-delete trigger is on `minute_entry` only, and
   * deliberately so — the record is the entry.
   */
  function minuteChildStatements(
    entryId: string,
    recusals: Recusal[],
    flags: string[],
  ): D1PreparedStatement[] {
    const db = requireDatabase();
    const statements = [
      db.prepare("DELETE FROM minute_recusal WHERE minute_entry_id = ?").bind(entryId),
      db.prepare("DELETE FROM minute_flag WHERE minute_entry_id = ?").bind(entryId),
    ];
    for (const recusal of recusals) {
      statements.push(
        db
          .prepare(
            `INSERT INTO minute_recusal (minute_entry_id, person_id, display_name, ` +
              `basis, reason, withdrew_from_room) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            entryId,
            recusal.personId,
            recusal.displayName,
            recusal.basis,
            recusal.reason,
            toInt(recusal.withdrewFromRoom),
          ),
      );
    }
    for (const flag of flags) {
      statements.push(
        db
          .prepare(
            `INSERT INTO minute_flag (minute_entry_id, flag) VALUES (?, ?) ` +
              `ON CONFLICT DO NOTHING`,
          )
          .bind(entryId, flag),
      );
    }
    return statements;
  }

  type MinuteFields = {
    entity: Entity;
    agendaItemId: string;
    itemNumber: number;
    ref: string;
    discussion: string;
    motion: Motion | null;
    closed: boolean;
    draft: boolean;
    source: MinuteSource;
  };

  function motionBindings(motion: Motion | null): unknown[] {
    return [
      motion?.text ?? null,
      motion?.movedByPersonId ?? null,
      motion?.movedByName ?? null,
      motion?.secondedByPersonId ?? null,
      motion?.secondedByName ?? null,
      motion?.tally?.for ?? null,
      motion?.tally?.against ?? null,
      motion?.tally?.abstain ?? null,
      motion?.outcome ?? null,
    ];
  }

  function insertMinuteStatement(
    id: string,
    meetingId: string,
    fields: MinuteFields,
  ): D1PreparedStatement {
    return requireDatabase()
      .prepare(
        `INSERT INTO minute_entry (${MINUTE_COLUMNS}) ` +
          `VALUES (${MINUTE_COLUMNS.split(", ")
            .map(() => "?")
            .join(", ")})`,
      )
      .bind(
        id,
        meetingId,
        fields.entity,
        fields.agendaItemId,
        fields.itemNumber,
        fields.ref,
        fields.discussion,
        ...motionBindings(fields.motion),
        toInt(fields.closed),
        toInt(fields.draft),
        fields.source,
      );
  }

  function updateMinuteStatement(id: string, fields: MinuteFields): D1PreparedStatement {
    return requireDatabase()
      .prepare(
        `UPDATE minute_entry SET entity = ?, agenda_item_id = ?, item_number = ?, ` +
          `ref = ?, discussion = ?, motion_text = ?, moved_by_person_id = ?, ` +
          `moved_by_name = ?, seconded_by_person_id = ?, seconded_by_name = ?, ` +
          `votes_for = ?, votes_against = ?, votes_abstain = ?, motion_outcome = ?, ` +
          `closed = ?, draft = ?, source = ? WHERE id = ?`,
      )
      .bind(
        fields.entity,
        fields.agendaItemId,
        fields.itemNumber,
        fields.ref,
        fields.discussion,
        ...motionBindings(fields.motion),
        toInt(fields.closed),
        toInt(fields.draft),
        fields.source,
        id,
      );
  }

  /**
   * The validation and reference work `saveMinute` and the transcript path
   * share, up to the point where one writes and the other batches.
   */
  async function prepareMinute(
    input: MinuteEntryInput,
    meetingRow: MeetingRow,
  ): Promise<{ fields: MinuteFields; recusals: Recusal[]; flags: string[] }> {
    const meeting = toMeeting(meetingRow, []);
    const entity = assertMinuteEntity(input.entity, meeting);

    const item = await one<AgendaItemRow>(
      requireDatabase()
        .prepare(
          `SELECT ${AGENDA_COLUMNS} FROM agenda_item WHERE id = ? AND meeting_id = ?`,
        )
        .bind(input.agendaItemId, meetingRow.id),
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

    return {
      fields: {
        entity,
        agendaItemId: item.id,
        itemNumber: int(item.item_number),
        ref: minuteRefForMeeting(meeting, int(item.item_number)),
        discussion: normalised.discussion,
        motion: normalised.motion,
        closed: normalised.closed,
        draft: normalised.draft,
        source: normalised.source,
      },
      recusals: normalised.recusals,
      flags: normalised.flags,
    };
  }

  async function minuteById(id: string): Promise<MinuteEntry> {
    const row = await one<MinuteRow>(
      requireDatabase()
        .prepare(`SELECT ${MINUTE_COLUMNS} FROM minute_entry WHERE id = ?`)
        .bind(id),
    );
    if (!row) throw new RepositoryError(`No minute entry ${id}`, "NOT_FOUND");
    return (await hydrateMinutes([row]))[0];
  }

  /**
   * The next item number for a meeting, allocated without a race.
   *
   * Item numbers are the minute references the treasury module points at, so
   * two concurrent additions must not both get 7. `nextInSequence` is the
   * shared fix; the statement before it exists because the counter starts at
   * zero and the agenda does not — a meeting seeded with five items needs the
   * counter to know that before it hands out six.
   */
  async function nextItemNumber(meetingId: string): Promise<number> {
    const name = `meetings:agenda-item-number:${meetingId}`;
    await requireDatabase()
      .prepare(
        `INSERT INTO counter (name, value) ` +
          `SELECT ?, COALESCE(MAX(item_number), 0) FROM agenda_item WHERE meeting_id = ? ` +
          `ON CONFLICT(name) DO NOTHING`,
      )
      .bind(name, meetingId)
      .run();
    return nextInSequence(name);
  }

  const api: MeetingsRepository = {
    /* --- Reads ----------------------------------------------------- */

    async listMeetings(entity) {
      const db = requireDatabase();
      // Newest first, and within an evening JSOA before JSOF, which is the
      // in-memory order. `scheduled_start DESC, entity ASC` is that order.
      const rows = entity
        ? await many<MeetingRow>(
            db
              .prepare(
                `SELECT ${MEETING_COLUMNS} FROM meeting WHERE entity = ? ` +
                  `ORDER BY scheduled_start DESC, entity ASC`,
              )
              .bind(entity),
          )
        : await many<MeetingRow>(
            db.prepare(
              `SELECT ${MEETING_COLUMNS} FROM meeting ` +
                `ORDER BY scheduled_start DESC, entity ASC`,
            ),
          );
      return hydrateMeetings(rows);
    },

    async listSameDayPairs() {
      const rows = await many<MeetingRow>(
        requireDatabase().prepare(
          `SELECT ${MEETING_COLUMNS} FROM meeting ` +
            `ORDER BY substr(scheduled_start, 1, 10) DESC, scheduled_start ASC`,
        ),
      );
      const meetings = await hydrateMeetings(rows);
      const byDate = new Map<string, Meeting[]>();
      for (const meeting of meetings) {
        const date = meeting.scheduledStart.slice(0, 10);
        byDate.set(date, [...(byDate.get(date) ?? []), meeting]);
      }
      return Array.from(byDate.entries()).map(([date, list]) => ({ date, meetings: list }));
    },

    async getMeeting(id) {
      const row = await getMeetingRow(id);
      if (!row) return null;
      return (await hydrateMeetings([row]))[0];
    },

    listAgendaItems,

    async listMinutes(meetingId) {
      return hydrateMinutes(await minuteRowsFor(meetingId));
    },

    async getMinuteByRef(ref) {
      const row = await one<MinuteRow>(
        requireDatabase()
          .prepare(`SELECT ${MINUTE_COLUMNS} FROM minute_entry WHERE ref = ?`)
          .bind(ref),
      );
      if (!row) return null;
      return (await hydrateMinutes([row]))[0];
    },

    /**
     * The decision register: every minuted motion, newest first.
     *
     * One query with the joins the shape needs, rather than a minute read per
     * meeting. An entry with no motion is not a decision and is not here; an
     * entry whose meeting or agenda item has gone is dropped, which is the
     * in-memory behaviour (`if (!meeting || !item) continue`) and the reason
     * these are inner joins.
     */
    async listDecisions(entity) {
      const db = requireDatabase();
      const sql =
        `SELECT m.id AS id, m.ref AS ref, m.entity AS entity, m.item_number AS item_number, ` +
        `m.draft AS draft, g.id AS meeting_id, g.title AS meeting_title, ` +
        `g.scheduled_start AS date, a.title AS item_title, a.type AS item_type, ` +
        `m.motion_text, m.moved_by_person_id, m.moved_by_name, ` +
        `m.seconded_by_person_id, m.seconded_by_name, m.votes_for, m.votes_against, ` +
        `m.votes_abstain, m.motion_outcome ` +
        `FROM minute_entry m ` +
        `JOIN meeting g ON g.id = m.meeting_id ` +
        `JOIN agenda_item a ON a.id = m.agenda_item_id ` +
        `WHERE m.motion_text IS NOT NULL` +
        (entity ? " AND m.entity = ?" : "") +
        ` ORDER BY g.scheduled_start DESC, m.ref ASC`;
      type Row = MinuteRow & {
        meeting_id: string;
        meeting_title: string;
        date: string;
        item_title: string;
        item_type: string;
      };
      const statement = db.prepare(sql);
      const rows = await many<Row>(entity ? statement.bind(entity) : statement);
      const recusals = await recusalsFor(rows.map((row) => row.id));
      const records: DecisionRecord[] = [];
      for (const row of rows) {
        const motion = toMotion(row);
        if (!motion) continue;
        records.push({
          ref: text(row.ref),
          entity: text(row.entity) as Entity,
          meetingId: text(row.meeting_id),
          meetingTitle: text(row.meeting_title),
          date: text(row.date),
          itemNumber: int(row.item_number),
          itemTitle: text(row.item_title),
          itemType: text(row.item_type) as AgendaItemType,
          motion,
          recusals: recusals.get(row.id) ?? [],
          provisional: toBool(row.draft),
        });
      }
      return records;
    },

    async listComplianceItems(entity) {
      const db = requireDatabase();
      const rows = entity
        ? await many<ComplianceRow>(
            db
              .prepare(
                `SELECT ${COMPLIANCE_COLUMNS} FROM compliance_item WHERE entity = ? ` +
                  `ORDER BY due_date, id`,
              )
              .bind(entity),
          )
        : await many<ComplianceRow>(
            db.prepare(
              `SELECT ${COMPLIANCE_COLUMNS} FROM compliance_item ORDER BY due_date, id`,
            ),
          );
      return rows.map(toComplianceItem);
    },

    /* --- Writes ---------------------------------------------------- */

    async saveAgendaItem(input) {
      const meetingRow = await requireMeetingRow(input.meetingId);
      const meeting = toMeeting(meetingRow, []);
      validateAgendaItemInput(input);

      const existing = input.id
        ? await one<AgendaItemRow>(
            requireDatabase()
              .prepare(
                `SELECT ${AGENDA_COLUMNS} FROM agenda_item WHERE id = ? AND meeting_id = ?`,
              )
              .bind(input.id, meetingRow.id),
          )
        : null;

      if (!existing) assertAgendaEditable(meeting);

      const keywords = (input.keywords ?? []).filter((k) => k.trim().length > 0);
      const db = requireDatabase();

      if (existing) {
        // An adopted agenda may have its wording and estimates corrected. What
        // it may not have is its item numbers moved, because those are the
        // minute references the treasury module points at — so `position` and
        // `item_number` are deliberately absent from this UPDATE.
        await atomic([
          db
            .prepare(
              `UPDATE agenda_item SET title = ?, owner_role = ?, estimated_minutes = ?, ` +
                `type = ?, note = ? WHERE id = ?`,
            )
            .bind(
              input.title.trim(),
              input.ownerRole,
              Math.round(input.estimatedMinutes),
              input.type,
              input.note?.trim() || null,
              existing.id,
            ),
          db
            .prepare("DELETE FROM agenda_item_keyword WHERE agenda_item_id = ?")
            .bind(existing.id),
          ...keywords.map((keyword) =>
            db
              .prepare(
                `INSERT INTO agenda_item_keyword (agenda_item_id, keyword) VALUES (?, ?) ` +
                  `ON CONFLICT DO NOTHING`,
              )
              .bind(existing.id, keyword),
          ),
        ]);
        const refreshed = await one<AgendaItemRow>(
          db
            .prepare(`SELECT ${AGENDA_COLUMNS} FROM agenda_item WHERE id = ?`)
            .bind(existing.id),
        );
        if (!refreshed) {
          throw new RepositoryError(`No agenda item ${existing.id}`, "NOT_FOUND");
        }
        return (await hydrateAgendaItems([refreshed]))[0];
      }

      const count = await one<{ n: number }>(
        db
          .prepare("SELECT COUNT(*) AS n FROM agenda_item WHERE meeting_id = ?")
          .bind(meetingRow.id),
      );
      const created: AgendaItem = {
        id: newId(),
        meetingId: meetingRow.id,
        entity: meeting.entity,
        position: int(count?.n) + 1,
        itemNumber: await nextItemNumber(meetingRow.id),
        title: input.title.trim(),
        ownerRole: input.ownerRole,
        estimatedMinutes: Math.round(input.estimatedMinutes),
        type: input.type,
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        ...(keywords.length > 0 ? { keywords } : {}),
      };
      await atomic(insertAgendaItemStatements(created));
      return created;
    },

    async removeAgendaItem(meetingId, itemId) {
      const meetingRow = await requireMeetingRow(meetingId);
      assertAgendaEditable(toMeeting(meetingRow, []));
      const db = requireDatabase();

      const item = await one<AgendaItemRow>(
        db
          .prepare(
            `SELECT ${AGENDA_COLUMNS} FROM agenda_item WHERE id = ? AND meeting_id = ?`,
          )
          .bind(itemId, meetingId),
      );
      if (!item) throw new RepositoryError(`No agenda item ${itemId}`, "NOT_FOUND");

      const minuted = await one<{ n: number }>(
        db
          .prepare("SELECT COUNT(*) AS n FROM minute_entry WHERE agenda_item_id = ?")
          .bind(itemId),
      );
      if (int(minuted?.n) > 0) {
        // Not a cascade, and not a soft refusal either: `minute_entry` grants
        // no delete at all, so removing the item would orphan a row that can
        // never be cleaned up.
        throw new RepositoryError(
          "This item already has a minute against it. Remove the minute first, " +
            "or leave the item and record that it was not reached.",
          "CONFLICT",
        );
      }

      const remaining = (await agendaRowsFor(meetingId)).filter((row) => row.id !== itemId);
      await atomic([
        db.prepare("DELETE FROM agenda_item_keyword WHERE agenda_item_id = ?").bind(itemId),
        db.prepare("DELETE FROM agenda_item WHERE id = ?").bind(itemId),
        // Positions stay 1-based and contiguous. Item numbers do not move.
        ...remaining.map((row, index) =>
          db
            .prepare("UPDATE agenda_item SET position = ? WHERE id = ?")
            .bind(index + 1, row.id),
        ),
      ]);
      return listAgendaItems(meetingId);
    },

    async reorderAgenda(meetingId, orderedItemIds) {
      const meetingRow = await requireMeetingRow(meetingId);
      assertAgendaEditable(toMeeting(meetingRow, []));
      const current = await agendaRowsFor(meetingId);
      const known = new Set(current.map((row) => row.id));
      const requested = orderedItemIds.filter((id) => known.has(id));
      if (requested.length !== current.length) {
        throw new AgendaError(
          "The reorder does not list every item on the agenda exactly once.",
          "BAD_INPUT",
        );
      }
      const db = requireDatabase();
      await atomic(
        requested.map((id, index) =>
          db.prepare("UPDATE agenda_item SET position = ? WHERE id = ?").bind(index + 1, id),
        ),
      );
      return listAgendaItems(meetingId);
    },

    /**
     * Adoption: item numbers take the adopted order, once, and never move again.
     *
     * The two things this has to be careful about are both the schema's.
     *
     * `UNIQUE (entity, ref)` means a renumber that swaps two references cannot
     * be written as two UPDATEs in sequence — the first collides with the row
     * it is about to overwrite. So every entry whose reference moves is parked
     * on a reference carrying its own id and then written to its real one,
     * inside the single batch.
     *
     * `minute_entry_no_edit_once_approved` means an approved entry cannot be
     * touched at all. Only entries whose reference actually changes are
     * updated, so re-adopting an agenda that did not renumber writes no minute
     * row and cannot abort. Where an approved entry's reference WOULD move,
     * the batch aborts and nothing lands, which is right: the citable
     * reference of a minute of record is the thing later resolutions point at,
     * and moving it under them is what the trigger exists to stop.
     */
    async adoptAgenda(meetingId, at) {
      const meetingRow = await requireMeetingRow(meetingId);
      const meeting = toMeeting(meetingRow, []);
      const db = requireDatabase();
      const items = await agendaRowsFor(meetingId);

      const statements: D1PreparedStatement[] = items
        .filter((row) => int(row.item_number) !== int(row.position))
        .map((row) =>
          db
            .prepare("UPDATE agenda_item SET item_number = ? WHERE id = ?")
            .bind(int(row.position), row.id),
        );

      statements.push(
        db
          .prepare(
            `UPDATE meeting SET agenda_adopted_at = ?, ` +
              `status = CASE WHEN status = 'DRAFT' THEN 'NOTICED' ELSE status END ` +
              `WHERE id = ?`,
          )
          .bind(at, meetingId),
      );

      const adoptedNumber = new Map(items.map((row) => [row.id, int(row.position)]));
      const entries = await minuteRowsFor(meetingId);
      const moving: { id: string; itemNumber: number; ref: string }[] = [];
      for (const entry of entries) {
        const itemNumber = adoptedNumber.get(entry.agenda_item_id);
        if (itemNumber === undefined) continue;
        const ref = minuteRefForMeeting(meeting, itemNumber);
        if (ref === entry.ref && int(entry.item_number) === itemNumber) continue;
        moving.push({ id: entry.id, itemNumber, ref });
      }
      for (const entry of moving) {
        statements.push(
          db
            .prepare("UPDATE minute_entry SET ref = ? WHERE id = ?")
            .bind(`pending:${entry.id}`, entry.id),
        );
      }
      for (const entry of moving) {
        statements.push(
          db
            .prepare("UPDATE minute_entry SET item_number = ?, ref = ? WHERE id = ?")
            .bind(entry.itemNumber, entry.ref, entry.id),
        );
      }

      await atomic(statements);
      return (await api.getMeeting(meetingId))!;
    },

    async markNoticeSent(meetingId, at) {
      await requireMeetingRow(meetingId);
      await requireDatabase()
        .prepare(
          `UPDATE meeting SET notice_sent_at = ?, ` +
            `status = CASE WHEN status = 'DRAFT' THEN 'NOTICED' ELSE status END ` +
            `WHERE id = ?`,
        )
        .bind(at, meetingId)
        .run();
      return (await api.getMeeting(meetingId))!;
    },

    async setMeetingStatus(meetingId, status) {
      await requireMeetingRow(meetingId);
      await requireDatabase()
        .prepare("UPDATE meeting SET status = ? WHERE id = ?")
        .bind(status, meetingId)
        .run();
      return (await api.getMeeting(meetingId))!;
    },

    async setAttendance(meetingId, personId, present) {
      await requireMeetingRow(meetingId);
      const db = requireDatabase();
      const attendee = await one<{ person_id: string }>(
        db
          .prepare(
            "SELECT person_id FROM meeting_attendee WHERE meeting_id = ? AND person_id = ?",
          )
          .bind(meetingId, personId),
      );
      if (!attendee) {
        // Not an upsert. The attendee list is the roll of who was entitled to
        // be in that room, and adding a name to it by marking them present is
        // a different act from recording that they came.
        throw new RepositoryError(
          `${personId} is not on the attendee list for this meeting`,
          "NOT_FOUND",
        );
      }
      await db
        .prepare(
          "UPDATE meeting_attendee SET present = ? WHERE meeting_id = ? AND person_id = ?",
        )
        .bind(toInt(present), meetingId, personId)
        .run();
      return (await api.getMeeting(meetingId))!;
    },

    async saveMinute(input) {
      const meetingRow = await requireMeetingRow(input.meetingId);
      const { fields, recusals, flags } = await prepareMinute(input, meetingRow);
      const db = requireDatabase();

      const existing = input.id
        ? await one<MinuteRow>(
            db.prepare(`SELECT ${MINUTE_COLUMNS} FROM minute_entry WHERE id = ?`).bind(input.id),
          )
        : await one<MinuteRow>(
            db
              .prepare(
                `SELECT ${MINUTE_COLUMNS} FROM minute_entry ` +
                  `WHERE meeting_id = ? AND agenda_item_id = ?`,
              )
              .bind(meetingRow.id, fields.agendaItemId),
          );

      // The entry, its recusals and its flags land together or not at all.
      // Written separately, a refused flag leaves an entry claiming the
      // parser had no reservations about it.
      if (existing) {
        await atomic([
          updateMinuteStatement(existing.id, fields),
          ...minuteChildStatements(existing.id, recusals, flags),
        ]);
        return minuteById(existing.id);
      }

      const id = newId();
      await atomic([
        insertMinuteStatement(id, meetingRow.id, fields),
        ...minuteChildStatements(id, recusals, flags),
      ]);
      return minuteById(id);
    },

    /**
     * The transcript drafts for a meeting, replaced.
     *
     * This is the one place the schema and the interface genuinely disagree,
     * so it is worth being explicit rather than clever. The interface says
     * "replaces every transcript-sourced draft". `minute_entry_no_delete`
     * says a minute entry is never deleted. Both cannot hold.
     *
     * The resolution: an entry that the new set covers is UPDATEd in place
     * (legal — it is a draft, so `draft = 0` is false and the edit trigger
     * does not fire), and an item with no entry yet gets an INSERT. Nothing
     * is deleted. In every state this module can actually reach that is
     * equivalent to the in-memory behaviour, because the parser writes one
     * section per agenda item and `removeAgendaItem` refuses to remove an item
     * that has a minute against it — so the covered set never shrinks.
     *
     * If a stale draft does turn up, this throws instead of leaving it there
     * or pretending it was removed. A draft nobody can account for sitting in
     * the register marked provisional is the failure the `draft` flag exists
     * to catch, and quietly keeping it would be worse than the refusal.
     *
     * One batch for the whole set, so the all-or-nothing property the
     * in-memory snapshot-and-restore gives is the transaction's here.
     */
    async replaceTranscriptDrafts(meetingId, inputs) {
      const meetingRow = await requireMeetingRow(meetingId);
      const db = requireDatabase();

      const existing = await minuteRowsFor(meetingId);
      const byItem = new Map(existing.map((row) => [row.agenda_item_id, row]));

      const statements: D1PreparedStatement[] = [];
      const writtenIds: string[] = [];
      const covered = new Set<string>();

      for (const input of inputs) {
        const current = byItem.get(input.agendaItemId);
        // A transcript draft never overwrites a minute the Secretary wrote.
        if (current && text(current.source) === "SECRETARY") continue;

        const { fields, recusals, flags } = await prepareMinute(
          { ...input, meetingId, entity: text(meetingRow.entity) as Entity, draft: true, source: "TRANSCRIPT_DRAFT" },
          meetingRow,
        );

        if (current) {
          covered.add(current.id);
          statements.push(updateMinuteStatement(current.id, fields));
          statements.push(...minuteChildStatements(current.id, recusals, flags));
          writtenIds.push(current.id);
        } else {
          const id = newId();
          statements.push(insertMinuteStatement(id, meetingId, fields));
          statements.push(...minuteChildStatements(id, recusals, flags));
          writtenIds.push(id);
        }
      }

      const stale = existing.filter(
        (row) => text(row.source) === "TRANSCRIPT_DRAFT" && !covered.has(row.id),
      );
      if (stale.length > 0) {
        throw new RepositoryError(
          `This parse does not cover ${stale.length} transcript draft` +
            `${stale.length === 1 ? "" : "s"} already on this meeting ` +
            `(${stale.map((row) => row.ref).join(", ")}), and a minute entry is never ` +
            `deleted. Clear or supersede ${stale.length === 1 ? "it" : "them"} from the ` +
            `minutes screen before running the parser again.`,
          "CONFLICT",
        );
      }

      statements.push(
        db
          .prepare(
            `UPDATE meeting SET status = 'MINUTES_DRAFT' ` +
              `WHERE id = ? AND status IN ('IN_SESSION', 'NOTICED')`,
          )
          .bind(meetingId),
      );

      await atomic(statements);

      const rows = await minuteRowsFor(meetingId);
      const order = new Map(writtenIds.map((id, index) => [id, index]));
      return hydrateMinutes(
        rows
          .filter((row) => order.has(row.id))
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
      );
    },

    async setComplianceStatus(itemId, status) {
      const db = requireDatabase();
      const row = await one<ComplianceRow>(
        db
          .prepare(`SELECT ${COMPLIANCE_COLUMNS} FROM compliance_item WHERE id = ?`)
          .bind(itemId),
      );
      if (!row) throw new RepositoryError(`No compliance item ${itemId}`, "NOT_FOUND");
      if (!toBool(row.verified) && status === "FILED") {
        throw new RepositoryError(
          "This obligation is not confirmed to exist, so it cannot be marked filed. " +
            "Confirm the duty first and replace the entry.",
          "CONFLICT",
        );
      }
      await db
        .prepare("UPDATE compliance_item SET status = ? WHERE id = ?")
        .bind(status, itemId)
        .run();
      return toComplianceItem({ ...row, status });
    },
  };

  return api;
}
