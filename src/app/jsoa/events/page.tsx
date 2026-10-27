import type { Metadata } from "next";

import { EffortCards, PageHead } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { EVENTS, eventWhen } from "@/app/(public)/events";

export const metadata: Metadata = {
  title: "Events · JSOA",
  description:
    "The Joint Special Operations Association's three recurring events: the " +
    "JSOC Ball, the Golf Tournament, and the JSOC " +
    "Youth Triathlon. Dates for the next cycle are confirmed by the Events Chair.",
  alternates: { canonical: "/jsoa/events" },
};

const CARD_IMAGE: Record<
  string,
  "event-golf" | "event-ball" | "event-triathlon" | undefined
> = {
  "golf-tournament": "event-golf",
  ball: "event-ball",
  triathlon: "event-triathlon",
};

/**
 * Format an ISO date without touching the Date constructor.
 *
 * `new Date("2026-10-23")` parses as UTC midnight and then renders in local
 * time, which in any western timezone shows the day before. For a date that
 * is the single most important fact on the card, being off by one is not a
 * rounding error. The string is already the three numbers we want.
 */
/**
 * Events, as a menu.
 *
 * Each card leads with the one fact somebody came for: the date, or a plain
 * statement that it is not set. A confirmed date takes the entity hue; an
 * unconfirmed one stays grey, because colour here means "this is a fact" and
 * the live Wix site's habit of showing last year's date as though it were
 * this year's is exactly what that rule exists to prevent.
 *
 * Everything else, registration, sponsorship, what happens on the day, is on
 * the event's own page, one click away.
 */
export default function EventsIndex() {
  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/events"
      crumbs={[{ href: "/jsoa/events", label: "Events" }]}
    >
      <PageHead eyebrow="Events" title="What's on" />

      <EffortCards
        items={EVENTS.map((event) => {
          const when = eventWhen(event.dates);
          return {
            key: event.slug,
            eyebrow: when.when,
            // The hue means "this is a fact", which a date that has
            // already happened is.
            accent: when.settled,
            title: event.title,
            foot: when.where,
            href: `/jsoa/events/${event.slug}`,
            image: CARD_IMAGE[event.slug],
          };
        })}
      />
    </PublicShell>
  );
}
