/**
 * The membership repository, against D1.
 *
 * Same interface as `repository.ts`, no signature changes: the interface
 * was already fully async, which is what made this a drop-in rather than
 * a refactor. The in-memory implementation stays where it is and is
 * still what the test suite runs against.
 *
 * Four things in here are decisions rather than transcription, and each
 * is the thing that would be got wrong by writing the obvious SQL:
 *
 *   1. Anything spanning two tables goes through `atomic`. An
 *      application and its flags, a member and the application it was
 *      converted from, a member's state and the application's state:
 *      each is one object to the domain and two statements to SQLite,
 *      and two separate awaits leave the second half on the floor when
 *      it fails with nothing to tell you.
 *
 *   2. `nextMemberId` allocates from the shared `counter` table through
 *      `nextInSequence`, not by reading the highest member number and
 *      adding one. The in-memory implementation does read-then-add,
 *      which is correct for one process and a race for two: both
 *      requests read 0141 and both mint JSOA-2026-0142.
 *
 *   3. `membership_audit` is append-only by trigger. There is no update
 *      and no delete path here, and adding one would not fail a review,
 *      it would throw at runtime.
 *
 *   4. Ties in a sort are broken by `rowid`, which is insertion order.
 *      Several of these lists are ordered by a timestamp that two rows
 *      written in the same millisecond share, and the in-memory
 *      implementation resolves those by insertion order because an
 *      array has no other option. `ORDER BY at DESC` alone would differ
 *      from it nondeterministically, which is the kind of difference
 *      that shows up once in a demo and never in a test.
 *
 * Reads that produce an `Application` fetch its flags as well, because
 * the domain type has no state in which `flags` is absent. That is one
 * extra statement per read and the alternative is a partially
 * constructed object that some caller eventually trusts.
 */

import "server-only";

import {
  atomic,
  database,
  int,
  many,
  newId,
  nextInSequence,
  now,
  one,
  orNull,
  requireDatabase,
  text,
  toBool,
  toInt,
} from "../db";
import type { MembershipState } from "./state";
import { formatMemberId } from "./state";
import { newReference, type MembershipRepository } from "./repository";
import {
  type Application,
  type ApplicationFields,
  type ChairDecision,
  type CheckoutHandoff,
  type DUES_CURRENCY,
  type IntakeFlag,
  type Member,
  type MembershipAuditEntry,
  type MembershipCategory,
  type QualifyingRelationship,
  type VouchOutcome,
  type VouchRequest,
  MEMBERSHIP_ENTITY,
} from "./types";
import type { DataClass, Entity } from "../authz/model";

/* Rows -------------------------------------------------------------- *
 *
 * One type per table, named as the columns are. Kept separate from the
 * domain types on purpose: a single type doing both jobs is how a
 * snake_case column ends up rendered in a template.
 */

type ApplicationRow = {
  id: string;
  entity: string;
  state: string;
  reference: string;
  applicant_name: string;
  email: string;
  phone: string;
  membership_category: string | null;
  qualifying_relationship: string | null;
  service_from: string | null;
  service_to: string | null;
  attested_war_veteran: number;
  is_augmentee: number;
  sponsor_member_id: string;
  created_at: string;
  submitted_at: string | null;
  step: number;
  vouch_expires_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_outcome: string | null;
  decision_reason: string | null;
  converted_member_id: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
};

type VouchRow = {
  token: string;
  application_id: string;
  sponsor_member_id: string;
  created_at: string;
  expires_at: string;
  answered_at: string | null;
  outcome: string | null;
  deliverable: number;
};

type HandoffRow = {
  id: string;
  application_id: string;
  entity: string;
  amount_cents: number;
  currency: string;
  created_at: string;
  hosted_url: string;
  status: string;
};

type MemberRow = {
  id: string;
  entity: string;
  member_id: string;
  person_id: string | null;
  display_name: string;
  email: string;
  phone: string;
  membership_category: string;
  qualifying_relationship: string | null;
  service_from: string | null;
  service_to: string | null;
  is_war_veteran: number;
  attested_war_veteran: number;
  state: string;
  sponsor_member_id: string | null;
  joined_at: string;
  payment_cleared_at: string | null;
  last_audited_at: string | null;
  application_id: string | null;
};

