/**
 * Published criteria, the score, and the band the score puts a Merit award in.
 *
 * Two things are deliberate here.
 *
 * The criteria are published. An applicant can read what they will be scored
 * against before they write the essay, and the same list is what a reviewer
 * fills in. A scholarship whose criteria are not written down is a scholarship
 * decided on impressions, which is both the thing a charitable class is
 * supposed to avoid and the thing that makes a disappointed applicant's letter
 * hard to answer.
 *
 * The bands turn a score into an amount by arithmetic rather than by judgment,
 * because the chair's account of the work is that the amounts are the
 * expensive part. Four people other than the chair score; the band does the
 * rest. The top award sits outside the bands on purpose: it is occasional and
 * the chair designates it, so it is not something a high score triggers on its
 * own.
 *
 * Nothing in this file knows who is eligible. That lives in eligibility.ts and
 * is a placeholder while counsel reports.
 */

import {
  CRITERION_KEYS,
  type CriterionKey,
  type ScoreSheet,
  type ScoringCriterion,
} from "./types";

export const SCORING_CRITERIA: ScoringCriterion[] = [
  {
    key: "ACADEMIC_RECORD",
    label: "Academic record",
    maxPoints: 30,
    published:
      "Grades, the difficulty of the course load, and progress over time. A " +
      "rising record counts for more than a flat one at the same average.",
  },
  {
    key: "ESSAY",
    label: "Essay",
    maxPoints: 25,
    published:
      "Whether the essay answers the question asked, in the applicant's own " +
      "voice, with something specific in it. Length is not scored.",
  },
  {
    key: "SERVICE_AND_LEADERSHIP",
    label: "Service and leadership",
    maxPoints: 20,
    published:
      "What the applicant has taken responsibility for, at school, at work, " +
      "at home or in their community. Sustained commitment counts for more " +
      "than a long list.",
  },
  {
    key: "RECOMMENDATION",
    label: "Recommendation",
    maxPoints: 15,
    published:
      "What someone who has taught, employed or coached the applicant says " +
      "about them, and how well they appear to know them.",
  },
  {
    key: "FINANCIAL_NEED",
    label: "Financial need",
    maxPoints: 10,
    published:
      "The gap between the cost of the year and what the family can meet. " +
      "Scored from what the applicant states; no financial document is " +
      "collected by this platform.",
  },
];

export const MAX_SCORE = SCORING_CRITERIA.reduce((sum, c) => sum + c.maxPoints, 0);

export function criterionByKey(key: CriterionKey): ScoringCriterion {
  const found = SCORING_CRITERIA.find((c) => c.key === key);
  if (!found) throw new Error(`No scoring criterion ${key}`);
  return found;
}

/* ------------------------------------------------------------------ *
 * Merit bands
 * ------------------------------------------------------------------ */

export type MeritBand = {
  key: string;
  label: string;
  /** Inclusive floor on the committee's average score. */
  minScore: number;
  amountCents: number;
};

/**
 * The chair's figures: normally $500 to $2,500. The bands are evenly spaced
 * inside that range so the arithmetic is checkable, and the floor is the score
 * below which there is no Merit award at all.
 *
 * Ordered high to low. `meritBandFor` takes the first band the score reaches.
 */
export const MERIT_BANDS: MeritBand[] = [
  { key: "BAND_2500", label: "$2,500", minScore: 90, amountCents: 250_000 },
  { key: "BAND_2000", label: "$2,000", minScore: 80, amountCents: 200_000 },
  { key: "BAND_1500", label: "$1,500", minScore: 70, amountCents: 150_000 },
  { key: "BAND_1000", label: "$1,000", minScore: 60, amountCents: 100_000 },
  { key: "BAND_500", label: "$500", minScore: 50, amountCents: 50_000 },
];

export const MERIT_FLOOR_SCORE = MERIT_BANDS[MERIT_BANDS.length - 1].minScore;

/**
 * The occasional top award.
 *
 * Outside the bands and not reachable by score alone: a score at or above the
 * floor makes an application eligible for the designation, and the chair makes
 * it. `proposeMeritAward` will not return this amount unless it is asked to.
 */
export const TOP_WINNER = {
  label: "Top winner",
  eligibleFromScore: 95,
  amountCents: 500_000,
  note:
    "Occasional, and designated by the chair rather than reached by score. " +
    "One or none in a cycle is normal.",
} as const;

