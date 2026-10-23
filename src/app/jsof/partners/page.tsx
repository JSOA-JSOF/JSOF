import type { Metadata } from "next";

import { Callout, OutboundLinks, PageHead, PartnerCards } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import {
  ACKNOWLEDGMENT_NOTE,
  BECOME_A_PARTNER,
  PARTNERS,
  PARTNERS_STANDFIRST,
} from "@/app/(public)/partners";

export const metadata: Metadata = {
  title: "Partners · JSOF",
  description:
    "Organizations that work alongside the Joint Special Operations " +
    "Foundation, acknowledged in the plain terms a public charity is " +
    "permitted to use.",
  alternates: { canonical: "/jsof/partners" },
};

/**
 * Partner acknowledgments.
 *
 * On the live Wix site this page contains the word PARTNERS and nothing
 * else, which is the first thing a corporate sponsor checks. This version
 * names the three organizations and says what each does with the Foundation
 * where there is something factual to say.
 *
 * It stays deliberately plain. Acknowledgment is what a 501(c)(3) may give a
 * sponsor; praise or comparison turns it into advertising, which costs the
 * sponsor the deduction and can create unrelated business income here. The
 * explanation of that stays on the page, because a plain page reads as an
 * unfinished one unless it says why it is plain.
 */
export default function PartnersPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/partners"
      crumbs={[{ href: "/jsof/partners", label: "Partners" }]}
    >
      <PageHead eyebrow="Partners" title="Who we work with" lede={PARTNERS_STANDFIRST} />

      <PartnerCards items={PARTNERS} />

      <Callout title="Why this page is so plain">
        <p>{ACKNOWLEDGMENT_NOTE}</p>
      </Callout>

      <OutboundLinks
        items={[
          {
            href: BECOME_A_PARTNER.href,
            label: BECOME_A_PARTNER.label,
            note: "Tiers, benefit valuation, and the approved wording",
          },
          {
            href: "/jsof/sponsors",
            label: "This year's sponsors",
            note: "Everyone who paid for the 2026 Golf Tournament, by level",
          },
          {
            href: "/donate/sponsor",
            label: "Sponsor an event",
            note: "From $2,500, through the Fundraising Chair",
          },
        ]}
      />
    </PublicShell>
  );
}
