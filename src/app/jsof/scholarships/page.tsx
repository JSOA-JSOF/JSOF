import type { Metadata } from "next";

import { Callout, EffortCards, OutboundLinks, PageHead } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import {
  APPLICATION_WINDOW,
  ELIGIBILITY_PLACEHOLDER,
  MINORS_NOTICE,
  SCHOLARSHIP_PROGRAMS,
  SCHOLARSHIPS_STANDFIRST,
} from "@/app/(public)/scholarships";

export const metadata: Metadata = {
  title: "Scholarships · JSOF",
  description:
    "The Joint Special Operations Foundation administers the Merit and " +
    "Wounded Patriot scholarships. The North Carolina Patriot Star " +
    "scholarship is administered by the Patriot Foundation.",
  alternates: { canonical: "/jsof/scholarships" },
};

/**
 * The scholarships index, as a menu.
 *
 * Three cards, then the two things that must be read before anyone applies.
 *
 * The eligibility placeholder stays on this page and is repeated on each
 * programme page. That is the one deliberate duplication on the site: the
 * criteria are under legal review, and a family must not be able to reach
 * any route to applying without passing the statement that they are not
 * published yet. Everything else moved behind a click.
 */
export default function ScholarshipsPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/scholarships"
      crumbs={[{ href: "/jsof/scholarships", label: "Scholarships" }]}
    >
      <PageHead
        eyebrow="Scholarships"
        title="Three programmes"
        lede={SCHOLARSHIPS_STANDFIRST}
      />

      <EffortCards
        items={SCHOLARSHIP_PROGRAMS.map((programme) => ({
          key: programme.slug,
          // "They close in the middle of February" -> "Closes in the middle
          // of February". Stripping only "They " left the verb behind and
          // the card read "Closes close in the middle of February".
          eyebrow: APPLICATION_WINDOW.closes
            .replace(/^They close /, "Closes ")
            .replace(/\.$/, ""),
          accent: false,
          title: programme.title,
          foot: programme.administeredBy,
          href: `/jsof/scholarships/${programme.slug}`,
        }))}
      />

      <Callout
        title={ELIGIBILITY_PLACEHOLDER.heading}
        marker={ELIGIBILITY_PLACEHOLDER.marker}
      >
        {ELIGIBILITY_PLACEHOLDER.body.map((paragraph) => (
          <p key={paragraph.slice(0, 32)}>{paragraph}</p>
        ))}
        <p>{ELIGIBILITY_PLACEHOLDER.guidance}</p>
      </Callout>

      <Callout title="If the applicant is under eighteen">
        <p>{MINORS_NOTICE}</p>
      </Callout>

      <OutboundLinks
        items={[
          {
            href: "/jsoa/scholarships",
            label: "The member's view",
            note: "When to apply, and what happens after you do",
          },
          {
            href: "/jsof/contact",
            label: "Ask the Scholarships Chair",
            note: "Answers about your own situation",
          },
        ]}
      />
    </PublicShell>
  );
}