type AuditRow = {
  id: string;
  at: string;
  person_id: string;
  action: string;
  data_class: string;
  entity: string;
  row_level: number;
  subject_ref: string | null;
};

const APPLICATION_COLUMNS =
  "id, entity, state, reference, applicant_name, email, phone, " +
  "membership_category, qualifying_relationship, service_from, service_to, " +
  "attested_war_veteran, is_augmentee, sponsor_member_id, created_at, " +
  "submitted_at, step, vouch_expires_at, decided_at, decided_by, " +
  "decision_outcome, decision_reason, converted_member_id, assigned_to, assigned_at";

const MEMBER_COLUMNS =
  "id, entity, member_id, person_id, display_name, email, phone, " +
  "membership_category, qualifying_relationship, service_from, service_to, " +
  "is_war_veteran, attested_war_veteran, state, sponsor_member_id, " +
  "joined_at, payment_cleared_at, last_audited_at, application_id";

/* Row to domain ----------------------------------------------------- */

function chairDecisionOf(row: ApplicationRow): ChairDecision | null {
  if (!row.decided_at || !row.decision_outcome) return null;
  return {
    at: row.decided_at,
    chairPersonId: text(row.decided_by),
    outcome: row.decision_outcome === "APPROVED" ? "APPROVED" : "DENIED",
    reason: text(row.decision_reason),
  };
}

function applicationOf(row: ApplicationRow, flags: IntakeFlag[]): Application {
  return {
    id: row.id,
    entity: row.entity as Entity,
    state: row.state as MembershipState,
    reference: row.reference,
    applicantName: text(row.applicant_name),
    email: text(row.email),
    phone: text(row.phone),
    membershipCategory: orNull(row.membership_category) as MembershipCategory | null,
    qualifyingRelationship: orNull(
      row.qualifying_relationship,
    ) as QualifyingRelationship | null,
    serviceFrom: orNull(row.service_from),
    serviceTo: orNull(row.service_to),
    attestedWarVeteran: toBool(row.attested_war_veteran),
    isAugmentee: toBool(row.is_augmentee),
    sponsorMemberId: text(row.sponsor_member_id),
    createdAt: row.created_at,
    submittedAt: orNull(row.submitted_at),
    step: int(row.step),
    vouchExpiresAt: orNull(row.vouch_expires_at),
    flags,
    chairDecision: chairDecisionOf(row),
    convertedMemberId: orNull(row.converted_member_id),
    assignedTo: orNull(row.assigned_to),
    assignedAt: orNull(row.assigned_at),
  };
}

function vouchOf(row: VouchRow): VouchRequest {
  return {
    token: row.token,
    applicationId: row.application_id,
    sponsorMemberId: text(row.sponsor_member_id),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    answeredAt: orNull(row.answered_at),
    outcome: orNull(row.outcome) as VouchOutcome | null,
    deliverable: toBool(row.deliverable),
  };
}

function handoffOf(row: HandoffRow): CheckoutHandoff {
  return {
    id: row.id,
    applicationId: row.application_id,
    entity: row.entity as Entity,
    amountCents: int(row.amount_cents),
    currency: row.currency as typeof DUES_CURRENCY,
    createdAt: row.created_at,
    hostedUrl: text(row.hosted_url),
    status: row.status === "CLEARED" ? "CLEARED" : "CREATED",
  };
}

function memberOf(row: MemberRow): Member {
  return {
    id: row.id,
    entity: row.entity as Entity,
    memberId: row.member_id,
    // Read back, finally. The column has existed since 0003 and nothing read
    // it or wrote it, which is what blocked every member-tier function.
    personId: orNull(row.person_id),
    displayName: text(row.display_name),
    email: text(row.email),
    phone: text(row.phone),
    membershipCategory: row.membership_category as MembershipCategory,
    qualifyingRelationship: orNull(
      row.qualifying_relationship,
    ) as QualifyingRelationship | null,
    serviceFrom: orNull(row.service_from),
    serviceTo: orNull(row.service_to),
    isWarVeteran: toBool(row.is_war_veteran),
    attestedWarVeteran: toBool(row.attested_war_veteran),
    state: row.state as MembershipState,
    sponsorMemberId: orNull(row.sponsor_member_id),
    joinedAt: row.joined_at,
    paymentClearedAt: orNull(row.payment_cleared_at),
    lastAuditedAt: orNull(row.last_audited_at),
    applicationId: orNull(row.application_id),
  };
}

