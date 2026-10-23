/**
 * Sponsor and partner marks.
 *
 * A separate manifest from `./media`, because the two answer different
 * questions and one field cannot answer both.
 *
 * `./media` is the OPSEC control. Every entry there records whether
 * there is an identifiable member in the frame, and the test rejects an
 * image that depicts real members. A corporate logo raises none of that,
 * and filing it there would mean writing a meaningless OPSEC note
 * twenty-four times, which is how a real control turns into a formality.
 *
 * What a logo does raise is whose mark it is and whether we are allowed
 * to show it. For a sponsor the answer is usually yes and obvious: being
 * shown is what they paid for. It is still recorded, because "usually"
 * is not a record, and because the right way to hold a sponsor's mark is
 * the file they sent with their brand guidance rather than one scraped
 * off their home page. `source` says which it is.
 */

export type SponsorLogo = {
  /** Local path. Nothing here is hotlinked from the owner's site. */
  src: string;
  /** The organization that owns the mark. Exactly as the sponsor list spells it. */
  owner: string;
  /** Where the file came from. */
  source: string;
  /**
   * Whether the owner has said we may show it.
   *
   * "granted" means somebody holds it in writing. A sponsorship
   * agreement that says the sponsor will be recognised counts, and is
   * the usual route. Nothing else does.
   */
  permission: "granted" | "requested" | "not yet asked";
  /** ISO date this entry was last checked. */
  reviewed: string;
};

export const SPONSOR_LOGOS = {
  "patriot-foundation": {
    src: "/media/partner-patriot-foundation.webp",
    owner: "Patriot Foundation",
    source: "patriotfoundation.org, the logo on their own home page",
    permission: "not yet asked",
    reviewed: "2026-10-23",
  },
  "peraton": {
    src: "/media/sponsor-peraton.svg",
    owner: "Peraton",
    source: "peraton.com, the wordmark in their own site header",
    permission: "not yet asked",
    reviewed: "2026-10-23",
  },
  "mantech": {
    src: "/media/sponsor-mantech.svg",
    owner: "ManTech",
    source: "mantech.com, the wordmark in their own site header",
    permission: "not yet asked",
    reviewed: "2026-10-23",
  },
  "lockheed-martin": {
    src: "/media/sponsor-lockheed.svg",
    owner: "Lockheed Martin",
    source: "lockheedmartin.com, the mark in their own site header",
    permission: "not yet asked",
    reviewed: "2026-10-23",
  },
  "onebrief": {
    src: "/media/sponsor-onebrief.svg",
    owner: "Onebrief",
    source: "onebrief.com, the mark in their own site header",
    permission: "not yet asked",
    reviewed: "2026-10-23",
  },
  "widelity": {
    src: "/media/sponsor-widelity.svg",
    owner: "Widelity",
    source: "widelity.com, the blue wordmark published on their own site",
    permission: "not yet asked",
    reviewed: "2026-10-23",
  },
} as const satisfies Record<string, SponsorLogo>;

export type SponsorLogoKey = keyof typeof SPONSOR_LOGOS;

/** Read an entry, widened to the declared shape. See `publicImage`. */
export function sponsorLogo(key: SponsorLogoKey): SponsorLogo {
  return SPONSOR_LOGOS[key];
}
