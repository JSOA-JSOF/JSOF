import type { Metadata } from "next";

import { EffortCards, PageHead } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { programmesFundedBy } from "@/app/(public)/programmes";

export const metadata: Metadata = {
  title: "Mission · JSOF",
  description:
    "The Joint Special Operations Foundation is the 501(c)(3) charitable " +
    "entity for the JSOC community. What it funds, and what it may not.",
  alternates: { canonical: "/jsof/mission" },
};

/** Family aid is the one programme with no photograph, and should stay
 *  that way: it is families in crisis, and there is no image of that we
 *  could publish. */
const CARD_IMAGE: Record<
  string,
  "scholarship-award" | "memorial" | "family-support" | undefined
> = {
  scholarships: "scholarship-award",
  memorial: "memorial",
  "family-aid": "family-support",
};

/**
 * The Foundation's mission, as a menu.
 *
 * Same pattern as the Association's: three cards, one fact each, detail
 * behind the click.
 *
 * The "what the Foundation does not fund" list was here and the board
 * removed it. The boundary it stated is still enforced in the data: a
 * programme the Association funds has a null `funds` string, so it cannot
 * render on this side at all, and a test rejects any Association-funded
 * programme that offers a donor framing. The page no longer says it; the
 * code still cannot break it.
 */
export default function FoundationMissionPage() {
  const funded = programmesFundedBy("JSOF");

  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/mission"
      crumbs={[{ href: "/jsof/mission", label: "Mission" }]}
    >
      <PageHead
        eyebrow="Mission"
        title="What your gift funds"
        lede="Three things, all charitable. Gifts are tax-deductible and can be restricted to any one of them."
      />

      <EffortCards
        items={funded.map((programme, index) => ({
          key: programme.slug,
          eyebrow: String(index + 1).padStart(2, "0"),
          title: programme.title,
          statement: programme.funds ?? programme.what,
          foot: programme.runBy === "JSOF" ? "Run by the Foundation" : "Run by the Association",
          href: programme.href,
          image: CARD_IMAGE[programme.slug],
        }))}
      />

    </PublicShell>
  );
}
