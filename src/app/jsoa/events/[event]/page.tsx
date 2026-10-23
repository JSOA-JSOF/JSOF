import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  Bullets,
  Callout,
  Facts,
  OutboundLinks,
  PageHead,
  Paragraphs,
  Section,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { DATES_TO_BE_CONFIRMED_LABEL, EVENTS, eventBySlug } from "@/app/(public)/events";

/**
 * One page per event, at a real URL per event.
 *
 * The three pages are generated from `events.ts` rather than written out, so
 * the "dates to be confirmed" state cannot be correct on two of them and
 * stale on the third. That is exactly how the live site got into its current
 * state: three separate pages, three different years.
 */

type EventParams = { params: Promise<{ event: string }> };

export function generateStaticParams() {
  return EVENTS.map((event) => ({ event: event.slug }));
}

export async function generateMetadata({ params }: EventParams): Promise<Metadata> {
  const { event: slug } = await params;
  const event = eventBySlug(slug);
  if (!event) return { title: "Event not found · JSOA" };

  const dateLine =
    event.dates.state === "TO_BE_CONFIRMED"
      ? `${DATES_TO_BE_CONFIRMED_LABEL}. ${event.dates.typicalTiming}`
      : `Confirmed for ${event.dates.startsAt}.`;

  return {
    title: `${event.title} · JSOA`,
    description: `${event.summary} ${dateLine}`,
    alternates: { canonical: `/jsoa/events/${event.slug}` },
    openGraph: {
      title: `${event.title} · JSOA`,
      description: event.summary,
      url: `/jsoa/events/${event.slug}`,
      type: "website",
    },
  };
}

export default async function EventPage({ params }: EventParams) {
  const { event: slug } = await params;
  const event = eventBySlug(slug);
  if (!event) notFound();

  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/events"
      crumbs={[
        { href: "/jsoa/events", label: "Events" },
        { href: `/jsoa/events/${event.slug}`, label: event.title },
      ]}
    >
      <PageHead eyebrow={event.kind} title={event.title} lede={event.summary} />

      {event.dates.state === "TO_BE_CONFIRMED" ? (
        <Callout
          title={DATES_TO_BE_CONFIRMED_LABEL}
          marker="Not yet set"
          tone="warn"
        >
          <p>
            {event.dates.typicalTiming} The date for the next one has not been
            confirmed. It is set by the {event.dates.confirmedBy}, and this page
            is where it will appear.
          </p>
          <p>
            We would rather say this than show you last year&rsquo;s date. If
            you need to plan around it, write to the {event.dates.confirmedBy}
            {" "}
            and ask to be told when it is set.
          </p>
        </Callout>
      ) : (
        <Callout title="Confirmed">
          <p>
            {event.dates.startsAt} at {event.dates.venue}.
          </p>
        </Callout>
      )}

      <Section title="What it is" id="what-it-is">
        <Paragraphs items={event.whatItIs} />
      </Section>

      <Section title="Who it is for" id="who-it-is-for">
        <Bullets items={event.whoItIsFor} />
      </Section>

      <Section title="What it costs, and why it is priced that way" id="pricing">
        <p>{event.pricingNote}</p>
      </Section>

      <Section title="Registration and sponsorship" id="taking-part">
        <p>
          Neither is handled on this page. Registration goes through the store,
          and sponsorship through the Foundation, because a sponsorship is a
          gift to the charitable entity and a ticket is not.
        </p>
        <OutboundLinks
          items={[
            ...(event.registration
              ? [
                  {
                    href: event.registration.href,
                    label: event.registration.label,
                    note: "Opens when the date is confirmed",
                  },
                ]
              : []),
            {
              href: event.sponsorship.href,
              label: event.sponsorship.label,
              note: "Fundraising Chair, through the Foundation",
            },
            ...(event.registration
              ? []
              : [
                  {
                    href: "/jsoa/contact",
                    label: "Ask about taking part",
                    note: "Events Chair. Online registration is not built yet.",
                  },
                ]),
          ]}
        />
      </Section>

      <Section title="Volunteering" id="volunteering">
        <p>{event.volunteering}</p>
        <OutboundLinks
          items={[
            {
              href: "/jsoa/contact",
              label: "Offer to help at this event",
              note: "Events Chair",
            },
          ]}
        />
      </Section>

      <Section title="At a glance" id="at-a-glance">
        <Facts
          rows={[
            { label: "Event", value: event.title },
            { label: "Kind", value: event.kind },
            {
              label: "Dates",
              value:
                event.dates.state === "TO_BE_CONFIRMED"
                  ? `${DATES_TO_BE_CONFIRMED_LABEL}. ${event.dates.typicalTiming}`
                  : `${event.dates.startsAt}, ${event.dates.venue}`,
            },
            { label: "Run by", value: "Joint Special Operations Association, 501(c)(19)" },
            {
              label: "Confirmed by",
              value:
                event.dates.state === "TO_BE_CONFIRMED"
                  ? event.dates.confirmedBy
                  : "Events Chair",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