function auditOf(row: AuditRow): MembershipAuditEntry {
  return {
    id: row.id,
    at: row.at,
    personId: row.person_id,
    action: row.action,
    dataClass: row.data_class as DataClass,
    entity: row.entity as Entity,
    rowLevel: toBool(row.row_level),
    subjectRef: orNull(row.subject_ref),
  };
}

/**
 * The columns `updateDraft` is allowed to touch, as a fixed map.
 *
 * A patch arrives as domain field names and this is what turns them
 * into column names. It is a whitelist and not a convenience: building
 * a SET clause from whatever keys the caller passed is how a draft
 * update becomes a way to write `state`.
 */
const DRAFT_COLUMNS: Record<keyof ApplicationFields | "step", string> = {
  applicantName: "applicant_name",
  email: "email",
  phone: "phone",
  membershipCategory: "membership_category",
  qualifyingRelationship: "qualifying_relationship",
  serviceFrom: "service_from",
  serviceTo: "service_to",
  attestedWarVeteran: "attested_war_veteran",
  isAugmentee: "is_augmentee",
  sponsorMemberId: "sponsor_member_id",
  step: "step",
};

const BOOLEAN_FIELDS = new Set(["attestedWarVeteran", "isAugmentee"]);

/* ------------------------------------------------------------------ *
 * The implementation
 * ------------------------------------------------------------------ */

export class D1MembershipRepository implements MembershipRepository {
  /* Applications ------------------------------------------------- */

  private async flagsFor(applicationId: string): Promise<IntakeFlag[]> {
    const rows = await many<{ flag: string }>(
      requireDatabase()
        .prepare(
          "SELECT flag FROM application_flag WHERE application_id = ? ORDER BY rowid",
        )
        .bind(applicationId),
    );
    return rows.map((r) => r.flag as IntakeFlag);
  }

  private async flagsForMany(
    applicationIds: string[],
  ): Promise<Map<string, IntakeFlag[]>> {
    const byApplication = new Map<string, IntakeFlag[]>();
    for (const id of applicationIds) byApplication.set(id, []);
    if (applicationIds.length === 0) return byApplication;
    const placeholders = applicationIds.map(() => "?").join(", ");
    const rows = await many<{ application_id: string; flag: string }>(
      requireDatabase()
        .prepare(
          "SELECT application_id, flag FROM application_flag " +
            `WHERE application_id IN (${placeholders}) ORDER BY rowid`,
        )
        .bind(...applicationIds),
    );
    for (const row of rows) {
      byApplication.get(row.application_id)?.push(row.flag as IntakeFlag);
    }
    return byApplication;
  }

  private async applicationRow(id: string): Promise<ApplicationRow | null> {
    return one<ApplicationRow>(
      requireDatabase()
        .prepare(`SELECT ${APPLICATION_COLUMNS} FROM application WHERE id = ?`)
        .bind(id),
    );
  }

  /** The read every write ends with. Throws where the in-memory one throws. */
  private async requireApplication(id: string): Promise<Application> {
    const row = await this.applicationRow(id);
    if (!row) throw new Error(`No application ${id}`);
    return applicationOf(row, await this.flagsFor(id));
  }

