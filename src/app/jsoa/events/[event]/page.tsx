import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  ActionBar,
  Facts,
  MemberWall,
  PageHead,
  Section,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { EVENTS, eventBySlug, eventWhen } from "@/app/(public)/events";
import { PHOTO_SUBMISSION } from "@/app/(public)/photos";

export function generateStaticParams() {
  return EVENTS.map((event) => ({ event: event.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ event: string }>;
}): Promise<Metadata> {
  const { event: slug } = await params;
  const event = eventBySlug(slug);
  if (!event) return { title: "Event · JSOA" };
  return {
    title: `${event.title} · JSOA`,
    description: event.summary,
    alternates: { canonical: `/jsoa/events/${event.slug}` },
  };
}

/** Split by hand: `new Date` parses as UTC and renders local, a day early. */
/**
 * One event.
 *
 * Three actions, then the five questions anyone has about an event, then
 * photographs. Everything that used to be prose about pricing structure and
 * what the day involves has gone: it is the sort of thing that belongs in
 * the registration flow, not on the page someone opens to find out when it
 * is.
 */
export default async function EventPage({
  params,
}: {
  params: Promise<{ event: string }>;
}) {
  const { event: slug } = await params;
  const event = eventBySlug(slug);
  if (!event) notFound();

  const { when, where } = eventWhen(event.dates);

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

      <ActionBar
        items={[
          {
            key: "play",
            label: "Register to take part",
            href: event.registration?.href,
            unavailable: "Online registration is not built yet. Ask the Events Chair.",
          },
          { key: "sponsor", label: "Sponsor this event", href: event.sponsorship.href },
          { key: "volunteer", label: "Volunteer", href: "/jsoa/contact" },
        ]}
      />

      <Section title="The details" id="details">
        <Facts
          rows={[
            { label: "What", value: event.kind },
            { label: "When", value: when },
            { label: "Where", value: where },
            { label: "Who", value: event.whoItIsFor[0] ?? "Open to the community" },
            {
              label: "Why",
              value:
                "Proceeds support the three lines of effort: the memorial, " +
                "scholarships, and the events that hold the community together.",
            },
          ]}
        />
      </Section>

      <Section title="Photographs" id="photographs">
        <ActionBar
          items={[
            {
              key: "submit",
              label: "Send us your photos",
              href: PHOTO_SUBMISSION.href ?? undefined,
              unavailable: PHOTO_SUBMISSION.whyClosed,
            },
          ]}
        />
        <MemberWall title={`Photographs from previous ${event.title}s`}>
          <p>
            The archive is for members. Member sign-in is not built yet, so
            there is nothing to sign in to at the moment. When it is, this is
            where the galleries will be.
          </p>
        </MemberWall>
      </Section>
    </PublicShell>
  );
}
