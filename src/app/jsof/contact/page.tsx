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
import { CONTACT_STANDFIRST, JSOF_CONTACTS } from "@/app/(public)/contact-roles";

export const metadata: Metadata = {
  title: "Contact by office · JSOF",
  description:
    "Contact the Joint Special Operations Foundation by office: Treasurer, " +
    "Fundraising Chair, Scholarships Chair, Memorial Chair, and Webmaster. " +
    "Each office lists its remit and how long a reply takes.",
  alternates: { canonical: "/jsof/contact" },
};

export default function FoundationContactPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/contact"
      crumbs={[{ href: "/jsof/contact", label: "Contact" }]}
    >
      <PageHead
        eyebrow="Contact"
        title="Contact the Foundation by office"
        lede={CONTACT_STANDFIRST}
      />

      <Callout title="The Foundation has its own point of contact">
        <p>
          Until now the charitable entity had no published way to reach it. A
          company wanting to sponsor an event, or an executor asking about a
          bequest, had nowhere to write. These offices are that address.
        </p>
        <p>
          The Foundation&rsquo;s Treasurer is a separate office from the
          Association&rsquo;s, holding separate books. A question about a
          deductible gift goes here. A question about dues or a store order
          goes to the Association.
        </p>
      </Callout>

      <Section title="Offices" id="offices" wide>
        <Offices items={JSOF_CONTACTS} />
      </Section>

      <Section title="Which office" id="which-office">
        <Bullets
          items={[
            "A receipt, an acknowledgment, or a question about a restricted fund: Treasurer, Foundation.",
            "Sponsoring an event, an in-kind gift, a matching programme, or a grant: Fundraising Chair.",
            "A scholarship, the cycle, or an application in progress: Scholarships Chair.",
            "A paver, an inscription, or visiting the memorial: Memorial Chair.",
            "Something broken on this site, or something that stops you using it: Webmaster.",
            "A larger or planned gift, or anything needing the board: write to the Association's Secretary, who takes it to the board.",
          ]}
        />
      </Section>

      <Section title="By post" id="by-post">
        <Facts
          rows={[
            { label: "Postal address", value: POSTAL_ADDRESS },
            { label: "Entity", value: "Joint Special Operations Foundation" },
            { label: "Subsection", value: "501(c)(3) public charity" },
            {
              label: "Addressing post",
              value:
                "Name the Foundation, not the Association, and address it to the office rather than to a person.",
            },
          ]}
        />
        <p>
          The two entities share a post box and nothing else. Naming the
          Foundation on the envelope is what keeps a cheque out of the
          Association&rsquo;s ledger.
        </p>
      </Section>

      <Section title="The Association has its own offices" id="association">
        <OutboundLinks
          items={[
            {
              href: "/jsoa/contact",
              label: "Contact the Association by office",
              note: "Membership, events, family support, store, and press",
            },
            {
              href: "/jsoa/family-support",
              label: "Family support",
              note: "Held by the Association, not the Foundation",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
