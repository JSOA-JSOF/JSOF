import type { Entity, Role } from "../authz/model";

/**
 * Deciding which office a message belongs to.
 *
 * Rules first, and a model only where the rules have nothing to say.
 * That order is deliberate and it is not about cost.
 *
 * A misroute is not a small thing here. The offices on the contact page
 * include the Memorial Chair, who hears from Gold Star families, and the
 * Family Support Chair, who hears from people in trouble. When one of
 * those goes to the wrong volunteer the organization has failed somebody
 * at the worst possible moment, and the board will reasonably want to
 * know why. "A rule matched the word paver" is an answer somebody can
 * check and fix. "The model thought so" is not.
 *
 * So the rules carry the cases we can name, a model suggests on the rest
 * and is marked as having suggested, and a human confirms anything a
 * rule did not place. The model never gets the last word, which is also
 * why nothing in this file calls one: the suggestion arrives from
 * ./suggest and is stored as a separate, clearly labelled route.
 */

export type RouteDecision = {
  role: Role | "UNPLACED";
  entity: Entity | null;
  /** Which rule matched, for the queue to show and the board to audit. */
  basis: string;
};

export type Rule = {
  /** Shown in the queue and written to message_route.basis. */
  name: string;
  role: Role;
  entity: Entity | null;
  /**
   * Matched against subject and body together, lowercased.
   *
   * Phrases rather than single words wherever a single word is ambiguous.
   * "fund" appears in a message about the memorial fund and in one about
   * refunding a polo shirt.
   */
  patterns: RegExp[];
};

/**
 * In order. The first match wins.
 *
 * The order is in two bands, and the split matters more than anything
 * else in this file. Both of the mistakes the tests caught on the first
 * draft were the same mistake.
 *
 * **What kind of message is this** comes first. A reporter writing about
 * the memorial is press, not bereavement, and must not land on the
 * volunteer who talks to Gold Star families. Somebody reporting that the
 * donate page throws an error is a broken website, not a gift. Who is
 * writing, and whether they are reporting a fault, dominates whatever
 * subject they happen to mention.
 *
 * **What is this about** comes second, in order of human consequence
 * rather than frequency. If a message about a fallen member also
 * mentions a cheque it goes to the Memorial Chair and not the Treasurer:
 * routing it on the money is technically defensible and humanly wrong.
 *
 * Within each band the patterns are deliberately narrow, because a rule
 * that fires too eagerly in the first band is worse than no rule at all.
 */
