/**
 * Review: what a scorer may open, what they may not, and what they record.
 *
 * Two controls live here and both are enforced in the data, not in the page.
 *
 * WITHHOLDING. A SCHOLARSHIP_REVIEWER reads the application and the
 * transcript. They do not read the disability documentation, which is what
 * decides a Wounded Patriot award and is the chair's to verify. The role table
 * already says so: SCHOLARSHIP_REVIEWER holds APPLICANT at READ and
 * APPLICANT_SENSITIVE at NONE. What this file adds is that the object handed
 * to a reviewer is BUILT, field by field, and never carries the evidence at
 * all. It is not redacted in the template and it is not hidden by CSS; it is
 * not in the response. A test walks the returned object at every depth.
 *
 * CONFLICT BLOCKING. A reviewer related to an applicant cannot open the file.
 * Not "sees a warning", not "is asked to recuse themselves": the function
 * throws and the attempt is written to the log. The relationship is modelled
 * explicitly as a declared record rather than guessed from a surname, because
 * guessing misses a step-parent and blocks a stranger.
 */

import { AuthzError, type Subject } from "../authz/policy";

import { guard, logRefusal } from "./guard";
import type { ScholarshipRepository } from "./repository";
import { nextId } from "./repository";
import {
  SCORING_CRITERIA,
  assertPointsInRange,
  committeeScore,
  sheetTotal,
  type CommitteeScore,
} from "./scoring";
import {
  SCHOLARSHIP_ENTITY,
  type Application,
  type CriterionKey,
  type RelationshipKind,
  type ReviewerFile,
  type ReviewerRelationship,
  type ScoreSheet,
} from "./types";

/* ------------------------------------------------------------------ *
 * The conflict block
 * ------------------------------------------------------------------ */

export class ConflictBlockedError extends Error {
  constructor(
    readonly applicationId: string,
    readonly kind: RelationshipKind,
  ) {
    super(
      "You have declared a relationship to this applicant, so this file is " +
        "closed to you. The block is recorded. Ask the Scholarships Chair to " +
        "reassign it rather than asking a colleague to open it for you.",
    );
    this.name = "ConflictBlockedError";
  }
}

export async function conflictFor(
  repo: ScholarshipRepository,
  reviewerPersonId: string,
  applicationId: string,
): Promise<ReviewerRelationship | null> {
  return repo.getRelationship(reviewerPersonId, applicationId);
}

export async function declareRelationship(
  repo: ScholarshipRepository,
  subject: Subject,
  input: {
    reviewerPersonId: string;
    applicationId: string;
    kind: RelationshipKind;
    note?: string;
  },
  now: Date = new Date(),
): Promise<ReviewerRelationship> {
  await guard(repo, subject, {
    action: "DECLARE_REVIEWER_RELATIONSHIP",
    dataClass: "APPLICANT",
    required: "READ",
    rowLevel: true,
    subjectRef: input.applicationId,
  });
  return repo.declareRelationship({
    id: nextId("schrel"),
    entity: SCHOLARSHIP_ENTITY,
    reviewerPersonId: input.reviewerPersonId,
    applicationId: input.applicationId,
    kind: input.kind,
    declaredAt: now.toISOString(),
    declaredByPersonId: subject.personId,
    note: input.note ?? null,
  });
}

/* ------------------------------------------------------------------ *
 * The reviewer's file
 * ------------------------------------------------------------------ */

/**
 * Build the reviewer's view from an application.
 *
 * Written as an explicit construction with no spread of the source record.
 * That is the whole mechanism: a future field added to `Application` cannot
 * arrive here by accident, and `woundedPatriot` has no landing place on the
 * target type at all.
 */
function buildReviewerFile(input: {
  application: Application;
  schoolName: string | null;
  myScore: ScoreSheet | null;
  scoresRecorded: number;
}): ReviewerFile {
  const { application } = input;
  return {
    applicationId: application.id,
    reference: application.reference,
    entity: application.entity,
    cycleId: application.cycleId,
    applicantName: application.applicant.fullName,
    enrolment: application.enrolment
      ? {
          schoolName: input.schoolName ?? "School on file",
          level: application.enrolment.level,
          academicYear: application.enrolment.academicYear,
          expectedCompletion: application.enrolment.expectedCompletion,
          accreditedInstitution: application.enrolment.accreditedInstitution,
        }
      : null,
    merit: application.merit
      ? {
          gpaHundredths: application.merit.gpaHundredths,
          transcriptSummary: application.merit.transcriptSummary,
          essay: application.merit.essay,
          activities: [...application.merit.activities],
          recommendationFrom: application.merit.recommendationFrom,
        }
      : null,
    appliedForWoundedPatriot: application.woundedPatriot !== null,
    criteria: SCORING_CRITERIA.map((c) => ({ ...c })),
    myScore: input.myScore,
    scoresRecorded: input.scoresRecorded,
  };
}

