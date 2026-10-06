import type { Metadata } from "next";

import {
  Bullets,
  Cards,
  Facts,
  OutboundLinks,
  PageHead,
  Section,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { JSOF_PROFILE } from "@/app/(public)/entities";
import { ALL_VOLUNTEER_NOTE, LINES_OF_EFFORT } from "@/app/(public)/mission";

export const metadata: Metadata = {
  title: "Joint Special Operations Foundation (JSOF)",
  description:
    "The Joint Special Operations Foundation is the 501(c)(3) charitable " +
    "entity for the JSOC community. It administers the scholarship " +
    "programmes, the memorial and paver plaza, and tax-deductible giving " +
    "that can be restricted to a specific fund.",
  alternates: { canonical: "/jsof" },
  openGraph: {
    title: "Joint Special Operations Foundation (JSOF)",
    description:
      "The 501(c)(3) charitable entity for the JSOC community: scholarships, " +
      "the memorial, and tax-deductible giving.",
    url: "/jsof",
    type: "website",
  },
};

const CHARITABLE_LINES = LINES_OF_EFFORT.filter((line) => line.carriedBy === "JSOF");

export default function FoundationHome() {
  return (
    <PublicShell entity="JSOF" currentPath={JSOF_PROFILE.home}>
      <PageHead
        eyebrow="Foundation · 501(c)(3)"
        title="Joint Special Operations Foundation"
        lede={
          "The charitable entity for the JSOC community. It administers the " +
          "scholarship programmes and the memorial, and receives " +
          "tax-deductible gifts that can be restricted to a specific fund."
        }
      />

      <Section title="What the Foundation is" id="what-it-is">
        <p>
          The Foundation is a 501(c)(3) public charity. It is a separate legal
          entity from the Joint Special Operations Association, with its own
          books, its own treasurer and its own receipts, and it shares a
          volunteer board with the Association and nothing else.
        </p>
        <p>
          It exists to do the two lines of effort that are charitable work
          rather than membership work: recognizing the fallen, and paying for
          the education of the community&rsquo;s families. It takes no dues and
          has no members.
        </p>
        <Facts
          rows={[
            { label: "Entity", value: "Joint Special Operations Foundation" },
            { label: "Subsection", value: "501(c)(3) public charity" },
            { label: "Gifts", value: "Tax-deductible, and may be restricted to a fund" },
            { label: "Members", value: "None. The Foundation does not take dues." },
            { label: "Staff", value: "None. Every office is a volunteer post." },
          ]}
        />
      </Section>

      <Section title="Why give here rather than to the Association" id="why-here">
        <p>
          Both organizations do good work and only one of them can promise you
          a deduction.
        </p>
        <Bullets
          items={[
            "A gift to the Foundation is deductible as a charitable contribution. That does not depend on anything about the membership roster.",
            "Whether a gift to the Association is deductible turns on a test applied to its members each year. It is a test on the roster, not on your gift, and it is not something a donor can check.",
            "Dues paid to the Association are not a charitable contribution at all, whatever else they are.",
            "A gift to the Foundation can be restricted to the memorial or to scholarships, and the restriction is honoured in the Foundation's own books.",
            "The Foundation's receipt carries the North Carolina charitable solicitation disclosure. The Association's dues receipt carries a not-deductible disclaimer instead.",
          ]}
        />
        <OutboundLinks
          items={[
            {
              href: "/jsof/why-the-foundation",
              label: "The full answer",
              note: "What each entity may do with a gift, and what your receipt will say",
            },
          ]}
        />
      </Section>

      <Section title="What your gift pays for" id="lines-of-effort" wide>
        <Cards
          columns={2}
          items={CHARITABLE_LINES.map((line) => ({
            key: line.slug,
            kind: "Foundation",
            title: line.title,
            href: line.href,
            body: line.statement,
            more: "Read more",
          }))}
        />
        <p>
          The Association&rsquo;s third line of effort, the family events, is
          funded by the Association from dues, ticket income and sponsorship.
          It is listed on the Association&rsquo;s own pages.
        </p>
      </Section>

      <Section title="Ways to give" id="ways-to-give">
        <OutboundLinks
          items={[
            {
              href: "/donate",
              label: "Make a donation",
              note: "General fund, or restricted to a line of effort",
            },
            {
              href: "/jsof/memorial",
              label: "Dedicate a paver",
              note: "Memorial plaza, inscription reviewed before it is cut",
            },
            {
              href: "/donate/sponsor",
              label: "Sponsor an event",
              note: "For companies. Arranged by the Fundraising Chair",
            },
            {
              href: "/jsof/contact",
              label: "Talk to someone first",
              note: "Treasurer or Fundraising Chair, by office",
            },
          ]}
        />
      </Section>

      <Section title="How the Foundation is run" id="how-it-is-run">
        <p>{ALL_VOLUNTEER_NOTE}</p>
        <Bullets
          items={[
            "Scholarship decisions are made by a committee on a written application. A reviewer related to an applicant cannot open that applicant's file.",
            "Any award to a board member's dependent goes to the full board with that member recused.",
            "The Foundation does not publish the names of scholarship recipients, applicants, or the families it helps.",
            "Payment is taken on the payment provider's own hosted page. Card details never reach this site.",
          ]}
        />
        <OutboundLinks
          items={[
            {
              href: "/jsof/partners",
              label: "Partners",
              note: "Acknowledgment of the organizations that work alongside us",
            },
            {
              href: "/jsoa/mission",
              label: "The shared mission",
              note: "Three lines of effort, across both entities",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
