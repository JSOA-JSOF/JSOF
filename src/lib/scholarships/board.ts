/**
 * The chair's overview, and the module's audit view.
 *
 * Everything here starts with `authorize()` through `guard()`. The routes below
 * /board/scholarships render what these return and hold no policy of their own.
 *
 * The overview is deliberately a count of work rather than a dashboard. The
 * chair spends about forty hours a month on this between January and June; what
 * she needs on opening a screen is how many files are waiting, how many
 * verifications are hers, and how many cheques have not gone out.
 */

import type { Subject } from "../authz/policy";

import { ELIGIBILITY_RULE } from "./eligibility";
import { guard } from "./guard";
import type { ScholarshipRepository } from "./repository";
import {
  MERIT_BANDS,
  MERIT_FLOOR_SCORE,
  SPREAD_WORTH_A_LOOK,
  committeeScore,
  meritBandFor,
} from "./scoring";
import {
  FLAG_LABELS,
  type Cycle,
  type IntakeFlag,
  type Program,
  type ScholarshipAuditEntry,
} from "./types";

export type CycleOverview = {
  cycle: Cycle;
  applications: number;
  submitted: number;
  inReview: number;
  scored: number;
  awarded: number;
  notAwarded: number;
  withdrawn: number;
  /** Files with no score sheet at all. The committee has not started these. */
  unscored: number;
  /** Files scored by fewer than the full committee. */
  partlyScored: number;
  woundedPatriotApplications: number;
  verificationsOutstanding: number;
  awards: number;
  awardsWithTheBoard: number;
  awardsAwaitingNotification: number;
  chequesQueued: number;
  chequesMailed: number;
  /** Intake flags across the cycle, so the chair can see the exceptions. */
  flagCounts: { flag: IntakeFlag; label: string; count: number }[];
  /** Repeated on every screen while there is no adopted rule. */
  eligibilityStatus: string;
  eligibilityMarker: string;
};

export const FULL_COMMITTEE = 4;

export async function loadCycleOverview(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
): Promise<CycleOverview> {
  await guard(repo, subject, {
    action: "READ_CYCLE_OVERVIEW",
    dataClass: "APPLICANT",
    required: "AGGREGATE",
    rowLevel: false,
  });

  const cycle = cycleId ? await repo.getCycle(cycleId) : await repo.currentCycle();
  if (!cycle) throw new Error(`No cycle ${cycleId}`);

  const applications = await repo.listApplications({ cycleId: cycle.id });
  const awards = await repo.listAwards({ cycleId: cycle.id });
  const cheques = await repo.listCheques(cycle.id);

  let unscored = 0;
  let partlyScored = 0;
  let woundedPatriotApplications = 0;
  let verificationsOutstanding = 0;
  const flagTally = new Map<IntakeFlag, number>();

  for (const application of applications) {
    for (const flag of application.flags) {
      flagTally.set(flag, (flagTally.get(flag) ?? 0) + 1);
    }
    if (application.state === "WITHDRAWN") continue;
    const sheets = await repo.listScoreSheets(application.id);
    if (sheets.length === 0) unscored += 1;
    else if (sheets.length < FULL_COMMITTEE) partlyScored += 1;
    if (application.woundedPatriot) {
      woundedPatriotApplications += 1;
      if (!(await repo.getVerification(application.id))) verificationsOutstanding += 1;
    }
  }

  const count = (state: string) => applications.filter((a) => a.state === state).length;

  return {
    cycle,
    applications: applications.length,
    submitted: count("SUBMITTED"),
    inReview: count("IN_REVIEW"),
    scored: count("SCORED"),
    awarded: count("AWARDED"),
    notAwarded: count("NOT_AWARDED"),
    withdrawn: count("WITHDRAWN"),
    unscored,
    partlyScored,
    woundedPatriotApplications,
    verificationsOutstanding,
    awards: awards.length,
    awardsWithTheBoard: awards.filter((a) => a.boardReview && a.boardReview.outcome === null)
      .length,
    awardsAwaitingNotification: awards.filter((a) => a.status === "APPROVED").length,
    chequesQueued: cheques.filter((c) => c.status === "QUEUED").length,
    chequesMailed: cheques.filter((c) => c.status === "MAILED").length,
    flagCounts: [...flagTally.entries()]
      .map(([flag, countOf]) => ({ flag, label: FLAG_LABELS[flag], count: countOf }))
      .sort((a, b) => b.count - a.count),
    eligibilityStatus: ELIGIBILITY_RULE.status,
    eligibilityMarker: ELIGIBILITY_RULE.marker,
  };
}