export async function openReviewFile(
  repo: ScholarshipRepository,
  subject: Subject,
  applicationId: string,
): Promise<ReviewerFile> {
  await guard(repo, subject, {
    action: "OPEN_REVIEW_FILE",
    dataClass: "APPLICANT",
    required: "READ",
    rowLevel: true,
    subjectRef: applicationId,
  });

  const relationship = await conflictFor(repo, subject.personId, applicationId);
  if (relationship) {
    await logRefusal(repo, subject, {
      action: "OPEN_REVIEW_FILE:CONFLICT_BLOCKED",
      dataClass: "APPLICANT",
      subjectRef: applicationId,
    });
    throw new ConflictBlockedError(applicationId, relationship.kind);
  }

  const application = await repo.getApplication(applicationId);
  if (!application) throw new Error(`No application ${applicationId}`);

  const school = application.enrolment
    ? await repo.getSchool(application.enrolment.schoolId)
    : null;
  const sheets = await repo.listScoreSheets(applicationId);

  return buildReviewerFile({
    application,
    schoolName: school?.name ?? null,
    myScore: sheets.find((s) => s.reviewerPersonId === subject.personId) ?? null,
    scoresRecorded: sheets.length,
  });
}

/* ------------------------------------------------------------------ *
 * The queue
 * ------------------------------------------------------------------ */

export type ReviewQueueRow = {
  applicationId: string;
  reference: string;
  applicantName: string;
  schoolName: string;
  appliedForWoundedPatriot: boolean;
  scoresRecorded: number;
  scoredByMe: boolean;
  submittedAt: string | null;
};

export type ReviewQueue = {
  cycleId: string;
  /** Files this reviewer may open and has not scored. */
  waiting: ReviewQueueRow[];
  /** Files this reviewer has already scored. */
  done: ReviewQueueRow[];
  /**
   * Files closed to this reviewer. Listed by reference and relationship only:
   * the applicant's name is not in here, because naming them would be a way
   * around the block.
   */
  blocked: { reference: string; kind: RelationshipKind }[];
};

const REVIEWABLE_STATES = ["SUBMITTED", "IN_REVIEW", "SCORED"] as const;

export async function loadReviewQueue(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
): Promise<ReviewQueue> {
  await guard(repo, subject, {
    action: "READ_REVIEW_QUEUE",
    dataClass: "APPLICANT",
    required: "READ",
    rowLevel: true,
  });

  const cycle = cycleId ?? (await repo.currentCycle()).id;
  const applications = await repo.listApplications({
    cycleId: cycle,
    states: [...REVIEWABLE_STATES],
  });
  const relationships = await repo.listRelationships(subject.personId);
  const blockedIds = new Map(relationships.map((r) => [r.applicationId, r.kind]));
  const schools = new Map((await repo.listSchools()).map((s) => [s.id, s.name]));

  const waiting: ReviewQueueRow[] = [];
  const done: ReviewQueueRow[] = [];
  const blocked: { reference: string; kind: RelationshipKind }[] = [];

  for (const application of applications) {
    const kind = blockedIds.get(application.id);
    if (kind) {
      blocked.push({ reference: application.reference, kind });
      continue;
    }
    const sheets = await repo.listScoreSheets(application.id);
    const row: ReviewQueueRow = {
      applicationId: application.id,
      reference: application.reference,
      applicantName: application.applicant.fullName,
      schoolName: application.enrolment
        ? (schools.get(application.enrolment.schoolId) ?? "School on file")
        : "No school given",
      appliedForWoundedPatriot: application.woundedPatriot !== null,
      scoresRecorded: sheets.length,
      scoredByMe: sheets.some((s) => s.reviewerPersonId === subject.personId),
      submittedAt: application.submittedAt,
    };
    (row.scoredByMe ? done : waiting).push(row);
  }

  return { cycleId: cycle, waiting, done, blocked };
}

/* ------------------------------------------------------------------ *
 * Driving the queue one file at a time
 * ------------------------------------------------------------------ */

