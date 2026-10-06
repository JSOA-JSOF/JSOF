/**
 * The composition report.
 *
 * This is a compliance control, not a dashboard. Two of the three tests decide
 * whether JSOA is exempt at all; the third decides whether a gift to JSOA is
 * deductible to the giver. A non-qualifying member class above 2.5% of the
 * roster destroys the exemption, so the figure has to be countable and
 * checkable rather than pretty.
 *
 * Authority: 26 U.S.C. 501(c)(19) and 170(c)(3), read with IRS Pub. 3386 ch. 9.
 *
 * NOT authority: Treas. Reg. 1.501(c)(19)-1, which still requires 75% of
 * members to be *war* veterans. Congress deleted that requirement in 1982 and
 * the regulation was never conformed. Building the 75% test on war-veteran
 * status instead of armed-forces service would fail this roster (33 of 40,
 * 82.5%) while the statute passes it comfortably (35 of 40, 87.5%). That is
 * the trap, and it is the difference between a report that says "exempt" and
 * one that says "not exempt".
 *
 * All threshold comparisons are integer arithmetic in permille. 97.5% of 40 is
 * exactly 39, and a float comparison at that boundary is an argument nobody
 * should have to have with the IRS.
 */

import type { MembershipState } from "./state";
import { MEMBER_ACCESS_STATES } from "./state";
import {
  type CompositionReport,
  type CompositionTest,
  type Member,
  type MembershipCategory,
  MEMBERSHIP_CATEGORIES,
  MEMBERSHIP_ENTITY,
} from "./types";

/**
 * Who counts as a member for the tests: the people who hold member access.
 * Applicants are not members, and a lapsed or revoked record is not a member.
 * Counting them would flatter the two exemption tests by inflating the
 * denominator with veterans who have left.
 */
export const COUNTED_STATES: MembershipState[] = MEMBER_ACCESS_STATES;

/** Threshold in permille. Never a float, never a percentage literal. */
export const THRESHOLDS = {
  ARMED_FORCES: 750,
  MEMBERS_CADETS_RELATIVES: 975,
  WAR_VETERANS: 900,
} as const;

/** `numerator / denominator >= threshold`, in integers. */
export function meetsThreshold(
  numerator: number,
  denominator: number,
  thresholdPermille: number,
): boolean {
  if (denominator === 0) return false;
  return numerator * 1000 >= thresholdPermille * denominator;
}

/** Exact percentage for display. Trailing zeros trimmed, one decimal kept. */
export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  const tenths = Math.round((numerator * 1000) / denominator);
  const whole = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  return decimal === 0 ? `${whole}%` : `${whole}.${decimal}%`;
}

export function formatThreshold(permille: number): string {
  const whole = Math.floor(permille / 10);
  const decimal = permille % 10;
  return decimal === 0 ? `${whole}%` : `${whole}.${decimal}%`;
}

function emptyCounts(): Record<MembershipCategory, number> {
  return MEMBERSHIP_CATEGORIES.reduce(
    (acc, category) => ({ ...acc, [category]: 0 }),
    {} as Record<MembershipCategory, number>,
  );
}

