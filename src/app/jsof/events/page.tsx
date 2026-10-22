import type { Metadata } from "next";

import {
  Bullets,
  Callout,
  OutboundLinks,
  PageHead,
  Section,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { EVENTS } from "@/app/(public)/events";

export const metadata: Metadata = {
  title: "Event sponsorship — JSOF",
  description:
    "What a company can sponsor across the JSOC community's events, and what " +
    "the difference is between a sponsorship and advertising.",
  alternates: { canonical: "/jsof/events" },
};

/**
 * Events, from the Foundation's side: what a company can sponsor.
 *
 * The events themselves belong to the Association. This page exists because
 * sponsorship is where the two entities actually touch, and where the IRC
 * 513(i) line sits. Tiers are not published here, because the board has not
 * yet decided which benefits fall on which side of that line, and publishing
 * a tier sheet that later has to be withdrawn is worse than publishing none.
 * See docs/ENTITY-SPLIT.md.
 */
export default function FoundationEventsPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/events"
      crumbs={[{ href: "/jsof", label: "Foundation" }]}
    >
      <PageHead
        eyebrow="Foundation · 501(c)(3)"
        title="Sponsorship"
        lede="The events belong to the Association. Sponsorship is arranged through the Foundation, because that is where the question of what a sponsor receives has to be answered."
      />

      <Section title="What there is to sponsor" id="what" wide>
        <ul>
          {EVENTS.map((event) => (
            <li key={event.slug}>
              <strong>{event.title}</strong>. {event.summary}
            </li>
          ))}
        </ul>
        <OutboundLinks
          items={[
            {
              href: "/jsoa/events",
              label: "The events themselves",
              note: "Dates, tickets, and what happens on the day",
            },
          ]}
        />
      </Section>

      <Section title="Acknowledgment, or advertising" id="the-line">
        <p>
          There is a line in the tax code between the two, and which side a
          sponsorship falls on decides whether the payment is deductible and
          whether it creates taxable income for us. We would rather tell you
          before you sign than after.
        </p>
        <Bullets
          items={[
            "An acknowledgment is your name, logo, locations and product lines, stated without endorsement. That is a qualified sponsorship, and it is deductible.",
            "Advertising is comparative claims, price information, or an endorsement of your product. That is not a deductible gift, and it can create unrelated business income for the Foundation.",
            "The test is all or nothing beyond a small safe harbour. One oversized benefit can change the treatment of the whole payment, not just the part above the line.",
          ]}
        />
        <Callout title="Tiers are not published yet" marker="Awaiting a board decision">
          <p>
            We have not published a sponsorship tier sheet, because the board
            has not finished deciding which benefits sit on which side of that
            line. Rather than publish tiers we would then have to withdraw, the
            Fundraising Chair will talk it through with you directly.
          </p>
        </Callout>
        <OutboundLinks
          items={[
            {
              href: "/jsof/contact",
              label: "Talk to the Fundraising Chair",
              note: "Sponsorship, by office",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
