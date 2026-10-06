/**
 * Patriot Foundation routing.
 *
 * This runs FIRST, before a name, an email, a date of birth or anything else
 * is collected. North Carolina residents attending North Carolina schools now
 * apply directly to the Patriot Foundation. Today the Scholarships Chair finds
 * that out after the applicant has filled the whole form in and emails them
 * individually; this module asks the three questions at the front and routes
 * before there is anything to misroute.
 *
 * The routing answers are the only thing a routed-away applicant ever gives
 * us. They are three booleans, they identify nobody, and the draft that holds
 * them is destroyed when the applicant is routed away.
 *
 * SPEC NOTE, and it needs the chair's answer before the cycle opens. The brief
 * names three questions that decide the routing, but a North Carolina resident
 * at a North Carolina school who is applying for Merit only is not obviously
 * the Patriot Foundation's applicant. `ROUTING_RULE.requiresWoundedPatriot`
 * is the one line that settles it, and it is a line rather than a branch in
 * the handler so that the answer can be changed in one place. It currently
 * routes on residence and school alone, which is the broader reading and the
 * one that cannot leave an applicant stuck in the wrong place with no award.
 */

import type { RoutingAnswers, RoutingDecision } from "./types";

export const PATRIOT_FOUNDATION = {
  name: "The Patriot Foundation",
  /**
   * Outbound. The Foundation's own site, not a page of ours: a routed
   * applicant should land where the application actually is.
   */
  href: "https://www.thepatriotfoundation.org/",
  note:
    "The Patriot Foundation administers scholarships for North Carolina " +
    "families in this community. They take the application directly.",
} as const;

export const ROUTING_RULE = {
  /**
   * When true, only an applicant who is ALSO applying for Wounded Patriot is
   * routed away. When false, residence and school decide it on their own.
   *
   * Confirm with the Scholarships Chair before the cycle opens. Changing this
   * changes nothing else in the module.
   */
  requiresWoundedPatriot: false,

  /** Stamped on the decision so a record says which reading produced it. */
  version: "1-residence-and-school",
} as const;

export const ROUTING_QUESTIONS = [
  {
    key: "ncResident" as const,
    question: "Do you live in North Carolina?",
    hint: "Where you live, not where you go to school.",
  },
  {
    key: "attendingNcSchool" as const,
    question: "Will you be attending a school in North Carolina?",
    hint: "The school you will be enrolled at in the academic year you are applying for.",
  },
  {
    key: "applyingForWoundedPatriot" as const,
    question: "Are you applying for the Wounded Patriot Scholarship?",
    hint:
      "The Wounded Patriot Scholarship recognizes a service-connected wound " +
      "or disability. You may apply for it, for the Merit Scholarship, or for both.",
  },
] as const;

const ROUTED_EXPLANATION =
  "You live in North Carolina and you will be attending a North Carolina " +
  "school, so your application goes to the Patriot Foundation and not to us. " +
  "They run the scholarships for North Carolina families in this community " +
  "and they take the application directly. Nothing you have entered here has " +
  "been kept, and there is nothing further for you to do on this site.";

const ROUTED_EXPLANATION_WOUNDED_PATRIOT =
  "You live in North Carolina, you will be attending a North Carolina school, " +
  "and you are applying for the Wounded Patriot Scholarship. That application " +
  "goes to the Patriot Foundation and not to us. They run it for North " +
  "Carolina families in this community and they take the application " +
  "directly. Nothing you have entered here has been kept.";

const CONTINUE_EXPLANATION =
  "This is the right place to apply. The Patriot Foundation takes the " +
  "applications from North Carolina residents attending North Carolina " +
  "schools; everyone else applies to the Foundation here.";

/**
 * Decide, from the three answers alone.
 *
 * Pure. No storage, no identity, nothing but the three booleans in and a
 * decision out, so the routing can be asserted in a test without an applicant
 * existing.
 */
export function decideRouting(
  answers: RoutingAnswers,
  now: Date = new Date(),
): RoutingDecision {
  const inNorthCarolina = answers.ncResident && answers.attendingNcSchool;
  const routed =
    inNorthCarolina &&
    (!ROUTING_RULE.requiresWoundedPatriot || answers.applyingForWoundedPatriot);

  if (!routed) {
    return {
      outcome: "CONTINUE_HERE",
      answers,
      explanation: CONTINUE_EXPLANATION,
      referral: null,
      decidedAt: now.toISOString(),
    };
  }

  return {
    outcome: "APPLY_TO_PATRIOT_FOUNDATION",
    answers,
    explanation: answers.applyingForWoundedPatriot
      ? ROUTED_EXPLANATION_WOUNDED_PATRIOT
      : ROUTED_EXPLANATION,
    referral: { ...PATRIOT_FOUNDATION },
    decidedAt: now.toISOString(),
  };
}

/** True when the applicant must be sent away before anything is collected. */
export function isRoutedAway(decision: RoutingDecision): boolean {
  return decision.outcome === "APPLY_TO_PATRIOT_FOUNDATION";
}

/**
 * Which programs an applicant who stays here may apply for.
 *
 * Merit is always available. Wounded Patriot is available to anyone who is not
 * routed away and said they were applying for it.
 */
export function programsOpenTo(decision: RoutingDecision): {
  merit: boolean;
  woundedPatriot: boolean;
} {
  if (isRoutedAway(decision)) return { merit: false, woundedPatriot: false };
  return { merit: true, woundedPatriot: decision.answers.applyingForWoundedPatriot };
}