export const ROUTING_RULES: Rule[] = [
  /* What kind of message ------------------------------------------- */
  {
    name: "press or a public statement",
    role: "COMMUNICATIONS_CHAIR",
    entity: null,
    patterns: [
      /\b(?:i am|i'm) a (?:reporter|journalist)\b/,
      /\bpress (?:enquiry|inquiry|request)\b/,
      /\bfor publication\b/,
      /\bon the record\b/,
      /\bcomment for (?:a|our) (?:story|article)\b/,
    ],
  },
  {
    name: "the website itself",
    role: "WEBMASTER",
    entity: null,
    patterns: [
      /\b(?:the )?(?:site|website|page) (?:is|was|keeps) (?:broken|down|not working)\b/,
      /\bbroken link\b/,
      /\berror message\b/,
      /\b404\b/,
      /\bcan(?:not|'t) (?:log ?in|sign in)\b/,
      /\bphotos? (?:did not|didn't|won'?t) upload\b/,
    ],
  },

  /* What it is about ----------------------------------------------- */
  {
    name: "memorial, paver, or a fallen member",
    role: "MEMORIAL_CHAIR",
    entity: "JSOF",
    patterns: [
      /\bpavers?\b/,
      /\bmemorial\b/,
      /\bfallen\b/,
      /\bgold star\b/,
      /\bkilled in action\b/,
      /\bname (?:on|added to) the (?:wall|memorial)\b/,
      /\binscription\b/,
    ],
  },
  {
    name: "a family needing help",
    role: "FAMILY_SUPPORT_CHAIR",
    entity: "JSOA",
    patterns: [
      /\bfamily support\b/,
      /\bemergency (?:assistance|help|funds?)\b/,
      /\bhardship\b/,
      /\bwe (?:are|'re) struggling\b/,
      /\bbehind on (?:rent|bills|the mortgage)\b/,
      /\bwidow(?:ed|er)?\b/,
    ],
  },
  {
    name: "scholarships",
    role: "SCHOLARSHIPS_CHAIR",
    entity: "JSOF",
    patterns: [
      /\bscholarships?\b/,
      /\bpatriot star\b/,
      /\bwounded patriot\b/,
      /\btuition\b/,
      /\bmy (?:son|daughter|child) (?:is|will be) applying\b/,
      /\beligib(?:le|ility)\b.*\bappl/,
    ],
  },
  {
    name: "membership, dues, or a vouch",
    role: "VP_MEMBERSHIP",
    entity: "JSOA",
    patterns: [
      /\bmembership\b/,
      /\bjoin the association\b/,
      /\b(?:annual )?dues\b/,
      /\bvouch(?:er|ing|ed)?\b/,
      /\bsponsor(?:ing)? (?:my|an) application\b/,
      /\bmy application\b/,
      /\brenew(?:al|ing)?\b/,
    ],
  },
  {
    name: "the store",
    role: "STORE_CHAIR",
    entity: "JSOA",
    patterns: [
      /\b(?:my )?order\b/,
      /\bshipping\b/,
      /\breturn(?:ing|ed)? (?:my|the|an?) \w+/,
      /\brefund\b/,
      /\bwrong size\b/,
      /\bcoin\b/,
      /\bpolo\b/,
      /\bquarter-?zip\b/,
      /\bmerch(?:andise)?\b/,
    ],
  },
  {
    name: "sponsorship of an event",
    role: "FUNDRAISING_CHAIR",
    entity: "JSOF",
    patterns: [
      /\bsponsor(?:ship)?\b/,
      /\beagle (?:level|sponsor)\b/,
      /\bgold (?:level|sponsor)\b/,
      /\bsilver (?:level|sponsor)\b/,
      /\bour company would like to\b/,
      /\bin-?kind\b/,
    ],
  },
  {
    name: "a gift, a receipt, or a tax question",
    role: "TREASURER",
    entity: "JSOF",
    patterns: [
      /\bdonat(?:e|ion|ing)\b/,
      /\breceipt\b/,
      /\btax[- ]deductible\b/,
      /\bein\b/,
      /\b990\b/,
      /\bmatching gift\b/,
      /\bdonor[- ]advised\b/,
      /\bbequest\b/,
    ],
  },
  {
    name: "an event: the ball, the golf, the triathlon",
    role: "EVENTS_CHAIR",
    entity: "JSOA",
    patterns: [
      /\bgolf\b/,
      /\btournament\b/,
      /\bthe ball\b/,
      /\btriathlon\b/,
      /\btrunk or treat\b/,
      /\bregistration\b/,
      /\btee time\b/,
      /\bfoursome\b/,
    ],
  },
  {
    name: "records, minutes, or governance",
    role: "SECRETARY",
    entity: null,
    patterns: [
      /\bminutes\b/,
      /\bbylaws?\b/,
      /\barticles of incorporation\b/,
      /\bboard (?:meeting|resolution)\b/,
      /\bpublic records?\b/,
    ],
  },
];

/** Lowercased subject and body, which is what the patterns expect. */
function haystack(subject: string | null, body: string): string {
  return `${subject ?? ""}\n${body}`.toLowerCase();
}

/**
 * Place a message, or decline to.
 *
 * Returning UNPLACED is a real answer and not a failure. A guess that
 * looks like a decision is worse than an empty queue somebody has to
 * look at, because the first is invisible and the second is not.
 */
export function routeByRules(
  subject: string | null,
  body: string,
): RouteDecision {
  const text = haystack(subject, body);
  for (const rule of ROUTING_RULES) {
    const hit = rule.patterns.find((pattern) => pattern.test(text));
    if (hit) {
      return { role: rule.role, entity: rule.entity, basis: rule.name };
    }
  }
  return { role: "UNPLACED", entity: null, basis: "no rule matched" };
}

/**
 * Every rule that matched, not just the first.
 *
 * The queue shows these under a message so whoever is looking can see
 * that something about a paver also mentioned a refund. A message that
 * trips four rules is usually a message that needs a person.
 */
export function allMatches(subject: string | null, body: string): string[] {
  const text = haystack(subject, body);
  return ROUTING_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(text)),
  ).map((rule) => rule.name);
}
