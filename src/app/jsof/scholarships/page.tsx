import Link from "next/link";
import type { Metadata } from "next";

import {
  Bullets,
  Callout,
  Cards,
  Facts,
  OutboundLinks,
  PageHead,
  Paragraphs,
  Section,
  SubHead,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import {
  APPLICATION_WINDOW,
  ELIGIBILITY_PLACEHOLDER,
  MINORS_NOTICE,
  SCHOLARSHIPS_STANDFIRST,
  SCHOLARSHIP_PROGRAMS,
} from "@/app/(public)/scholarships";

export const metadata: Metadata = {
  title: "Scholarships · JSOF",
  description:
    "The Joint Special Operations Foundation's three scholarship programmes: " +
    "the Merit Scholarship, the Wounded Patriot Scholarship, and the North " +
    "Carolina Patriot Star Scholarship. The annual cycle, and how decisions " +
    "are made. Eligibility criteria are under legal review and are not " +
    "published yet.",
  alternates: { canonical: "/jsof/scholarships" },
};

export default function ScholarshipsPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/scholarships"
      crumbs={[{ href: "/jsof/scholarships", label: "Scholarships" }]}
    >
      <PageHead
        eyebrow="Scholarships"
        title="Scholarships"
        lede={SCHOLARSHIPS_STANDFIRST}
      />

      {/*
        The single eligibility statement on the public tier. It is a marked
        placeholder, not a hedged version of the rule. See
        src/app/(public)/scholarships.ts for why, and docs/ARCHITECTURE.md
        under "Scholarships — do not build eligibility as currently published".
      */}
      <Callout
        title={ELIGIBILITY_PLACEHOLDER.heading}
        marker={ELIGIBILITY_PLACEHOLDER.marker}
        tone="warn"
      >
        <Paragraphs items={ELIGIBILITY_PLACEHOLDER.body} />
        <p>{ELIGIBILITY_PLACEHOLDER.guidance}</p>
      </Callout>

      <Section title="The programmes" id="programmes" wide>
        <p>
          Three programmes. The Foundation runs two of them and a partner
          organization runs the third on its own timetable.
        </p>
        <Cards
          columns={3}
          items={SCHOLARSHIP_PROGRAMS.map((program) => ({
            key: program.slug,
            kind: program.administeredBy,
            title: program.title,
            body: program.summary,
            foot: "Eligibility awaiting counsel",
          }))}
        />

        {SCHOLARSHIP_PROGRAMS.map((program) => (
          <div key={program.slug} id={program.slug}>
            <SubHead>{program.title}</SubHead>
            <Paragraphs items={program.purpose} />
            <Facts
              rows={[
                { label: "Administered by", value: program.administeredBy },
                {
                  label: "Eligibility",
                  value: `${ELIGIBILITY_PLACEHOLDER.marker}. Not published yet.`,
                },
                {
                  label: "How to apply",
                  value: program.applyVia ? (
                    program.applyVia.href.startsWith("http") ? (
                      <a href={program.applyVia.href} rel="noopener noreferrer">
                        {program.applyVia.label}
                      </a>
                    ) : (
                      // An internal route used to fall through to plain text,
                      // because the only route here was the partner's. It now
                      // has to be a link, or the application is unreachable
                      // from the public site.
                      <Link href={program.applyVia.href}>{program.applyVia.label}</Link>
                    )
                  ) : (
                    "The application is not open. It opens with the criteria."
                  ),
                },
              ]}
            />
          </div>
        ))}
      </Section>

      <Section title="The application window" id="window">
        <p>
          The cycle is annual. The exact dates for the next cycle are confirmed
          by the {APPLICATION_WINDOW.confirmedBy}, and this page is where they
          will appear. No year is shown until they are set, for the same reason
          the events pages show none.
        </p>
        <Facts
          rows={[
            { label: "Opens", value: APPLICATION_WINDOW.opens },
            { label: "Closes", value: APPLICATION_WINDOW.closes },
            { label: "Decisions", value: APPLICATION_WINDOW.decisionsBy },
            {
              label: "Exact dates",
              value: `To be confirmed by the ${APPLICATION_WINDOW.confirmedBy}.`,
            },
          ]}
        />
        <p>
          If you want to be told when the window opens, write to the
          Scholarships Chair and ask. You will be told once, when it opens, and
          your address will not be used for anything else.
        </p>
      </Section>

      <Section title="How a decision is made" id="how-decided">
        <p>
          A committee reads a written application and decides. Three things
          about that process are worth stating publicly, because they are what
          make it a fair process rather than a stated intention.
        </p>
        <Bullets
          items={[
            "A reviewer related to an applicant cannot open that applicant's file at all. The block is enforced in software and it is logged.",
            "An award to a board member's dependent goes to the full board, with that board member recused.",
            "What a reviewer sees is limited to what their decision needs. The eligibility information and the selection material are held separately.",
          ]}
        />
        <p>
          Selection records are retained for five years and then are no longer
          held. An unsuccessful application is purged on a schedule rather than
          kept indefinitely.
        </p>
      </Section>

      <Section title="If the applicant is under eighteen" id="minors">
        <p>{MINORS_NOTICE}</p>
        <p>
          The Foundation never asks an applicant to upload separation
          paperwork, a discharge document, or anything else carrying a Social
          Security number. There is no field for it, and there will not be one.
        </p>
      </Section>

      <Section title="Questions" id="questions">
        <OutboundLinks
          items={[
            {
              href: "/jsof/contact",
              label: "Write to the Scholarships Chair",
              note: "Eligibility questions, the cycle, or an application in progress",
            },
            {
              href: "https://patriotfoundation.org",
              label: "Patriot Foundation",
              note: "Administers the North Carolina Patriot Star Scholarship",
            },
            {
              href: "/donate",
              label: "Fund a scholarship",
              note: "A gift can be restricted to the scholarship fund",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