export function meritBandFor(total: number): MeritBand | null {
  return MERIT_BANDS.find((band) => total >= band.minScore) ?? null;
}

/**
 * Score to amount, as a pure function, so a caller can preview the default
 * without writing anything.
 *
 * Nothing in here reads or writes a record, and calling it commits nothing.
 * `proposeAwards` is what commits; this is what a screen shows while the chair
 * is still deciding.
 */
export type MeritPreview = {
  total: number;
  band: MeritBand | null;
  /** Null when the score is below the Merit floor. */
  amountCents: number | null;
  label: string;
  /** True when the chair MAY designate a top winner. Never automatic. */
  eligibleForTopWinner: boolean;
  topWinnerAmountCents: number;
  basis: string;
};

export function previewMeritAward(total: number): MeritPreview {
  const band = meritBandFor(total);
  const eligibleForTopWinner = total >= TOP_WINNER.eligibleFromScore;
  return {
    total,
    band,
    amountCents: band?.amountCents ?? null,
    label: band ? band.label : "No Merit award",
    eligibleForTopWinner,
    topWinnerAmountCents: TOP_WINNER.amountCents,
    basis: band
      ? `Committee average ${total}, band ${band.label}.`
      : `Committee average ${total}, below the Merit floor of ${MERIT_FLOOR_SCORE}.`,
  };
}

/** The flat Wounded Patriot amount, for a preview. Qualification is a person's decision. */
export function previewWoundedPatriotAward(): {
  amountCents: number;
  amountConfirmed: boolean;
  basis: string;
} {
  return {
    amountCents: WOUNDED_PATRIOT.amountCents,
    amountConfirmed: WOUNDED_PATRIOT.amountConfirmed,
    basis: "Flat award to everyone the chair has verified. Not score-based.",
  };
}

/* ------------------------------------------------------------------ *
 * Wounded Patriot
 * ------------------------------------------------------------------ */

/**
 * A flat amount to everyone who qualifies, so there is no band and no score.
 * Qualification is the disability verification, which is a person's decision
 * and is recorded in verification.ts.
 *
 * PLACEHOLDER. The chair gave the Merit range and did not give this figure.
 * Confirm it with her before the cycle opens; it is a constant so that
 * confirming it is a one-line change.
 */
export const WOUNDED_PATRIOT = {
  amountCents: 100_000,
  amountConfirmed: false,
  note:
    "Placeholder amount. The flat Wounded Patriot figure was not supplied " +
    "with the rest of the intake and needs the chair's confirmation.",
} as const;

/* ------------------------------------------------------------------ *
 * Aggregating the committee
 * ------------------------------------------------------------------ */

export function sheetTotal(points: Record<CriterionKey, number>): number {
  return CRITERION_KEYS.reduce((sum, key) => sum + (points[key] ?? 0), 0);
}

export class ScoreOutOfRangeError extends Error {
  constructor(key: CriterionKey, value: number, max: number) {
    super(`${key} scored ${value}, which is outside 0 to ${max}`);
    this.name = "ScoreOutOfRangeError";
  }
}

export function assertPointsInRange(points: Record<CriterionKey, number>): void {
  for (const criterion of SCORING_CRITERIA) {
    const value = points[criterion.key];
    if (!Number.isInteger(value) || value < 0 || value > criterion.maxPoints) {
      throw new ScoreOutOfRangeError(criterion.key, value, criterion.maxPoints);
    }
  }
}

export type CommitteeScore = {
  /** Mean of the sheets, rounded to the nearest whole point. */
  average: number;
  sheets: number;
  /** Highest and lowest sheet, so a wide spread is visible rather than averaged away. */
  high: number;
  low: number;
  spread: number;
};

export function committeeScore(sheets: ScoreSheet[]): CommitteeScore | null {
  if (sheets.length === 0) return null;
  const totals = sheets.map((s) => s.total);
  const sum = totals.reduce((a, b) => a + b, 0);
  const high = Math.max(...totals);
  const low = Math.min(...totals);
  return {
    average: Math.round(sum / totals.length),
    sheets: totals.length,
    high,
    low,
    spread: high - low,
  };
}

/** A spread this wide is worth the chair looking at before the band is applied. */
export const SPREAD_WORTH_A_LOOK = 20;

export function formatCents(amountCents: number): string {
  const sign = amountCents < 0 ? "-" : "";
  const absolute = Math.abs(amountCents);
  const dollars = Math.floor(absolute / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(absolute % 100).padStart(2, "0")}`;
}
