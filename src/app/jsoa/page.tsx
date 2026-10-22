import type { Metadata } from "next";

import { Hero } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { JSOA_PROFILE } from "@/app/(public)/entities";

export const metadata: Metadata = {
  title: "Joint Special Operations Association (JSOA)",
  description:
    "The Joint Special Operations Association brings together people with the " +
    "common interest of supporting JSOC and the organizations that make up " +
    "the JSOC enterprise, the unit members and their families.",
  alternates: { canonical: "/jsoa" },
  openGraph: {
    title: "Joint Special Operations Association (JSOA)",
    description:
      "Supporting JSOC, the organizations that make up the JSOC enterprise, " +
      "the unit members and their families.",
    url: "/jsoa",
    type: "website",
  },
};

/**
 * The Association home: who we are, and the navigation. Nothing else.
 *
 * The hero fills the viewport below the masthead, so the page does not
 * scroll. Every other subject has its own page and is one click away in the
 * nav, which is the whole reason this page can be this short.
 *
 * The photograph occupies the slot a looping background video will take.
 */
export default function AssociationHome() {
  return (
    <PublicShell entity="JSOA" currentPath={JSOA_PROFILE.home}>
      <Hero
        full
        eyebrow="Association · 501(c)(19)"
        title="Who we are"
        lede={[
          "The Joint Special Operations Association is an organization " +
            "designed to bring together people with the common interest of " +
            "supporting JSOC and the organizations that make up the JSOC " +
            "enterprise, the unit members and their families.",
          "The JSOA does not have paid employees. It is operated by a group " +
            "of dedicated volunteers. We are a 501(c)(19) tax-exempt " +
            "organization.",
        ]}
        image="association-hero"
      />
    </PublicShell>
  );
}
