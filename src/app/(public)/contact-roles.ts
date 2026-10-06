import type { Entity } from "@/lib/authz/model";

/**
 * The public contact directory, by office.
 *
 * This is a security requirement, not a house style. The live site publishes
 * ten board members by name against their offices, two of them at personal
 * consumer mailboxes. For a community whose membership is itself the sensitive
 * fact, a named directory of the people who run a JSOC-affiliated association
 * is a targeting list, and it stays accurate only until the next election.
 *
 * So the public tier publishes the office, what the office decides, where to
 * write to it, and how long an answer takes. Who holds the office is member
 * and board information. See docs/MODULE-BRIEF.md.
 */

export type ContactRole = {
  slug: string;
  /** The office. Never a person. */
  role: string;
  entity: Entity;
  /** What this office actually decides, so a reader picks the right one. */
  remit: string;
  mailbox: string;
  /**
   * False where the mailbox still has to be created or re-pointed. The page
   * routes those through the Secretary rather than printing an address that
   * bounces.
   */
  mailboxLive: boolean;
  respondsWithin: string;
};

export const SECRETARY_MAILBOX = "secretary@thejsoa.org";

/**
 * Two of these replace personal consumer mailboxes on the live site
 * (`memorial@` and `webmaster@`). Both are marked not-live because the board
 * has to create them; until then the page sends the reader to the Secretary.
 */
export const JSOA_CONTACTS: ContactRole[] = [
  {
    slug: "president",
    role: "President",
    entity: "JSOA",
    remit:
      "Anything that needs the board rather than a chair, and anything about " +
      "the relationship between the Association and the Foundation.",
    mailbox: "president@thejsoa.org",
    mailboxLive: true,
    respondsWithin: "five business days",
  },
  {
    slug: "vice-president-membership",
    role: "Vice President, Membership",
    entity: "JSOA",
    remit:
      "Eligibility questions, the sponsorship requirement, augmentee cases, " +
      "and anything about an application already in progress.",
    mailbox: "membership@thejsoa.org",
    mailboxLive: true,
    respondsWithin: "three business days",
  },
  {
    slug: "vice-president-operations",
    role: "Vice President, Operations",
    entity: "JSOA",
    remit:
      "Anything published under the Association's name, and any request to " +
      "correct something on this site.",
    mailbox: "vp@thejsoa.org",
    mailboxLive: true,
    respondsWithin: "five business days",
  },
  {
    slug: "secretary",
    role: "Secretary",
    entity: "JSOA",
    remit:
      "Correspondence with no obvious home, records requests, and anything " +
      "that should reach the whole board.",
    mailbox: SECRETARY_MAILBOX,
    mailboxLive: true,
    respondsWithin: "five business days",
  },
  {
    slug: "treasurer",
    role: "Treasurer, Association",
    entity: "JSOA",
    remit:
      "Dues, event receipts, and store receipts. The Association's books are " +
      "separate from the Foundation's and are never combined into one figure.",
    mailbox: "treasurer@thejsoa.org",
    mailboxLive: true,
    respondsWithin: "five business days",
  },
  {
    slug: "events-chair",
    role: "Events Chair",
    entity: "JSOA",
    remit:
      "The ball, the golf tournament, and the youth triathlon: dates, " +
      "volunteering, and registration questions.",
    mailbox: "events@thejsoa.org",
    mailboxLive: false,
    respondsWithin: "five business days",
  },
  {
    slug: "family-support-chair",
    role: "Family Support Chair",
    entity: "JSOA",
    remit:
      "Requests for family support, and referrals on behalf of a family. The " +
      "only office that holds these cases.",
    mailbox: "familysupport@thejsoa.org",
    mailboxLive: false,
    respondsWithin: "two business days",
  },
  {
    slug: "store-and-sales-chair",
    role: "Store and Sales Chair",
    entity: "JSOA",
    remit: "Orders, sizing, shipping, and returns.",
    mailbox: "sales@thejsoa.org",
    mailboxLive: true,
    respondsWithin: "five business days",
  },
  {
    slug: "communications-chair",
    role: "Communications Chair",
    entity: "JSOA",
    remit:
      "Press and media enquiries, and the newsletter. No interview or " +
      "photograph is arranged through this mailbox without the board.",
    mailbox: "communications@thejsoa.org",
    mailboxLive: false,
    respondsWithin: "five business days",
  },
];

export const JSOF_CONTACTS: ContactRole[] = [
  {
    slug: "foundation-treasurer",
    role: "Treasurer, Foundation",
    entity: "JSOF",
    remit:
      "Gift acknowledgments, receipts, restricted-fund questions, and " +
      "corporate giving paperwork. The Foundation's own books.",
    mailbox: "foundation.treasurer@thejsoa.org",
    mailboxLive: false,
    respondsWithin: "five business days",
  },
  {
    slug: "fundraising-chair",
    role: "Fundraising Chair",
    entity: "JSOF",
    remit:
      "Sponsorship of an event, in-kind gifts, matching-gift programmes, and " +
      "grant enquiries.",
    mailbox: "fundraising@thejsoa.org",
    mailboxLive: true,
    respondsWithin: "three business days",
  },
  {
    slug: "scholarships-chair",
    role: "Scholarships Chair",
    entity: "JSOF",
    remit:
      "The scholarship programmes: the cycle, the application, and the " +
      "status of an application already submitted.",
    mailbox: "scholarships@thejsoa.org",
    mailboxLive: true,
    respondsWithin: "three business days",
  },
  {
    slug: "memorial-chair",
    role: "Memorial Chair",
    entity: "JSOF",
    remit:
      "The memorial and the paver programme, including inscriptions and " +
      "anything concerning a fallen service member or their family.",
    mailbox: "memorial@thejsoa.org",
    mailboxLive: false,
    respondsWithin: "three business days",
  },
  {
    slug: "webmaster",
    role: "Webmaster",
    entity: "JSOF",
    remit:
      "Something broken on this site, or an accessibility problem that stops " +
      "you using it.",
    mailbox: "webmaster@thejsoa.org",
    mailboxLive: false,
    respondsWithin: "five business days",
  },
];

export const CONTACTS_BY_ENTITY: Record<Entity, ContactRole[]> = {
  JSOA: JSOA_CONTACTS,
  JSOF: JSOF_CONTACTS,
};

export function contactBySlug(entity: Entity, slug: string): ContactRole | undefined {
  return CONTACTS_BY_ENTITY[entity].find((contact) => contact.slug === slug);
}

/**
 * The line every contact page carries. It is a commitment about a volunteer
 * board, so it says so.
 */
export const CONTACT_STANDFIRST =
  "Every office below is a volunteer post. We publish the office, its remit, " +
  "and how long an answer takes. We do not publish who holds it.";
