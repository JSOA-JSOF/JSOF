/**
 * The eligible class, as configuration.
 *
 * This file is the ONLY place in the module that says anything about who may
 * hold a scholarship. Everything else calls `evaluateEligibility()` and acts
 * on the outcome it returns. Nothing else branches on how the class is
 * defined, nothing else holds a criterion, and nothing else names a
 * relationship to a member.
 *
 * Why it is built this way, from docs/ARCHITECTURE.md: the rule as published
 * defines the eligible class by membership in the Association. That is the
 * fact pattern the IRS uses to deny or revoke 501(c)(3) exemption, because
 * dues collected from a membership and awards paid back into the same
 * membership is private benefit. The rule is with counsel. The machinery
 * around it is not, and the next cycle opens in the middle of December 2026
 * whatever counsel says.
 *
 * So the rule is a placeholder with a status flag, and the placeholder returns
 * UNDETERMINED for every applicant. UNDETERMINED is not a denial and not an
 * approval: it means a person decides, which is what happens today anyway.
 * When counsel reports, `criteria` gains entries, `status` becomes PUBLISHED
 * and `evaluate` starts answering. One file changes, and nothing downstream
 * has to be found and corrected.
 *
 * A test in tests/scholarships.test.ts asserts that the rule currently under
 * review appears in no source file in this module. If you are tempted to write
 * it into a comment "just for context", that test is the reason not to.
 */

export const ELIGIBILITY_STATUSES = [
  /** Counsel has not reported. The placeholder is in force. */
  "UNDER_LEGAL_REVIEW",
  /** Counsel has reported and the board has adopted the criteria. */
  "PUBLISHED",
] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

/**
 * One objective, checkable criterion. Empty while the rule is under review.
 *
 * `key` is what a record carries, `question` is what the form asks, and
 * `authority` is what the board adopted it under. A criterion with no
 * authority is somebody's opinion and does not belong in a charitable class.
 */
export type EligibilityCriterion = {
  key: string;
  question: string;
  authority: string;
};

export type EligibilityOutcome =
  /** No published rule to apply. A person decides. */
  | "UNDETERMINED"
  | "ELIGIBLE"
  | "NOT_ELIGIBLE";

export type EligibilityDetermination = {
  outcome: EligibilityOutcome;
  /** Which version of the rule produced this. Stored on the record. */
  ruleVersion: string;
  /** What the board or the chair is being told, in the chair's language. */
  explanation: string;
  /** True when a person has to decide this one by hand. */
  needsHumanDetermination: boolean;
};

/**
 * Facts an eligibility rule is allowed to see.
 *
 * Deliberately thin, and deliberately NOT the whole application. A rule that
 * can read the essay is a rule that can be about the essay. These are the
 * eligibility dataset, kept apart from the selection dataset per
 * docs/PRIVACY-AND-PAYMENTS.md.
 */
export type EligibilityFacts = {
  /** Where the applicant is enrolled, by level. */
  enrolmentLevel: string;
  /** Whether the enrolment is at an accredited institution, as attested. */
  accreditedInstitution: boolean;
  /** The sponsoring member's standing, as the roster reported it. */
  sponsorInGoodStanding: boolean;
  /** Set when the applicant declared a service connection. */
  declaredServiceConnection: boolean;
};

/**
 * The single exported configuration object.
 *
 * `placeholder: true` and `status: "UNDER_LEGAL_REVIEW"` are the flags the
 * board screens read so that every page showing an eligibility outcome also
 * shows that there is not yet a rule behind it.
 */
export const ELIGIBILITY_RULE = {
  status: "UNDER_LEGAL_REVIEW" as EligibilityStatus,

  /** True while nothing here decides anything. The board screens render this. */
  placeholder: true,

  /** Stamped onto every determination so a record says which rule produced it. */
  version: "0-placeholder",

  /** The marker a reader sees, so the gap is obviously deliberate. */
  marker: "PLACEHOLDER, AWAITING COUNSEL",

  heading: "Eligibility criteria are not published yet",

  /**
   * What the board and the chair are told. Note what it does not do: it does
   * not restate, paraphrase, hint at or hedge the rule under review. Saying
   * "the old rule applies for now" would be the organization asserting that
   * rule in the one place a regulator or a disappointed applicant would look.
   */
  body: [
    "The criteria that decide who may hold a Foundation scholarship are under " +
      "legal review and have not been adopted. Until they are, this platform " +
      "applies no eligibility rule of its own.",
    "Every application is therefore marked as needing a determination by a " +
      "person. That is what happens today. The difference is that the record " +
      "now says so, and says which version of the rule was in force when the " +
      "determination was made.",
  ],

  /** Who to ask while there is no rule. */
  guidance:
    "Applicants asking whether they can apply are answered by the " +
    "Scholarships Chair, individually, in writing.",

  /** Empty until counsel reports. Each entry becomes a question on the form. */
  criteria: [] as EligibilityCriterion[],

  /**
   * Apply the rule.
   *
   * While `placeholder` is true this ignores the facts entirely and returns
   * UNDETERMINED. It still takes them, so that adding the real rule is an edit
   * to this function and not a change to every call site.
   */
  evaluate(facts: EligibilityFacts): EligibilityDetermination {
    void facts;
    return {
      outcome: "UNDETERMINED",
      ruleVersion: ELIGIBILITY_RULE.version,
      explanation:
        "No eligibility rule is in force. The Scholarships Chair decides this " +
        "application on the criteria the board has adopted for the cycle.",
      needsHumanDetermination: true,
    };
  },
} as const;

/**
 * The one function the rest of the module calls.
 *
 * Call sites may read `determination.outcome` and `needsHumanDetermination`.
 * They may not read `ELIGIBILITY_RULE.criteria` to decide anything, and they
 * may not ask a question of their own about who the applicant is related to.
 */
export function evaluateEligibility(facts: EligibilityFacts): EligibilityDetermination {
  return ELIGIBILITY_RULE.evaluate(facts);
}

/** True when the module is running without an adopted rule. */
export function eligibilityIsPlaceholder(): boolean {
  return ELIGIBILITY_RULE.placeholder || ELIGIBILITY_RULE.status === "UNDER_LEGAL_REVIEW";
}
