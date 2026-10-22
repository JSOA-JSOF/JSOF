import type { Metadata } from "next";

import {
  Bullets,
  Callout,
  Facts,
  OutboundLinks,
  PageHead,
  Section,
  Steps,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";

export const metadata: Metadata = {
  title: "Membership — JSOA",
  description:
    "Who may join the Joint Special Operations Association, what membership " +
    "costs, and how an application is sponsored and confirmed.",
  alternates: { canonical: "/jsoa/membership" },
};

/**
 * Membership, for the Association side.
 *
 * Two things the live site gets wrong are fixed here. It calls the $200 a
 * "membership fee" without saying what it is not, and it sends applicants
 * offsite to Submittable. Both are stated plainly instead.
 */
export default function MembershipPage() {
  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/membership"
      crumbs={[{ href: "/jsoa", label: "Association" }]}
    >
      <PageHead
        eyebrow="Association · 501(c)(19)"
        title="Membership"
        lede="Membership is open to the people who have served in and alongside the command, and it is confirmed by a member before any payment is taken."
      />

      <Section title="Who may join" id="eligibility">
        <Bullets
          items={[
            "Service members and civilians currently assigned to JSOC or an associated unit.",
            "Former service members and civilians of JSOC or an associated unit who served two years and left in good standing.",
            "Augmentees, considered case by case. Tell us about your service and the Vice President, Membership will come back to you.",
          ]}
        />
        <p>
          Membership is open to all eligible personnel regardless of race,
          colour, creed, religion, age, sex, disability or national origin.
        </p>
      </Section>

      <Section title="What it costs" id="dues">
        <Facts
          rows={[
            { label: "Membership", value: "$200, one time" },
            { label: "Renewal", value: "None. It is not billed again." },
            { label: "Deductible", value: "No. See below." },
          ]}
        />
        <Callout title="Membership is not a charitable contribution">
          <p>
            The $200 buys membership of the Association, and no receipt from us
            will describe it as a deductible gift. If a deductible gift is what
            you want, that is the Joint Special Operations Foundation, which is
            a separate 501(c)(3).
          </p>
        </Callout>
      </Section>

      <Section title="How an application works" id="how">
        <Steps
          items={[
            {
              lead: "You apply.",
              detail:
                "Name, how you are connected to the command, and who is sponsoring you.",
            },
            {
              lead: "Your sponsor confirms it.",
              detail:
                "A current member vouches for the application. We will not tell you whether the person you named is a member, because that would make this form a way of checking the roster.",
            },
            {
              lead: "Then, and only then, payment.",
              detail:
                "Nothing is charged to an applicant nobody has stood behind. Payment is taken on the provider's own hosted page and card details never reach this site.",
            },
          ]}
        />
        <OutboundLinks
          items={[
            {
              href: "/apply",
              label: "Apply for membership",
              note: "Sponsor confirmation first, payment second",
            },
            {
              href: "/jsoa/contact",
              label: "Ask about eligibility",
              note: "Vice President, Membership",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