  async createDraft(fields: Partial<ApplicationFields>): Promise<Application> {
    const id = newId();
    const createdAt = now();
    // Field by field rather than a spread over the defaults.
    // `Partial<ApplicationFields>` permits `{ email: undefined }`, and D1
    // refuses to bind undefined; `??` turns that into the default the column
    // would have taken anyway, which is what the caller meant.
    const merged: ApplicationFields = {
      applicantName: fields.applicantName ?? "",
      email: fields.email ?? "",
      phone: fields.phone ?? "",
      membershipCategory: fields.membershipCategory ?? null,
      qualifyingRelationship: fields.qualifyingRelationship ?? null,
      serviceFrom: fields.serviceFrom ?? null,
      serviceTo: fields.serviceTo ?? null,
      attestedWarVeteran: fields.attestedWarVeteran ?? false,
      isAugmentee: fields.isAugmentee ?? false,
      sponsorMemberId: fields.sponsorMemberId ?? "",
    };

    await requireDatabase()
      .prepare(
        "INSERT INTO application (" +
          "id, entity, state, reference, applicant_name, email, phone, " +
          "membership_category, qualifying_relationship, service_from, " +
          "service_to, attested_war_veteran, is_augmentee, sponsor_member_id, " +
          "created_at, submitted_at, step, vouch_expires_at" +
          ") VALUES (?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, NULL)",
      )
      .bind(
        id,
        MEMBERSHIP_ENTITY,
        newReference(),
        merged.applicantName,
        merged.email,
        merged.phone,
        merged.membershipCategory,
        merged.qualifyingRelationship,
        merged.serviceFrom,
        merged.serviceTo,
        toInt(merged.attestedWarVeteran),
        toInt(merged.isAugmentee),
        merged.sponsorMemberId,
        createdAt,
      )
      .run();

    return this.requireApplication(id);
  }

  async getApplication(id: string): Promise<Application | null> {
    const row = await this.applicationRow(id);
    if (!row) return null;
    return applicationOf(row, await this.flagsFor(id));
  }

  async getApplicationByReference(reference: string): Promise<Application | null> {
    const row = await one<ApplicationRow>(
      requireDatabase()
        .prepare(`SELECT ${APPLICATION_COLUMNS} FROM application WHERE reference = ?`)
        .bind(reference),
    );
    if (!row) return null;
    return applicationOf(row, await this.flagsFor(row.id));
  }

