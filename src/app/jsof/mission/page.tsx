import type { Metadata } from "next";

import {
  Banner,
  Bullets,
  Facts,
  OutboundLinks,
  PageHead,
  ProgrammeCards,
  Section,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { ALL_VOLUNTEER_NOTE } from "@/app/(public)/mission";
import { programmesFundedBy } from "@/app/(public)/programmes";

export const metadata: Metadata = {
  title: "Mission — JSOF",
  description:
    "The Joint Special Operations Foundation is the 501(c)(3) charitable " +
    "entity for the JSOC community. What it funds, and what it may not.",
  alternates: { canonical: "/jsof/mission" },
};

export default function FoundationMissionPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/mission"
      crumbs={[{ href: "/jsof", label: "Foundation" }]}
    >
      <PageHead
        eyebrow="Foundation · 501(c)(3)"
        title="Our mission"
        lede="To fund the charitable work of the JSOC community: recognizing the fallen, educating their families, and helping families in genuine need."
      />

      <Banner image="foundation-hero" />

      <Section title="What the Foundation is" id="what-it-is">
        <p>
          The Foundation is a 501(c)(3) public charity and a separate legal
          entity from the Joint Special Operations Association. It has its own
          books, its own treasurer and its own receipts, and it shares a
          volunteer board with the Association and nothing else.
        </p>
        <Facts
          rows={[
            { label: "Subsection", value: "501(c)(3) public charity" },
            { label: "Gifts", value: "Tax-deductible, and may be restricted to a fund" },
            { label: "Members", value: "None. The Foundation does not take dues." },
            { label: "Staff", value: "None. Every office is a volunteer post." },
          ]}
        />
      </Section>

      <Section title="What it funds" id="funds" wide>
        <ProgrammeCards programmes={programmesFundedBy("JSOF")} view="funds" />
      </Section>

      <Section title="What it does not fund" id="limits">
        <p>
          This is the part most charities leave out, and it is the part that
          keeps the Foundation a charity.
        </p>
        <Bullets
          items={[
            "The Association's own operations. The Foundation is not a fundraising arm for a membership organization.",
            "Members' events. The ball, the golf tournament and the triathlon are member benefits, paid for by the Association from dues, tickets and event sponsorship.",
            "Anything where the benefit runs to members because they are members rather than to a charitable class.",
          ]}
        />
        <p>{ALL_VOLUNTEER_NOTE}</p>
        <OutboundLinks
          items={[
            {
              href: "/jsof/why-the-foundation",
              label: "Why give here rather than to the Association",
              note: "What each entity may do with a gift, and what your receipt will say",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
