import type { Metadata } from "next";

import { EffortCards, PageHead } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { EVENTS } from "@/app/(public)/events";

export const metadata: Metadata = {
  title: "Events · JSOA",
  description:
    "The Joint Special Operations Association's three recurring events: the " +
    "JSOC Ball, the Joint Special Operations Golf Tournament, and the JSOC " +
    "Youth Triathlon. Dates for the next cycle are confirmed by the Events Chair.",
  alternates: { canonical: "/jsoa/events" },
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Format an ISO date without touching the Date constructor.
 *
 * `new Date("2026-10-23")` parses as UTC midnight and then renders in local
 * time, which in any western timezone shows the day before. For a date that
 * is the single most important fact on the card, being off by one is not a
 * rounding error. The string is already the three numbers we want.
 */
function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

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
          // Narrowed on the discriminant itself: assigning the check to a
          // boolean first loses it, because TypeScript does not track the
          // boolean back to the union.
          const dates = event.dates;
          const confirmed = dates.state === "CONFIRMED";
          return {
            key: event.slug,
            eyebrow:
              dates.state === "CONFIRMED"
                ? formatDay(dates.startsAt)
                : "Date to be confirmed",
            accent: confirmed,
            title: event.title,
            statement: event.summary,
            foot: dates.state === "CONFIRMED" ? dates.venue : event.kind,
            href: `/jsoa/events/${event.slug}`,
          };
        })}
      />
    </PublicShell>
  );
}
