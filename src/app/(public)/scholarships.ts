import type { OutboundRoute } from "./entities";

/**
 * The scholarship programmes, as public content.
 *
 * One thing is deliberately absent: the eligibility rule.
 *
 * The rule as published on the live site defines the class by membership in
 * the Association. Per docs/ARCHITECTURE.md that is the fact pattern the IRS
 * uses to deny or revoke 501(c)(3) exemption, because dues collected from
 * members and scholarships paid to members' children is private benefit. The
 * rule is with counsel.
 *
 * Publishing it anyway, even with a hedge, would be the organization asserting
 * the rule in the one place a regulator or a disappointed applicant would
 * look. So the page carries exactly one eligibility statement: a marked
 * placeholder saying the criteria are under review and not yet published, with
 * the office to write to. No programme entry restates the rule, hints at it,
 * or lists a criterion that is part of it.
 *
 * This module therefore holds no eligibility criteria at all. What it holds is
 * what a programme is for, who administers it, and how the cycle runs.
 */

export const ELIGIBILITY_PLACEHOLDER = {
  /** Read by the page and by tests/public.test.ts. */
  status: "AWAITING_COUNSEL" as const,
  /** Rendered as the heading of the placeholder block. */
  heading: "Eligibility: not yet published",
  /** The marker the reader sees, so the gap is obviously deliberate. */
  marker: "Placeholder, awaiting counsel",
  body: [
    "The eligibility criteria for the Foundation's scholarships are under " +
      "legal review and are not published here yet. This is a placeholder, " +
      "and it will be replaced with the criteria once counsel has signed them " +
      "off.",
    "We are not withholding them to be difficult. A charitable scholarship " +
      "has to define who may apply by objective criteria that serve a " +
      "charitable class, and the review is about getting that definition " +
      "right before it is published and relied on. Publishing a rule we then " +
      "have to withdraw would be worse for applicants than publishing nothing.",
  ],
  /** What a would-be applicant should do with the gap. */
  guidance:
    "If you are wondering whether you can apply, write to the Scholarships " +
    "Chair. You will get an answer about your own situation, and you will be " +
    "told when the criteria are published.",
  contactSlug: "scholarships-chair",
} as const;

export type ApplicationWindow = {
  state: "ANNUAL_CYCLE_DATES_TO_BE_CONFIRMED";
  /** Season words only. A year here is a year that goes stale. */
  opens: string;
  closes: string;
  decisionsBy: string;
  confirmedBy: string;
};

export const APPLICATION_WINDOW: ApplicationWindow = {
  state: "ANNUAL_CYCLE_DATES_TO_BE_CONFIRMED",
  opens: "Applications open in the autumn.",
  closes: "They close in the middle of February.",
  decisionsBy: "Decisions go out in the spring, before the academic year is planned.",
  confirmedBy: "Scholarships Chair",
};

/**
 * Where an application is made. `null` where there is nowhere to send an
 * applicant yet: the Foundation's own application is held behind the same
 * review that holds the criteria, and a link to a form that cannot accept an
 * application is worse than saying so.
 */
export type ApplyRoute =
  | OutboundRoute
  | { href: string; label: string; ownedBy: "partner" }
  | null;

export type ScholarshipProgram = {
  slug: string;
  title: string;
  /** One sentence. Doubles as the summary in the index. */
  summary: string;
  /** What the programme is for. Purpose, not a rule about who qualifies. */
  purpose: string[];
  administeredBy: string;
  applyVia: ApplyRoute;
  /**
   * Every programme points at the same placeholder. One statement, one place
   * to change when counsel reports.
   */
  eligibility: typeof ELIGIBILITY_PLACEHOLDER;
};

export const SCHOLARSHIP_PROGRAMS: ScholarshipProgram[] = [
  {
    slug: "merit",
    title: "Merit Scholarship",
    summary:
      "The Foundation's general scholarship, awarded on an application " +
      "reviewed by a committee.",
    purpose: [
      "The Foundation's main award, for study at an accredited " +
        "post-secondary institution. It is meant to reduce what a family in " +
        "the JSOC community has to find for tuition in a given year.",
      "The award is decided by a committee, on a written application. A " +
        "reviewer related to an applicant cannot open that applicant's file " +
        "at all, and the block is logged.",
    ],
    administeredBy: "Joint Special Operations Foundation",
    applyVia: null,
    eligibility: ELIGIBILITY_PLACEHOLDER,
  },
  {
    slug: "wounded-patriot",
    title: "Wounded Patriot Scholarship",
    summary:
      "A scholarship that recognizes a service-connected wound or disability.",
    purpose: [
      "An award that recognizes a service-connected wound or disability. " +
        "Undergraduate and graduate study both fall within it.",
      "It exists because the financial effect of a serious injury lands on a " +
        "household for years afterwards, and usually after the attention has " +
        "moved on.",
    ],
    administeredBy: "Joint Special Operations Foundation",
    applyVia: null,
    eligibility: ELIGIBILITY_PLACEHOLDER,
  },
  {
    slug: "north-carolina-patriot-star",
    title: "North Carolina Patriot Star Scholarship",
    summary:
      "A North Carolina award administered by the Patriot Foundation, for " +
      "study at an accredited institution in the state.",
    purpose: [
      "An award tied to study at an accredited institution in North " +
        "Carolina. It is administered by the Patriot Foundation, which runs " +
        "its own selection process on its own timetable.",
      "Because the Patriot Foundation administers it, the application does " +
        "not come through this site and the criteria are theirs to state.",
    ],
    administeredBy: "Patriot Foundation",
    applyVia: {
      href: "https://patriotfoundation.org",
      label: "Apply through the Patriot Foundation",
      ownedBy: "partner",
    },
    eligibility: ELIGIBILITY_PLACEHOLDER,
  },
];

export function programBySlug(slug: string): ScholarshipProgram | undefined {
  return SCHOLARSHIP_PROGRAMS.find((program) => program.slug === slug);
}

export const SCHOLARSHIPS_STANDFIRST =
  "Three programmes. The Foundation runs two of them; a partner organization " +
  "runs the third. The eligibility criteria are with counsel and are not " +
  "published yet.";

/**
 * Minors. docs/PRIVACY-AND-PAYMENTS.md: an applicant under eighteen needs
 * affirmative guardian consent as a separate step, and a minor's name, school,
 * photograph or likeness is never published without separate written consent.
 * Stated publicly so a guardian knows what to expect before they start.
 */
export const MINORS_NOTICE =
  "An applicant under eighteen needs a guardian's consent, captured as a " +
  "separate step with the guardian's own contact details rather than a box " +
  "the student ticks. The Foundation does not publish an applicant's name, " +
  "school, photograph or likeness, and does not publish the names of " +
  "recipients.";
