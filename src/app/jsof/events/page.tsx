import type { Metadata } from "next";

import { Callout, EffortCards, OutboundLinks, PageHead } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { EVENTS } from "@/app/(public)/events";

export const metadata: Metadata = {
  title: "Sponsorship · JSOF",
  description:
    "What a company can sponsor across the JSOC community's events, and the " +
    "difference between an acknowledgment and advertising.",
  alternates: { canonical: "/jsof/events" },
};

/** The triathlon still has none; a card without one is composed, not blank. */
const CARD_IMAGE: Record<string, "event-golf" | "event-ball" | undefined> = {
  "golf-tournament": "event-golf",
  ball: "event-ball",
  triathlon: undefined,
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Split by hand, not by `new Date`: that parses as UTC and renders local,
 *  which shows the day before across the Americas. */
function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * Sponsorship, from the Foundation's side.
 *
 * The events belong to the Association; this page exists because sponsorship
 * is where the two entities touch and where the IRC 513(i) line sits. The
 * cards are the same menu pattern as everywhere else, and the one thing that
 * stays in prose is the acknowledgment-versus-advertising distinction, which
 * is the whole reason a sponsor should read this before signing.
 */
export default function FoundationEventsPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/events"
      crumbs={[{ href: "/jsof/events", label: "Events" }]}
    >
      <PageHead
        eyebrow="Sponsorship"
        title="What you can sponsor"
        lede="The events belong to the Association. Sponsorship runs through the Foundation, because that is where what a sponsor receives has to be answered. From $2,500."
      />

      <EffortCards
        items={EVENTS.map((event) => {
          const dates = event.dates;
          return {
            key: event.slug,
            eyebrow:
              dates.state === "CONFIRMED"
                ? formatDay(dates.startsAt)
                : "Date to be confirmed",
            accent: dates.state === "CONFIRMED",
            title: event.title,
            statement: event.summary,
            foot: dates.state === "CONFIRMED" ? dates.venue : event.kind,
            href: "/donate/sponsor",
            image: CARD_IMAGE[event.slug],
          };
        })}
      />

      <Callout title="Acknowledgment, or advertising">
        <p>
          There is a line in the tax code between the two, and which side your
          sponsorship falls on decides whether the payment is deductible. An
          acknowledgment is your name, logo, locations and product lines,
          stated without endorsement, and it is deductible. Advertising is
          comparative claims, pricing or an endorsement, and it is not, as
          well as creating taxable income for us. Beyond a small safe harbour
          the test applies to the whole payment rather than the part above the
          line, so one oversized benefit changes how all of it is treated.
        </p>
      </Callout>

      <OutboundLinks
        items={[
          {
            href: "/donate/sponsor",
            label: "How sponsorship works",
            note: "What you receive, and what your receipt will say",
          },
          {
            href: "/jsof/contact",
            label: "Talk to the Fundraising Chair",
            note: "Sponsorship, by office",
          },
        ]}
      />
    </PublicShell>
  );
}