  async updateDraft(
    id: string,
    patch: Partial<ApplicationFields> & { step?: number },
  ): Promise<Application> {
    // Existence first, so a patch against a missing draft fails the same
    // way it does in memory rather than silently updating no rows.
    if (!(await this.applicationRow(id))) throw new Error(`No application ${id}`);

    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [field, value] of Object.entries(patch)) {
      const column = DRAFT_COLUMNS[field as keyof typeof DRAFT_COLUMNS];
      if (!column || value === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(
        BOOLEAN_FIELDS.has(field) ? toInt(Boolean(value)) : (value as unknown),
      );
    }

    if (assignments.length > 0) {
      await requireDatabase()
        .prepare(`UPDATE application SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...values, id)
        .run();
    }
    return this.requireApplication(id);
  }

  /**
   * The submission. Application row and flag set, in one batch.
   *
   * The flags are replaced rather than merged, which is what the
   * in-memory implementation does and what the intake expects: it
   * recomputes the whole set on every submission so that computing
   * them costs the same whatever the answers are.
   */
  async markSubmitted(
    id: string,
    input: {
      state: MembershipState;
      flags: IntakeFlag[];
      vouchExpiresAt: string | null;
      at: string;
    },
  ): Promise<Application> {
    if (!(await this.applicationRow(id))) throw new Error(`No application ${id}`);
    const db = requireDatabase();
    await atomic([
      db
        .prepare(
          "UPDATE application SET state = ?, vouch_expires_at = ?, submitted_at = ? WHERE id = ?",
        )
        .bind(input.state, input.vouchExpiresAt, input.at, id),
      db.prepare("DELETE FROM application_flag WHERE application_id = ?").bind(id),
      ...input.flags.map((flag) =>
        db
          .prepare("INSERT INTO application_flag (application_id, flag) VALUES (?, ?)")
          .bind(id, flag),
      ),
    ]);
    return this.requireApplication(id);
  }

  async setApplicationState(id: string, state: MembershipState): Promise<Application> {
    if (!(await this.applicationRow(id))) throw new Error(`No application ${id}`);
    await requireDatabase()
      .prepare("UPDATE application SET state = ? WHERE id = ?")
      .bind(state, id)
      .run();
    return this.requireApplication(id);
  }

  async recordChairDecision(
    id: string,
    decision: ChairDecision,
    state: MembershipState,
  ): Promise<Application> {
    if (!(await this.applicationRow(id))) throw new Error(`No application ${id}`);
    await requireDatabase()
      .prepare(
        "UPDATE application SET state = ?, decided_at = ?, decided_by = ?, " +
          "decision_outcome = ?, decision_reason = ? WHERE id = ?",
      )
      .bind(
        state,
        decision.at,
        decision.chairPersonId,
        decision.outcome,
        decision.reason,
        id,
      )
      .run();
    return this.requireApplication(id);
  }

  /**
   * The queues. Ordered by when the application was submitted, falling
   * back to when it was created for a draft that never was, with
   * insertion order breaking a tie.
   */
  async listApplications(states?: MembershipState[]): Promise<Application[]> {
    const db = requireDatabase();
    const order = "ORDER BY COALESCE(submitted_at, created_at), rowid";
    const rows = states
      ? states.length === 0
        ? []
        : await many<ApplicationRow>(
            db
              .prepare(
                `SELECT ${APPLICATION_COLUMNS} FROM application ` +
                  `WHERE state IN (${states.map(() => "?").join(", ")}) ${order}`,
              )
              .bind(...states),
          )
      : await many<ApplicationRow>(
          db.prepare(`SELECT ${APPLICATION_COLUMNS} FROM application ${order}`),
        );

    const flags = await this.flagsForMany(rows.map((r) => r.id));
    return rows.map((row) => applicationOf(row, flags.get(row.id) ?? []));
  }

  /**
   * Prior applications from this address, drafts excluded.
   *
   * Compared case-insensitively and trimmed, as the in-memory one does.
   * That means the `application_email` index is not used, which at this
   * table's size is not worth storing a second normalised column for.
   */
  async countApplicationsByEmail(email: string): Promise<number> {
    const needle = email.trim().toLowerCase();
    if (!needle) return 0;
    const row = await one<{ n: number }>(
      requireDatabase()
        .prepare(
          "SELECT COUNT(*) AS n FROM application " +
            "WHERE lower(trim(email)) = ? AND state <> 'DRAFT'",
        )
        .bind(needle),
    );
    return int(row?.n);
  }

  /**
   * Give an item to a reviewer, or take it back.
   *
   * `assigned_to` references `person(id)`, so an id the identity table does
   * not know fails here with a foreign-key error rather than being written and
   * rendering as a reviewer nobody can find. That is why the caller resolves
   * the reviewer before calling, and why the dev persona ids cannot be
   * assigned against a real database — the same constraint that
   * `src/lib/authz/session.ts` already documents for chair decisions.
   */
  async assignApplication(
    id: string,
    reviewerPersonId: string | null,
    at: string | null,
  ): Promise<Application> {
    if (!(await this.applicationRow(id))) throw new Error(`No application ${id}`);
    await requireDatabase()
      .prepare("UPDATE application SET assigned_to = ?, assigned_at = ? WHERE id = ?")
      .bind(reviewerPersonId, reviewerPersonId ? at : null, id)
      .run();
    return this.requireApplication(id);
  }

  /* Vouch -------------------------------------------------------- */

  async createVouchRequest(request: VouchRequest): Promise<VouchRequest> {
    await requireDatabase()
      .prepare(
        "INSERT INTO vouch_request (" +
          "token, application_id, sponsor_member_id, created_at, expires_at, " +
          "answered_at, outcome, deliverable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        request.token,
        request.applicationId,
        request.sponsorMemberId,
        request.createdAt,
        request.expiresAt,
        request.answeredAt,
        request.outcome,
        toInt(request.deliverable),
      )
      .run();
    return { ...request };
  }

  async getVouchRequest(token: string): Promise<VouchRequest | null> {
    const row = await one<VouchRow>(
      requireDatabase().prepare("SELECT * FROM vouch_request WHERE token = ?").bind(token),
    );
    return row ? vouchOf(row) : null;
  }

  async getVouchRequestForApplication(
    applicationId: string,
  ): Promise<VouchRequest | null> {
    const row = await one<VouchRow>(
      requireDatabase()
        .prepare(
          "SELECT * FROM vouch_request WHERE application_id = ? " +
            "ORDER BY created_at, rowid LIMIT 1",
        )
        .bind(applicationId),
    );
    return row ? vouchOf(row) : null;
  }

  async answerVouchRequest(
    token: string,
    outcome: VouchOutcome,
    at: string,
  ): Promise<VouchRequest> {
    await requireDatabase()
      .prepare("UPDATE vouch_request SET outcome = ?, answered_at = ? WHERE token = ?")
      .bind(outcome, at, token)
      .run();
    const updated = await this.getVouchRequest(token);
    if (!updated) throw new Error("No vouch request for that token");
    return updated;
  }

  async listLapsedVouchRequests(at: string): Promise<VouchRequest[]> {
    const rows = await many<VouchRow>(
      requireDatabase()
        .prepare(
          "SELECT * FROM vouch_request WHERE answered_at IS NULL AND expires_at <= ? " +
            "ORDER BY expires_at, rowid",
        )
        .bind(at),
    );
    return rows.map(vouchOf);
  }

  /* Roster ------------------------------------------------------- */

  async listMembers(): Promise<Member[]> {
    const rows = await many<MemberRow>(
      requireDatabase().prepare(`SELECT ${MEMBER_COLUMNS} FROM member ORDER BY rowid`),
    );
    return rows.map(memberOf);
  }

  private async memberRow(id: string): Promise<MemberRow | null> {
    return one<MemberRow>(
      requireDatabase()
        .prepare(`SELECT ${MEMBER_COLUMNS} FROM member WHERE id = ?`)
        .bind(id),
    );
  }

  async getMember(id: string): Promise<Member | null> {
    const row = await this.memberRow(id);
    return row ? memberOf(row) : null;
  }

  async getMemberByMemberId(memberId: string): Promise<Member | null> {
    // Normalised on the way in, as the in-memory one does: a sponsor
    // typing their own id in lower case is not a sponsor who does not exist.
    const row = await one<MemberRow>(
      requireDatabase()
        .prepare(`SELECT ${MEMBER_COLUMNS} FROM member WHERE member_id = ?`)
        .bind(memberId.trim().toUpperCase()),
    );
    return row ? memberOf(row) : null;
  }

  /**
   * By roster address. `member.email` is not unique — a shared family mailbox
   * is normal here — so this is ordered by `rowid` to match the in-memory
   * implementation's "first in roster order" rather than letting SQLite pick.
   */
  async getMemberByEmail(email: string): Promise<Member | null> {
    const needle = email.trim().toLowerCase();
    if (!needle) return null;
    const row = await one<MemberRow>(
      requireDatabase()
        .prepare(
          `SELECT ${MEMBER_COLUMNS} FROM member WHERE lower(email) = ? ORDER BY rowid LIMIT 1`,
        )
        .bind(needle),
    );
    return row ? memberOf(row) : null;
  }

  async getMemberByPersonId(personId: string): Promise<Member | null> {
    if (!personId) return null;
    const row = await one<MemberRow>(
      requireDatabase()
        .prepare(`SELECT ${MEMBER_COLUMNS} FROM member WHERE person_id = ? ORDER BY rowid LIMIT 1`)
        .bind(personId),
    );
    return row ? memberOf(row) : null;
  }

  /**
   * The next member number for a year.
   *
   * One counter row per year, incremented in a single statement. Not a
   * read of MAX(member_id): two concurrent approvals both read the same
   * highest number and both mint it, and because `member_id` is UNIQUE
   * the second one fails at the end of a workflow that has already
   * taken the money.
   */
  async nextMemberId(year: number): Promise<string> {
    return formatMemberId(year, await nextInSequence(`membership:member_id:${year}`));
  }

  /**
   * The roster record, and the application's pointer back to it.
   *
   * Two tables, one object, so one batch. A member row with the
   * application still showing `converted_member_id` null is a member
   * the chair queue would offer to approve again.
   */
  async createMember(
    member: Omit<Member, "id" | "memberId"> & { memberId?: string },
  ): Promise<Member> {
    const id = newId();
    const year = Number(member.joinedAt.slice(0, 4));
    const memberId = member.memberId ?? (await this.nextMemberId(year));
    const db = requireDatabase();

    const insert = db
      .prepare(
        "INSERT INTO member (" +
          "id, entity, member_id, person_id, display_name, email, phone, " +
          "membership_category, qualifying_relationship, service_from, " +
          "service_to, is_war_veteran, attested_war_veteran, state, " +
          "sponsor_member_id, joined_at, payment_cleared_at, last_audited_at, " +
          "application_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        member.entity,
        memberId,
        // Was the literal NULL. `person_id` is a real foreign key, so this
        // binds only an id that `invite()` has already created or found; the
        // caller passes null when there was no identity store to write to,
        // which is a member with no account rather than a failed creation.
        member.personId,
        member.displayName,
        member.email,
        member.phone,
        member.membershipCategory,
        member.qualifyingRelationship,
        member.serviceFrom,
        member.serviceTo,
        toInt(member.isWarVeteran),
        toInt(member.attestedWarVeteran),
        member.state,
        member.sponsorMemberId,
        member.joinedAt,
        member.paymentClearedAt,
        member.lastAuditedAt,
        member.applicationId,
      );

    await atomic(
      member.applicationId
        ? [
            insert,
            db
              .prepare("UPDATE application SET converted_member_id = ? WHERE id = ?")
              .bind(id, member.applicationId),
          ]
        : [insert],
    );

    const created = await this.getMember(id);
    if (!created) throw new Error(`No member ${id}`);
    return created;
  }

  /**
   * A member's state, and the application's, together.
   *
   * The in-memory implementation carries the state across to the
   * application record, and the chair queue reads both, so a batch
   * rather than two awaits: half of this applied is a member in good
   * standing whose application still says they are awaiting payment.
   */
  async setMemberState(
    id: string,
    state: MembershipState,
    auditedAt?: string,
  ): Promise<Member> {
    const row = await this.memberRow(id);
    if (!row) throw new Error(`No member ${id}`);
    const db = requireDatabase();

    const statements = [
      auditedAt
        ? db
            .prepare("UPDATE member SET state = ?, last_audited_at = ? WHERE id = ?")
            .bind(state, auditedAt, id)
        : db.prepare("UPDATE member SET state = ? WHERE id = ?").bind(state, id),
    ];
    if (row.application_id) {
      statements.push(
        db
          .prepare("UPDATE application SET state = ? WHERE id = ?")
          .bind(state, row.application_id),
      );
    }
    await atomic(statements);

    const updated = await this.getMember(id);
    if (!updated) throw new Error(`No member ${id}`);
    return updated;
  }

  /**
   * The two contact fields, and the identity row with them.
   *
   * One batch, because of the edge case E30 is built around: `person.email`
   * is the identity and `member.email` is the roster contact, they are
   * separate columns in separate tables, and a member whose roster address
   * changed while their sign-in address did not is a member who cannot sign
   * in. Both or neither.
   *
   * `person.email` is UNIQUE, so a collision fails the batch and neither
   * table moves. The caller checks first and refuses without saying whose
   * address it is; this is the backstop for the race between the check and
   * the write, not the user-facing message.
   */
  async updateMemberContact(
    id: string,
    patch: { email?: string; phone?: string },
    options?: { alsoPersonEmail?: boolean },
  ): Promise<Member> {
    const row = await this.memberRow(id);
    if (!row) throw new Error(`No member ${id}`);
    const db = requireDatabase();

    const assignments: string[] = [];
    const values: unknown[] = [];
    if (patch.email !== undefined) {
      assignments.push("email = ?");
      values.push(patch.email.trim());
    }
    if (patch.phone !== undefined) {
      assignments.push("phone = ?");
      values.push(patch.phone.trim());
    }
    if (assignments.length === 0) return memberOf(row);

    const statements = [
      db
        .prepare(`UPDATE member SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...values, id),
    ];
    if (options?.alsoPersonEmail && patch.email !== undefined && row.person_id) {
      statements.push(
        db
          .prepare("UPDATE person SET email = ? WHERE id = ?")
          .bind(patch.email.trim().toLowerCase(), row.person_id),
      );
    }
    await atomic(statements);

    const updated = await this.getMember(id);
    if (!updated) throw new Error(`No member ${id}`);
    return updated;
  }

