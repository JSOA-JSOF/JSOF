import type { OutboundRoute } from "./entities";

/**
 * The three recurring events, as public content.
 *
 * The live site's three event pages each carry a different past year, which is
 * the single most damaging thing on it: a visitor who lands on a page headed
 * with a year that has gone learns that nobody is minding the site and leaves.
 *
 * So dates are a state, not a string. Until the board confirms a date the page
 * says the date is to be confirmed, names the office that will confirm it, and
 * says what to do in the meantime. That reads as an organization between
 * cycles. A stale year reads as an organization that has stopped.
 */

export type EventDates =
  | {
      state: "TO_BE_CONFIRMED";
      /** When it has usually fallen. No year, ever. */
      typicalTiming: string;
      confirmedBy: string;
    }
  | {
      state: "CONFIRMED";
      /** ISO date. Rendered in America/New_York at the point of use. */
      startsAt: string;
      venue: string;
    };

export type PublicEvent = {
  slug: string;
  title: string;
  /** Short kind label for the index and the eyebrow. */
  kind: string;
  /** One sentence. Doubles as the meta description. */
  summary: string;
  whatItIs: string[];
  whoItIsFor: string[];
  dates: EventDates;
  /** How the price is put together, and why it is put together that way. */
  pricingNote: string;
  /**
   * Where to register. `null` where there is nowhere to send anyone yet.
   *
   * Ticketing is not built, and /store/tickets returned 404 on the live site
   * while events linked to it. Same reasoning as `ApplyRoute` in
   * scholarships.ts: a link that cannot take a registration is worse than an
   * honest absence, and pointing it at the merchandise catalogue instead
   * would just move the lie.
   */
  registration: OutboundRoute | null;
  sponsorship: OutboundRoute;
  volunteering: string;
};

/**
 * Sponsorship enquiries go to the office, not to a tier sheet.
 *
 * This pointed at /donate/sponsor, which does not exist and returned 404 on
 * the live site. Tiers are not published because the board has not settled
 * which benefits fall on which side of the IRC 513(i) line, and publishing a
 * sheet we then have to withdraw is worse than publishing none. See
 * docs/ENTITY-SPLIT.md.
 */
const SPONSORSHIP: OutboundRoute = {
  href: "/donate/sponsor",
  label: "Sponsor this event",
  ownedBy: "foundation",
};

/** Ticketing is not built. See the note on `registration` above. */
const REGISTRATION = null;

export const EVENTS: PublicEvent[] = [
  {
    slug: "ball",
    title: "JSOC Ball",
    kind: "Formal dinner",
    summary:
      "The annual formal dinner for the JSOC community and their families, " +
      "funded and organized by the Association.",
    whatItIs: [
      "A formal dinner and evening for the JSOC community, held once a year. " +
        "It is the Association's largest gathering, and the one event where " +
        "serving personnel, people who have left the command, and their " +
        "families are all in the same room.",
      "The Association funds and organizes it. Proceeds above cost go to the " +
        "three lines of effort, and the shortfall in a thin year is covered " +
        "by sponsorship rather than by raising the ticket price out of reach.",
    ],
    whoItIsFor: [
      "Members and their guests.",
      "Personnel currently assigned to JSOC and its associated units, and their partners.",
      "Families of the fallen, as guests of the Association.",
    ],
    dates: {
      state: "TO_BE_CONFIRMED",
      typicalTiming: "Usually held in the autumn.",
      confirmedBy: "Events Chair",
    },
    pricingNote:
      "A ticket is shown as two separate lines: the admission itself, priced " +
      "at what the evening costs to put on, and an optional donation stated " +
      "separately. That split is deliberate. Admission to a paid-entertainment " +
      "event can be taxable in North Carolina, and bundling a gift into the " +
      "ticket price would pull the gift in with it. Stated separately, the " +
      "donation portion is treated as a donation, and the receipt says which " +
      "part is which.",
    registration: REGISTRATION,
    sponsorship: SPONSORSHIP,
    volunteering:
      "The ball runs on volunteers: setup, registration desk, raffle, and " +
      "teardown. Volunteer hours are recorded, because the volunteer-labour " +
      "exception is part of what keeps the event untaxed.",
  },
  {
    slug: "golf-tournament",
    title: "Golf Tournament",
    kind: "Charity golf",
    summary:
      "A one-day charity golf tournament supporting JSOC warriors and their " +
      "families. Honor, support, strength.",
    whatItIs: [
      "A one-day tournament, open to the public as well as to the JSOC " +
        "community. Teams enter, companies sponsor holes, and the proceeds go " +
        "to the three lines of effort.",
      "It is the Association's main fundraising event of the year and the " +
        "easiest one for someone outside the community to take part in.",
    ],
    whoItIsFor: [
      "Anyone who wants to play. No connection to the command is required.",
      "Companies looking to sponsor a hole, a team, or the tournament.",
      "Members and their guests.",
    ],
    dates: {
      state: "CONFIRMED",
      startsAt: "2026-10-23",
      venue: "Fayetteville, North Carolina",
    },
    pricingNote:
      "The entry fee buys participation, and a fee to participate sits " +
      "outside the North Carolina sales tax base. Merchandise, shirts, tee " +
      "prizes, and the banquet are therefore priced as separate line items " +
      "rather than folded into the entry fee, so the fee itself is not pulled " +
      "into tax by the bundle.",
    registration: REGISTRATION,
    sponsorship: SPONSORSHIP,
    volunteering:
      "Hole marshals, scoring, registration, and the prize table. Volunteer " +
      "hours are recorded.",
  },
  {
    slug: "triathlon",
    title: "JSOC Youth Triathlon",
    kind: "Youth multisport",
    summary:
      "A swim, bike, and run event for the children of the JSOC community, " +
      "organized around age groups rather than finishing times.",
    whatItIs: [
      "A short-course triathlon for children: a swim, a bike leg, and a run, " +
        "set by age group. It is built to be finishable. The point is that " +
        "every child crosses the line, not that anyone wins.",
      "It sits alongside the Association's other family events, which include " +
        "a Trunk or Treat in the autumn.",
    ],
    whoItIsFor: [
      "Children of the JSOC community, by age group.",
      "Parents and siblings, as spectators and as volunteers.",
    ],
    dates: {
      state: "TO_BE_CONFIRMED",
      typicalTiming: "Usually held in the early summer.",
      confirmedBy: "Events Chair",
    },
    pricingNote:
      "Entry is a fee to participate. Shirts and finisher items are priced " +
      "separately from entry. Where cost is the reason a family would not " +
      "enter a child, write to the Family Support Chair before the event " +
      "rather than after it.",
    registration: REGISTRATION,
    sponsorship: SPONSORSHIP,
    volunteering:
      "Course marshals, water stations, bike racking, and timing. This is the " +
      "event that needs the most volunteers per participant. Volunteer hours " +
      "are recorded.",
  },
];

export function eventBySlug(slug: string): PublicEvent | undefined {
  return EVENTS.find((event) => event.slug === slug);
}

export const EVENTS_STANDFIRST =
  "Three recurring events. Where a date is not yet confirmed the page says so " +
  "rather than showing last year's, and the Events Chair is the office that " +
  "confirms it.";

/** The exact wording for an unconfirmed date. One string, used everywhere. */
export const DATES_TO_BE_CONFIRMED_LABEL = "Dates to be confirmed";
