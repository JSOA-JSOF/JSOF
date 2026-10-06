import type { Metadata } from "next";

import {
  Callout,
  Facts,
  OutboundLinks,
  PageHead,
  Section,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import {
  ACKNOWLEDGMENT_NOTE,
  BECOME_A_PARTNER,
  PARTNERS,
  PARTNERS_STANDFIRST,
} from "@/app/(public)/partners";
import styles from "./partners.module.css";

export const metadata: Metadata = {
  title: "Partners · JSOF",
  description:
    "Organizations that work alongside the Joint Special Operations " +
    "Foundation: the Patriot Foundation, the Patriot Military Family " +
    "Foundation, and Force Network. This page acknowledges them and nothing more.",
  alternates: { canonical: "/jsof/partners" },
};

export default function PartnersPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/partners"
      crumbs={[{ href: "/jsof/partners", label: "Partners" }]}
    >
      <PageHead
        eyebrow="Partners"
        title="Partners"
        lede={PARTNERS_STANDFIRST}
      />

      <Section title="Acknowledgments" id="acknowledgments" wide>
        {/*
          Acknowledgment only. Each entry renders the approved wording, the
          organization's own web address, and a factual statement of what it
          does. No adjective, no comparison, no recommendation, no call to
          action. See src/app/(public)/partners.ts and docs/ARCHITECTURE.md
          under "Sponsorship": one adjective converts the whole placement from
          a qualified sponsorship payment into taxable advertising.
        */}
        <ul className={styles.list}>
          {PARTNERS.map((partner) => (
            <li className={styles.item} key={partner.slug}>
              <h3 className={styles.org}>{partner.acknowledgment}</h3>
              <a
                className={styles.url}
                href={partner.url}
                rel="noopener noreferrer"
              >
                {partner.url.replace(/^https:\/\//, "")}
              </a>
              {partner.relationship ? (
                <p className={styles.relationship}>{partner.relationship}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Callout title="Why this page is so plain">
        <p>{ACKNOWLEDGMENT_NOTE}</p>
      </Callout>

      <Section title="Becoming a partner" id="becoming-a-partner">
        <p>{BECOME_A_PARTNER.note}</p>
        <OutboundLinks
          items={[
            {
              href: BECOME_A_PARTNER.href,
              label: BECOME_A_PARTNER.label,
              note: "Tiers, benefit valuation, and the approved wording",
            },
            {
              href: "/jsof/contact",
              label: "Talk to the Fundraising Chair",
              note: "Sponsorship, in-kind gifts, and matching programmes",
            },
          ]}
        />
      </Section>

      <Section title="What a sponsor gets, and what it does not get" id="what-a-sponsor-gets">
        <Facts
          rows={[
            {
              label: "On this page",
              value: "A name, a web address, and a statement of fact.",
            },
            {
              label: "Not on this page",
              value:
                "Descriptions of products or services, comparisons, endorsements, prices, or calls to action.",
            },
            {
              label: "Wording",
              value:
                "Agreed in advance and recorded. Sponsor-supplied copy is reviewed before it is published.",
            },
            {
              label: "Exclusivity",
              value:
                "A sponsor may be the only sponsor of an event. No organization is named as the only source of anything.",
            },
            {
              label: "Pricing",
              value:
                "A fixed amount. Never tied to attendance figures or to how many people see the placement.",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
