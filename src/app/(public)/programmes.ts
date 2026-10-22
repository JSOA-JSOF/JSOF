/**
 * The one programme register, read by both public tiers.
 *
 * The Association page says what a programme is. The Foundation page says what
 * a gift to it funds. Both read this file, so the two descriptions and the two
 * sets of figures cannot drift apart. This is the filters-not-copies rule from
 * docs/ROLE-WORKSPACE.md applied to the public tier, and it exists because the
 * live site already demonstrates the failure: the memorial and family support
 * each appear in two places, worded differently, with a donate button on the
 * Association's own pages.
 *
 * `runBy` and `fundedBy` are separate fields on purpose. They are not always
 * the same, and the difference is the single most consequential fact about
 * this organization's structure:
 *
 *   The Foundation may fund charitable work directly. It may not fund the
 *   Association's own operations or member benefits. A programme run by the
 *   Association and funded by the Association shows no Foundation ask; one
 *   funded by the Foundation does. Rendering that from data rather than from
 *   editorial judgement is what stops a donate button appearing beside a
 *   members' event. See docs/ENTITY-SPLIT.md.
 */

export type Entity = "JSOA" | "JSOF";

/**
 * An impact figure, held to the same standard as a dashboard tile.
 *
 * Impact statements are where charities lie, usually not deliberately: a round
 * number with no denominator, a total that only ever rises, a figure nobody
 * can reconstruct. docs/DASHBOARD-BRIEF.md already governs this for the board
 * tiles and the same three rules apply in public, where the stakes are higher
 * because a donor cannot check:
 *
 *   1. A figure that cannot be computed yet says so. `value: null` and a
 *      `needs`. Never a confident zero.
 *   2. Every figure states what it was computed from, in `from`.
 *   3. No vanity metrics. If you cannot say what decision or judgement the
 *      figure would change, leave it out.
 */
export type Impact = {
  /** Null when it is not yet measurable. Never substitute zero. */
  value: string | null;
  label: string;
  /** Provenance, in one line. "Live data" is not provenance. */
  from: string;
  /** Required when value is null: what would have to exist to compute it. */
  needs?: string;
  /**
   * Which year this counts. The board has not settled calendar versus fiscal
   * reporting, so a figure that depends on the answer says which it used.
   */
  basis?: "CALENDAR_YEAR" | "FISCAL_YEAR" | "CUMULATIVE";
};

export type Programme = {
  slug: string;
  title: string;
  /** What it is, for the Association page. One or two sentences. */
  what: string;
  /** What a gift funds, for the Foundation page. Null when it takes no gifts. */
  funds: string | null;
  /** The office that runs it. */
  runBy: Entity;
  /** Where the money comes from. */
  fundedBy: Entity;
  /** Why fundedBy is what it is, when a reader might expect the other. */
  fundingNote?: string;
  impact: Impact[];
  href: string;
};

export const PROGRAMMES: Programme[] = [
  {
    slug: "memorial",
    title: "The JSOC Memorial",
    what:
      "The memorial and its paver plaza, recognizing those who have given " +
      "their lives in defense of the Nation. The first and most significant " +
      "phase is dedicated; later phases will take in enabling forces, " +
      "international partners, military working dogs, and members of the " +
      "command who died while assigned from causes other than combat.",
    funds:
      "The next phases of the memorial, and the upkeep of what is already " +
      "built.",
    runBy: "JSOF",
    fundedBy: "JSOF",
    impact: [
      {
        value: null,
        label: "Names recognized",
        from: "The dedication record for each completed phase",
        needs: "the memorial register, which is not in the platform yet",
        basis: "CUMULATIVE",
      },
      {
        value: null,
        label: "Phases dedicated, of those planned",
        from: "Phases dedicated against the four published future phases",
        needs: "a board-confirmed phase plan with dates",
      },
    ],
    href: "/jsof/memorial",
  },
  {
    slug: "scholarships",
    title: "Scholarships",
    what:
      "Awards for study at accredited institutions, decided by a committee " +
      "on a written application. A reviewer related to an applicant cannot " +
      "open that applicant's file.",
    funds:
      "Scholarship awards, paid to the institution. The Foundation does not " +
      "publish the names of applicants or recipients.",
    runBy: "JSOF",
    fundedBy: "JSOF",
    impact: [
      {
        value: null,
        label: "Awarded this cycle",
        from: "Sum of awards disbursed, in integer cents, for the cycle",
        needs: "a completed cycle in the platform rather than in a spreadsheet",
        basis: "FISCAL_YEAR",
      },
      {
        value: null,
        label: "Applicants who received an outcome",
        from: "Applicants notified, against applications decided",
        needs: "the notify step to run inside the platform",
        basis: "FISCAL_YEAR",
      },
      {
        value: null,
        label: "Awarded since the programme began",
        from: "Sum of all disbursed awards across every recorded cycle",
        needs: "the historical award record, which exists only on paper",
        basis: "CUMULATIVE",
      },
    ],
    href: "/jsof/scholarships",
  },
  {
    slug: "family-aid",
    title: "Help for families in need",
    what:
      "Direct help for families of the fallen, and for families under strain " +
      "from illness or injury.",
    funds:
      "Assistance to families in genuine need, on a written request, decided " +
      "by the office that holds it.",
    runBy: "JSOA",
    fundedBy: "JSOF",
    fundingNote:
      "The Association holds the requests because that is where families " +
      "already turn. The Foundation funds the assistance, because help to a " +
      "family in need is charitable work rather than a member benefit.",
    impact: [
      {
        value: null,
        label: "Families helped",
        from: "Closed assistance cases, counted without identifying anyone",
        needs: "the family support case register, which is not built",
        basis: "CALENDAR_YEAR",
      },
      {
        value: null,
        label: "Days from request to decision",
        from: "Median across closed cases",
        needs: "timestamps on requests, which land with persistence",
      },
    ],
    href: "/jsoa/family-support",
  },
  {
    slug: "community-events",
    title: "Community events",
    what:
      "The JSOC Ball, the golf tournament, the youth triathlon, and Trunk or " +
      "Treat. The events that hold the community together.",
    funds: null,
    runBy: "JSOA",
    fundedBy: "JSOA",
    fundingNote:
      "Funded by dues, ticket income and event sponsorship, not by " +
      "charitable gifts. A members' event is a member benefit, so the " +
      "Foundation does not pay for it and no gift is solicited for it.",
    impact: [
      {
        value: null,
        label: "People attending across the year",
        from: "Ticketed attendance, summed across the four events",
        needs: "ticketing inside the platform",
        basis: "CALENDAR_YEAR",
      },
    ],
    href: "/jsoa/events",
  },
];

export function programmesFundedBy(entity: Entity): Programme[] {
  return PROGRAMMES.filter((programme) => programme.fundedBy === entity);
}

export function programmeBySlug(slug: string): Programme | undefined {
  return PROGRAMMES.find((programme) => programme.slug === slug);
}

/**
 * Every impact figure is currently unmeasured, and that is the honest state
 * rather than an oversight. Each one names what it needs, so the list doubles
 * as the board's "what we have to start counting" backlog. A test asserts that
 * an unmeasured figure always says what it needs, so none of these can quietly
 * become a confident zero.
 */
export function unmeasuredImpact(): { programme: string; label: string; needs: string }[] {
  return PROGRAMMES.flatMap((programme) =>
    programme.impact
      .filter((figure) => figure.value === null)
      .map((figure) => ({
        programme: programme.title,
        label: figure.label,
        needs: figure.needs ?? "",
      })),
  );
}
