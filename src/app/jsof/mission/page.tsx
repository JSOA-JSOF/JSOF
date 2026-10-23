import type { Metadata } from "next";

import { Bullets, Callout, EffortCards, PageHead } from "@/app/(public)/blocks";
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
 * behind the click. What stays in prose is the list of things the Foundation
 * may not fund, which is the part most charities leave out and the part that
 * keeps this one a charity. Turning that into a card would make it look like
 * another option rather than a boundary.
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
        lede="Three things, all of them charitable work. Gifts to the Foundation are tax-deductible and can be restricted to any one of them."
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

      <Callout title="What the Foundation does not fund">
        <Bullets
          items={[
            "The Association's own operations. The Foundation is not a fundraising arm for a membership organization.",
            "Members' events. The ball, the golf tournament and the triathlon are member benefits, paid for by the Association from dues, tickets and event sponsorship.",
            "Anything where the benefit runs to members because they are members rather than to a charitable class.",
          ]}
        />
      </Callout>
    </PublicShell>
  );
}
