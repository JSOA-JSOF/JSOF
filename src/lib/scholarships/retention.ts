/**
 * Retention, written as code because docs/PRIVACY-AND-PAYMENTS.md says it must
 * be: "Purge on schedule, in code, not by intention."
 *
 * Two clocks, and they are different in kind.
 *
 *   Unsuccessful applicants   Their personal data is deleted one year after
 *                             the decision. Not archived, not anonymised in
 *                             place: the application, the guardian consent,
 *                             the score sheets and the verification go.
 *   Selection records         Kept five years, per docs/ARCHITECTURE.md. A
 *                             selection record carries the decision and the
 *                             figures and identifies nobody, so keeping it is
 *                             not keeping the applicant.
 *
 * The order matters. `purgeUnsuccessfulApplicants` writes the selection record
 * FIRST and deletes afterwards, so a failure between the two leaves a record
 * of a decision rather than no trace of one.
 *
 * There is no scheduler in this build. The purge is a function with a test
 * against it and a button on the retention screen that says what it will do
 * before it does it. When a scheduler lands it calls this; nothing here
 * changes.
 */

import type { Subject } from "../authz/policy";

import { guard } from "./guard";
import { nextId, type ScholarshipRepository } from "./repository";
import { committeeScore } from "./scoring";
import {
  SCHOLARSHIP_ENTITY,
  UNSUCCESSFUL_STATES,
  type Application,
  type PurgeResult,
  type SelectionRecord,
} from "./types";

/** One year after the decision. The cycle runs January to June, so this clears before the next one. */
export const UNSUCCESSFUL_RETENTION_DAYS = 365;

/** Five years, per docs/ARCHITECTURE.md. */
export const SELECTION_RECORD_RETENTION_YEARS = 5;

const DAY_MS = 86_400_000;

/** The date the application's decision started the clock. */
export function clockStartedAt(application: Application): string {
  return (
    application.decidedAt ??
    application.withdrawnAt ??
    application.submittedAt ??
    application.createdAt
  );
}

export function purgeDueAt(application: Application): string {
  const start = new Date(clockStartedAt(application));
  return new Date(start.getTime() + UNSUCCESSFUL_RETENTION_DAYS * DAY_MS).toISOString();
}

export function retainSelectionRecordUntil(decidedAt: string): string {
  const start = new Date(decidedAt);
  const until = new Date(start);
  until.setUTCFullYear(until.getUTCFullYear() + SELECTION_RECORD_RETENTION_YEARS);
  return until.toISOString().slice(0, 10);
}

export function isDueForPurge(application: Application, now: Date = new Date()): boolean {
  if (!UNSUCCESSFUL_STATES.includes(application.state)) return false;
  return purgeDueAt(application) <= now.toISOString();
}

/* ------------------------------------------------------------------ *
 * The purge
 * ------------------------------------------------------------------ */

async function selectionRecordFor(
  repo: ScholarshipRepository,
  application: Application,
): Promise<SelectionRecord> {
  const sheets = await repo.listScoreSheets(application.id);
  const score = committeeScore(sheets);
  const awards = await repo.listAwards({ applicationId: application.id });

  // Captured here because this is the last moment it exists: the application
  // is deleted immediately after, taking the enrolment and therefore the only
  // route from an award to a place with it.
  const schoolId = application.enrolment?.schoolId ?? null;
  const school = schoolId ? await repo.getSchool(schoolId) : null;

  return {
    id: nextId("schsel"),
    entity: SCHOLARSHIP_ENTITY,
    cycleId: application.cycleId,
    applicationRef: application.reference,
    outcome: application.state,
    totalScore: score?.average ?? null,
    scoresRecorded: sheets.length,
    awards: awards.map((a) => ({ program: a.program, amountCents: a.amountCents })),
    eligibilityRuleVersion: application.eligibilityRuleVersion,
    schoolState: school?.state ?? null,
    decidedAt: clockStartedAt(application),
    retainUntil: retainSelectionRecordUntil(clockStartedAt(application)),
  };
}

/**
 * Delete the personal data of every unsuccessful applicant past retention.
 *
 * Returns what it did, in references rather than names, so the result can go
 * into the audit log without putting back what the purge just removed.
 */
