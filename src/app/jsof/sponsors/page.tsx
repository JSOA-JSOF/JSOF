import type { Metadata } from "next";

import { Callout, OutboundLinks, PageHead, SponsorWall } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import {
  GOLF_2026_SPONSORS,
  SPONSORS_STANDFIRST,
  SPONSOR_LEVELS,
  SPONSOR_WALL_NOTE,
} from "@/app/(public)/sponsors";

export const metadata: Metadata = {
  title: "Sponsors · JSOF",
  description:
    "The companies and organizations that sponsored the 2026 Golf " +
    "Tournament, by level.",
  alternates: { canonical: "/jsof/sponsors" },
};

/**
 * The sponsor wall.
 *
 * The board at the course is the only place these names have been
 * published, which means they come down with the banner. A company that
 * paid at Eagle level and got one afternoon of recognition got less than
 * it was sold. This is the same board, kept up.
 */
export default function SponsorsPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/sponsors"
      crumbs={[{ href: "/jsof/sponsors", label: "Sponsors" }]}
    >
      <PageHead
        eyebrow="Sponsors"
        title="Thank you to our sponsors"
        lede={SPONSORS_STANDFIRST}
      />

      <SponsorWall levels={SPONSOR_LEVELS} sponsors={GOLF_2026_SPONSORS} />

      <Callout title="Why there is nothing written about each one">
        <p>{SPONSOR_WALL_NOTE}</p>
      </Callout>

      <OutboundLinks
        items={[
          {
            href: "/donate/sponsor",
            label: "Sponsor an event",
            note: "What the levels include, through the Fundraising Chair",
          },
          {
            href: "/jsof/partners",
            label: "Partners",
            note: "Organizations that work alongside the Foundation",
          },
        ]}
      />
    </PublicShell>
  );
}
