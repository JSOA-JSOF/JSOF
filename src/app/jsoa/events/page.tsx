import type { Metadata } from "next";

import { Cards, OutboundLinks, PageHead, Section } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { DATES_TO_BE_CONFIRMED_LABEL, EVENTS, EVENTS_STANDFIRST } from "@/app/(public)/events";

export const metadata: Metadata = {
  title: "Events · JSOA",
  description:
    "The Joint Special Operations Association's three recurring events: the " +
    "JSOC Ball, the Joint Special Operations Golf Tournament, and the JSOC " +
    "Youth Triathlon. Dates for the next cycle are confirmed by the Events Chair.",
  alternates: { canonical: "/jsoa/events" },
};

export default function EventsIndex() {
  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/events"
      crumbs={[{ href: "/jsoa/events", label: "Events" }]}
    >
      <PageHead eyebrow="Events" title="Events" lede={EVENTS_STANDFIRST} />

      <Section title="The three events" id="the-events" wide>
        <Cards
          columns={3}
          items={EVENTS.map((event) => ({
            key: event.slug,
            kind: event.kind,
            title: event.title,
            href: `/jsoa/events/${event.slug}`,
            body: event.summary,
            foot:
              event.dates.state === "TO_BE_CONFIRMED"
                ? DATES_TO_BE_CONFIRMED_LABEL
                : "Date confirmed",
            more: "What it is, who it is for",
          }))}
        />
      </Section>

      <Section title="Why no dates are shown" id="dates">
        <p>
          Every one of these events runs on an annual cycle, and the date for
          the next one is set by the board once the venue and the calendar are
          settled. Until that happens the page says the date is to be
          confirmed.
        </p>
        <p>
          That is a deliberate choice over the alternative, which is a page
          headed with a year that has already gone. A stale year tells a
          visitor that nobody is looking after this, and it is the fastest way
          to lose a sponsor who was about to write to us.
        </p>
      </Section>

      <Section title="Taking part" id="taking-part">
        <p>
          Registration and sponsorship are handled elsewhere on this site. Both
          open when the dates are confirmed.
        </p>
        <OutboundLinks
          items={[
            {
              href: "/store/tickets",
              label: "Registration and tickets",
              note: "Opens with the confirmed dates",
            },
            {
              href: "/donate/sponsor",
              label: "Sponsorship packages",
              note: "Arranged by the Fundraising Chair, through the Foundation",
            },
            {
              href: "/jsoa/contact",
              label: "Volunteer at an event",
              note: "Events Chair",
            },
          ]}
        />
      </Section>

      <Section title="Other family events" id="other">
        <p>
          The Association also funds smaller family events through the year,
          including a Trunk or Treat in the autumn. They are announced to
          members rather than listed here, because they are sized for the
          community rather than for the public.
        </p>
      </Section>
    </PublicShell>
  );
}
