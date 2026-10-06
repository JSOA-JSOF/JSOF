/**
 * The Scholarships Chair's dashboard, as one authorized read.
 *
 * `loadScholarshipsDashboard` is the only export the route calls. It guards
 * once through `guard()` — the same pattern as every other read in this module
 * — and then computes every figure from the repository, so the page holds no
 * policy and no arithmetic.
 *
 * Where it sits on the reviewer boundary: APPLICANT at WRITE, the same level as
 * the awards board, because this read carries award amounts, a cumulative total
 * and a cost per dollar awarded. A scholarship reviewer holds APPLICANT READ so
 * they can open the file they are scoring; a scorer who knows what three points
 * is worth is not scoring independently of the money. See
 * tests/reviewer-boundary.test.ts, where that decision is written down.
 *
 * Two shapes worth noting before reading on:
 *
 *   - A figure that cannot be computed returns `value: null` with `needs`.
 *     Never zero. Three of the tiles below are in that state and each says
 *     what would have to exist.
 *   - Every tile carries `from`: one line naming what it was computed from,
 *     with its denominator. A percentage without a denominator gets argued
 *     about instead of acted on.
 */

import type { Kpi } from "../../components/dashboard/Kpi";
import type { Subject } from "../authz/policy";

import { FULL_COMMITTEE } from "./board";
import { guard } from "./guard";
import type { ScholarshipRepository } from "./repository";
import { formatCents } from "./scoring";
import type { Application, Award, Cheque, Program, SelectionRecord } from "./types";

/* ------------------------------------------------------------------ *
 * Constants that are somebody's claim rather than something computed.
 *
 * Each one is named, commented and marked unverified, so that a figure
 * derived from it can never be mistaken for a measurement. Confirming one is
 * a one-line change here.
 * ------------------------------------------------------------------ */

/**
 * What the current intake tool costs the Foundation each year.
 *
 * SOURCE: the Scholarships Chair's own answer during intake — "about $9,000 a
 * year" for Submittable. ANNUAL, not per cycle. UNVERIFIED: nobody has put an
 * invoice or a renewal notice next to it, and it is not in any ledger this
 * platform reads. It is an input to the cost-per-dollar tile and is labelled as
 * an estimate everywhere that tile is rendered.
 */
export const INTAKE_TOOL_ANNUAL_COST_CENTS = 900_000;

/** The vendor the figure above refers to. Named so the tile can cite it. */
export const INTAKE_TOOL_NAME = "Submittable";

/**
 * How long after a decision the cheque ought to be in the post.
 *
 * PLACEHOLDER. No service standard has been set for this by the board, and the
 * applicant is the only person who experiences the wait. Thirty days gives the
 * tile a line to be measured against; confirm it with the chair and the
 * Treasurer before it is quoted anywhere.
 */
export const DECISION_TO_CHEQUE_TARGET_DAYS = 30;

/**
 * Fewer mailed cheques than this and a median is a number about two or three
 * records rather than about the cycle. Below it the tile reports that instead.
 */
export const MEANINGFUL_MAILED_SAMPLE = 5;

/** Award statuses that mean a decision was made and still stands. */
const STANDING: Award["status"][] = ["APPROVED", "NOTIFIED"];

/**
 * States that mean the Foundation owes the applicant an outcome.
 *
 * A withdrawal is excluded: the applicant made that decision themselves and
 * there is nothing to tell them. Everything before a decision is excluded too,
 * because a figure that counted those would fall as the cycle filled up.
 */
const OWED_AN_OUTCOME: Application["state"][] = ["AWARDED", "NOT_AWARDED"];

/* ------------------------------------------------------------------ *
 * What the route gets
 * ------------------------------------------------------------------ */

/**
 * The cycle's outstanding work, counted once.
 *
 * This used to be `actions`, rendered under the figures on this dashboard. Per
 * docs/ROLE-WORKSPACE.md the doing moved to the Overview tab and the figures
 * stayed here, so what is left in this file is the counting. `workspace.ts`
 * turns these counts into `RoleTask`s with a `because` on each.
 *
 * Deliberately a pure function over already-fetched records: it takes no
 * repository and performs no authorization, so it is not a read and cannot be
 * called to get round one. Both callers guard first and pass what they got.
 */
