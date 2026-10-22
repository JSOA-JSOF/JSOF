import type { Metadata } from "next";

import {
  Callout,
  Cards,
  OutboundLinks,
  PageHead,
  Section,
  Steps,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import {
  APPLICATION_WINDOW,
  ELIGIBILITY_PLACEHOLDER,
  SCHOLARSHIP_PROGRAMS,
} from "@/app/(public)/scholarships";

export const metadata: Metadata = {
  title: "Scholarships — JSOA",
  description:
    "The scholarship year for JSOA members: when applications open and close, " +
    "how the process works, and where to apply.",
  alternates: { canonical: "/jsoa/scholarships" },
};

/**
 * Scholarships, seen from the membership side.
 *
 * The Foundation runs the programmes and its own page carries the impact
 * figures for donors. This page is for members: the shape of the year, what
 * happens to an application, and where to go. The two never restate each
 * other's numbers.
 *
 * Dates are season words rather than a year, because a year on a volunteer
 * site goes stale and the live site is currently publishing a deadline that
 * has passed. See src/app/(public)/scholarships.ts.
 */
export default function AssociationScholarshipsPage() {
  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/scholarships"
      crumbs={[{ href: "/jsoa", label: "Association" }]}
    >
      <PageHead
        eyebrow="Association · 501(c)(19)"
        title="Scholarships"
        lede="The scholarships are administered by the Joint Special Operations Foundation. This page is the member's view: the shape of the year, and what happens to an application."
      />

      <Section title="The year" id="timeline">
        <Steps
          items={[
            { lead: "Autumn.", detail: APPLICATION_WINDOW.opens },
            { lead: "Mid February.", detail: APPLICATION_WINDOW.closes },
            { lead: "Spring.", detail: APPLICATION_WINDOW.decisionsBy },
          ]}
        />
        <p>
          Exact dates for each cycle are set by the {APPLICATION_WINDOW.confirmedBy}{" "}
          and published once confirmed. We do not show last year&rsquo;s dates
          as though they were this year&rsquo;s.
        </p>
      </Section>

      <Section title="The programmes" id="programmes" wide>
        <Cards
          columns={3}
          items={SCHOLARSHIP_PROGRAMS.map((programme) => ({
            key: programme.slug,
            kind: programme.administeredBy,
            title: programme.title,
            body: programme.summary,
          }))}
        />
      </Section>

      <Section title="How an application is handled" id="process">
        <Steps
          items={[
            {
              lead: "You apply in writing.",
              detail: "One application, on the Foundation's form.",
            },
            {
              lead: "A committee scores it.",
              detail:
                "A reviewer related to an applicant cannot open that applicant's file, and a reviewer never sees the award amounts while scoring.",
            },
            {
              lead: "The board decides.",
              detail:
                "An award to a board member's dependent goes to the full board with that member recused.",
            },
            {
              lead: "Everyone is told.",
              detail:
                "Every applicant receives an outcome, not only the successful ones.",
            },
          ]}
        />
        <p>
          The Foundation does not publish the names of applicants or of
          recipients, and it never will.
        </p>
      </Section>

      <Callout title={ELIGIBILITY_PLACEHOLDER.heading} marker={ELIGIBILITY_PLACEHOLDER.marker}>
        {ELIGIBILITY_PLACEHOLDER.body.map((paragraph) => (
          <p key={paragraph.slice(0, 32)}>{paragraph}</p>
        ))}
        <p>{ELIGIBILITY_PLACEHOLDER.guidance}</p>
      </Callout>

      <Section title="Where to apply" id="apply">
        <OutboundLinks
          items={[
            {
              href: "/jsof/scholarships",
              label: "The Foundation's scholarship pages",
              note: "Programmes, and what gifts to them have funded",
            },
            {
              href: "/jsoa/contact",
              label: "Ask the Scholarships Chair",
              note: "Answers about your own situation",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
