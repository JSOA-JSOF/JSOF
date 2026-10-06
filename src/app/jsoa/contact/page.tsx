import type { Metadata } from "next";

import {
  Bullets,
  Callout,
  Facts,
  Offices,
  OutboundLinks,
  PageHead,
  Section,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { POSTAL_ADDRESS } from "@/app/(public)/entities";
import { CONTACT_STANDFIRST, JSOA_CONTACTS } from "@/app/(public)/contact-roles";

export const metadata: Metadata = {
  title: "Contact by office · JSOA",
  description:
    "Contact the Joint Special Operations Association by office: President, " +
    "Vice President for Membership, Vice President for Operations, Secretary, " +
    "Treasurer, Events, Family Support, Store and Sales, and Communications. " +
    "Each office lists its remit and how long a reply takes.",
  alternates: { canonical: "/jsoa/contact" },
};

export default function AssociationContactPage() {
  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/contact"
      crumbs={[{ href: "/jsoa/contact", label: "Contact" }]}
    >
      <PageHead
        eyebrow="Contact"
        title="Contact the Association by office"
        lede={CONTACT_STANDFIRST}
      />

      <Callout title="Why there are no names here">
        <p>
          A published list of the people who run a JSOC-affiliated association,
          matched to their offices, is a list somebody else can use. It is also
          wrong within a year of every election. So this page publishes the
          office, what it decides, and how long it takes to answer.
        </p>
        <p>
          If you need to know who you are dealing with, ask in your first
          message and the person answering will tell you. That is a
          conversation between two people, which is different from a directory
          on the open internet.
        </p>
      </Callout>

      <Section title="Offices" id="offices" wide>
        <p>
          Pick the office by what you need decided, not by seniority. A message
          to the President about a store order takes longer than a message to
          the Store and Sales Chair, because it will be forwarded to them
          anyway.
        </p>
        <Offices items={JSOA_CONTACTS} />
      </Section>

      <Section title="If you are not sure which office" id="not-sure">
        <p>
          Write to the Secretary. That office exists partly to route things,
          and it will not bounce your message back to you asking which chair
          you meant.
        </p>
        <Bullets
          items={[
            "Something about your own application already in progress: Vice President, Membership.",
            "Something about a family who needs help: Family Support Chair.",
            "Something about the memorial or a paver: Memorial Chair, on the Foundation side.",
            "Something wrong on this website: Webmaster, on the Foundation side.",
            "A journalist or a photographer: Communications Chair, and nothing is arranged without the board.",
          ]}
        />
      </Section>

      <Section title="By post" id="by-post">
        <Facts
          rows={[
            { label: "Postal address", value: POSTAL_ADDRESS },
            { label: "Entity", value: "Joint Special Operations Association" },
            { label: "Subsection", value: "501(c)(19)" },
            {
              label: "Addressing post",
              value: "Address it to the office, not to a person.",
            },
          ]}
        />
        <p>
          Post reaches a box that is checked on a volunteer&rsquo;s schedule.
          If it is time-sensitive, use the mailbox.
        </p>
      </Section>

      <Section title="The Foundation has its own offices" id="foundation">
        <p>
          Scholarships, the memorial, sponsorship and deductible giving are the
          Foundation&rsquo;s work and have their own offices.
        </p>
        <OutboundLinks
          items={[
            {
              href: "/jsof/contact",
              label: "Contact the Foundation by office",
              note: "Treasurer, Fundraising, Scholarships, Memorial, Webmaster",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