export type CycleWorkCounts = {
  /** Files with no score sheet at all. */
  unscored: number;
  /** Files started and short of the full committee. */
  partlyScored: number;
  /** The two above, which is everything short of a defensible score. */
  awaitingAFullCommittee: number;
  verificationsOutstanding: number;
  awardsWithTheBoard: number;
  awardsAwaitingNotification: number;
  chequesQueued: number;
  /** Decided applications where nothing has been sent to the applicant. */
  decidedWithNoOutcomeSent: number;
  /** Of those, the ones holding no award and so no notification path at all. */
  decidedWithNoAwardAtAll: number;
};

export function countCycleWork(input: {
  applications: Application[];
  sheetsByApplication: Map<string, number>;
  awards: Award[];
  cheques: Cheque[];
  verificationsOutstanding: number;
}): CycleWorkCounts {
  const { applications, sheetsByApplication, awards, cheques } = input;
  const live = applications.filter((application) => application.state !== "WITHDRAWN");

  const unscored = live.filter(
    (application) => (sheetsByApplication.get(application.id) ?? 0) === 0,
  ).length;
  const partlyScored = live.filter((application) => {
    const sheets = sheetsByApplication.get(application.id) ?? 0;
    return sheets > 0 && sheets < FULL_COMMITTEE;
  }).length;

  const notifiedApplicationIds = new Set(
    awards.filter((award) => award.notifiedAt !== null).map((award) => award.applicationId),
  );
  const awardedApplicationIds = new Set(awards.map((award) => award.applicationId));
  const decided = applications.filter((application) =>
    OWED_AN_OUTCOME.includes(application.state),
  );

  return {
    unscored,
    partlyScored,
    awaitingAFullCommittee: unscored + partlyScored,
    verificationsOutstanding: input.verificationsOutstanding,
    awardsWithTheBoard: awards.filter(
      (award) => award.boardReview !== null && award.boardReview.outcome === null,
    ).length,
    awardsAwaitingNotification: awards.filter((award) => award.status === "APPROVED").length,
    chequesQueued: cheques.filter((cheque) => cheque.status === "QUEUED").length,
    decidedWithNoOutcomeSent: decided.filter(
      (application) => !notifiedApplicationIds.has(application.id),
    ).length,
    decidedWithNoAwardAtAll: decided.filter(
      (application) => !awardedApplicationIds.has(application.id),
    ).length,
  };
}

export type DistributionRow = {
  schoolName: string;
  state: string;
  awards: number;
  totalCents: number;
};

export type ScholarshipsDashboard = {
  cycleLabel: string;
  asOf: string;
  /**
   * Every figure this cycle produces. Kept whole so nothing is lost, and split
   * into the two fields below for rendering.
   */
  thisCycle: Kpi[];
  /**
   * The three the board asked for. docs/ROLE-WORKSPACE.md: one to three per
   * role, not seven. A volunteer looking at six numbers has none.
   *
   * These three, and why each one earns a slot:
   *
   *   1. Applicants who received an outcome. The only tile with a real
   *      failure behind it: an applicant with no award hears nothing, ever.
   *   2. Days from decision to money reaching the school. The only part of
   *      the timeline the applicant actually experiences, and the measure of
   *      the task she named as most draining.
   *   3. Applications scored by the full committee. Defensibility, which is
   *      what a grantmaker or a disappointed applicant asks about.
   */
  headline: Kpi[];
  /**
   * The rest, behind a disclosure on the same page. Not deleted: each one is
   * still true and still has its provenance. They are not headlines because
   * none of them would change a decision this week — one cannot be measured
   * at all, one is 100% by construction, and one rests on an unverified
   * estimate and is really the Treasurer's figure.
   */
  moreFigures: Kpi[];
  /** Cumulative figures across the cycles on file. */
  sinceInception: Kpi[];
  /**
   * The reporting basis actually used for the cumulative band. Nobody has told
   * us whether scholarships are reported on a calendar or a fiscal year, so
   * this says what the data supports rather than guessing.
   */
  cumulativeBasis: string;
  distribution: {
    basis: string;
    schoolsReached: number;
    statesCovered: number;
    rows: DistributionRow[];
  };
};

