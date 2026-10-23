/**
 * Partner acknowledgment.
 *
 * This page is the narrowest thing in the public tier, on purpose.
 *
 * docs/ARCHITECTURE.md, sponsorship: a single message containing both
 * advertising and acknowledgment is *entirely* advertising. One adjective
 * about a company converts the whole placement from a qualified sponsorship
 * payment into taxable advertising income, and it does so for the full amount,
 * not the excess. The 2% benefit safe harbour works the same way: all or
 * nothing.
 *
 * What an acknowledgment may carry is therefore fixed: the organization's
 * name, its own logo, its web address, and a value-neutral factual
 * statement. The logo is in the permitted list rather than a risk to it: a
 * payor's established logo and slogan are part of its identity, and it is
 * the qualitative or comparative claim that converts a placement. No
 * adjective,
 * no comparison, no endorsement, no price, no call to action, and never the
 * word "provider" in an exclusivity sense, because an exclusive sponsor is a
 * qualified sponsorship payment and an exclusive provider is not.
 *
 * `tests/public.test.ts` holds this by scanning every string in this module
 * against `FORBIDDEN_SPONSOR_LANGUAGE` in `./public-safety`.
 */

import type { PublicImageKey } from "./media";

export type Partner = {
  slug: string;
  /** Not `name`: nothing in the public tier carries a field called `name`. */
  organization: string;
  /**
   * Their own web address, or null where they have none that works.
   *
   * Null is a real state and not an oversight. Linking a partner to a
   * registrar's parking page is worse for them than not linking them at
   * all, so the card drops the link rather than publishing a dead one.
   */
  url: string | null;
  /**
   * Their logo, as a key into the image manifest, or null where we do not
   * have one.
   *
   * A logo is acknowledgment rather than advertising, which is why this is
   * safe to add: the sponsorship rules treat a payor's own logo and
   * established slogan as part of their identity, and it is the qualitative
   * or comparative claim that converts a placement into advertising, not
   * the mark itself. So the mark goes in and the adjectives stay out.
   *
   * The manifest entry carries whose mark it is and whether the permission
   * to show it is actually held. See `rights` in ./media.
   */
  logo: PublicImageKey | null;
  /**
   * The exact approved wording. Held as one string so the board can see and
   * approve what will appear, rather than approving a design and discovering
   * the copy later. Nothing else about the organization is rendered.
   */
  acknowledgment: string;
  /**
   * A factual statement of what the organization does with or for the
   * Foundation, or null where there is nothing factual to state. Absence is
   * the correct output here. An adjective is not.
   */
  relationship: string | null;
};

export const PARTNERS: Partner[] = [
  {
    slug: "patriot-foundation",
    organization: "Patriot Foundation",
    url: "https://www.patriotfoundation.org/",
    logo: "partner-patriot-foundation",
    acknowledgment: "Patriot Foundation",
    relationship:
      "Administers the North Carolina Patriot Star Scholarship, including its " +
      "application and selection.",
  },
  {
    slug: "patriot-military-family-foundation",
    organization: "Patriot Military Family Foundation",
    url: "https://patriotmilitaryfamilyfoundation.org",
    logo: "partner-patriot-military-family-foundation",
    acknowledgment: "Patriot Military Family Foundation",
    relationship: null,
  },
  {
    slug: "force-network",
    organization: "Force Network",
    // forcenetwork.com resolves to a Network Solutions "under construction"
    // placeholder, and the HTTPS address does not answer at all. Checked
    // 23 October 2026. Until they give us a working address this card
    // carries the name and nothing else.
    url: null,
    logo: null,
    acknowledgment: "Force Network",
    relationship: null,
  },
];

export function partnerBySlug(slug: string): Partner | undefined {
  return PARTNERS.find((partner) => partner.slug === slug);
}

export const PARTNERS_STANDFIRST =
  "Organizations that work alongside the Foundation. This page acknowledges " +
  "them and nothing more.";

/**
 * The explanation the reader gets for why the page is so plain. Worth saying
 * out loud: a visitor who expects testimonials and a sentence about how
 * wonderful each organization is should understand that the restraint is a
 * tax position, not indifference.
 */
export const ACKNOWLEDGMENT_NOTE =
  "These entries carry a name, a logo, a link, and a statement of fact. " +
  "They carry no " +
  "description of any organization's products or services, no comparison, and " +
  "no recommendation. Under the rules for qualified sponsorship, a single " +
  "acknowledgment that also advertises is treated as advertising in full, and " +
  "the income becomes taxable. Keeping the wording flat is what keeps a gift " +
  "a gift.";

/**
 * How a company becomes a sponsor. Points at the Foundation module rather than
 * describing tiers here, because the tier table and the benefit valuation live
 * with the people who have to price them.
 */
export const BECOME_A_PARTNER = {
  href: "/donate/sponsor",
  label: "Sponsorship packages",
  ownedBy: "foundation" as const,
  note:
    "Sponsorship is arranged through the Fundraising Chair. Every placement " +
    "records the approved wording and the fair market value of anything the " +
    "sponsor receives in return, and sponsor-supplied copy is reviewed before " +
    "it is published. A fee tied to attendance or to impressions is not a " +
    "sponsorship payment at all, so the Foundation does not price one that way.",
};