/* ------------------------------------------------------------------ *
 * The chair's file list
 * ------------------------------------------------------------------ */

export type ChairRow = {
  applicationId: string;
  reference: string;
  applicantName: string;
  state: string;
  schoolName: string;
  sponsorMemberId: string;
  sponsorOnRoster: boolean;
  sponsorInGoodStanding: boolean;
  isMinor: boolean;
  guardianConsentOnFile: boolean;
  appliedForWoundedPatriot: boolean
  verified: boolean | null;
  scoresRecorded: number;
  average: number | null;
  band: string | null;
  flags: IntakeFlag[];
};

export async function loadChairRows(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
  limit = 60,
): Promise<ChairRow[]> {
  await guard(repo, subject, {
    action: "READ_CHAIR_FILE_LIST",
    dataClass: "APPLICANT",
    required: "READ",
    rowLevel: true,
  });

  const cycle = cycleId ?? (await repo.currentCycle()).id;
  const applications = (await repo.listApplications({ cycleId: cycle })).slice(0, limit);
  const schools = new Map((await repo.listSchools()).map((s) => [s.id, s.name]));
  const rows: ChairRow[] = [];

  for (const application of applications) {
    const sheets = await repo.listScoreSheets(application.id);
    const score = committeeScore(sheets);
    const band = score ? meritBandFor(score.average) : null;
    const verification = application.woundedPatriot
      ? await repo.getVerification(application.id)
      : null;
    rows.push({
      applicationId: application.id,
      reference: application.reference,
      applicantName: application.applicant.fullName,
      state: application.state,
      schoolName: application.enrolment
        ? (schools.get(application.enrolment.schoolId) ?? "School on file")
        : "No school given",
      sponsorMemberId: application.sponsor?.sponsorMemberId ?? "none given",
      sponsorOnRoster: application.sponsor?.onRoster ?? false,
      sponsorInGoodStanding: application.sponsor?.inGoodStanding ?? false,
      isMinor: application.flags.includes("APPLICANT_IS_A_MINOR"),
      guardianConsentOnFile: application.guardianConsentId !== null,
      appliedForWoundedPatriot: application.woundedPatriot !== null,
      verified: application.woundedPatriot ? verification?.outcome === "VERIFIED" : null,
      scoresRecorded: sheets.length,
      average: score?.average ?? null,
      band: band?.label ?? null,
      flags: application.flags,
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ *
 * Exceptions
 * ------------------------------------------------------------------ */

/** Within this many points of a band line is close enough to want a second look. */
export const BAND_BOUNDARY_MARGIN = 3;

export type CycleExceptions = {
  cycleId: string;
  /**
   * Any applicant whose sponsoring member holds a board seat. These go to the
   * full board with that member recused, and nothing here approves one.
   */
  boardMemberDependents: {
    applicationId: string;
    reference: string;
    applicantName: string;
    recusedPersonId: string;
    awards: { awardId: string; program: Program; amountCents: number; status: string }[];
    boardDecisionRecorded: boolean;
  }[];
  /**
   * Scores sitting within a few points of a band line, where one reviewer's
   * sheet is the difference between two amounts.
   */
  nearBandBoundary: {
    applicationId: string;
    reference: string;
    applicantName: string;
    average: number;
    bandLabel: string;
    /** The band immediately above, and how far away it is. */
    nextBandLabel: string | null;
    pointsToNextBand: number | null;
    /** Negative when the score is below the Merit floor. */
    pointsAboveFloor: number;
  }[];
  /** Committees that disagreed widely. The average hides this. */
  wideSpread: {
    applicationId: string;
    reference: string;
    applicantName: string;
    average: number;
    spread: number;
    high: number;
    low: number;
  }[];
  /** Sponsor checks that came back wrong. The chair's spreadsheet, automated. */
  sponsorProblems: {
    applicationId: string;
    reference: string;
    applicantName: string;
    sponsorMemberId: string;
    onRoster: boolean;
    inGoodStanding: boolean;
  }[];
  /** Under-18 applicants with no guardian consent record. These cannot submit. */
  minorsWithoutConsent: {
    applicationId: string;
    reference: string;
    applicantName: string;
    state: string;
  }[];
  /** Wounded Patriot applications the chair has not yet verified. */
  verificationsOutstanding: {
    applicationId: string;
    reference: string;
    applicantName: string;
  }[];
};

/**
 * Everything in the cycle that wants a person's attention, in one read.
 *
 * Requires APPLICANT at READ, because every list here names an applicant.
 */
export async function loadCycleExceptions(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
): Promise<CycleExceptions> {
  await guard(repo, subject, {
    action: "READ_CYCLE_EXCEPTIONS",
    dataClass: "APPLICANT",
    required: "READ",
    rowLevel: true,
  });

  const cycle = cycleId ?? (await repo.currentCycle()).id;
  const applications = await repo.listApplications({ cycleId: cycle });
  const awards = await repo.listAwards({ cycleId: cycle });

  const result: CycleExceptions = {
    cycleId: cycle,
    boardMemberDependents: [],
    nearBandBoundary: [],
    wideSpread: [],
    sponsorProblems: [],
    minorsWithoutConsent: [],
    verificationsOutstanding: [],
  };

  for (const application of applications) {
    const base = {
      applicationId: application.id,
      reference: application.reference,
      applicantName: application.applicant.fullName,
    };

    if (application.boardMemberPersonId) {
      const theirs = awards.filter((a) => a.applicationId === application.id);
      result.boardMemberDependents.push({
        ...base,
        recusedPersonId: application.boardMemberPersonId,
        awards: theirs.map((a) => ({
          awardId: a.id,
          program: a.program,
          amountCents: a.amountCents,
          status: a.status,
        })),
        boardDecisionRecorded: theirs.every((a) => a.boardReview?.outcome !== null),
      });
    }

    if (
      application.sponsor &&
      (!application.sponsor.onRoster || !application.sponsor.inGoodStanding)
    ) {
      result.sponsorProblems.push({
        ...base,
        sponsorMemberId: application.sponsor.sponsorMemberId,
        onRoster: application.sponsor.onRoster,
        inGoodStanding: application.sponsor.inGoodStanding,
      });
    }

    if (application.flags.includes("APPLICANT_IS_A_MINOR") && !application.guardianConsentId) {
      result.minorsWithoutConsent.push({ ...base, state: application.state });
    }

    if (application.state === "WITHDRAWN") continue;

    if (application.woundedPatriot && !(await repo.getVerification(application.id))) {
      result.verificationsOutstanding.push({ ...base });
    }

    const sheets = await repo.listScoreSheets(application.id);
    const score = committeeScore(sheets);
    if (!score) continue;

    if (score.spread >= SPREAD_WORTH_A_LOOK) {
      result.wideSpread.push({
        ...base,
        average: score.average,
        spread: score.spread,
        high: score.high,
        low: score.low,
      });
    }

    const band = meritBandFor(score.average);
    const above = MERIT_BANDS.filter((b) => b.minScore > score.average).sort(
      (a, b) => a.minScore - b.minScore,
    )[0];
    const toNext = above ? above.minScore - score.average : null;
    const nearFloor = Math.abs(score.average - MERIT_FLOOR_SCORE) <= BAND_BOUNDARY_MARGIN;
    if ((toNext !== null && toNext <= BAND_BOUNDARY_MARGIN) || nearFloor) {
      result.nearBandBoundary.push({
        ...base,
        average: score.average,
        bandLabel: band?.label ?? "No Merit award",
        nextBandLabel: above?.label ?? null,
        pointsToNextBand: toNext,
        pointsAboveFloor: score.average - MERIT_FLOOR_SCORE,
      });
    }
  }

  result.nearBandBoundary.sort((a, b) => b.average - a.average);
  result.wideSpread.sort((a, b) => b.spread - a.spread);
  return result;
}

/* ------------------------------------------------------------------ *
 * Audit
 * ------------------------------------------------------------------ */

export async function loadScholarshipAudit(
  repo: ScholarshipRepository,
  subject: Subject,
  limit = 120,
): Promise<ScholarshipAuditEntry[]> {
  await guard(repo, subject, {
    action: "READ_SCHOLARSHIP_AUDIT",
    dataClass: "AUDIT_LOG",
    required: "READ",
    rowLevel: false,
  });
  return repo.listAudit(limit);
}