  /* Payment handoff --------------------------------------------- */

  async createCheckoutHandoff(handoff: CheckoutHandoff): Promise<CheckoutHandoff> {
    await requireDatabase()
      .prepare(
        "INSERT INTO checkout_handoff (" +
          "id, application_id, entity, amount_cents, currency, created_at, " +
          "hosted_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        handoff.id,
        handoff.applicationId,
        handoff.entity,
        handoff.amountCents,
        handoff.currency,
        handoff.createdAt,
        handoff.hostedUrl,
        handoff.status,
      )
      .run();
    return { ...handoff };
  }

  async getCheckoutHandoff(id: string): Promise<CheckoutHandoff | null> {
    const row = await one<HandoffRow>(
      requireDatabase().prepare("SELECT * FROM checkout_handoff WHERE id = ?").bind(id),
    );
    return row ? handoffOf(row) : null;
  }

  /** The most recent one. An abandoned session is not the live one. */
  async getCheckoutHandoffForApplication(
    applicationId: string,
  ): Promise<CheckoutHandoff | null> {
    const row = await one<HandoffRow>(
      requireDatabase()
        .prepare(
          "SELECT * FROM checkout_handoff WHERE application_id = ? " +
            "ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )
        .bind(applicationId),
    );
    return row ? handoffOf(row) : null;
  }

  async markCheckoutCleared(id: string): Promise<CheckoutHandoff> {
    await requireDatabase()
      .prepare("UPDATE checkout_handoff SET status = 'CLEARED' WHERE id = ?")
      .bind(id)
      .run();
    const updated = await this.getCheckoutHandoff(id);
    if (!updated) throw new Error(`No checkout handoff ${id}`);
    return updated;
  }

  /* Audit log ---------------------------------------------------- *
   *
   * Append and read. `membership_audit` has BEFORE UPDATE and BEFORE
   * DELETE triggers that RAISE(ABORT), so there is nothing to be gained
   * by adding a correction path here: it would throw. A wrong entry is
   * followed by another entry.
   */

  async appendAudit(
    entry: Omit<MembershipAuditEntry, "id">,
  ): Promise<MembershipAuditEntry> {
    const id = newId();
    await requireDatabase()
      .prepare(
        "INSERT INTO membership_audit (" +
          "id, at, person_id, action, data_class, entity, row_level, subject_ref" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        entry.at,
        entry.personId,
        entry.action,
        entry.dataClass,
        entry.entity,
        toInt(entry.rowLevel),
        entry.subjectRef,
      )
      .run();
    return { ...entry, id };
  }

  /** Most recent first, as the in-memory one returns them. */
  async listAudit(limit = 200): Promise<MembershipAuditEntry[]> {
    const rows = await many<AuditRow>(
      requireDatabase()
        .prepare(
          "SELECT id, at, person_id, action, data_class, entity, row_level, subject_ref " +
            "FROM membership_audit ORDER BY at DESC, rowid DESC LIMIT ?",
        )
        .bind(limit),
    );
    return rows.map(auditOf);
  }
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

let instance: D1MembershipRepository | null = null;

/**
 * The D1 repository, or null when there is no binding.
 *
 * Null is a normal answer and not an error. `next dev` with no Worker
 * behind it has no binding, and the accessor in `repository.ts` falls
 * back to the in-memory roster in that case, which is what keeps the
 * module workable without a database.
 *
 * The instance is cached and the *decision* is not: the binding is
 * looked up on every call, so a build-time render that found no binding
 * does not pin the whole Worker to seed data afterwards. Caching is
 * free here because the object holds no connection — every method
 * reaches for the binding when it runs.
 */
export function d1MembershipRepositoryIfBound(): MembershipRepository | null {
  if (!database()) return null;
  instance ??= new D1MembershipRepository();
  return instance;
}
