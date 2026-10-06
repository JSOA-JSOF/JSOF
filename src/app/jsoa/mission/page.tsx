import type { Metadata } from "next";

import {
  Bullets,
  Facts,
  OutboundLinks,
  PageHead,
  Section,
  SubHead,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { ALL_VOLUNTEER_NOTE, LINES_OF_EFFORT, MISSION_STATEMENT } from "@/app/(public)/mission";

export const metadata: Metadata = {
  title: "Mission and lines of effort · JSOA",
  description:
    "The Joint Special Operations Association's mission statement and its " +
    "three lines of effort: memorialize the fallen, provide scholarships and " +
    "grants to JSOC families, and support JSOC family events.",
  alternates: { canonical: "/jsoa/mission" },
};

export default function MissionPage() {
  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/mission"
      crumbs={[{ href: "/jsoa/mission", label: "Mission" }]}
    >
      <PageHead
        eyebrow="Mission"
        title="What the Association is for"
        lede={MISSION_STATEMENT}
      />

      <Section title="Three lines of effort" id="lines-of-effort">
        <p>
          The mission narrows to three things. They have not changed, and the
          value of keeping the list to three is that anyone can hold it in
          their head: memorialize the fallen, educate the families, and keep
          the community together.
        </p>
        {LINES_OF_EFFORT.map((line) => (
          <div key={line.slug}>
            <SubHead>{line.title}</SubHead>
            <p>{line.statement}</p>
            <p>{line.detail}</p>
            <Facts
              rows={[
                {
                  label: "Carried by",
                  value:
                    line.carriedBy === "JSOA"
                      ? "Joint Special Operations Association, 501(c)(19)"
                      : "Joint Special Operations Foundation, 501(c)(3)",
                },
                {
                  label: "Gifts for this go to",
                  value:
                    line.carriedBy === "JSOA"
                      ? "the Association. A gift here is not deductible as a charitable contribution."
                      : "the Foundation, where the gift is deductible and can be restricted to this line of effort.",
                },
              ]}
            />
          </div>
        ))}
      </Section>

      <Section title="Two organizations, one board" id="two-entities">
        <p>
          There are two legal entities and they are not interchangeable. This
          trips people up, including people who have been around the
          organization for years, so it is worth stating plainly.
        </p>
        <Bullets
          items={[
            "The Association is a 501(c)(19) veterans' organization. It holds membership, dues, events and the store.",
            "The Foundation is a 501(c)(3) public charity. It holds the scholarships, the memorial and charitable giving.",
            "They share a volunteer board and share nothing else. Separate books, separate donor records, separate receipts.",
            "Any figure that spans both is shown as two labelled columns. It is never added into one number.",
          ]}
        />
        <p>
          The practical consequence for a donor: the entity you give to
          determines whether the gift is deductible and what it may be spent
          on. The Foundation page sets out why a charitable gift belongs there.
        </p>
      </Section>

      <Section title="How the work gets done" id="volunteers">
        <p>{ALL_VOLUNTEER_NOTE}</p>
        <p>
          That is also why response times on the contact page are measured in
          business days rather than hours. An office answers when the person
          holding it is off shift.
        </p>
      </Section>

      <Section title="Where to go next" id="next">
        <OutboundLinks
          items={[
            {
              href: "/jsoa/events",
              label: "Events",
              note: "Ball, golf tournament, youth triathlon",
            },
            {
              href: "/jsoa/family-support",
              label: "Family support",
              note: "What it covers and how to ask",
            },
            {
              href: "/jsof/scholarships",
              label: "Scholarships",
              note: "The three programmes and the cycle",
            },
            {
              href: "/jsof/memorial",
              label: "Memorial and pavers",
              note: "The plaza, and how a paver is dedicated",
            },
            {
              href: "/apply",
              label: "Apply for membership",
              note: "Sponsorship required",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
