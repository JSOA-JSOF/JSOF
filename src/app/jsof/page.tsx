import type { Metadata } from "next";

import { Hero } from "@/app/(public)/blocks";
import { Intro, TIMING_8S } from "@/app/(public)/Intro";
import { PublicShell } from "@/app/(public)/PublicShell";
import { JSOF_PROFILE } from "@/app/(public)/entities";

export const metadata: Metadata = {
  title: "Joint Special Operations Foundation (JSOF)",
  description:
    "The Joint Special Operations Foundation is the 501(c)(3) charitable " +
    "entity for the JSOC community. It funds the scholarship programmes, the " +
    "memorial, and help for families in need.",
  alternates: { canonical: "/jsof" },
  openGraph: {
    title: "Joint Special Operations Foundation (JSOF)",
    description:
      "The 501(c)(3) charitable entity for the JSOC community: scholarships, " +
      "the memorial, and help for families in need.",
    url: "/jsof",
    type: "website",
  },
};

/**
 * The Foundation home: who we are, and the navigation. Nothing else.
 *
 * Same shape as the Association home, because the two tiers stay structurally
 * identical. The giving path now lives in the nav rather than on this page,
 * which is a real trade for a fundraising site and was the board's call.
 */
export default function FoundationHome() {
  return (
    <PublicShell entity="JSOF" currentPath={JSOF_PROFILE.home}>
      <Intro
        video="/media/jsof-intro.mp4"
        timing={TIMING_8S}
        title="Joint Special Operations Foundation"
        mission={[
          "The Joint Special Operations Foundation is the charitable entity " +
            "for the JSOC community. It funds the scholarship programmes, " +
            "the memorial to those who have given their lives, and help for " +
            "families in genuine need.",
        ]}
        note={
          "A separate 501(c)(3) from the Association, with its own books and " +
          "its own receipts. No members, no dues, no paid staff. Gifts are " +
          "tax-deductible."
        }
      />

      <Hero
        full
        eyebrow="Foundation · 501(c)(3)"
        title="Who we are"
        lede={[
          "The Joint Special Operations Foundation is the charitable entity " +
            "for the JSOC community. It funds the scholarship programmes, the " +
            "memorial to those who have given their lives, and help for " +
            "families in genuine need.",
          "The Foundation is a separate 501(c)(3) from the Association, with " +
            "its own books and its own receipts. It has no members, no dues " +
            "and no paid staff, and gifts to it are tax-deductible.",
        ]}
        image="foundation-hero"
      />
    </PublicShell>
  );
}
