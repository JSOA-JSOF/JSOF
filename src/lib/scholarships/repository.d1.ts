import "server-only";

/**
 * The scholarships repository, against D1.
 *
 * Same interface as `InMemoryScholarshipRepository`, same 38 methods, no
 * signature change: the interface was already fully async, so this is a
 * drop-in. `migrations/0007_scholarships.sql` is the contract and the
 * decisions in its comments are the decisions here.
 *
 * Four of those decisions shape this file.
 *
 * THE APPLICATION IS SIX TABLES, NOT ONE. `scholarship_application` carries
 * the applicant and the routing; the enrolment, the sponsor check, the merit
 * section and the Wounded Patriot section are their own rows, and the intake
 * flags are a set. So every read assembles and every write batches. An
 * application written as six separate awaits can leave an essay with no
 * application attached, and nothing would ever tell you — hence `atomic`
 * everywhere an object spans tables.
 *
 * `disability_verification` RECORDS HOW, NEVER WHAT. This file writes
 * `outcome`, `method`, who checked and when. It does not write, read or
 * derive any medical detail, and there is no column here that could carry
 * one.
 *
 * `selection_record` MUST SURVIVE THE APPLICATION. It references the cycle
 * and holds the application's reference as plain text, never a foreign key
 * to the application and never a name, so `purgeApplication` cannot take it
 * with it.
 *
 * `scholarship_audit` IS APPEND-ONLY BY TRIGGER. The only statement in this
 * file that touches it is an INSERT. There is deliberately no path that
 * updates or deletes a row, because the database would abort it.
 *
 * Nothing here authorizes. Authorization stays in the service layer above,
 * exactly as it does for the in-memory implementation.
 */

import type { DataClass, Entity } from "../authz/model";
import {
  atomic,
  int,
  many,
  newId,
  one,
  orNull,
  requireDatabase,
  text,
  toBool,
  toInt,
} from "../db";

import { PATRIOT_FOUNDATION } from "./routing";
import type { ScholarshipRepository } from "./repository";
import {
  CRITERION_KEYS,
  INTAKE_FLAGS,
  SCHOLARSHIP_CURRENCY,
  type Application,
  type ApplicationState,
  type Award,
  type AwardStatus,
  type BoardReview,
  type Cheque,
  type ChequeStatus,
  type CriterionKey,
  type Cycle,
  type CycleState,
  type DisabilityVerification,
  type EnrolmentLevel,
  type GuardianConsent,
  type GuardianRelationship,
  type IntakeFlag,
  type Program,
  type RelationshipKind,
  type ReviewerRelationship,
  type RoutingDecision,
  type RoutingOutcome,
  type ScholarshipAuditEntry,
  type School,
  type ScoreSheet,
  type SelectionRecord,
  type VerificationMethod,
  type VerificationOutcome,
} from "./types";

/* ------------------------------------------------------------------ *
 * Encodings
 *
 * Three domain fields are a list or an object where the schema gives one
 * TEXT column. They are encoded here rather than in each method so that
 * the choice is visible in one place and reversible in one place.
 * ------------------------------------------------------------------ */

/** A postal address: `School.addressLines` and `Cheque.addressLines`. */
function linesToText(lines: string[]): string {
  return lines.join("\n");
}

function textToLines(value: unknown): string[] {
  const raw = text(value);
  if (!raw) return [];
  return raw.split("\n");
}

/**
 * `MeritSection.activities`, a list of short phrases, into `activities TEXT`.
 * One per line, which is also how the applicant types them.
 */
function activitiesToText(activities: string[]): string {
  return activities.join("\n");
}

function textToActivities(value: unknown): string[] {
  const raw = text(value);
  if (!raw) return [];
  return raw.split("\n").filter((line) => line.trim().length > 0);
}

/**
 * `DisabilityEvidence`, as the three columns 0010 added.
 *
 * Written as `evidence_narrative`, `evidence_service_connection` and
 * `evidence_verification_contact`, never as JSON. 0010's reason is specific
 * and worth keeping in view here: `verificationContact` is a person the
 * chair may ring, and a name inside a JSON blob is a name nobody can find
 * when a retention sweep has to remove it.
 *
 * What is not stored is unchanged and is the point. The applicant's own
 * account, what they say the connection to service is, and who may confirm
 * it. Never a document, never an attachment, never a diagnosis.
 *
 * The read stays tolerant of the single `disability_evidence` column that
 * 0007 had, so a row written before 0010 still resolves: when all three
 * columns are empty and the legacy column is not, it is parsed. That is a
 * read path only. Nothing writes it any more.
 */
type StoredEvidence = {
  narrative: string;
  claimedServiceConnection: string;
  verificationContact: string;
};

