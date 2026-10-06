import type { Metadata } from "next";

import {
  Bullets,
  Cards,
  OutboundLinks,
  PageHead,
  Section,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { JSOA_PROFILE } from "@/app/(public)/entities";
import { EVENTS } from "@/app/(public)/events";
import { ALL_VOLUNTEER_NOTE, LINES_OF_EFFORT, MISSION_STATEMENT } from "@/app/(public)/mission";

export const metadata: Metadata = {
  title: "Joint Special Operations Association (JSOA)",
  description:
    "The Joint Special Operations Association is an all-volunteer 501(c)(19) " +
    "membership association supporting the JSOC enterprise, its unit members, " +
    "and their families. Mission, events, family support, and contact by office.",
  alternates: { canonical: "/jsoa" },
  openGraph: {
    title: "Joint Special Operations Association (JSOA)",
    description:
      "All-volunteer membership association supporting the JSOC enterprise, " +
      "its unit members, and their families.",
    url: "/jsoa",
    type: "website",
  },
};

export default function AssociationHome() {
  return (
    <PublicShell entity="JSOA" currentPath={JSOA_PROFILE.home}>
      <PageHead
        eyebrow="Association · 501(c)(19)"
        title="Joint Special Operations Association"
        lede={MISSION_STATEMENT}
      />

      <Section title="Three lines of effort" id="lines-of-effort" wide>
        <p>
          Everything the Association and the Foundation do falls under one of
          three lines of effort. Two of them are carried by the Foundation,
          because they are charitable work funded by deductible gifts. The
          third is the Association&rsquo;s own.
        </p>
        <Cards
          columns={3}
          items={LINES_OF_EFFORT.map((line) => ({
            key: line.slug,
            kind: line.carriedBy === "JSOA" ? "Association" : "Foundation",
            title: line.title,
            href: line.href,
            body: line.statement,
            more: "Read more",
          }))}
        />
      </Section>

      <Section title="Membership" id="membership">
        <p>
          Membership is open to people connected to the command: those
          currently assigned to JSOC or an associated unit, those who served
          there and left in good standing, and augmentees, who are considered
          case by case. It is open regardless of race, colour, creed, religion,
          age, sex, disability or national origin.
        </p>
        <p>
          An application needs a sponsor who is already a member. The sponsor
          confirms it, and only then is any payment requested. Nothing is
          charged to an applicant nobody has stood behind.
        </p>
        <p>
          Dues are not a charitable contribution. If you want a deductible
          gift, give to the Foundation instead.
        </p>
        <OutboundLinks
          items={[
            {
              href: "/apply",
              label: "Apply for membership",
              note: "Sponsor confirmation first, payment second",
            },
            {
              href: "/jsoa/contact",
              label: "Ask about eligibility",
              note: "Vice President, Membership",
            },
          ]}
        />
      </Section>

      <Section title="Events" id="events" wide>
        <p>
          Three recurring events. Where the board has not confirmed a date, the
          page says so rather than showing last year&rsquo;s.
        </p>
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
                ? "Dates to be confirmed"
                : "Date confirmed",
            more: "Event details",
          }))}
        />
      </Section>

      <Section title="If your family needs help" id="family-support">
        <p>
          The Association helps families of the fallen, and families under
          strain from illness or injury. There is one office that holds those
          requests and one way to ask.
        </p>
        <OutboundLinks
          items={[
            {
              href: "/jsoa/family-support",
              label: "Family support",
              note: "What it covers, how to ask, and how long it takes",
            },
          ]}
        />
      </Section>

      <Section title="How the Association is run" id="how-it-is-run">
        <p>{ALL_VOLUNTEER_NOTE}</p>
        <Bullets
          items={[
            "The Association is a 501(c)(19) veterans' organization. Dues and event income fund its own work.",
            "The Foundation is a separate 501(c)(3). The two never share a ledger, a donor record, or a receipt.",
            "We publish offices and their remit, not the names of the people who hold them.",
          ]}
        />
        <OutboundLinks
          items={[
            {
              href: "/jsoa/mission",
              label: "Mission in full",
              note: "The statement and the three lines of effort",
            },
            {
              href: "/jsoa/contact",
              label: "Contact by office",
              note: "Nine offices, with remit and response time",
            },
            {
              href: "/jsof",
              label: "The Foundation",
              note: "Deductible giving, scholarships, and the memorial",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
