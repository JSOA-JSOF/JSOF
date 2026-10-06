/**
 * Qualified sponsorship: the 2% safe harbour and the acknowledgment review.
 *
 * The safe harbour is all or nothing. If the fair market value of everything
 * the sponsor receives is 2% or less of the payment, the benefits are
 * disregarded and the whole payment is a qualified sponsorship payment. If it
 * exceeds 2%, the ENTIRE benefit value is carved out, not merely the excess —
 * which is why a sponsor register that stores only "benefits: yes" is useless.
 *
 * The acknowledgment review is a warning to a human, never a block. It cannot
 * be a block: whether a phrase is an acknowledgment or an advert is a judgment,
 * and a validator that refuses to save would just get worked around. What it
 * can do is make sure nobody publishes "the region's best roofer" without
 * having been told what that adjective does.
 *
 * Research, not advice. COUNSEL before a placement contract is signed.
 */

import { formatCents } from "./money";
import {
  PLACEMENT_CATEGORY,
  PLACEMENT_LABEL,
  type PlacementCategory,
  type PlacementKind,
  type SponsorPlacement,
  type Sponsorship,
} from "./types";

/* ------------------------------------------------------------------ *
 * The 2% safe harbour
 * ------------------------------------------------------------------ */

/** Numerator and denominator, so the test never touches a float. */
export const SAFE_HARBOUR_NUMERATOR = 2;
export const SAFE_HARBOUR_DENOMINATOR = 100;

export type SafeHarbourAssessment = {
  paymentCents: number;
  totalBenefitFairMarketValueCents: number;
  /**
   * 2% of the payment, floored, for display. The decision below does NOT use
   * this number: it compares the exact ratio, so a payment that is not a
   * multiple of fifty cents is still judged correctly.
   */
  thresholdCents: number;
  /** True when benefit value is at or below 2% of the payment. */
  withinSafeHarbour: boolean;
  /** Zero inside the harbour; the whole benefit value outside it. */
  carvedOutCents: number;
  /** The part of the payment that remains a qualified sponsorship payment. */
  qualifiedSponsorshipPortionCents: number;
  /** What the excess alone would have been, to show what the cliff costs. */
  excessOverThresholdCents: number;
  explanation: string;
};

/**
 * Exact integer comparison of `benefit / payment` against `2 / 100`.
 * benefit/payment > 2/100  <=>  benefit * 100 > payment * 2  <=>  benefit * 50 > payment.
 */
export function exceedsSafeHarbour(paymentCents: number, totalBenefitCents: number): boolean {
  return (
    totalBenefitCents * SAFE_HARBOUR_DENOMINATOR >
    paymentCents * SAFE_HARBOUR_NUMERATOR
  );
}

export function assessSafeHarbour(
  paymentCents: number,
  totalBenefitFairMarketValueCents: number,
): SafeHarbourAssessment {
  const thresholdCents = Math.floor(
    (paymentCents * SAFE_HARBOUR_NUMERATOR) / SAFE_HARBOUR_DENOMINATOR,
  );
  const exceeds = exceedsSafeHarbour(paymentCents, totalBenefitFairMarketValueCents);
  const carvedOutCents = exceeds ? totalBenefitFairMarketValueCents : 0;
  const excessOverThresholdCents = Math.max(
    0,
    totalBenefitFairMarketValueCents - thresholdCents,
  );

  const explanation = exceeds
    ? `Benefits are valued at ${formatCents(totalBenefitFairMarketValueCents)} against a ` +
      `${formatCents(paymentCents)} payment, above the 2% ceiling of ` +
      `${formatCents(thresholdCents)}. The safe harbour is all or nothing, so the ` +
      `entire ${formatCents(totalBenefitFairMarketValueCents)} is carved out, not just ` +
      `the ${formatCents(excessOverThresholdCents)} above the ceiling. ` +
      `${formatCents(paymentCents - carvedOutCents)} remains a qualified sponsorship ` +
      `payment; the carved-out value is treated separately.`
    : `Benefits are valued at ${formatCents(totalBenefitFairMarketValueCents)} against a ` +
      `${formatCents(paymentCents)} payment, at or below the 2% ceiling of ` +
      `${formatCents(thresholdCents)}. The benefits are disregarded and the whole ` +
      `${formatCents(paymentCents)} is a qualified sponsorship payment.`;

  return {
    paymentCents,
    totalBenefitFairMarketValueCents,
    thresholdCents,
    withinSafeHarbour: !exceeds,
    carvedOutCents,
    qualifiedSponsorshipPortionCents: paymentCents - carvedOutCents,
    excessOverThresholdCents,
    explanation,
  };
}

export function totalPlacementBenefitCents(placements: SponsorPlacement[]): number {
  return placements.reduce((total, p) => total + p.benefitFairMarketValueCents, 0);
}

export function assessSponsorship(sponsorship: Sponsorship): SafeHarbourAssessment {
  return assessSafeHarbour(
    sponsorship.paymentCents,
    totalPlacementBenefitCents(sponsorship.placements),
  );
}

/* ------------------------------------------------------------------ *
 * Advertising versus acknowledgment
 * ------------------------------------------------------------------ */

export const ADVERTISING_NOTE =
  "A programme or newsletter advert is advertising, not an acknowledgment. " +
  "Advertising revenue is unrelated business income for a veterans' organization " +
  "and is reported and taxed separately from sponsorship. A tee sign, a shirt " +
  "back and a website footer are acknowledgments and are not.";

export function placementCategory(kind: PlacementKind): PlacementCategory {
  return PLACEMENT_CATEGORY[kind];
}