function legacyEvidence(value: unknown): StoredEvidence {
  const raw = text(value);
  if (!raw) {
    return { narrative: "", claimedServiceConnection: "", verificationContact: "" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredEvidence>;
    if (parsed && typeof parsed === "object") {
      return {
        narrative: text(parsed.narrative),
        claimedServiceConnection: text(parsed.claimedServiceConnection),
        verificationContact: text(parsed.verificationContact),
      };
    }
  } catch {
    // Not JSON. Treat the column as the narrative, which is what it reads as.
  }
  return { narrative: raw, claimedServiceConnection: "", verificationContact: "" };
}

function rowToEvidence(row: WoundedPatriotRow): StoredEvidence {
  const evidence: StoredEvidence = {
    narrative: text(row.evidence_narrative),
    claimedServiceConnection: text(row.evidence_service_connection),
    verificationContact: text(row.evidence_verification_contact),
  };
  const empty =
    !evidence.narrative &&
    !evidence.claimedServiceConnection &&
    !evidence.verificationContact;
  return empty ? legacyEvidence(row.disability_evidence) : evidence;
}

/* ------------------------------------------------------------------ *
 * Row shapes
 * ------------------------------------------------------------------ */

type CycleRow = {
  id: string;
  entity: string;
  label: string;
  state: string;
  opens_at: string;
  closes_at: string;
  decisions_by: string;
  closed_at: string | null;
};

type SchoolRow = {
  id: string;
  name: string;
  payable_to: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  office: string | null;
};

type ApplicationRow = {
  id: string;
  entity: string;
  cycle_id: string;
  reference: string;
  state: string;
  created_at: string;
  submitted_at: string | null;
  step: number;
  applicant_full_name: string;
  applicant_email: string;
  applicant_phone: string;
  applicant_dob: string | null;
  applicant_residence_state: string;
  routing_outcome: string | null;
  routing_explanation: string;
  routing_referral_name: string | null;
  routing_decided_at: string | null;
  // 0010. Nullable: null is "predates the columns, nobody answered",
  // which is not the same as answered no.
  routing_nc_resident: number | null;
  routing_attending_nc_school: number | null;
  routing_applying_wounded_patriot: number | null;
  eligibility_outcome: string;
  eligibility_rule_version: string;
  board_member_person_id: string | null;
  withdrawn_at: string | null;
  decided_at: string | null;
};

type FlagRow = { application_id: string; flag: string };

type EnrolmentRow = {
  application_id: string;
  school_id: string;
  level: string;
  accredited_institution: number;
  academic_year: string;
  expected_completion: string;
  student_number: string;
};

type SponsorRow = {
  application_id: string;
  sponsor_member_id: string;
  checked_at: string;
  roster_member_id: string | null;
  on_roster: number;
  in_good_standing: number;
  sponsor_name: string | null;
  sponsor_email: string | null;
};

type MeritRow = {
  application_id: string;
  gpa_hundredths: number;
  transcript_summary: string;
  essay: string;
  activities: string;
  recommendation_from: string;
};

type WoundedPatriotRow = {
  application_id: string;
  service_member_relationship: string;
  /** 0007's single column. Read for old rows, never written. */
  disability_evidence: string;
  // 0010.
  evidence_narrative: string;
  evidence_service_connection: string;
  evidence_verification_contact: string;
};

type ConsentRow = {
  id: string;
  entity: string;
  application_id: string;
  guardian_name: string;
  guardian_email: string;
  guardian_phone: string;
  relationship: string;
  statement_version: string;
  consented_at: string;
};

type RelationshipRow = {
  id: string;
  entity: string;
  reviewer_person_id: string;
  application_id: string;
  kind: string;
  declared_at: string;
  declared_by_person_id: string;
  note: string | null;
};

type ScoreSheetRow = {
  id: string;
  entity: string;
  application_id: string;
  reviewer_person_id: string;
  total: number;
  comment: string;
  scored_at: string;
};

type ScorePointRow = { score_sheet_id: string; criterion: string; points: number };

type VerificationRow = {
  id: string;
  entity: string;
  application_id: string;
  outcome: string;
  verified_by_person_id: string;
  verified_at: string;
  method: string;
  note: string;
};

type AwardRow = {
  id: string;
  entity: string;
  cycle_id: string;
  application_id: string;
  program: string;
  amount_cents: number;
  currency: string;
  status: string;
  basis: string;
  proposed_at: string;
  decided_by_person_id: string | null;
  decided_at: string | null;
  notified_at: string | null;
};

type BoardReviewRow = {
  award_id: string;
  reason: string;
  recused_person_id: string;
  requested_at: string;
  requested_by_person_id: string;
  minute_ref: string | null;
  decided_at: string | null;
  outcome: string | null;
};

type ApproverRow = { award_id: string; person_id: string };

type ChequeRow = {
  id: string;
  entity: string;
  cycle_id: string;
  award_id: string;
  payee_school_id: string;
  payable_to: string;
  address: string;
  city: string;
  state: string;
  postal_code: string;
  office: string | null;
  amount_cents: number;
  currency: string;
  memo_reference: string;
  status: string;
  mailed_at: string | null;
  mailed_by_person_id: string | null;
  note: string | null;
};

type SelectionRow = {
  id: string;
  entity: string;
  cycle_id: string;
  application_ref: string;
  outcome: string;
  total_score: number | null;
  scores_recorded: number;
  eligibility_rule_version: string;
  school_state: string | null;
  decided_at: string;
  retain_until: string;
};

type SelectionAwardRow = {
  selection_record_id: string;
  program: string;
  amount_cents: number;
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

/* ------------------------------------------------------------------ *
 * Row to domain
 * ------------------------------------------------------------------ */

function asEntity(value: unknown): Entity {
  return text(value, "JSOF") as Entity;
}

function toCycle(row: CycleRow): Cycle {
  return {
    id: row.id,
    entity: asEntity(row.entity),
    label: text(row.label),
    state: text(row.state) as CycleState,
    opensAt: text(row.opens_at),
    closesAt: text(row.closes_at),
    decisionsBy: text(row.decisions_by),
    closedAt: orNull(row.closed_at),
  };
}

function toSchool(row: SchoolRow): School {
  return {
    id: row.id,
    name: text(row.name),
    payableTo: text(row.payable_to),
    addressLines: textToLines(row.address),
    city: text(row.city),
    state: text(row.state),
    postalCode: text(row.postal_code),
    office: orNull(row.office),
  };
}

/**
 * The routing decision, read from its own columns.
 *
 * The three answers are stored, not reconstructed: 0010 added
 * `routing_nc_resident`, `routing_attending_nc_school` and
 * `routing_applying_wounded_patriot` for exactly this. It matters because
 * `programsOpenTo()` in `routing.ts` recomputes which programmes an
 * applicant may apply for from `answers.applyingForWoundedPatriot`, and
 * `stepsFor()` decides from that whether the Wounded Patriot step appears
 * at all. Derived from whether the section exists, that answer is circular
 * — the section only gets created once the step appears — and the step
 * never appears, silently. Stored, it does.
 *
 * The columns are nullable and read as false here, because the domain type
 * is a boolean and has no third state. Null means the row predates 0010
 * and nobody answered, which is not the same as having answered no; that
 * distinction is kept in the column and lost at this boundary on purpose.
 * Nothing in this file writes null, because every write comes from a
 * `RoutingAnswers` that has real answers in it.
 */
function toRouting(row: ApplicationRow): RoutingDecision {
  const referralName = orNull(row.routing_referral_name);
  const referral =
    referralName === null
      ? null
      : referralName === PATRIOT_FOUNDATION.name
        ? { ...PATRIOT_FOUNDATION }
        : // Only the href and the note are lost; the name is what was stored.
          { name: referralName, href: "", note: "" };

  return {
    outcome: text(row.routing_outcome, "CONTINUE_HERE") as RoutingOutcome,
    answers: {
      ncResident: toBool(row.routing_nc_resident),
      attendingNcSchool: toBool(row.routing_attending_nc_school),
      applyingForWoundedPatriot: toBool(row.routing_applying_wounded_patriot),
    },
    explanation: text(row.routing_explanation),
    referral,
    decidedAt: text(row.routing_decided_at, text(row.created_at)),
  };
}

const KNOWN_FLAGS = new Set<string>(INTAKE_FLAGS);

type ApplicationChildren = {
  flags: Map<string, string[]>;
  enrolments: Map<string, EnrolmentRow>;
  sponsors: Map<string, SponsorRow>;
  merits: Map<string, MeritRow>;
  wounded: Map<string, WoundedPatriotRow>;
  consentIds: Map<string, string>;
};

function toApplication(row: ApplicationRow, children: ApplicationChildren): Application {
  const enrolmentRow = children.enrolments.get(row.id);
  const sponsorRow = children.sponsors.get(row.id);
  const meritRow = children.merits.get(row.id);
  const woundedRow = children.wounded.get(row.id);

  return {
    id: row.id,
    entity: asEntity(row.entity),
    cycleId: text(row.cycle_id),
    reference: text(row.reference),
    state: text(row.state) as ApplicationState,
    createdAt: text(row.created_at),
    submittedAt: orNull(row.submitted_at),
    step: int(row.step),
    routing: toRouting(row),
    applicant: {
      fullName: text(row.applicant_full_name),
      email: text(row.applicant_email),
      phone: text(row.applicant_phone),
      dateOfBirth: text(row.applicant_dob),
      residenceState: text(row.applicant_residence_state),
    },
    enrolment: enrolmentRow
      ? {
          schoolId: text(enrolmentRow.school_id),
          level: text(enrolmentRow.level) as EnrolmentLevel,
          accreditedInstitution: toBool(enrolmentRow.accredited_institution),
          academicYear: text(enrolmentRow.academic_year),
          expectedCompletion: text(enrolmentRow.expected_completion),
          studentNumber: text(enrolmentRow.student_number),
        }
      : null,
    sponsor: sponsorRow
      ? {
          sponsorMemberId: text(sponsorRow.sponsor_member_id),
          checkedAt: text(sponsorRow.checked_at),
          rosterMemberId: orNull(sponsorRow.roster_member_id),
          onRoster: toBool(sponsorRow.on_roster),
          inGoodStanding: toBool(sponsorRow.in_good_standing),
          sponsorName: orNull(sponsorRow.sponsor_name),
          sponsorEmail: orNull(sponsorRow.sponsor_email),
        }
      : null,
    merit: meritRow
      ? {
          gpaHundredths: int(meritRow.gpa_hundredths),
          transcriptSummary: text(meritRow.transcript_summary),
          essay: text(meritRow.essay),
          activities: textToActivities(meritRow.activities),
          recommendationFrom: text(meritRow.recommendation_from),
        }
      : null,
    woundedPatriot: woundedRow
      ? {
          serviceMemberRelationship: text(woundedRow.service_member_relationship),
          disabilityEvidence: rowToEvidence(woundedRow),
        }
      : null,
    guardianConsentId: children.consentIds.get(row.id) ?? null,
    eligibilityOutcome: text(row.eligibility_outcome),
    eligibilityRuleVersion: text(row.eligibility_rule_version),
    flags: (children.flags.get(row.id) ?? []).filter((flag) =>
      KNOWN_FLAGS.has(flag),
    ) as IntakeFlag[],
    boardMemberPersonId: orNull(row.board_member_person_id),
    withdrawnAt: orNull(row.withdrawn_at),
    decidedAt: orNull(row.decided_at),
  };
}

function toConsent(row: ConsentRow): GuardianConsent {
  return {
    id: row.id,
    entity: asEntity(row.entity),
    applicationId: text(row.application_id),
    guardianName: text(row.guardian_name),
    guardianEmail: text(row.guardian_email),
    guardianPhone: text(row.guardian_phone),
    relationship: text(row.relationship) as GuardianRelationship,
    statementVersion: text(row.statement_version),
    consentedAt: text(row.consented_at),
  };
}

function toRelationship(row: RelationshipRow): ReviewerRelationship {
  return {
    id: row.id,
    entity: asEntity(row.entity),
    reviewerPersonId: text(row.reviewer_person_id),
    applicationId: text(row.application_id),
    kind: text(row.kind) as RelationshipKind,
    declaredAt: text(row.declared_at),
    declaredByPersonId: text(row.declared_by_person_id),
    note: orNull(row.note),
  };
}

function emptyPoints(): Record<CriterionKey, number> {
  const points = {} as Record<CriterionKey, number>;
  for (const key of CRITERION_KEYS) points[key] = 0;
  return points;
}

function toScoreSheet(row: ScoreSheetRow, points: ScorePointRow[]): ScoreSheet {
  const filled = emptyPoints();
  for (const point of points) {
    if ((CRITERION_KEYS as readonly string[]).includes(point.criterion)) {
      filled[point.criterion as CriterionKey] = int(point.points);
    }
  }
  return {
    id: row.id,
    entity: asEntity(row.entity),
    applicationId: text(row.application_id),
    reviewerPersonId: text(row.reviewer_person_id),
    points: filled,
    total: int(row.total),
    comment: text(row.comment),
    scoredAt: text(row.scored_at),
  };
}

function toVerification(row: VerificationRow): DisabilityVerification {
  return {
    id: row.id,
    entity: asEntity(row.entity),
    applicationId: text(row.application_id),
    outcome: text(row.outcome) as VerificationOutcome,
    verifiedByPersonId: text(row.verified_by_person_id),
    verifiedAt: text(row.verified_at),
    method: text(row.method) as VerificationMethod,
    note: text(row.note),
  };
}

function toAward(
  row: AwardRow,
  review: BoardReviewRow | undefined,
  approvers: string[],
): Award {
  const boardReview: BoardReview | null = review
    ? {
        reason: "BOARD_MEMBER_DEPENDENT",
        recusedPersonId: text(review.recused_person_id),
        requestedAt: text(review.requested_at),
        requestedByPersonId: text(review.requested_by_person_id),
        minuteRef: orNull(review.minute_ref),
        decidedAt: orNull(review.decided_at),
        outcome: orNull(review.outcome) as "APPROVED" | "DECLINED" | null,
        approverPersonIds: approvers,
      }
    : null;

  return {
    id: row.id,
    entity: asEntity(row.entity),
    cycleId: text(row.cycle_id),
    applicationId: text(row.application_id),
    program: text(row.program) as Program,
    amountCents: int(row.amount_cents),
    currency: text(row.currency, SCHOLARSHIP_CURRENCY) as typeof SCHOLARSHIP_CURRENCY,
    status: text(row.status) as AwardStatus,
    basis: text(row.basis),
    proposedAt: text(row.proposed_at),
    decidedByPersonId: orNull(row.decided_by_person_id),
    decidedAt: orNull(row.decided_at),
    boardReview,
    notifiedAt: orNull(row.notified_at),
  };
}

function toCheque(row: ChequeRow): Cheque {
  return {
    id: row.id,
    entity: asEntity(row.entity),
    cycleId: text(row.cycle_id),
    awardId: text(row.award_id),
    payeeSchoolId: text(row.payee_school_id),
    payableTo: text(row.payable_to),
    addressLines: textToLines(row.address),
    city: text(row.city),
    state: text(row.state),
    postalCode: text(row.postal_code),
    office: orNull(row.office),
    amountCents: int(row.amount_cents),
    currency: text(row.currency, SCHOLARSHIP_CURRENCY) as typeof SCHOLARSHIP_CURRENCY,
    memoReference: text(row.memo_reference),
    status: text(row.status) as ChequeStatus,
    mailedAt: orNull(row.mailed_at),
    mailedByPersonId: orNull(row.mailed_by_person_id),
    note: orNull(row.note),
  };
}

function toSelectionRecord(
  row: SelectionRow,
  awards: SelectionAwardRow[],
): SelectionRecord {
  return {
    id: row.id,
    entity: asEntity(row.entity),
    cycleId: text(row.cycle_id),
    applicationRef: text(row.application_ref),
    outcome: text(row.outcome) as ApplicationState,
    totalScore: row.total_score === null ? null : int(row.total_score),
    scoresRecorded: int(row.scores_recorded),
    awards: awards.map((a) => ({
      program: text(a.program) as Program,
      amountCents: int(a.amount_cents),
    })),
    eligibilityRuleVersion: text(row.eligibility_rule_version),
    schoolState: orNull(row.school_state),
    decidedAt: text(row.decided_at),
    retainUntil: text(row.retain_until),
  };
}

function toAuditEntry(row: AuditRow): ScholarshipAuditEntry {
  return {
    id: row.id,
    at: text(row.at),
    personId: text(row.person_id),
    action: text(row.action),
    dataClass: text(row.data_class) as DataClass,
    entity: asEntity(row.entity),
    rowLevel: toBool(row.row_level),
    subjectRef: orNull(row.subject_ref),
  };
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

function groupBy<R, K>(rows: R[], key: (row: R) => K): Map<K, R[]> {
  const out = new Map<K, R[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

function indexBy<R, K>(rows: R[], key: (row: R) => K): Map<K, R> {
  const out = new Map<K, R>();
  for (const row of rows) out.set(key(row), row);
  return out;
}

/* ------------------------------------------------------------------ *
 * The implementation
 * ------------------------------------------------------------------ */

export class D1ScholarshipRepository implements ScholarshipRepository {
  private db(): D1Database {
    return requireDatabase();
  }

  /* Cycles and schools ------------------------------------------- */

  async listCycles(): Promise<Cycle[]> {
    const rows = await many<CycleRow>(
      this.db().prepare("SELECT * FROM scholarship_cycle ORDER BY opens_at, id"),
    );
    return rows.map(toCycle);
  }

  async getCycle(id: string): Promise<Cycle | null> {
    const row = await one<CycleRow>(
      this.db().prepare("SELECT * FROM scholarship_cycle WHERE id = ?").bind(id),
    );
    return row ? toCycle(row) : null;
  }

  /**
   * The cycle the module is working in.
   *
   * Same rule as the in-memory implementation: an open or planned cycle if
   * there is one, otherwise the most recent. "Most recent" is `opens_at`
   * here, because a table has no insertion order to fall back on.
   */
  async currentCycle(): Promise<Cycle> {
    const open = await one<CycleRow>(
      this.db().prepare(
        "SELECT * FROM scholarship_cycle WHERE state IN ('OPEN', 'PLANNED') " +
          "ORDER BY opens_at, id LIMIT 1",
      ),
    );
    if (open) return toCycle(open);
    const latest = await one<CycleRow>(
      this.db().prepare(
        "SELECT * FROM scholarship_cycle ORDER BY opens_at DESC, id DESC LIMIT 1",
      ),
    );
    if (!latest) throw new Error("No scholarship cycle is configured");
    return toCycle(latest);
  }

  async listSchools(): Promise<School[]> {
    const rows = await many<SchoolRow>(
      this.db().prepare("SELECT * FROM school ORDER BY name, id"),
    );
    return rows.map(toSchool);
  }

  async getSchool(id: string): Promise<School | null> {
    const row = await one<SchoolRow>(
      this.db().prepare("SELECT * FROM school WHERE id = ?").bind(id),
    );
    return row ? toSchool(row) : null;
  }

  /* Applications ------------------------------------------------- */

  /**
   * Read a set of applications and everything hanging off them.
   *
   * Seven statements for any number of applications rather than seven per
   * application: the child tables are read with the same WHERE as a
   * subquery and assembled in memory. A cycle is 150 applications and the
   * board screens read all of them at once.
   */
  private async loadApplications(
    where: string,
    binds: unknown[],
    order: string,
  ): Promise<Application[]> {
    const db = this.db();
    const scope = `SELECT id FROM scholarship_application WHERE ${where}`;

    const rows = await many<ApplicationRow>(
      db
        .prepare(`SELECT * FROM scholarship_application WHERE ${where} ${order}`)
        .bind(...binds),
    );
    if (rows.length === 0) return [];

    const [flagRows, enrolmentRows, sponsorRows, meritRows, woundedRows, consentRows] =
      await Promise.all([
        many<FlagRow>(
          db
            .prepare(
              "SELECT application_id, flag FROM scholarship_application_flag " +
                `WHERE application_id IN (${scope}) ORDER BY rowid`,
            )
            .bind(...binds),
        ),
        many<EnrolmentRow>(
          db
            .prepare(
              `SELECT * FROM scholarship_enrolment WHERE application_id IN (${scope})`,
            )
            .bind(...binds),
        ),
        many<SponsorRow>(
          db
            .prepare(
              `SELECT * FROM scholarship_sponsor_check WHERE application_id IN (${scope})`,
            )
            .bind(...binds),
        ),
        many<MeritRow>(
          db
            .prepare(`SELECT * FROM scholarship_merit WHERE application_id IN (${scope})`)
            .bind(...binds),
        ),
        many<WoundedPatriotRow>(
          db
            .prepare(
              `SELECT * FROM scholarship_wounded_patriot WHERE application_id IN (${scope})`,
            )
            .bind(...binds),
        ),
        many<{ id: string; application_id: string }>(
          db
            .prepare(
              `SELECT id, application_id FROM guardian_consent WHERE application_id IN (${scope})`,
            )
            .bind(...binds),
        ),
      ]);

    const children: ApplicationChildren = {
      flags: new Map(
        [...groupBy(flagRows, (r) => r.application_id)].map(([id, list]) => [
          id,
          list.map((r) => r.flag),
        ]),
      ),
      enrolments: indexBy(enrolmentRows, (r) => r.application_id),
      sponsors: indexBy(sponsorRows, (r) => r.application_id),
      merits: indexBy(meritRows, (r) => r.application_id),
      wounded: indexBy(woundedRows, (r) => r.application_id),
      consentIds: new Map(consentRows.map((r) => [r.application_id, r.id])),
    };

    return rows.map((row) => toApplication(row, children));
  }

  /**
   * Insert the draft and every section it already has, in one batch.
   *
   * A draft from `startApplication` has none, but `createDraft` takes a
   * whole `Application` and the sections have to land with it or not at
   * all. An application row with no enrolment row is a half-written
   * application that nothing will report.
   */
  async createDraft(draft: Application): Promise<Application> {
    const statements: D1PreparedStatement[] = [
      this.insertApplicationStatement(draft),
      ...this.flagStatements(draft.id, draft.flags),
      ...this.sectionStatements(draft.id, {
        enrolment: draft.enrolment,
        sponsor: draft.sponsor,
        merit: draft.merit,
        woundedPatriot: draft.woundedPatriot,
      }),
    ];
    await atomic(statements);
    const stored = await this.getApplication(draft.id);
    if (!stored) throw new Error(`Could not read back application ${draft.id}`);
    return stored;
  }

  private insertApplicationStatement(application: Application): D1PreparedStatement {
    return this.db()
      .prepare(
        "INSERT INTO scholarship_application (" +
          "id, entity, cycle_id, reference, state, created_at, submitted_at, step, " +
          "applicant_full_name, applicant_email, applicant_phone, applicant_dob, " +
          "applicant_residence_state, routing_outcome, routing_explanation, " +
          "routing_referral_name, routing_decided_at, routing_nc_resident, " +
          "routing_attending_nc_school, routing_applying_wounded_patriot, " +
          "eligibility_outcome, eligibility_rule_version, board_member_person_id, " +
          "withdrawn_at, decided_at" +
          ") VALUES (" +
          placeholders(25) +
          ")",
      )
      .bind(
        application.id,
        application.entity,
        application.cycleId,
        application.reference,
        application.state,
        application.createdAt,
        application.submittedAt,
        application.step,
        application.applicant.fullName,
        application.applicant.email,
        application.applicant.phone,
        application.applicant.dateOfBirth,
        application.applicant.residenceState,
        application.routing.outcome,
        application.routing.explanation,
        application.routing.referral?.name ?? null,
        application.routing.decidedAt,
        toInt(application.routing.answers.ncResident),
        toInt(application.routing.answers.attendingNcSchool),
        toInt(application.routing.answers.applyingForWoundedPatriot),
        application.eligibilityOutcome,
        application.eligibilityRuleVersion,
        application.boardMemberPersonId,
        application.withdrawnAt,
        application.decidedAt,
      );
  }

  private flagStatements(
    applicationId: string,
    flags: IntakeFlag[],
  ): D1PreparedStatement[] {
    const db = this.db();
    const statements = [
      db
        .prepare("DELETE FROM scholarship_application_flag WHERE application_id = ?")
        .bind(applicationId),
    ];
    for (const flag of new Set(flags)) {
      statements.push(
        db
          .prepare(
            "INSERT INTO scholarship_application_flag (application_id, flag) VALUES (?, ?)",
          )
          .bind(applicationId, flag),
      );
    }
    return statements;
  }

  /**
   * The four section tables, from a patch.
   *
   * A key that is absent is left alone; a key present and null removes the
   * row, because `merit: null` on the domain object means the applicant did
   * not apply for Merit and a leftover row would say otherwise.
   */
  private sectionStatements(
    applicationId: string,
    patch: Pick<Partial<Application>, "enrolment" | "sponsor" | "merit" | "woundedPatriot">,
  ): D1PreparedStatement[] {
    const db = this.db();
    const statements: D1PreparedStatement[] = [];

    if ("enrolment" in patch) {
      const enrolment = patch.enrolment ?? null;
      statements.push(
        db
          .prepare("DELETE FROM scholarship_enrolment WHERE application_id = ?")
          .bind(applicationId),
      );
      if (enrolment) {
        statements.push(
          db
            .prepare(
              "INSERT INTO scholarship_enrolment (application_id, school_id, level, " +
                "accredited_institution, academic_year, expected_completion, student_number) " +
                `VALUES (${placeholders(7)})`,
            )
            .bind(
              applicationId,
              enrolment.schoolId,
              enrolment.level,
              toInt(enrolment.accreditedInstitution),
              enrolment.academicYear,
              enrolment.expectedCompletion,
              enrolment.studentNumber,
            ),
        );
      }
    }

    if ("sponsor" in patch) {
      const sponsor = patch.sponsor ?? null;
      statements.push(
        db
          .prepare("DELETE FROM scholarship_sponsor_check WHERE application_id = ?")
          .bind(applicationId),
      );
      if (sponsor) {
        statements.push(
          db
            .prepare(
              "INSERT INTO scholarship_sponsor_check (application_id, sponsor_member_id, " +
                "checked_at, roster_member_id, on_roster, in_good_standing, sponsor_name, " +
                `sponsor_email) VALUES (${placeholders(8)})`,
            )
            .bind(
              applicationId,
              sponsor.sponsorMemberId,
              sponsor.checkedAt,
              sponsor.rosterMemberId,
              toInt(sponsor.onRoster),
              toInt(sponsor.inGoodStanding),
              sponsor.sponsorName,
              sponsor.sponsorEmail,
            ),
        );
      }
    }

    if ("merit" in patch) {
      const merit = patch.merit ?? null;
      statements.push(
        db
          .prepare("DELETE FROM scholarship_merit WHERE application_id = ?")
          .bind(applicationId),
      );
      if (merit) {
        statements.push(
          db
            .prepare(
              "INSERT INTO scholarship_merit (application_id, gpa_hundredths, " +
                "transcript_summary, essay, activities, recommendation_from) " +
                `VALUES (${placeholders(6)})`,
            )
            .bind(
              applicationId,
              merit.gpaHundredths,
              merit.transcriptSummary,
              merit.essay,
              activitiesToText(merit.activities),
              merit.recommendationFrom,
            ),
        );
      }
    }

    if ("woundedPatriot" in patch) {
      const section = patch.woundedPatriot ?? null;
      statements.push(
        db
          .prepare("DELETE FROM scholarship_wounded_patriot WHERE application_id = ?")
          .bind(applicationId),
      );
      if (section) {
        statements.push(
          db
            .prepare(
              // `disability_evidence` is 0007's single column and is left to
              // its default. The three columns 0010 added are what is
              // written: a verification contact nobody can find is a name a
              // retention sweep cannot remove.
              "INSERT INTO scholarship_wounded_patriot (application_id, " +
                "service_member_relationship, evidence_narrative, " +
                "evidence_service_connection, evidence_verification_contact) " +
                `VALUES (${placeholders(5)})`,
            )
            .bind(
              applicationId,
              section.serviceMemberRelationship,
              section.disabilityEvidence.narrative,
              section.disabilityEvidence.claimedServiceConnection,
              section.disabilityEvidence.verificationContact,
            ),
        );
      }
    }

    return statements;
  }

  async getApplication(id: string): Promise<Application | null> {
    const found = await this.loadApplications("id = ?", [id], "");
    return found[0] ?? null;
  }

  async getApplicationByReference(reference: string): Promise<Application | null> {
    const found = await this.loadApplications("reference = ?", [reference], "");
    return found[0] ?? null;
  }

  /**
   * Patch semantics, matching `Object.assign` on the in-memory record: a
   * key that is absent is untouched, a key present is written. Scalar
   * columns go in one UPDATE, the flags and the four sections in the same
   * batch, so an application never holds half of a change.
   */
  async updateApplication(id: string, patch: Partial<Application>): Promise<Application> {
    const exists = await one<{ id: string }>(
      this.db().prepare("SELECT id FROM scholarship_application WHERE id = ?").bind(id),
    );
    if (!exists) throw new Error(`No application ${id}`);

    const columns: string[] = [];
    const binds: unknown[] = [];
    const set = (column: string, value: unknown): void => {
      columns.push(`${column} = ?`);
      binds.push(value);
    };

    if ("entity" in patch) set("entity", patch.entity);
    if ("cycleId" in patch) set("cycle_id", patch.cycleId);
    if ("reference" in patch) set("reference", patch.reference);
    if ("state" in patch) set("state", patch.state);
    if ("createdAt" in patch) set("created_at", patch.createdAt);
    if ("submittedAt" in patch) set("submitted_at", patch.submittedAt ?? null);
    if ("step" in patch) set("step", patch.step);
    if ("applicant" in patch && patch.applicant) {
      set("applicant_full_name", patch.applicant.fullName);
      set("applicant_email", patch.applicant.email);
      set("applicant_phone", patch.applicant.phone);
      set("applicant_dob", patch.applicant.dateOfBirth);
      set("applicant_residence_state", patch.applicant.residenceState);
    }
    if ("routing" in patch && patch.routing) {
      set("routing_outcome", patch.routing.outcome);
      set("routing_explanation", patch.routing.explanation);
      set("routing_referral_name", patch.routing.referral?.name ?? null);
      set("routing_nc_resident", toInt(patch.routing.answers.ncResident));
      set("routing_attending_nc_school", toInt(patch.routing.answers.attendingNcSchool));
      set(
        "routing_applying_wounded_patriot",
        toInt(patch.routing.answers.applyingForWoundedPatriot),
      );
      set("routing_decided_at", patch.routing.decidedAt);
    }
    if ("eligibilityOutcome" in patch) set("eligibility_outcome", patch.eligibilityOutcome);
    if ("eligibilityRuleVersion" in patch) {
      set("eligibility_rule_version", patch.eligibilityRuleVersion);
    }
    if ("boardMemberPersonId" in patch) {
      set("board_member_person_id", patch.boardMemberPersonId ?? null);
    }
    if ("withdrawnAt" in patch) set("withdrawn_at", patch.withdrawnAt ?? null);
    if ("decidedAt" in patch) set("decided_at", patch.decidedAt ?? null);

    // `guardianConsentId` is deliberately not written. The pointer is the
    // `guardian_consent.application_id` unique key, so the consent record
    // IS the pointer and the application has no column for it. Setting it
    // after `createGuardianConsent` is therefore already true, and nulling
    // it would mean destroying a consent, which this method must not do.

    const statements: D1PreparedStatement[] = [];
    if (columns.length > 0) {
      statements.push(
        this.db()
          .prepare(
            `UPDATE scholarship_application SET ${columns.join(", ")} WHERE id = ?`,
          )
          .bind(...binds, id),
      );
    }
    if ("flags" in patch) statements.push(...this.flagStatements(id, patch.flags ?? []));
    statements.push(...this.sectionStatements(id, patch));

    await atomic(statements);

    const stored = await this.getApplication(id);
    if (!stored) throw new Error(`No application ${id}`);
    return stored;
  }

  async listApplications(filter?: {
    cycleId?: string;
    states?: ApplicationState[];
  }): Promise<Application[]> {
    const conditions: string[] = ["1 = 1"];
    const binds: unknown[] = [];
    if (filter?.cycleId) {
      conditions.push("cycle_id = ?");
      binds.push(filter.cycleId);
    }
    if (filter?.states) {
      // An explicit empty list matches nothing, as `includes` does.
      if (filter.states.length === 0) return [];
      conditions.push(`state IN (${placeholders(filter.states.length)})`);
      binds.push(...filter.states);
    }
    return this.loadApplications(
      conditions.join(" AND "),
      binds,
      "ORDER BY COALESCE(submitted_at, created_at), id",
    );
  }

  async countApplicationsByEmail(cycleId: string, email: string): Promise<number> {
    const needle = email.trim().toLowerCase();
    if (!needle) return 0;
    const row = await one<{ n: number }>(
      this.db()
        .prepare(
          "SELECT COUNT(*) AS n FROM scholarship_application " +
            "WHERE cycle_id = ? AND state <> 'DRAFT' " +
            "AND lower(trim(applicant_email)) = ?",
        )
        .bind(cycleId, needle),
    );
    return int(row?.n);
  }

  /**
   * Remove the draft outright.
   *
   * Takes the section rows with it. The in-memory implementation can drop
   * the application and leave the children to be garbage; a database
   * cannot, because the children hold foreign keys to the row that just
   * went.
   */
  async discardDraft(id: string): Promise<void> {
    await atomic(this.applicationCascade(id));
  }

  /**
   * Every statement that removes an application and the personal data
   * hanging off it, in foreign-key order: the score points before the
   * sheets they belong to, the sections before the application.
   *
   * Awards and cheques are NOT here. An award carries a non-null foreign
   * key to the application, so the batch will be refused for an
   * application that has one; see the note on `purgeApplication`.
   */
  private applicationCascade(id: string): D1PreparedStatement[] {
    const db = this.db();
    return [
      db
        .prepare(
          "DELETE FROM score_point WHERE score_sheet_id IN " +
            "(SELECT id FROM score_sheet WHERE application_id = ?)",
        )
        .bind(id),
      db.prepare("DELETE FROM score_sheet WHERE application_id = ?").bind(id),
      db.prepare("DELETE FROM disability_verification WHERE application_id = ?").bind(id),
      db.prepare("DELETE FROM reviewer_relationship WHERE application_id = ?").bind(id),
      db.prepare("DELETE FROM guardian_consent WHERE application_id = ?").bind(id),
      db.prepare("DELETE FROM scholarship_enrolment WHERE application_id = ?").bind(id),
      db.prepare("DELETE FROM scholarship_sponsor_check WHERE application_id = ?").bind(id),
      db.prepare("DELETE FROM scholarship_merit WHERE application_id = ?").bind(id),
      db
        .prepare("DELETE FROM scholarship_wounded_patriot WHERE application_id = ?")
        .bind(id),
      db
        .prepare("DELETE FROM scholarship_application_flag WHERE application_id = ?")
        .bind(id),
      db.prepare("DELETE FROM scholarship_application WHERE id = ?").bind(id),
    ];
  }

  /* Guardian consent --------------------------------------------- */

  async createGuardianConsent(consent: GuardianConsent): Promise<GuardianConsent> {
    await this.db()
      .prepare(
        "INSERT INTO guardian_consent (id, entity, application_id, guardian_name, " +
          "guardian_email, guardian_phone, relationship, statement_version, consented_at) " +
          `VALUES (${placeholders(9)})`,
      )
      .bind(
        consent.id,
        consent.entity,
        consent.applicationId,
        consent.guardianName,
        consent.guardianEmail,
        consent.guardianPhone,
        consent.relationship,
        consent.statementVersion,
        consent.consentedAt,
      )
      .run();
    return { ...consent };
  }

  async getGuardianConsent(id: string): Promise<GuardianConsent | null> {
    const row = await one<ConsentRow>(
      this.db().prepare("SELECT * FROM guardian_consent WHERE id = ?").bind(id),
    );
    return row ? toConsent(row) : null;
  }

  async getGuardianConsentForApplication(
    applicationId: string,
  ): Promise<GuardianConsent | null> {
    const row = await one<ConsentRow>(
      this.db()
        .prepare("SELECT * FROM guardian_consent WHERE application_id = ?")
        .bind(applicationId),
    );
    return row ? toConsent(row) : null;
  }

  /* Conflicts ---------------------------------------------------- */

  async listRelationships(reviewerPersonId?: string): Promise<ReviewerRelationship[]> {
    const statement = reviewerPersonId
      ? this.db()
          .prepare(
            "SELECT * FROM reviewer_relationship WHERE reviewer_person_id = ? " +
              "ORDER BY declared_at, id",
          )
          .bind(reviewerPersonId)
      : this.db().prepare("SELECT * FROM reviewer_relationship ORDER BY declared_at, id");
    const rows = await many<RelationshipRow>(statement);
    return rows.map(toRelationship);
  }

  async getRelationship(
    reviewerPersonId: string,
    applicationId: string,
  ): Promise<ReviewerRelationship | null> {
    const row = await one<RelationshipRow>(
      this.db()
        .prepare(
          "SELECT * FROM reviewer_relationship WHERE reviewer_person_id = ? " +
            "AND application_id = ?",
        )
        .bind(reviewerPersonId, applicationId),
    );
    return row ? toRelationship(row) : null;
  }

  async declareRelationship(
    relationship: ReviewerRelationship,
  ): Promise<ReviewerRelationship> {
    await this.db()
      .prepare(
        "INSERT INTO reviewer_relationship (id, entity, reviewer_person_id, " +
          "application_id, kind, declared_at, declared_by_person_id, note) " +
          `VALUES (${placeholders(8)})`,
      )
      .bind(
        relationship.id,
        relationship.entity,
        relationship.reviewerPersonId,
        relationship.applicationId,
        relationship.kind,
        relationship.declaredAt,
        relationship.declaredByPersonId,
        relationship.note,
      )
      .run();
    return { ...relationship };
  }

  /* Scoring ------------------------------------------------------ */

  private async loadScoreSheets(
    where: string,
    binds: unknown[],
  ): Promise<ScoreSheet[]> {
    const db = this.db();
    const rows = await many<ScoreSheetRow>(
      db
        .prepare(`SELECT * FROM score_sheet WHERE ${where} ORDER BY scored_at, id`)
        .bind(...binds),
    );
    if (rows.length === 0) return [];
    const points = await many<ScorePointRow>(
      db
        .prepare(
          "SELECT * FROM score_point WHERE score_sheet_id IN " +
            `(SELECT id FROM score_sheet WHERE ${where})`,
        )
        .bind(...binds),
    );
    const bySheet = groupBy(points, (p) => p.score_sheet_id);
    return rows.map((row) => toScoreSheet(row, bySheet.get(row.id) ?? []));
  }

  async listScoreSheets(applicationId: string): Promise<ScoreSheet[]> {
    return this.loadScoreSheets("application_id = ?", [applicationId]);
  }

  async listScoreSheetsForApplications(applicationIds: string[]): Promise<ScoreSheet[]> {
    if (applicationIds.length === 0) return [];
    const unique = [...new Set(applicationIds)];
    return this.loadScoreSheets(
      `application_id IN (${placeholders(unique.length)})`,
      unique,
    );
  }

  async getScoreSheet(
    applicationId: string,
    reviewerPersonId: string,
  ): Promise<ScoreSheet | null> {
    const found = await this.loadScoreSheets(
      "application_id = ? AND reviewer_person_id = ?",
      [applicationId, reviewerPersonId],
    );
    return found[0] ?? null;
  }

  /**
   * One sheet per reviewer per application, per the schema's unique key: a
   * second opinion from the same reviewer is an edit. The sheet and its
   * five criterion rows go in one batch, because a total without its
   * points is a figure nobody can explain.
   */
  async upsertScoreSheet(sheet: ScoreSheet): Promise<ScoreSheet> {
    const db = this.db();
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          "DELETE FROM score_point WHERE score_sheet_id IN " +
            "(SELECT id FROM score_sheet WHERE application_id = ? " +
            "AND reviewer_person_id = ?)",
        )
        .bind(sheet.applicationId, sheet.reviewerPersonId),
      db
        .prepare(
          "DELETE FROM score_sheet WHERE application_id = ? AND reviewer_person_id = ?",
        )
        .bind(sheet.applicationId, sheet.reviewerPersonId),
      db
        .prepare(
          "INSERT INTO score_sheet (id, entity, application_id, reviewer_person_id, " +
            `total, comment, scored_at) VALUES (${placeholders(7)})`,
        )
        .bind(
          sheet.id,
          sheet.entity,
          sheet.applicationId,
          sheet.reviewerPersonId,
          sheet.total,
          sheet.comment,
          sheet.scoredAt,
        ),
    ];
    for (const key of CRITERION_KEYS) {
      statements.push(
        db
          .prepare(
            "INSERT INTO score_point (score_sheet_id, criterion, points) VALUES (?, ?, ?)",
          )
          .bind(sheet.id, key, sheet.points[key] ?? 0),
      );
    }
    await atomic(statements);

    const stored = await this.getScoreSheet(sheet.applicationId, sheet.reviewerPersonId);
    if (!stored) throw new Error(`Could not read back score sheet ${sheet.id}`);
    return stored;
  }

  /* Disability verification -------------------------------------- */

  async getVerification(applicationId: string): Promise<DisabilityVerification | null> {
    const row = await one<VerificationRow>(
      this.db()
        .prepare(
          "SELECT * FROM disability_verification WHERE application_id = ? " +
            "ORDER BY verified_at DESC, id DESC LIMIT 1",
        )
        .bind(applicationId),
    );
    return row ? toVerification(row) : null;
  }

  /**
   * Record that a person checked, and how.
   *
   * `method` is one of the four ways a human can have checked and `note`
   * is the chair's own words about who she spoke to. Neither this method
   * nor the schema has anywhere to put what was seen, which is the point:
   * the Foundation needs to know somebody verified it, not to hold a
   * medical record.
   */
  async recordVerification(
    record: DisabilityVerification,
  ): Promise<DisabilityVerification> {
    const db = this.db();
    await atomic([
      db
        .prepare("DELETE FROM disability_verification WHERE application_id = ?")
        .bind(record.applicationId),
      db
        .prepare(
          "INSERT INTO disability_verification (id, entity, application_id, outcome, " +
            "verified_by_person_id, verified_at, method, note) " +
            `VALUES (${placeholders(8)})`,
        )
        .bind(
          record.id,
          record.entity,
          record.applicationId,
          record.outcome,
          record.verifiedByPersonId,
          record.verifiedAt,
          record.method,
          record.note,
        ),
    ]);
    return { ...record };
  }

  /* Awards ------------------------------------------------------- */

  private async loadAwards(where: string, binds: unknown[]): Promise<Award[]> {
    const db = this.db();
    const rows = await many<AwardRow>(
      db
        .prepare(`SELECT * FROM award WHERE ${where} ORDER BY proposed_at, id`)
        .bind(...binds),
    );
    if (rows.length === 0) return [];
    const scope = `SELECT id FROM award WHERE ${where}`;
    const [reviews, approvers] = await Promise.all([
      many<BoardReviewRow>(
        db
          .prepare(`SELECT * FROM award_board_review WHERE award_id IN (${scope})`)
          .bind(...binds),
      ),
      many<ApproverRow>(
        db
          .prepare(
            "SELECT award_id, person_id FROM award_board_approver " +
              `WHERE award_id IN (${scope}) ORDER BY rowid`,
          )
          .bind(...binds),
      ),
    ]);
    const reviewByAward = indexBy(reviews, (r) => r.award_id);
    const approversByAward = groupBy(approvers, (a) => a.award_id);
    return rows.map((row) =>
      toAward(
        row,
        reviewByAward.get(row.id),
        (approversByAward.get(row.id) ?? []).map((a) => a.person_id),
      ),
    );
  }

  async listAwards(filter?: {
    cycleId?: string;
    applicationId?: string;
  }): Promise<Award[]> {
    const conditions: string[] = ["1 = 1"];
    const binds: unknown[] = [];
    if (filter?.cycleId) {
      conditions.push("cycle_id = ?");
      binds.push(filter.cycleId);
    }
    if (filter?.applicationId) {
      conditions.push("application_id = ?");
      binds.push(filter.applicationId);
    }
    return this.loadAwards(conditions.join(" AND "), binds);
  }

  async getAward(id: string): Promise<Award | null> {
    const found = await this.loadAwards("id = ?", [id]);
    return found[0] ?? null;
  }

  /**
   * The award, its board review and its approvers, in one batch.
   *
   * An award to a board member's dependent is created in BOARD_REVIEW with
   * the recused member named. The recusal is not a flag that can be
   * written a moment later and fail: it lands with the award or the award
   * does not exist.
   */
  async createAward(award: Award): Promise<Award> {
    const statements: D1PreparedStatement[] = [
      this.db()
        .prepare(
          "INSERT INTO award (id, entity, cycle_id, application_id, program, " +
            "amount_cents, currency, status, basis, proposed_at, decided_by_person_id, " +
            `decided_at, notified_at) VALUES (${placeholders(13)})`,
        )
        .bind(
          award.id,
          award.entity,
          award.cycleId,
          award.applicationId,
          award.program,
          award.amountCents,
          award.currency,
          award.status,
          award.basis,
          award.proposedAt,
          award.decidedByPersonId,
          award.decidedAt,
          award.notifiedAt,
        ),
      ...this.boardReviewStatements(award.id, award.boardReview),
    ];
    await atomic(statements);
    const stored = await this.getAward(award.id);
    if (!stored) throw new Error(`Could not read back award ${award.id}`);
    return stored;
  }

  private boardReviewStatements(
    awardId: string,
    review: BoardReview | null | undefined,
  ): D1PreparedStatement[] {
    const db = this.db();
    const statements: D1PreparedStatement[] = [
      db.prepare("DELETE FROM award_board_approver WHERE award_id = ?").bind(awardId),
    ];
    if (!review) {
      statements.push(
        db.prepare("DELETE FROM award_board_review WHERE award_id = ?").bind(awardId),
      );
      return statements;
    }
    statements.push(
      db
        .prepare(
          "INSERT INTO award_board_review (award_id, reason, recused_person_id, " +
            "requested_at, requested_by_person_id, minute_ref, decided_at, outcome) " +
            `VALUES (${placeholders(8)}) ` +
            "ON CONFLICT(award_id) DO UPDATE SET reason = excluded.reason, " +
            "recused_person_id = excluded.recused_person_id, " +
            "requested_at = excluded.requested_at, " +
            "requested_by_person_id = excluded.requested_by_person_id, " +
            "minute_ref = excluded.minute_ref, decided_at = excluded.decided_at, " +
            "outcome = excluded.outcome",
        )
        .bind(
          awardId,
          review.reason,
          review.recusedPersonId,
          review.requestedAt,
          review.requestedByPersonId,
          review.minuteRef,
          review.decidedAt,
          review.outcome,
        ),
    );
    for (const personId of new Set(review.approverPersonIds)) {
      statements.push(
        db
          .prepare(
            "INSERT INTO award_board_approver (award_id, person_id) VALUES (?, ?)",
          )
          .bind(awardId, personId),
      );
    }
    return statements;
  }

  async updateAward(id: string, patch: Partial<Award>): Promise<Award> {
    const exists = await one<{ id: string }>(
      this.db().prepare("SELECT id FROM award WHERE id = ?").bind(id),
    );
    if (!exists) throw new Error(`No award ${id}`);

    const columns: string[] = [];
    const binds: unknown[] = [];
    const set = (column: string, value: unknown): void => {
      columns.push(`${column} = ?`);
      binds.push(value);
    };

    if ("entity" in patch) set("entity", patch.entity);
    if ("cycleId" in patch) set("cycle_id", patch.cycleId);
    if ("applicationId" in patch) set("application_id", patch.applicationId);
    if ("program" in patch) set("program", patch.program);
    if ("amountCents" in patch) set("amount_cents", patch.amountCents);
    if ("currency" in patch) set("currency", patch.currency);
    if ("status" in patch) set("status", patch.status);
    if ("basis" in patch) set("basis", patch.basis);
    if ("proposedAt" in patch) set("proposed_at", patch.proposedAt);
    if ("decidedByPersonId" in patch) {
      set("decided_by_person_id", patch.decidedByPersonId ?? null);
    }
    if ("decidedAt" in patch) set("decided_at", patch.decidedAt ?? null);
    if ("notifiedAt" in patch) set("notified_at", patch.notifiedAt ?? null);

    const statements: D1PreparedStatement[] = [];
    if (columns.length > 0) {
      statements.push(
        this.db()
          .prepare(`UPDATE award SET ${columns.join(", ")} WHERE id = ?`)
          .bind(...binds, id),
      );
    }
    // The full-board decision writes the status, the minute reference and
    // the approvers together. Splitting them would let an award read as
    // approved with nobody named as having approved it.
    if ("boardReview" in patch) {
      statements.push(...this.boardReviewStatements(id, patch.boardReview ?? null));
    }
    await atomic(statements);

    const stored = await this.getAward(id);
    if (!stored) throw new Error(`No award ${id}`);
    return stored;
  }

  /* Disbursement ------------------------------------------------- */

  async listCheques(cycleId?: string): Promise<Cheque[]> {
    const statement = cycleId
      ? this.db()
          .prepare("SELECT * FROM cheque WHERE cycle_id = ? ORDER BY id")
          .bind(cycleId)
      : this.db().prepare("SELECT * FROM cheque ORDER BY id");
    const rows = await many<ChequeRow>(statement);
    return rows.map(toCheque);
  }

  async getCheque(id: string): Promise<Cheque | null> {
    const row = await one<ChequeRow>(
      this.db().prepare("SELECT * FROM cheque WHERE id = ?").bind(id),
    );
    return row ? toCheque(row) : null;
  }

  async createCheque(cheque: Cheque): Promise<Cheque> {
    await this.db()
      .prepare(
        "INSERT INTO cheque (id, entity, cycle_id, award_id, payee_school_id, " +
          "payable_to, address, city, state, postal_code, office, amount_cents, " +
          "currency, memo_reference, status, mailed_at, mailed_by_person_id, note) " +
          `VALUES (${placeholders(18)})`,
      )
      .bind(
        cheque.id,
        cheque.entity,
        cheque.cycleId,
        cheque.awardId,
        cheque.payeeSchoolId,
        cheque.payableTo,
        linesToText(cheque.addressLines),
        cheque.city,
        cheque.state,
        cheque.postalCode,
        cheque.office,
        cheque.amountCents,
        cheque.currency,
        cheque.memoReference,
        cheque.status,
        cheque.mailedAt,
        cheque.mailedByPersonId,
        cheque.note,
      )
      .run();
    return { ...cheque, addressLines: [...cheque.addressLines] };
  }

  async updateCheque(id: string, patch: Partial<Cheque>): Promise<Cheque> {
    const exists = await one<{ id: string }>(
      this.db().prepare("SELECT id FROM cheque WHERE id = ?").bind(id),
    );
    if (!exists) throw new Error(`No cheque ${id}`);

    const columns: string[] = [];
    const binds: unknown[] = [];
    const set = (column: string, value: unknown): void => {
      columns.push(`${column} = ?`);
      binds.push(value);
    };

    if ("entity" in patch) set("entity", patch.entity);
    if ("cycleId" in patch) set("cycle_id", patch.cycleId);
    if ("awardId" in patch) set("award_id", patch.awardId);
    if ("payeeSchoolId" in patch) set("payee_school_id", patch.payeeSchoolId);
    if ("payableTo" in patch) set("payable_to", patch.payableTo);
    if ("addressLines" in patch) set("address", linesToText(patch.addressLines ?? []));
    if ("city" in patch) set("city", patch.city);
    if ("state" in patch) set("state", patch.state);
    if ("postalCode" in patch) set("postal_code", patch.postalCode);
    if ("office" in patch) set("office", patch.office ?? null);
    if ("amountCents" in patch) set("amount_cents", patch.amountCents);
    if ("currency" in patch) set("currency", patch.currency);
    if ("memoReference" in patch) set("memo_reference", patch.memoReference);
    if ("status" in patch) set("status", patch.status);
    if ("mailedAt" in patch) set("mailed_at", patch.mailedAt ?? null);
    if ("mailedByPersonId" in patch) {
      set("mailed_by_person_id", patch.mailedByPersonId ?? null);
    }
    if ("note" in patch) set("note", patch.note ?? null);

    if (columns.length > 0) {
      await this.db()
        .prepare(`UPDATE cheque SET ${columns.join(", ")} WHERE id = ?`)
        .bind(...binds, id)
        .run();
    }

    const stored = await this.getCheque(id);
    if (!stored) throw new Error(`No cheque ${id}`);
    return stored;
  }

  /* Retention ---------------------------------------------------- */

  async listSelectionRecords(cycleId?: string): Promise<SelectionRecord[]> {
    const db = this.db();
    const where = cycleId ? "cycle_id = ?" : "1 = 1";
    const binds = cycleId ? [cycleId] : [];
    const rows = await many<SelectionRow>(
      db
        .prepare(`SELECT * FROM selection_record WHERE ${where} ORDER BY decided_at, id`)
        .bind(...binds),
    );
    if (rows.length === 0) return [];
    const awards = await many<SelectionAwardRow>(
      db
        .prepare(
          "SELECT selection_record_id, program, amount_cents " +
            "FROM selection_record_award WHERE selection_record_id IN " +
            `(SELECT id FROM selection_record WHERE ${where}) ORDER BY rowid`,
        )
        .bind(...binds),
    );
    const byRecord = groupBy(awards, (a) => a.selection_record_id);
    return rows.map((row) => toSelectionRecord(row, byRecord.get(row.id) ?? []));
  }

  /**
   * Write the record that outlives the application.
   *
   * The record and its award lines go together: a selection record whose
   * amounts failed to land is a record of a decision with the decision
   * missing, and it is written precisely at the moment the application is
   * about to be destroyed, so there is no second chance to repair it.
   */
  async createSelectionRecord(record: SelectionRecord): Promise<SelectionRecord> {
    const db = this.db();
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          "INSERT INTO selection_record (id, entity, cycle_id, application_ref, " +
            "outcome, total_score, scores_recorded, eligibility_rule_version, " +
            `school_state, decided_at, retain_until) VALUES (${placeholders(11)})`,
        )
        .bind(
          record.id,
          record.entity,
          record.cycleId,
          record.applicationRef,
          record.outcome,
          record.totalScore,
          record.scoresRecorded,
          record.eligibilityRuleVersion,
          record.schoolState,
          record.decidedAt,
          record.retainUntil,
        ),
    ];
    for (const award of record.awards) {
      statements.push(
        db
          .prepare(
            "INSERT INTO selection_record_award (selection_record_id, program, " +
              "amount_cents) VALUES (?, ?, ?) " +
              "ON CONFLICT(selection_record_id, program) DO UPDATE SET " +
              "amount_cents = excluded.amount_cents",
          )
          .bind(record.id, award.program, award.amountCents),
      );
    }
    await atomic(statements);
    return { ...record, awards: record.awards.map((a) => ({ ...a })) };
  }

  /**
   * The one delete path for applicant personal data.
   *
   * Everything in `applicationCascade` goes in a single batch: the
   * application, the four sections, the flags, the guardian consent, the
   * score sheets with their points, the disability verification and the
   * declared relationships. Deleting the application and leaving the essay
   * behind is not a purge, and doing it in eleven separate awaits leaves a
   * half-purged applicant on the floor.
   *
   * KNOWN LIMIT, reported rather than worked around: `award.application_id`
   * is a non-null foreign key to the application and awards are not
   * purged, because the selection record is what keeps the figures and the
   * cheque run is a financial record. So an application that still has an
   * award row cannot be purged. In the retention flow that is only
   * reachable for a NOT_AWARDED or WITHDRAWN application that nevertheless
   * carries a DECLINED award. The schema needs `award.application_id` to be
   * nullable, or the purge contract needs to say that awards go too;
   * neither is this module's to decide, so this refuses in words rather
   * than leaving the database to refuse with "FOREIGN KEY constraint
   * failed".
   */
  async purgeApplication(id: string): Promise<boolean> {
    const db = this.db();
    const exists = await one<{ id: string }>(
      db.prepare("SELECT id FROM scholarship_application WHERE id = ?").bind(id),
    );
    if (!exists) return false;

    const awards = await one<{ n: number }>(
      db.prepare("SELECT COUNT(*) AS n FROM award WHERE application_id = ?").bind(id),
    );
    if (int(awards?.n) > 0) {
      throw new Error(
        `Application ${id} still has ${int(awards?.n)} award record(s). An ` +
          "award holds a required reference to the application it was made " +
          "on, so the application cannot be removed while one exists. The " +
          "selection record keeps the decision and the figures; what to do " +
          "with the award is a schema decision and not this module's.",
      );
    }

    await atomic(this.applicationCascade(id));
    return true;
  }

  async purgeSelectionRecord(id: string): Promise<boolean> {
    const db = this.db();
    const exists = await one<{ id: string }>(
      db.prepare("SELECT id FROM selection_record WHERE id = ?").bind(id),
    );
    if (!exists) return false;
    await atomic([
      db.prepare("DELETE FROM selection_record_award WHERE selection_record_id = ?").bind(id),
      db.prepare("DELETE FROM selection_record WHERE id = ?").bind(id),
    ]);
    return true;
  }

  /* Audit log (append-only; no delete exists) -------------------- */

  /**
   * The only statement in this file that touches `scholarship_audit`.
   *
   * Append-only by trigger, not by convention: the database aborts an
   * UPDATE or a DELETE, so there is no code path here that would attempt
   * one and no method on the interface that would ask for it.
   */
  async appendAudit(
    entry: Omit<ScholarshipAuditEntry, "id">,
  ): Promise<ScholarshipAuditEntry> {
    const record: ScholarshipAuditEntry = { ...entry, id: newId() };
    await this.db()
      .prepare(
        "INSERT INTO scholarship_audit (id, at, person_id, action, data_class, " +
          `entity, row_level, subject_ref) VALUES (${placeholders(8)})`,
      )
      .bind(
        record.id,
        record.at,
        record.personId,
        record.action,
        record.dataClass,
        record.entity,
        toInt(record.rowLevel),
        record.subjectRef,
      )
      .run();
    return { ...record };
  }

  async listAudit(limit = 200): Promise<ScholarshipAuditEntry[]> {
    const rows = await many<AuditRow>(
      this.db()
        .prepare(
          "SELECT * FROM scholarship_audit ORDER BY at DESC, rowid DESC LIMIT ?",
        )
        .bind(limit),
    );
    return rows.map(toAuditEntry);
  }
}