/* ------------------------------------------------------------------ *
 * Arithmetic helpers. Integer cents throughout; a median says it is one.
 * ------------------------------------------------------------------ */

/** Whole percent, rounded. Returns null rather than dividing by zero. */
function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part * 100) / whole);
}

/** Median to the nearest whole day. Null on an empty sample. */
function medianDays(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function wholeDaysBetween(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

/** "1 cycle" / "2 cycles", so no figure ships with a "(s)" on it. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Mean of a set of integer-cent amounts, rounded to the nearest cent. */
function meanCents(amounts: number[]): number | null {
  if (amounts.length === 0) return null;
  const total = amounts.reduce((sum, value) => sum + value, 0);
  return Math.round(total / amounts.length);
}

/**
 * Cents of admin cost per dollar awarded, as an integer count of hundredths of
 * a cent so nothing is carried in a float.
 *
 *   cents per dollar = costCents / (awardedCents / 100) = 100 * costCents / awardedCents
 *
 * and a hundred times that for the hundredths.
 */
function hundredthsOfACentPerDollar(costCents: number, awardedCents: number): number | null {
  if (awardedCents <= 0) return null;
  return Math.round((costCents * 10_000) / awardedCents);
}

function formatCentsPerDollar(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, "0");
  return `${whole}.${fraction} cents`;
}

/* ------------------------------------------------------------------ *
 * The read
 * ------------------------------------------------------------------ */

export async function loadScholarshipsDashboard(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
  now: Date = new Date(),
): Promise<ScholarshipsDashboard> {
  // WRITE, not AGGREGATE. `loadCycleOverview` is counts only and a reviewer may
  // reach it; this read adds every award amount, the cumulative total and the
  // cost per dollar. The role table already spells the chair's seat as
  // APPLICANT WRITE, so nothing is widened to make this work. rowLevel is
  // false because nothing returned here names an applicant: the tiles are
  // counts and totals, and the distribution rows are schools.
  await guard(repo, subject, {
    action: "READ_SCHOLARSHIPS_DASHBOARD",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: false,
  });

  const cycle = cycleId ? await repo.getCycle(cycleId) : await repo.currentCycle();
  if (!cycle) throw new Error(`No cycle ${cycleId}`);

  const cycles = await repo.listCycles();
  const applications = await repo.listApplications({ cycleId: cycle.id });
  const awards = await repo.listAwards({ cycleId: cycle.id });
  const cheques = await repo.listCheques(cycle.id);
  const everyAward = await repo.listAwards();
  const everyApplication = await repo.listApplications();
  const selectionRecords = await repo.listSelectionRecords();
  const schools = await repo.listSchools();

  const sheetsByApplication = new Map<string, number>();
  for (const application of applications) {
    sheetsByApplication.set(
      application.id,
      (await repo.listScoreSheets(application.id)).length,
    );
  }

  // The three that earn a slot, in the order they are read. Every other figure
  // this cycle produces is below them on the same page, behind a disclosure.
  const headline: Kpi[] = [
    outcomeDelivered(applications, awards),
    decisionToCheque(awards, cheques),
    scoredByFullCommittee(applications, sheetsByApplication),
  ];
  const moreFigures: Kpi[] = [
    chairHours(),
    notifiedWithoutRetyping(awards),
    adminCostPerDollar(awards, cycle.label),
  ];

  const cumulative = cumulativeFigures(
    cycles,
    everyAward,
    selectionRecords,
    everyApplication,
    schools,
  );
  const distribution = awardDistribution(everyAward, everyApplication, schools);

  return {
    cycleLabel: cycle.label,
    asOf: now.toISOString(),
    thisCycle: [...headline, ...moreFigures],
    headline,
    moreFigures,
    sinceInception: cumulative.kpis,
    cumulativeBasis: cumulative.basis,
    distribution,
  };
}

/* ------------------------------------------------------------------ *
 * 1. Chair hours per cycle
 * ------------------------------------------------------------------ */

/**
 * The headline, and the one figure on this dashboard that cannot be computed.
 *
 * Nothing in this platform times an action. The module's audit log carries an
 * `at` on every entry, but an audit entry records that a read happened, not how
 * long the person spent on the work, and the log is not the chair's to read in
 * any case. Reporting a number here would mean inventing one.
 */
function chairHours(): Kpi {
  return {
    key: "chair-hours",
    label: "Chair hours per cycle",
    value: null,
    status: "unmeasured",
    from:
      "Would need timestamps on the chair's own actions. Her account of the " +
      "current load is about 40 hours a month from January to June, roughly " +
      "240 a cycle, and nothing here measures it.",
    needs: "action timing, which lands with persistence",
  };
}

/* ------------------------------------------------------------------ *
 * 2. Applicants who received an outcome
 * ------------------------------------------------------------------ */

/**
 * The most important tile, and it reads as a problem because it is one.
 *
 * An applicant hears from the Foundation when an award of theirs is notified.
 * An applicant with no award hears nothing, ever: `NOT_AWARDED_NOTICE` exists
 * as a message kind in notify.ts and no function in this module sends one.
 * The denominator is therefore every application with a decision recorded
 * against it, not every application with an award.
 */
function outcomeDelivered(applications: Application[], awards: Award[]): Kpi {
  const notifiedApplicationIds = new Set(
    awards.filter((award) => award.notifiedAt !== null).map((award) => award.applicationId),
  );
  const awardedApplicationIds = new Set(awards.map((award) => award.applicationId));

  const decided = applications.filter((application) =>
    OWED_AN_OUTCOME.includes(application.state),
  );
  const told = decided.filter((application) => notifiedApplicationIds.has(application.id)).length;
  const noAwardAtAll = decided.filter(
    (application) => !awardedApplicationIds.has(application.id),
  ).length;

  return {
    key: "outcome-told",
    label: "Applicants who received an outcome",
    value: `${told} of ${decided.length}`,
    target: `${decided.length} of ${decided.length}`,
    status: told === decided.length ? "good" : "problem",
    from:
      `Applications with a notified award, against the ${decided.length} ` +
      `decided this cycle; withdrawals are excluded. ${noAwardAtAll} of them ` +
      `have no award and so no notification path at all: NOT_AWARDED_NOTICE ` +
      `exists as a message kind and no function sends it.`,
  };
}

/* ------------------------------------------------------------------ *
 * 3. Days from decision to the cheque being posted
 * ------------------------------------------------------------------ */

/**
 * Not days to a decision. Days until the money is on its way to the school,
 * which is the only part of the timeline the applicant experiences: the award
 * letter does not pay a bursar.
 *
 * Measured from the award's `decidedAt` to its cheque's `mailedAt`, as a
 * median, because one award held up for a term would drag a mean and the
 * typical wait is what the chair is answerable for.
 */
function decisionToCheque(awards: Award[], cheques: Cheque[]): Kpi {
  const decidedAtByAward = new Map(
    awards
      .filter((award) => award.decidedAt !== null)
      .map((award) => [award.id, award.decidedAt as string]),
  );

  const waits: number[] = [];
  for (const cheque of cheques) {
    if (cheque.status !== "MAILED" || cheque.mailedAt === null) continue;
    const decidedAt = decidedAtByAward.get(cheque.awardId);
    if (!decidedAt) continue;
    const days = wholeDaysBetween(decidedAt, cheque.mailedAt);
    if (days !== null) waits.push(days);
  }

  const queued = cheques.filter((cheque) => cheque.status === "QUEUED").length;

  if (waits.length < MEANINGFUL_MAILED_SAMPLE) {
    return {
      key: "decision-to-cheque",
      label: "Days from decision to money reaching the school",
      value: null,
      status: "unmeasured",
      from:
        `Award decision date to cheque mailing date. Only ${waits.length} ` +
        `cheques are mailed this cycle, with ${queued} still queued, which is ` +
        `too few for a median to describe anything.`,
      needs: `at least ${MEANINGFUL_MAILED_SAMPLE} mailed cheques in the cycle`,
    };
  }

  const median = medianDays(waits) as number;
  return {
    key: "decision-to-cheque",
    label: "Days from decision to money reaching the school",
    value: `${median} days`,
    target: `within ${DECISION_TO_CHEQUE_TARGET_DAYS} days (placeholder)`,
    status: median <= DECISION_TO_CHEQUE_TARGET_DAYS ? "good" : "watch",
    from:
      `Median, to the nearest day, over the ${waits.length} cheques mailed ` +
      `this cycle, from each award's decision date. ${queued} are still ` +
      `queued and are not in it. The target is a placeholder: no service ` +
      `standard has been set.`,
  };
}

/* ------------------------------------------------------------------ *
 * 4. Awards notified without retyping
 * ------------------------------------------------------------------ */

/**
 * Migration progress, not a quality score.
 *
 * In this platform the figure is 100% by construction: `buildAwardNotification`
 * merges `award.amountCents` and there is no code path anywhere in the module
 * that types an amount into a message. What the tile actually tracks is how
 * many of the cycle's amounts have gone out that way instead of by hand, which
 * is the direct measure of whether the retyping has stopped.
 */
function notifiedWithoutRetyping(awards: Award[]): Kpi {
  const notified = awards.filter((award) => award.notifiedAt !== null).length;
  const outstanding = awards.length - notified;

  return {
    key: "merged-not-retyped",
    label: "Awards notified without retyping the amount",
    value: `${notified} of ${awards.length}`,
    target: `${awards.length} of ${awards.length}`,
    status: notified === awards.length ? "good" : "watch",
    from:
      `Awards with a notification sent, against every award in the cycle. ` +
      `Each one merged the amount from the award record, because no path in ` +
      `this module types an amount into a message. ${outstanding} have not ` +
      `gone out yet. The figure to compare it against is nought: today all ` +
      `${awards.length} amounts are retyped by hand.`,
  };
}

/* ------------------------------------------------------------------ *
 * 5. Applications scored by the full committee
 * ------------------------------------------------------------------ */

/**
 * An award scored by two people is less defensible than one scored by four,
 * and defensibility is what a grantmaker asks about. `FULL_COMMITTEE` is 4.
 *
 * Denominator is applications that are open to scoring: drafts, files waiting
 * on a guardian and withdrawals are excluded because no committee owes them a
 * sheet.
 */
function scoredByFullCommittee(
  applications: Application[],
  sheetsByApplication: Map<string, number>,
): Kpi {
  const scorable = applications.filter(
    (application) =>
      application.state !== "DRAFT" &&
      application.state !== "AWAITING_GUARDIAN_CONSENT" &&
      application.state !== "WITHDRAWN",
  );
  const full = scorable.filter(
    (application) => (sheetsByApplication.get(application.id) ?? 0) >= FULL_COMMITTEE,
  ).length;
  const none = scorable.filter(
    (application) => (sheetsByApplication.get(application.id) ?? 0) === 0,
  ).length;
  const share = percent(full, scorable.length);

  // Short of the full committee on any award is a watch; short on more than a
  // tenth of the cycle is a problem, because by then it is the normal case.
  const status: Kpi["status"] =
    share === null ? "unmeasured" : share === 100 ? "good" : share >= 90 ? "watch" : "problem";

  return {
    key: "full-committee",
    label: `Applications scored by all ${FULL_COMMITTEE} reviewers`,
    value: `${full} of ${scorable.length}`,
    target: `${scorable.length} of ${scorable.length}`,
    status,
    from:
      `Score sheets per application, against the ${scorable.length} open to ` +
      `scoring this cycle. ${none} have no sheet at all. Drafts, files ` +
      `waiting on a guardian and withdrawals are excluded.`,
  };
}

/* ------------------------------------------------------------------ *
 * 6. Admin cost per dollar awarded
 * ------------------------------------------------------------------ */

/**
 * The cleanest argument for or against a tooling decision, and the figure the
 * Treasurer will read first.
 *
 * The cost side is an estimate the chair gave in intake and is annual; the
 * awarded side is this cycle's standing awards. The Foundation runs one cycle a
 * year, so the two are comparable, but the comparison is stated on the tile
 * rather than assumed, and the status is never better than a watch while the
 * cost is unverified.
 */
function adminCostPerDollar(awards: Award[], cycleLabel: string): Kpi {
  const standing = awards.filter((award) => STANDING.includes(award.status));
  const awardedCents = standing.reduce((sum, award) => sum + award.amountCents, 0);
  const undecided = awards.length - standing.length;
  const hundredths = hundredthsOfACentPerDollar(INTAKE_TOOL_ANNUAL_COST_CENTS, awardedCents);

  if (hundredths === null) {
    return {
      key: "admin-cost-per-dollar",
      label: "Admin cost per dollar awarded",
      value: null,
      status: "unmeasured",
      from:
        `${INTAKE_TOOL_NAME} at an estimated ${formatCents(INTAKE_TOOL_ANNUAL_COST_CENTS)} a ` +
        `year, over the amount awarded in ${cycleLabel}. Nothing is awarded yet, ` +
        `so there is no denominator.`,
      needs: "a decided award in the cycle to divide by",
    };
  }

  return {
    key: "admin-cost-per-dollar",
    label: "Admin cost per dollar awarded",
    value: formatCentsPerDollar(hundredths),
    status: "watch",
    from:
      `${INTAKE_TOOL_NAME} at an estimated ${formatCents(INTAKE_TOOL_ANNUAL_COST_CENTS)} a ` +
      `year, the chair's own figure in intake, annual and unverified, over ` +
      `${formatCents(awardedCents)} standing in ${cycleLabel}, one cycle a year. ` +
      `${plural(undecided, "award is", "awards are")} not yet decided and ` +
      `excluded, so the denominator will grow and this figure will fall.`,
  };
}

/* ------------------------------------------------------------------ *
 * Cumulative: every cycle on file
 * ------------------------------------------------------------------ */

type CycleTotals = {
  cycleId: string;
  closed: boolean;
  source: "award records" | "selection records" | "nothing on file";
  lines: { program: Program; amountCents: number }[];
  /** Distinct award-holding applications in that cycle. */
  recipients: number;
};

/**
 * One cycle's totals, from whichever record survives for it.
 *
 * A closed cycle whose applicant data has been purged keeps only its selection
 * records, which carry the programme and the amount and nothing that identifies
 * a person. An open cycle has its award records. A cycle is never counted from
 * both, so a cycle part way through a purge cannot be double counted.
 */
function totalsForCycle(
  cycleId: string,
  closed: boolean,
  everyAward: Award[],
  selectionRecords: SelectionRecord[],
): CycleTotals {
  const standing = everyAward.filter(
    (award) => award.cycleId === cycleId && STANDING.includes(award.status),
  );
  if (standing.length > 0) {
    return {
      cycleId,
      closed,
      source: "award records",
      lines: standing.map((award) => ({ program: award.program, amountCents: award.amountCents })),
      recipients: new Set(standing.map((award) => award.applicationId)).size,
    };
  }

  const records = selectionRecords.filter(
    (record) => record.cycleId === cycleId && record.awards.length > 0,
  );
  if (records.length > 0) {
    return {
      cycleId,
      closed,
      source: "selection records",
      lines: records.flatMap((record) => record.awards),
      recipients: new Set(records.map((record) => record.applicationRef)).size,
    };
  }

  return { cycleId, closed, source: "nothing on file", lines: [], recipients: 0 };
}

function cumulativeFigures(
  cycles: { id: string; state: string }[],
  everyAward: Award[],
  selectionRecords: SelectionRecord[],
  everyApplication: Application[],
  schools: { id: string; state: string }[],
): { kpis: Kpi[]; basis: string } {
  const perCycle = cycles.map((cycle) =>
    totalsForCycle(cycle.id, cycle.state === "CLOSED", everyAward, selectionRecords),
  );
  const counted = perCycle.filter((totals) => totals.lines.length > 0);
  const closed = counted.filter((totals) => totals.closed);
  const open = counted.filter((totals) => !totals.closed);

  const allLines = counted.flatMap((totals) => totals.lines);
  const totalCents = allLines.reduce((sum, line) => sum + line.amountCents, 0);
  const closedCents = closed
    .flatMap((totals) => totals.lines)
    .reduce((sum, line) => sum + line.amountCents, 0);
  const openCents = open
    .flatMap((totals) => totals.lines)
    .reduce((sum, line) => sum + line.amountCents, 0);
  const recipients = counted.reduce((sum, totals) => sum + totals.recipients, 0);

  const merit = allLines.filter((line) => line.program === "MERIT").map((l) => l.amountCents);
  const woundedPatriot = allLines
    .filter((line) => line.program === "WOUNDED_PATRIOT")
    .map((l) => l.amountCents);

  const basis =
    `Counted per cycle, not per calendar or fiscal year. Cycles on file: ` +
    `${cycles.length}, of which ${counted.length} carry awards ` +
    `(${closed.length} closed, ${open.length} still open). The cycle opens in ` +
    `December and awards land in spring, so it straddles two calendar years, ` +
    `and nobody has confirmed whether the Foundation reports scholarships on a ` +
    `calendar or a fiscal basis. Until that is settled these are cycle totals ` +
    `and nothing else.`;

  // Two cycles is not a history. Any cumulative figure drawn from it is a
  // starting point for the board's own records, not a substantiated total, and
  // the tiles say which cycles they cover rather than implying more.
  const thinHistory = closed.length < 3;
  const historyNote =
    `${plural(closed.length, "closed cycle", "closed cycles")} and ` +
    `${open.length} open: too little history to stand as a since-inception ` +
    `total, so read it as what the platform holds.`;

  const kpis: Kpi[] = [
    {
      key: "cumulative-total",
      label: "Total awarded, every cycle on file",
      value: formatCents(totalCents),
      status: thinHistory ? "watch" : "good",
      from:
        `${formatCents(closedCents)} across ` +
        `${plural(closed.length, "closed cycle", "closed cycles")} from ` +
        `selection records, plus ${formatCents(openCents)} standing in ` +
        `${open.length} open. ${historyNote}`,
    },
    {
      key: "cumulative-count",
      label: "Scholarships awarded, every cycle on file",
      value: `${allLines.length} awards to ${recipients} recipients`,
      status: thinHistory ? "watch" : "good",
      from:
        `One line per award, counted separately from recipients because an ` +
        `applicant can hold both a Merit and a Wounded Patriot award in one ` +
        `cycle. Recipients are counted per cycle, so somebody awarded in two ` +
        `cycles counts twice. ${historyNote}`,
    },
    averageAward("cumulative-average-all", "Average award, both programmes", allLines.map((l) => l.amountCents), {
      from:
        `Blended across all ${allLines.length} awards on file. Merit is ` +
        `score-banded and Wounded Patriot is flat, so the two tiles beside ` +
        `this one are the figures to use.`,
      status: "good",
    }),
    averageAward("cumulative-average-merit", "Average Merit award", merit, {
      from:
        `${merit.length} Merit awards on file. Score-banded from $500 to ` +
        `$2,500, so this average moves with the committee's scoring and is ` +
        `the one worth watching.`,
      status: "good",
    }),
    averageAward("cumulative-average-wp", "Average Wounded Patriot award", woundedPatriot, {
      from:
        `${woundedPatriot.length} Wounded Patriot awards on file. A flat ` +
        `award, so the average is the flat amount, and that amount is still ` +
        `an unconfirmed placeholder, which is why this is not a finding.`,
      status: "watch",
    }),
    cumulativeStatesTile(selectionRecords, everyApplication, new Map(schools.map((s) => [s.id, s]))),
  ];

  return { kpis, basis };
}

/**
 * States reached across every cycle on file, including purged ones.
 *
 * This tile was unmeasurable until `schoolState` was added to the selection
 * record: the purge deletes the application and with it the only route from an
 * award to a place, so a closed cycle's spread used to be gone for good.
 *
 * It counts STATES and not schools, because that is all a surviving record
 * keeps. The school is deliberately absent — a school narrows a cycle to one
 * institution's applicants, which in a small school is a person, and this
 * record is retained five years precisely because there is nobody in it. The
 * ranked list below the tiles still names schools for the cycles that have not
 * been purged yet, and says so.
 */
function cumulativeStatesTile(
  selectionRecords: SelectionRecord[],
  applications: Application[],
  schoolsById: Map<string, { state: string }>,
): Kpi {
  const fromRecords = new Set(
    selectionRecords.map((record) => record.schoolState).filter((s): s is string => Boolean(s)),
  );
  const fromOpen = new Set(
    applications
      .map((application) => application.enrolment?.schoolId)
      .filter((id): id is string => Boolean(id))
      .map((id) => schoolsById.get(id)?.state)
      .filter((s): s is string => Boolean(s)),
  );
  const all = new Set([...fromRecords, ...fromOpen]);
  const recordsMissing = selectionRecords.filter((record) => record.schoolState === null).length;

  return {
    key: "cumulative-spread",
    label: "States reached, every cycle on file",
    value: plural(all.size, "state", "states"),
    status: "good",
    from:
      `${fromRecords.size} from selection records that outlived their ` +
      `applications, ${fromOpen.size} from cycles still holding them. ` +
      (recordsMissing > 0
        ? `${recordsMissing} older ${plural(recordsMissing, "record", "records")} ` +
          `predate the field and know no state. `
        : "") +
      `States, not schools: a purged record keeps the state deliberately and ` +
      `nothing finer.`,
  };
}

function averageAward(
  key: string,
  label: string,
  amounts: number[],
  copy: { from: string; status: Kpi["status"] },
): Kpi {
  const mean = meanCents(amounts);
  if (mean === null) {
    return {
      key,
      label,
      value: null,
      status: "unmeasured",
      from: copy.from,
      needs: "at least one award of this kind on file",
    };
  }
  return { key, label, value: formatCents(mean), status: copy.status, from: copy.from };
}

/* ------------------------------------------------------------------ *
 * Where the awards went
 * ------------------------------------------------------------------ */

/**
 * A ranked list, not a map.
 *
 * The useful content is the ranking and the spread, and a map would mean a
 * mapping library, which the module brief forbids. Built by joining standing
 * awards to their application's school, which means it covers exactly the
 * cycles that still hold their applications.
 */
function awardDistribution(
  everyAward: Award[],
  everyApplication: Application[],
  schools: { id: string; name: string; state: string }[],
): ScholarshipsDashboard["distribution"] {
  const applicationsById = new Map(everyApplication.map((a) => [a.id, a]));
  const schoolsById = new Map(schools.map((s) => [s.id, s]));
  const tally = new Map<string, DistributionRow>();
  const cyclesCovered = new Set<string>();

  for (const award of everyAward) {
    if (!STANDING.includes(award.status)) continue;
    const application = applicationsById.get(award.applicationId);
    if (!application?.enrolment) continue;
    const school = schoolsById.get(application.enrolment.schoolId);
    if (!school) continue;
    cyclesCovered.add(award.cycleId);
    const row = tally.get(school.id) ?? {
      schoolName: school.name,
      state: school.state,
      awards: 0,
      totalCents: 0,
    };
    row.awards += 1;
    row.totalCents += award.amountCents;
    tally.set(school.id, row);
  }

  const rows = [...tally.values()].sort(
    (a, b) => b.awards - a.awards || b.totalCents - a.totalCents || a.schoolName.localeCompare(b.schoolName),
  );
  const states = new Set(rows.map((row) => row.state));

  return {
    basis:
      `Standing awards joined to the school on each application. Covers only ` +
      `cycles that still hold their applications, which is ` +
      `${plural(cyclesCovered.size, "cycle", "cycles")} here. A purged cycle ` +
      `keeps no school, so it cannot appear at all.`,
    schoolsReached: rows.length,
    statesCovered: states.size,
    rows,
  };
}
