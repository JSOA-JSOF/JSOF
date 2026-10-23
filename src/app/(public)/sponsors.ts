import type { SponsorLogoKey } from "./sponsor-logos";

/**
 * Event sponsors, by level.
 *
 * Separate from `./partners`, which is a short list of organizations the
 * Foundation works alongside. This is the other thing entirely: the
 * companies that paid for an event, listed because being listed is part
 * of what they paid for.
 *
 * The same rule governs both, and it is the reason there is no prose
 * here. docs/ARCHITECTURE.md, sponsorship: a message containing both
 * advertising and acknowledgment is advertising in full, and it converts
 * the whole payment rather than the part above the line. A level, a name,
 * a logo and a link are acknowledgment. One adjective about what a
 * company does is not, and it would cost the sponsor and the Foundation
 * both.
 *
 * A logo is on the safe side of that line rather than a risk to it. The
 * rules treat a payor's established logo and slogan as part of its
 * identity, so a mark goes in as drawn, including whatever tagline is
 * inside it. What we must not do is retype that tagline as our own text,
 * which is why no entry here has a description field to put it in.
 *
 * `tests/public.test.ts` holds this by scanning every string in this
 * module against `FORBIDDEN_SPONSOR_LANGUAGE`.
 */

export type SponsorLevel = "eagle" | "gold" | "silver";

export type Sponsor = {
  slug: string;
  /** Not `name`: nothing in the public tier carries a field called `name`. */
  organization: string;
  level: SponsorLevel;
  /** Their own address, or null until somebody has checked one works. */
  url: string | null;
  /** Their mark, or null until we hold the file and the permission. */
  logo: SponsorLogoKey | null;
};

/**
 * The levels, in order, with what each is called and nothing else.
 *
 * No price and no benefit list. Those belong on `/donate/sponsor` with
 * the people who have to price them, and the Fundraising Chair's review
 * asked for a tier sheet carrying the fair market value of what a
 * sponsor receives. Putting half of one here would pre-empt that.
 */
export const SPONSOR_LEVELS: { key: SponsorLevel; label: string }[] = [
  { key: "eagle", label: "Eagle" },
  { key: "gold", label: "Gold" },
  { key: "silver", label: "Silver" },
];

/**
 * The 2026 Golf Tournament's sponsors, as printed on the board at the
 * course on 23 October 2026.
 *
 * Held against the event rather than against the Foundation, because a
 * sponsor list is a fact about a year. Next year's goes in its own
 * constant and this one stays as the record of what was promised and
 * shown in 2026.
 */
export const GOLF_2026_SPONSORS: Sponsor[] = [
  // Eagle
  { slug: "oak-grove-technologies", organization: "Oak Grove Technologies", level: "eagle", url: null, logo: null },
  { slug: "patriot-foundation", organization: "Patriot Foundation", level: "eagle", url: "https://www.patriotfoundation.org/", logo: "patriot-foundation" },
  { slug: "hendrick-automotive-group", organization: "Hendrick Automotive Group", level: "eagle", url: null, logo: null },
  { slug: "peraton", organization: "Peraton", level: "eagle", url: null, logo: "peraton" },
  { slug: "accel-innovation", organization: "Accel Innovation", level: "eagle", url: null, logo: null },
  { slug: "second-front", organization: "Second Front", level: "eagle", url: null, logo: null },

  // Gold
  { slug: "widelity", organization: "Widelity", level: "gold", url: null, logo: "widelity" },
  { slug: "legion-intelligence", organization: "Legion Intelligence", level: "gold", url: null, logo: null },
  { slug: "mayvin", organization: "Mayvin", level: "gold", url: null, logo: null },
  { slug: "veilant", organization: "Veilant", level: "gold", url: null, logo: null },
  { slug: "arma", organization: "ARMA", level: "gold", url: null, logo: null },
  { slug: "ads", organization: "ADS", level: "gold", url: null, logo: null },
  { slug: "tier-one-real-estate-services", organization: "Tier One Real Estate Services", level: "gold", url: null, logo: null },
  { slug: "homeowners-property-management", organization: "Homeowners Property Management", level: "gold", url: null, logo: null },
  { slug: "hooten-young", organization: "Hooten & Young", level: "gold", url: null, logo: null },
  { slug: "snc", organization: "SNC", level: "gold", url: null, logo: null },
  { slug: "lockheed-martin", organization: "Lockheed Martin", level: "gold", url: null, logo: "lockheed-martin" },
  { slug: "onebrief", organization: "Onebrief", level: "gold", url: null, logo: "onebrief" },
  { slug: "k2-solutions", organization: "K2 Solutions", level: "gold", url: null, logo: null },
  { slug: "mantech", organization: "ManTech", level: "gold", url: null, logo: "mantech" },
  { slug: "dell", organization: "Dell", level: "gold", url: null, logo: null },

  // Silver
  { slug: "black-bear-technology", organization: "Black Bear Technology", level: "silver", url: null, logo: null },
  { slug: "phoenix-global-support", organization: "Phoenix Global Support", level: "silver", url: null, logo: null },
  { slug: "caci", organization: "CACI", level: "silver", url: null, logo: null },
];

export function sponsorsAtLevel(
  sponsors: Sponsor[],
  level: SponsorLevel,
): Sponsor[] {
  return sponsors.filter((sponsor) => sponsor.level === level);
}

export const SPONSORS_STANDFIRST =
  "The companies and organizations that paid for the 2026 Golf Tournament, " +
  "at the level each gave. This page names them and nothing more.";

/**
 * Why the page is a list of names and marks and no sentences at all.
 *
 * Worth saying out loud on the page itself. A sponsor wall with no
 * descriptions reads as unfinished unless the reason is given, and the
 * reason is one a sponsor's own finance team will recognise.
 */
export const SPONSOR_WALL_NOTE =
  "Each entry is a level, a name, a mark and a link. There is no " +
  "description of any company's products or services here, and no " +
  "recommendation of them. Under the rules for qualified sponsorship an " +
  "acknowledgment that also advertises is treated as advertising in full, " +
  "which would make the payment taxable income to the Foundation and " +
  "change how the sponsor has to account for it. Keeping the wording flat " +
  "is what protects both sides.";