export function categorySummary(placements: SponsorPlacement[]): {
  acknowledgmentCents: number;
  advertisingCents: number;
  advertisingPlacements: string[];
} {
  let acknowledgmentCents = 0;
  let advertisingCents = 0;
  const advertisingPlacements: string[] = [];
  for (const placement of placements) {
    if (PLACEMENT_CATEGORY[placement.kind] === "ADVERTISING") {
      advertisingCents += placement.benefitFairMarketValueCents;
      advertisingPlacements.push(PLACEMENT_LABEL[placement.kind]);
    } else {
      acknowledgmentCents += placement.benefitFairMarketValueCents;
    }
  }
  return { acknowledgmentCents, advertisingCents, advertisingPlacements };
}

/* ------------------------------------------------------------------ *
 * Acknowledgment string review
 * ------------------------------------------------------------------ */

export type AcknowledgmentFindingCategory =
  | "QUALITATIVE"
  | "COMPARATIVE"
  | "PRICE"
  | "SAVINGS"
  | "CALL_TO_ACTION"
  | "ENDORSEMENT";

export type AcknowledgmentFinding = {
  /** Always a warning. There is no error severity here on purpose. */
  severity: "warning";
  category: AcknowledgmentFindingCategory;
  /** The text that triggered it, as it appears in the string. */
  match: string;
  index: number;
  explanation: string;
};

type Pattern = {
  category: AcknowledgmentFindingCategory;
  pattern: RegExp;
  explanation: string;
};

const QUALITATIVE_EXPLANATION =
  "This is qualitative language about the sponsor. A message containing both " +
  "advertising and acknowledgment is entirely advertising, so one adjective converts " +
  "the whole placement into taxable advertising. Keep the wording to identity: " +
  "name, address, telephone, logo, and a neutral product line.";

const COMPARATIVE_EXPLANATION =
  "This is comparative language. Comparison makes the message advertising, and " +
  "advertising taints the entire placement, not just this phrase.";

const PATTERNS: Pattern[] = [
  {
    category: "QUALITATIVE",
    pattern:
      /\b(best|finest|premier|premium|superior|excellent|outstanding|quality|award[- ]winning|trusted|expert|professional grade|world[- ]class|unbeatable|top[- ](?:rated|quality))\b/gi,
    explanation: QUALITATIVE_EXPLANATION,
  },
  {
    category: "COMPARATIVE",
    pattern:
      /(\bleading\b|\bnumber one\b|\bno\.? ?1\b|#1|\bbetter than\b|\bfastest\b|\blargest\b|\bmost\b|\bvoted\b|\bcompare\b)/gi,
    explanation: COMPARATIVE_EXPLANATION,
  },
  {
    category: "PRICE",
    pattern: /(\$\s?\d[\d,]*(?:\.\d{2})?|\b\d+(?:\.\d+)?\s?%|\bper month\b|\bstarting at\b|\bfrom only\b|\blowest price\b|\bprices?\b)/gi,
    explanation:
      "Price information, including a percentage or a rate, makes the message " +
      "advertising. An acknowledgment may name what the sponsor sells but may not " +
      "say what it costs.",
  },
  {
    category: "SAVINGS",
    pattern: /\b(save|savings|discount|sale|deal|free|offer|coupon|bonus)\b/gi,
    explanation:
      "An inducement to buy makes the message advertising. Remove the offer and keep " +
      "the sponsor's identity.",
  },
  {
    category: "CALL_TO_ACTION",
    pattern:
      /\b(call now|call today|call us|visit us|visit today|shop|buy|order now|sign up|book now|click here|ask for|don'?t miss|limited time)\b/gi,
    explanation:
      "A call to action makes the message advertising. A telephone number or web " +
      "address on its own is fine; an instruction to use it is not.",
  },
  {
    category: "ENDORSEMENT",
    pattern:
      /\b(recommends?|recommended|endorses?|endorsed|approved by|our choice|we use|exclusive provider|official (?:provider|supplier))\b/gi,
    explanation:
      "An endorsement makes the message advertising. Exclusive sponsor is acceptable; " +
      "exclusive provider is not, and neither is the organization vouching for the " +
      "sponsor's goods.",
  },
];

export type AcknowledgmentReview = {
  text: string;
  findings: AcknowledgmentFinding[];
  /** True when nothing was flagged. Not a guarantee of anything. */
  clean: boolean;
  /** Shown to the board member next to the findings. */
  advisory: string;
};

export const ACKNOWLEDGMENT_ADVISORY_CLEAN =
  "Nothing was flagged. This check looks for known advertising signals and cannot " +
  "tell you the wording is correct. Read it once more as the sponsor's customer " +
  "would, then save it.";

export const ACKNOWLEDGMENT_ADVISORY_FLAGGED =
  "These are warnings for you to read, not a block. You can save and publish this " +
  "wording anyway, and sometimes that is the right call. Before you do: a message " +
  "that mixes advertising with acknowledgment is treated as advertising in its " +
  "entirety, so one adjective can move the whole placement out of qualified " +
  "sponsorship and into taxable advertising income.";

export function reviewAcknowledgment(text: string): AcknowledgmentReview {
  const findings: AcknowledgmentFinding[] = [];
  for (const { category, pattern, explanation } of PATTERNS) {
    // Fresh regex per pass: a shared /g/ keeps lastIndex between calls.
    const scanner = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(text)) !== null) {
      findings.push({
        severity: "warning",
        category,
        match: match[0],
        index: match.index,
        explanation,
      });
      if (match[0].length === 0) scanner.lastIndex += 1;
    }
  }
  findings.sort((a, b) => a.index - b.index);
  const clean = findings.length === 0;
  return {
    text,
    findings,
    clean,
    advisory: clean ? ACKNOWLEDGMENT_ADVISORY_CLEAN : ACKNOWLEDGMENT_ADVISORY_FLAGGED,
  };
}