export function buildCompositionReport(
  members: Member[],
  asOf: Date = new Date(),
): CompositionReport {
  const counted = members.filter(
    (m) => m.entity === MEMBERSHIP_ENTITY && COUNTED_STATES.includes(m.state),
  );
  const denominator = counted.length;

  const categoryCounts = emptyCounts();
  for (const member of counted) categoryCounts[member.membershipCategory] += 1;

  const armedForces = categoryCounts.VETERAN;
  const cadets = categoryCounts.CADET;
  const relatives = categoryCounts.QUALIFYING_RELATIVE;
  const nonQualifying = categoryCounts.NON_QUALIFYING;
  const warVeterans = counted.filter((m) => m.isWarVeteran).length;

  const tests: CompositionTest[] = [
    {
      key: "ARMED_FORCES",
      label: "Past or present members of the armed forces",
      thresholdPermille: THRESHOLDS.ARMED_FORCES,
      numerator: armedForces,
      denominator,
      passes: meetsThreshold(armedForces, denominator, THRESHOLDS.ARMED_FORCES),
      governs: "Exemption under 501(c)(19). Failing it is not a filing problem, it is the exemption.",
      authority: "26 U.S.C. 501(c)(19)(B); Pub. 3386 ch. 9",
      breakdown: [
        { label: "Veterans, wartime service", count: counted.filter((m) => m.membershipCategory === "VETERAN" && m.isWarVeteran).length },
        { label: "Veterans, peacetime service only", count: counted.filter((m) => m.membershipCategory === "VETERAN" && !m.isWarVeteran).length },
      ],
    },
    {
      key: "MEMBERS_CADETS_RELATIVES",
      label: "Members, cadets, or qualifying relatives",
      thresholdPermille: THRESHOLDS.MEMBERS_CADETS_RELATIVES,
      numerator: armedForces + cadets + relatives,
      denominator,
      passes: meetsThreshold(
        armedForces + cadets + relatives,
        denominator,
        THRESHOLDS.MEMBERS_CADETS_RELATIVES,
      ),
      governs:
        "Exemption under 501(c)(19). The other side of the same line: a " +
        "non-qualifying class above 2.5% of the roster destroys it.",
      authority: "26 U.S.C. 501(c)(19)(C); Pub. 3386 ch. 9",
      breakdown: [
        { label: "Armed forces", count: armedForces },
        { label: "Cadets and midshipmen", count: cadets },
        { label: "Qualifying relatives", count: relatives },
        { label: "Non-qualifying, counting against the 2.5% ceiling", count: nonQualifying },
      ],
    },
    {
      key: "WAR_VETERANS",
      label: "War veterans",
      thresholdPermille: THRESHOLDS.WAR_VETERANS,
      numerator: warVeterans,
      denominator,
      passes: meetsThreshold(warVeterans, denominator, THRESHOLDS.WAR_VETERANS),
      governs:
        "Whether a gift to the Association is deductible to the giver. " +
        "Measured against the whole membership, so every cadet, spouse and " +
        "non-qualifying member counts against it. Exemption is unaffected.",
      authority: "26 U.S.C. 170(c)(3); Pub. 3386 ch. 9",
      breakdown: [
        { label: "War veterans, derived from attested service dates", count: warVeterans },
        { label: "Members with no qualifying wartime service", count: denominator - warVeterans },
      ],
    },
  ];

  return {
    entity: MEMBERSHIP_ENTITY,
    asOf: asOf.toISOString(),
    denominator,
    countedStates: COUNTED_STATES,
    excludedRecords: members.length - denominator,
    tests,
    categoryCounts,
    attestationMismatches: counted.filter((m) => m.attestedWarVeteran !== m.isWarVeteran).length,
    missingServiceDates: counted.filter(
      (m) => m.membershipCategory === "VETERAN" && !m.serviceFrom,
    ).length,
  };
}

/** Findings on individual records, for the audit view. No names, ids only. */
export function recordFindings(member: Member): string[] {
  const findings: string[] = [];
  if (member.membershipCategory === "VETERAN" && !member.serviceFrom) {
    findings.push("Veteran category with no attested service dates. The 90% test cannot count this record.");
  }
  if (member.membershipCategory === "QUALIFYING_RELATIVE" && !member.qualifyingRelationship) {
    findings.push("Qualifying relative with no degree of relation recorded.");
  }
  if (member.attestedWarVeteran !== member.isWarVeteran) {
    findings.push(
      member.attestedWarVeteran
        ? "Self-attested war veteran, but the attested dates touch no wartime period."
        : "Attested dates touch a wartime period, but the member did not claim war-veteran status.",
    );
  }
  if (member.membershipCategory === "NON_QUALIFYING") {
    findings.push("Non-qualifying class. Counts against the 2.5% ceiling.");
  }
  return findings;
}