export async function purgeUnsuccessfulApplicants(
  repo: ScholarshipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<PurgeResult> {
  await guard(repo, subject, {
    action: "PURGE_UNSUCCESSFUL_APPLICANTS",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: true,
  });

  const applications = await repo.listApplications();
  const due = applications.filter((a) => isDueForPurge(a, now));

  const result: PurgeResult = {
    at: now.toISOString(),
    applicationsPurged: 0,
    guardianConsentsPurged: 0,
    scoreSheetsPurged: 0,
    verificationsPurged: 0,
    selectionRecordsWritten: 0,
    references: [],
  };

  for (const application of due) {
    // The record of the decision is written before anything is deleted.
    await repo.createSelectionRecord(await selectionRecordFor(repo, application));
    result.selectionRecordsWritten += 1;

    const consent = await repo.getGuardianConsentForApplication(application.id);
    const sheets = await repo.listScoreSheets(application.id);
    const verification = await repo.getVerification(application.id);

    const removed = await repo.purgeApplication(application.id);
    if (!removed) continue;

    result.applicationsPurged += 1;
    if (consent) result.guardianConsentsPurged += 1;
    result.scoreSheetsPurged += sheets.length;
    if (verification) result.verificationsPurged += 1;
    result.references.push(application.reference);
  }

  await repo.appendAudit({
    at: result.at,
    personId: subject.personId,
    action: "PURGE_UNSUCCESSFUL_APPLICANTS:COMPLETED",
    dataClass: "APPLICANT",
    entity: SCHOLARSHIP_ENTITY,
    rowLevel: true,
    subjectRef: `${result.applicationsPurged} applications, ${result.scoreSheetsPurged} score sheets`,
  });

  return result;
}

/** Selection records whose five years are up. */
export async function purgeExpiredSelectionRecords(
  repo: ScholarshipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<{ at: string; purged: number; references: string[] }> {
  await guard(repo, subject, {
    action: "PURGE_SELECTION_RECORDS",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: false,
  });

  const today = now.toISOString().slice(0, 10);
  const records = await repo.listSelectionRecords();
  const expired = records.filter((r) => r.retainUntil <= today);
  const references: string[] = [];
  for (const record of expired) {
    if (await repo.purgeSelectionRecord(record.id)) references.push(record.applicationRef);
  }

  await repo.appendAudit({
    at: now.toISOString(),
    personId: subject.personId,
    action: "PURGE_SELECTION_RECORDS:COMPLETED",
    dataClass: "APPLICANT",
    entity: SCHOLARSHIP_ENTITY,
    rowLevel: false,
    subjectRef: `${references.length} selection records`,
  });

  return { at: now.toISOString(), purged: references.length, references };
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export type RetentionSchedule = {
  now: string;
  retentionDays: number;
  selectionRecordYears: number;
  /** Unsuccessful applicants whose data is past retention and still here. */
  dueNow: { reference: string; cycleId: string; dueAt: string; state: string }[];
  /** Unsuccessful applicants inside the window, soonest first. */
  upcoming: { reference: string; cycleId: string; dueAt: string; state: string }[];
  /** Successful applicants, who are kept until the award year is closed out. */
  retainedForAwards: number;
  selectionRecords: number;
  selectionRecordsExpired: number;
};

export async function loadRetentionSchedule(
  repo: ScholarshipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<RetentionSchedule> {
  await guard(repo, subject, {
    action: "READ_RETENTION_SCHEDULE",
    dataClass: "APPLICANT",
    // WRITE: named applicants across cycles, including ones this reader never
    // scored and a closed cycle they had nothing to do with.
    required: "WRITE",
    rowLevel: true,
  });

  const applications = await repo.listApplications();
  const unsuccessful = applications.filter((a) => UNSUCCESSFUL_STATES.includes(a.state));
  const today = now.toISOString().slice(0, 10);
  const records = await repo.listSelectionRecords();

  const rows = unsuccessful.map((a) => ({
    reference: a.reference,
    cycleId: a.cycleId,
    dueAt: purgeDueAt(a),
    state: a.state as string,
  }));

  return {
    now: now.toISOString(),
    retentionDays: UNSUCCESSFUL_RETENTION_DAYS,
    selectionRecordYears: SELECTION_RECORD_RETENTION_YEARS,
    dueNow: rows
      .filter((r) => r.dueAt <= now.toISOString())
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    upcoming: rows
      .filter((r) => r.dueAt > now.toISOString())
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .slice(0, 20),
    retainedForAwards: applications.filter((a) => a.state === "AWARDED").length,
    selectionRecords: records.length,
    selectionRecordsExpired: records.filter((r) => r.retainUntil <= today).length,
  };
}
