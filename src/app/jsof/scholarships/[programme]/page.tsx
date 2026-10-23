import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Callout, Facts, Paragraphs, PageHead, Section } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import {
  APPLICATION_WINDOW,
  ELIGIBILITY_PLACEHOLDER,
  SCHOLARSHIP_PROGRAMS,
  programBySlug,
} from "@/app/(public)/scholarships";

export function generateStaticParams() {
  return SCHOLARSHIP_PROGRAMS.map((programme) => ({ programme: programme.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ programme: string }>;
}): Promise<Metadata> {
  const { programme: slug } = await params;
  const programme = programBySlug(slug);
  if (!programme) return { title: "Scholarship · JSOF" };
  return {
    title: `${programme.title} · JSOF`,
    description: programme.summary,
    alternates: { canonical: `/jsof/scholarships/${programme.slug}` },
  };
}

/**
 * One scholarship programme.
 *
 * Split out so the index can be three cards rather than three stacked
 * sections. The eligibility placeholder travels with the programme rather
 * than being stated once at the index: somebody who lands here from a search
 * result needs to see that the criteria are not published, and would
 * otherwise never pass the place where it was said.
 */
export default async function ProgrammePage({
  params,
}: {
  params: Promise<{ programme: string }>;
}) {
  const { programme: slug } = await params;
  const programme = programBySlug(slug);
  if (!programme) notFound();

  const apply = programme.applyVia;

  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/scholarships"
      crumbs={[
        { href: "/jsof/scholarships", label: "Scholarships" },
        { href: `/jsof/scholarships/${programme.slug}`, label: programme.title },
      ]}
    >
      <PageHead
        eyebrow="Scholarship"
        title={programme.title}
        lede={programme.summary}
      />

      <Section title="What it is for" id="purpose">
        <Paragraphs items={programme.purpose} />
        <Facts
          rows={[
            { label: "Administered by", value: programme.administeredBy },
            { label: "Opens", value: APPLICATION_WINDOW.opens },
            { label: "Closes", value: APPLICATION_WINDOW.closes },
            { label: "Decisions", value: APPLICATION_WINDOW.decisionsBy },
            {
              label: "How to apply",
              value: apply ? (
                apply.href.startsWith("http") ? (
                  <a href={apply.href} rel="noopener noreferrer">
                    {apply.label}
                  </a>
                ) : (
                  <Link href={apply.href}>{apply.label}</Link>
                )
              ) : (
                "The application is not open. It opens with the criteria."
              ),
            },
          ]}
        />
      </Section>

      <Callout
        title={ELIGIBILITY_PLACEHOLDER.heading}
        marker={ELIGIBILITY_PLACEHOLDER.marker}
      >
        {ELIGIBILITY_PLACEHOLDER.body.map((paragraph) => (
          <p key={paragraph.slice(0, 32)}>{paragraph}</p>
        ))}
        <p>{ELIGIBILITY_PLACEHOLDER.guidance}</p>
      </Callout>
    </PublicShell>
  );
}
