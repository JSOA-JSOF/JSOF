import type { Entity } from "@/lib/authz/model";

/**
 * Entity metadata and navigation for the public tier.
 *
 * The split front door at `/` sends a visitor to one entity or the other
 * before anything else loads. From that point on the visitor is inside one
 * entity's colour, one entity's nav, and one entity's language. Crossing over
 * is possible and is always labelled, because the two organizations are not
 * interchangeable: one takes dues, the other takes deductible gifts.
 */

/**
 * A link to a route another module owns. Held as data so the public tier
 * points at routes rather than reimplementing them, and so the owning module
 * is legible from the page that links to it.
 */
export type OutboundRoute = {
  href: string;
  label: string;
  /** The module that builds this route. See docs/MODULE-BRIEF.md. */
  ownedBy:
    | "membership"
    | "scholarships"
    | "foundation"
    | "store"
    | "treasury"
    | "secretary";
};

export type NavItem = {
  href: string;
  label: string;
  /** Set when the destination belongs to another module. */
  ownedBy?: OutboundRoute["ownedBy"];
};

export type EntityProfile = {
  entity: Entity;
  /** Full legal style, used in the h1 and the title tag. */
  legalName: string;
  shortName: string;
  subsection: string;
  /** One line, reused as the default meta description prefix. */
  standfirst: string;
  hueClass: "jsoaHue" | "jsofHue";
  home: string;
  nav: NavItem[];
  /** The one-sentence reason a reader might be on the wrong side of the door. */
  crossover: { href: string; label: string; because: string };
};

export const POSTAL_ADDRESS = "PO Box 72758, Fort Bragg, NC 28307";

export const JSOA_PROFILE: EntityProfile = {
  entity: "JSOA",
  legalName: "Joint Special Operations Association",
  shortName: "JSOA",
  subsection: "501(c)(19)",
  standfirst:
    "An all-volunteer membership association supporting the JSOC enterprise, " +
    "its unit members, and their families.",
  hueClass: "jsoaHue",
  home: "/jsoa",
  nav: [
    { href: "/jsoa/mission", label: "Mission" },
    { href: "/jsoa/events", label: "Events" },
    { href: "/jsoa/family-support", label: "Family support" },
    { href: "/apply", label: "Join", ownedBy: "membership" },
    { href: "/store", label: "Store", ownedBy: "store" },
    { href: "/jsoa/contact", label: "Contact" },
  ],
  crossover: {
    href: "/jsof",
    label: "Joint Special Operations Foundation",
    because:
      "Looking to make a tax-deductible gift, sponsor an event, or apply for a " +
      "scholarship? That is the Foundation.",
  },
};

export const JSOF_PROFILE: EntityProfile = {
  entity: "JSOF",
  legalName: "Joint Special Operations Foundation",
  shortName: "JSOF",
  subsection: "501(c)(3)",
  standfirst:
    "The charitable entity. It administers the scholarship programs, the " +
    "memorial, and tax-deductible giving for the JSOC community.",
  hueClass: "jsofHue",
  home: "/jsof",
  nav: [
    { href: "/jsof/why-the-foundation", label: "Why the Foundation" },
    { href: "/jsof/scholarships", label: "Scholarships" },
    { href: "/jsof/memorial", label: "Memorial" },
    { href: "/jsof/partners", label: "Partners" },
    { href: "/donate", label: "Donate", ownedBy: "foundation" },
    { href: "/jsof/contact", label: "Contact" },
  ],
  crossover: {
    href: "/jsoa",
    label: "Joint Special Operations Association",
    because:
      "Looking to join, pay dues, buy event tickets, or reach the store? That " +
      "is the Association.",
  },
};

export const ENTITY_PROFILES: Record<Entity, EntityProfile> = {
  JSOA: JSOA_PROFILE,
  JSOF: JSOF_PROFILE,
};

/** Consistent, boring titles. Findability depends on them being predictable. */
export function publicTitle(topic: string, entity: Entity): string {
  return `${topic} · ${ENTITY_PROFILES[entity].shortName}`;
}
