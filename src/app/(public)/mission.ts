/**
 * The mission and the three lines of effort.
 *
 * The mission statement is the organization's own. The lines of effort are
 * also its own, and they are the most useful thing on the live site: three
 * sentences that tell a stranger exactly what the money does. They are held
 * here once and used on the Association home, the mission page, and the
 * Foundation's giving pages, so the three surfaces cannot drift.
 *
 * Which entity carries which line is stated, because it is the answer to the
 * question a donor is actually asking.
 */

export const MISSION_STATEMENT =
  "The Joint Special Operations Association is an organization designed to " +
  "bring together people with the common interest of supporting JSOC and the " +
  "organizations that make up the JSOC enterprise, the unit members and their " +
  "families.";

export type LineOfEffort = {
  slug: string;
  title: string;
  /** One sentence, as the organization states it. */
  statement: string;
  detail: string;
  /** Which entity carries the work, and which one a gift for it should go to. */
  carriedBy: "JSOA" | "JSOF";
  /** Where a reader goes to see this line of effort in practice. */
  href: string;
};

export const LINES_OF_EFFORT: LineOfEffort[] = [
  {
    slug: "memorialize-the-fallen",
    title: "Memorialize the fallen",
    statement: "Recognize those who have given their lives in defense of the Nation.",
    detail:
      "The memorial and its paver plaza. Recognizing the fallen is the " +
      "Association's stated first priority, and the work is deliberate and " +
      "slow: the first phase is dedicated, and later phases are planned to " +
      "take in enabling forces, international partners, military working " +
      "dogs, and members of the command who died from causes other than " +
      "combat while assigned.",
    carriedBy: "JSOF",
    href: "/jsof/memorial",
  },
  {
    slug: "scholarships-and-grants",
    title: "Scholarships and grants for JSOC families",
    statement:
      "Provide scholarships and grants to family members of the JSOC community.",
    detail:
      "Awards for study at accredited institutions, decided by a committee " +
      "on a written application, with a reviewer related to an applicant " +
      "blocked from opening that applicant's file. The eligibility criteria " +
      "are with counsel and are not published yet.",
    carriedBy: "JSOF",
    href: "/jsof/scholarships",
  },
  {
    slug: "family-events-and-support",
    title: "Support JSOC family events",
    statement:
      "Fund and run the events that hold the community together, and help " +
      "families who are having a hard year.",
    detail:
      "The ball, the golf tournament, the youth triathlon, and a Trunk or " +
      "Treat in the autumn. Alongside them, direct help for families of the " +
      "fallen and for families under strain from illness or injury.",
    carriedBy: "JSOA",
    href: "/jsoa/events",
  },
];

export function lineOfEffortBySlug(slug: string): LineOfEffort | undefined {
  return LINES_OF_EFFORT.find((line) => line.slug === slug);
}

/**
 * The fact about the organization that a reader most often wants confirmed,
 * and the one the live site states well: nobody is paid.
 */
export const ALL_VOLUNTEER_NOTE =
  "The Association and the Foundation are run entirely by volunteers. There " +
  "are no paid employees and no paid fundraisers, and every office listed on " +
  "the contact pages is a volunteer post held alongside a job.";