export type ReviewProgress = {
  cycleId: string;
  reviewerPersonId: string;
  /** Files this reviewer may open and has not scored. */
  remaining: number;
  /** Files this reviewer has scored. */
  reviewed: number;
  /** Files closed to this reviewer by a declared relationship. */
  blocked: number;
  /** Every reviewable file in the cycle, blocked ones included. */
  total: number;
};

/**
 * How much is left for this reviewer, as counts only.
 *
 * Cheap enough to call on every screen, and it carries no applicant identity,
 * so it can be shown beside anything.
 */
export async function reviewProgress(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
): Promise<ReviewProgress> {
  const queue = await loadReviewQueue(repo, subject, cycleId);
  return {
    cycleId: queue.cycleId,
    reviewerPersonId: subject.personId,
    remaining: queue.waiting.length,
    reviewed: queue.done.length,
    blocked: queue.blocked.length,
    total: queue.waiting.length + queue.done.length + queue.blocked.length,
  };
}

export type NextForReview = {
  progress: ReviewProgress;
  /** Null when there is nothing left for this reviewer. */
  file: ReviewerFile | null;
};

/**
 * The next file this reviewer should open, with the counts around it.
 *
 * Honours the conflict block twice over: a file the reviewer has declared a
 * relationship to is excluded from the queue, and `openReviewFile` refuses it
 * again if it somehow arrives here. Oldest submission first, which is the
 * order the chair works in.
 */
export async function nextForReview(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
): Promise<NextForReview> {
  const queue = await loadReviewQueue(repo, subject, cycleId);
  const progress: ReviewProgress = {
    cycleId: queue.cycleId,
    reviewerPersonId: subject.personId,
    remaining: queue.waiting.length,
    reviewed: queue.done.length,
    blocked: queue.blocked.length,
    total: queue.waiting.length + queue.done.length + queue.blocked.length,
  };

  const next = [...queue.waiting].sort((a, b) =>
    (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""),
  )[0];
  if (!next) return { progress, file: null };

  return { progress, file: await openReviewFile(repo, subject, next.applicationId) };
}

/* ------------------------------------------------------------------ *
 * Recording a score
 * ------------------------------------------------------------------ */

/**
 * A score sheet is the reviewer's own record about an application, not an edit
 * to the applicant's data, so it is reachable at APPLICANT READ. The sheet is
 * keyed on the reviewer's person id and a subject may only write their own:
 * a reviewer cannot record a colleague's score, and the conflict block is
 * applied again here rather than trusted from whatever opened the file.
 */
export async function recordScore(
  repo: ScholarshipRepository,
  subject: Subject,
  input: {
    applicationId: string;
    points: Record<CriterionKey, number>;
    comment: string;
    reviewerPersonId?: string;
  },
  now: Date = new Date(),
): Promise<ScoreSheet> {
  const reviewerPersonId = input.reviewerPersonId ?? subject.personId;
  if (reviewerPersonId !== subject.personId) {
    throw new AuthzError(
      `${subject.personId} cannot record a score on behalf of ${reviewerPersonId}`,
      "DENIED",
    );
  }

  await guard(repo, subject, {
    action: "RECORD_SCORE",
    dataClass: "APPLICANT",
    required: "READ",
    rowLevel: true,
    subjectRef: input.applicationId,
  });

  const relationship = await conflictFor(repo, subject.personId, input.applicationId);
  if (relationship) {
    await logRefusal(repo, subject, {
      action: "RECORD_SCORE:CONFLICT_BLOCKED",
      dataClass: "APPLICANT",
      subjectRef: input.applicationId,
    });
    throw new ConflictBlockedError(input.applicationId, relationship.kind);
  }

  assertPointsInRange(input.points);
  const existing = await repo.getScoreSheet(input.applicationId, subject.personId);
  const sheet: ScoreSheet = {
    id: existing?.id ?? nextId("schscore"),
    entity: SCHOLARSHIP_ENTITY,
    applicationId: input.applicationId,
    reviewerPersonId: subject.personId,
    points: { ...input.points },
    total: sheetTotal(input.points),
    comment: input.comment.trim(),
    scoredAt: now.toISOString(),
  };
  return repo.upsertScoreSheet(sheet);
}

export async function committeeScoreFor(
  repo: ScholarshipRepository,
  applicationId: string,
): Promise<CommitteeScore | null> {
  return committeeScore(await repo.listScoreSheets(applicationId));
}
