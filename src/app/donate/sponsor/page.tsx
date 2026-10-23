import type { Metadata } from "next";

import { Bullets, Callout, Facts, OutboundLinks, PageHead, Section, Steps } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { EVENTS } from "@/app/(public)/events";

export const metadata: Metadata = {
  title: "Sponsor an event · JSOF",
  description:
    "Corporate sponsorship of the JSOC community's events, what a sponsor " +
    "receives, and the difference between an acknowledgment and advertising.",
  alternates: { canonical: "/donate/sponsor" },
};

/**
 * The sponsorship landing page.
 *
 * This route was referenced from every event in `events.ts` and did not
 * exist: it returned 404 on the live deployment while the tournament flyer
 * was in circulation advertising sponsorship. That is the worst kind of
 * broken link, because it fails the one visitor who was ready to give money.
 *
 * Tiers are deliberately not published. The board has not settled which
 * benefits sit on which side of the IRC 513(i) line, and a tier sheet that
 * has to be withdrawn is worse than no tier sheet. See docs/ENTITY-SPLIT.md.
 */
export default function SponsorPage() {
  const confirmed = EVENTS.filter((event) => event.dates.state === "CONFIRMED");

  return (
    <PublicShell
      entity="JSOF"
      currentPath="/donate"
      crumbs={[
        { href: "/donate", label: "Donate" },
        { href: "/donate/sponsor", label: "Sponsor an event" },
      ]}
    >
      <PageHead
        eyebrow="Foundation · 501(c)(3)"
        title="Sponsor an event"
        lede="Companies sponsor the events that hold this community together. Before you commit, here is exactly what you receive and how it is treated."
      />

      <Section title="What there is to sponsor" id="what">
        {confirmed.length > 0 ? (
          <Facts
            rows={confirmed.map((event) => ({
              label: event.title,
              value:
                event.dates.state === "CONFIRMED"
                  ? `${event.dates.startsAt} · ${event.dates.venue}`
                  : "Date to be confirmed",
            }))}
          />
        ) : null}
        <p>
          Sponsorship starts at $2,500. What that includes is agreed with the
          Fundraising Chair rather than taken from a published tier sheet, for
          the reason set out below.
        </p>
      </Section>

      <Section title="Where the money goes" id="where">
        <Bullets
          items={[
            "Memorializing the fallen, through the memorial and its paver plaza.",
            "Scholarships for the families of the JSOC community.",
            "Help for families in genuine need, through the Foundation.",
          ]}
        />
        <Callout title="One thing to know about which organization you are giving to">
          <p>
            The events themselves belong to the Association, a 501(c)(19).
            The charitable work your sponsorship funds belongs to the
            Foundation, a separate 501(c)(3). A gift to the Foundation is
            deductible; a payment that buys advertising is not, whichever
            organization receives it.
          </p>
        </Callout>
      </Section>

      <Section title="Acknowledgment, or advertising" id="the-line">
        <p>
          There is a line in the tax code between the two, and which side your
          sponsorship falls on decides whether your payment is deductible. We
          would rather you knew before you signed than after.
        </p>
        <Steps
          items={[
            {
              lead: "An acknowledgment is deductible.",
              detail:
                "Your name, logo, locations and product lines, stated without endorsement. That is a qualified sponsorship.",
            },
            {
              lead: "Advertising is not.",
              detail:
                "Comparative claims, pricing, an inducement to buy, or an endorsement of your product. That is advertising, and it can create taxable income for us as well as costing you the deduction.",
            },
            {
              lead: "It is close to all or nothing.",
              detail:
                "Beyond a small safe harbour the test applies to the whole payment rather than just the part above the line, so one oversized benefit can change how all of it is treated.",
            },
          ]}
        />
      </Section>

      <Section title="How to arrange it" id="how">
        <p>
          Talk to the Fundraising Chair. You will get a written agreement
          setting out what you receive, which entity receives the payment, and
          what your receipt will say.
        </p>
        <OutboundLinks
          items={[
            {
              href: "/jsof/contact",
              label: "Contact the Fundraising Chair",
              note: "Sponsorship, by office",
            },
            {
              href: "/jsof/events",
              label: "More on sponsorship",
              note: "What can be sponsored across the year",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
