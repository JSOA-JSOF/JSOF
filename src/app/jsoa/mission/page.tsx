import type { Metadata } from "next";

import { EffortCards, PageHead } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { LINES_OF_EFFORT } from "@/app/(public)/mission";

export const metadata: Metadata = {
  title: "Mission and lines of effort · JSOA",
  description:
    "The Joint Special Operations Association's mission statement and its " +
    "three lines of effort: memorialize the fallen, provide scholarships and " +
    "grants to JSOC families, and support JSOC family events.",
  alternates: { canonical: "/jsoa/mission" },
};

/** Only two photographs can lawfully be published, so only two cards get one. */
const CARD_IMAGE: Record<string, "association-hero" | "foundation-hero" | undefined> = {
  "memorialize-the-fallen": undefined,
  "scholarships-and-grants": "foundation-hero",
  "family-events-and-support": "association-hero",
};

/**
 * The mission, as a menu that fits one screen.
 *
 * Two things were cut to get it there, both measured rather than guessed:
 * the page used to begin its cards 413px down a 900px viewport, and to run
 * 644px past the fold.
 *
 * The mission statement is gone from the head. It is not lost: it opens the
 * home page and it is the centre of the opening sequence, so printing it
 * here was the third time of asking, and it was costing about 150px at the
 * top of a page whose whole job is to be a menu.
 *
 * The two-entity note was briefly a fourth card and the board removed it:
 * three lines of effort means three cards, and a fourth dilutes the one
 * thing this page is for. The distinction it carried is not lost, it is on
 * /jsof/why-the-foundation and in the footer's crossover on every page.
 */
export default function MissionPage() {
  const cards = LINES_OF_EFFORT.map((line, index) => ({
    key: line.slug,
    eyebrow: String(index + 1).padStart(2, "0"),
    title: line.title,
    statement: line.statement,
    foot: line.carriedBy === "JSOA" ? "The Association" : "The Foundation",
    href: line.href,
    image: CARD_IMAGE[line.slug],
  }));

  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/mission"
      crumbs={[{ href: "/jsoa/mission", label: "Mission" }]}
    >
      <PageHead eyebrow="Mission" title="What we do" />

      <EffortCards items={cards} />
    </PublicShell>
  );
}
