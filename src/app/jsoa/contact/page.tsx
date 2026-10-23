import type { Metadata } from "next";

import { Callout, Offices, OutboundLinks, PageHead } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { JSOA_CONTACTS } from "@/app/(public)/contact-roles";
import { POSTAL_ADDRESS } from "@/app/(public)/entities";

export const metadata: Metadata = {
  title: "Contact · JSOA",
  description:
    "Contact the Joint Special Operations Association by office. Each office " +
    "lists what it decides, its mailbox, and how long it takes to reply.",
  alternates: { canonical: "/jsoa/contact" },
};

/**
 * The office directory.
 *
 * Offices, not people: `ContactRole` has no field for a person, so this is
 * structural rather than editorial. The board considered publishing a named
 * board of directors with photographs and chose offices only.
 *
 * Trimmed to a directory plus one short explanation. The reasoning for the
 * choice is worth keeping, because a contact page with no names looks like
 * an omission unless it says otherwise, and a corporate sponsor opening this
 * page is deciding whether the organization is real.
 */
export default function ContactPage() {
  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/contact"
      crumbs={[{ href: "/jsoa/contact", label: "Contact" }]}
    >
      <PageHead
        eyebrow="Contact"
        title="Who to write to"
        lede="Pick the office by what you need decided, not by seniority. Every office below is a volunteer post held alongside a job."
      />

      <Offices items={JSOA_CONTACTS} />

      <Callout title="Why there are no names here">
        <p>
          A published list of the people who run a JSOC-affiliated
          association, matched to their offices, is a list somebody else can
          use. It is also wrong within a year of every election. So this page
          publishes the office, what it decides, and how long it takes to
          answer. Ask in your first message and the person answering will tell
          you who they are.
        </p>
      </Callout>

      <OutboundLinks
        items={[
          {
            href: "/jsof/contact",
            label: "The Foundation's offices",
            note: "Scholarships, the memorial, and giving",
          },
          {
            href: "/jsoa/membership",
            label: "Membership questions",
            note: "Eligibility, dues, and how to join",
          },
        ]}
      />

      <p
        style={{
          marginTop: "28px",
          fontSize: "0.88rem",
          color: "var(--mute)",
        }}
      >
        By post: {POSTAL_ADDRESS}
      </p>
    </PublicShell>
  );
}
