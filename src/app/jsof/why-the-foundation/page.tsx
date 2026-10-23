import type { Metadata } from "next";

import {
  Bullets,
  Callout,
  Facts,
  OutboundLinks,
  PageHead,
  Section,
  SubHead,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";

export const metadata: Metadata = {
  title: "Why give to the Foundation rather than the Association · JSOF",
  description:
    "The Joint Special Operations Foundation is a 501(c)(3) and the " +
    "Association is a 501(c)(19). This page explains what that means for a " +
    "donor: which gifts are deductible, which can be restricted to a fund, " +
    "and what each entity's receipt says.",
  alternates: { canonical: "/jsof/why-the-foundation" },
};

export default function WhyTheFoundationPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/why-the-foundation"
      crumbs={[{ href: "/jsof/why-the-foundation", label: "Why the Foundation" }]}
    >
      <PageHead
        eyebrow="For donors"
        title="Why give to the Foundation rather than the Association"
        lede={
          "Both organizations share a board. They do not share a tax " +
          "position, and that is the part that affects you. If you are " +
          "giving rather than joining, give to the Foundation."
        }
      />

      <Section title="The short answer" id="short-answer">
        <p>
          Give to the Foundation. A gift there is deductible as a charitable
          contribution, it can be restricted to the memorial or to
          scholarships, and the deduction does not depend on anything you
          cannot see.
        </p>
      </Section>

      <Section title="The longer answer" id="long-answer">
        <SubHead>The Foundation is a 501(c)(3)</SubHead>
        <p>
          That is the ordinary public-charity status. Gifts to it are
          deductible, subject to your own circumstances, and the deductibility
          is a property of the organization rather than of its membership. The
          Foundation issues a written acknowledgment for every gift, and that
          acknowledgment carries the North Carolina charitable solicitation
          disclosure.
        </p>

        <SubHead>The Association is a 501(c)(19)</SubHead>
        <p>
          That is the status for a veterans&rsquo; organization, and it is the
          right status for what the Association does. It is not, however, the
          same as a public charity for a donor.
        </p>
        <Bullets
          items={[
            "Dues are not a charitable contribution. They buy membership, which is something of value, so there is nothing to deduct.",
            "Whether a gift to the Association is deductible depends on a composition test applied to the roster: a share of the membership has to be war veterans. That is a fact about the roster in a given year, not about your gift.",
            "You cannot check that test, and neither can we on the day you give. It is determined and reported annually.",
          ]}
        />
        <p>
          So a gift to the Association may well be deductible. The honest
          position is that we will not tell you it definitely is, on the day
          you write the cheque, because that is not something we can know for
          you.
        </p>
      </Section>

      <Callout title="This is the correction to the old site" marker="Being fixed">
        <p>
          The current public site states flatly that donations to the
          Association are tax-deductible. That is too strong, and it is stated
          on the wrong entity. The Foundation is where a deductible gift
          belongs, and this page is the replacement for that claim.
        </p>
        <p>
          Nothing here is tax advice, and the deduction still depends on your
          own circumstances. Ask whoever prepares your return.
        </p>
      </Callout>

      <Section title="Side by side" id="side-by-side" wide>
        <p>
          The two entities are never added together into one figure, here or in
          the accounts.
        </p>
        <Facts
          rows={[
            {
              label: "Subsection",
              value: "Foundation: 501(c)(3). Association: 501(c)(19).",
            },
            {
              label: "Deductible gift",
              value:
                "Foundation: yes. Association: depends on an annual test applied to its roster.",
            },
            {
              label: "Dues",
              value: "Foundation: none. Association: dues, which are not deductible.",
            },
            {
              label: "Restrict to a fund",
              value:
                "Foundation: yes, to the memorial or to scholarships. Association: not applicable.",
            },
            {
              label: "Receipt",
              value:
                "Foundation: contribution acknowledgment with the North Carolina disclosure. Association: receipt with a dues-not-deductible disclaimer.",
            },
            {
              label: "Books",
              value: "Separate. Separate treasurers, separate ledgers, separate receipt templates.",
            },
          ]}
        />
      </Section>

      <Section title="What the Foundation will and will not do with a gift" id="restrictions">
        <Bullets
          items={[
            "A restricted gift is spent on what it was given for. If a fund cannot use it, we will come back to you rather than quietly move it.",
            "An unrestricted gift is split across the charitable lines of effort by the board.",
            "The Foundation does not pay dues, event costs or store costs for the Association. Money does not move between the two entities without two treasurers' approvals and a reference in both minute books.",
            "The Foundation does not pay a commission to any fundraiser, because it does not use paid fundraisers.",
          ]}
        />
        <p>
          On costs, we would rather be plain than impressive. The organizations
          are entirely volunteer-run, so overheads are genuinely small, and we
          will publish what they are rather than claim a round number. A
          promise that every last cent reaches the programme is the kind of
          claim that is easy to make and impossible to keep, and the annual
          accounts are the place to check it.
        </p>
      </Section>

      <Section title="Ways to give" id="ways-to-give">
        <OutboundLinks
          items={[
            {
              href: "/donate",
              label: "Make a donation",
              note: "General fund, or restricted to a line of effort",
            },
            {
              href: "/jsof/memorial",
              label: "Dedicate a paver",
              note: "Memorial plaza",
            },
            {
              href: "/donate/sponsor",
              label: "Sponsor an event",
              note: "For companies",
            },
            {
              href: "/jsof/contact",
              label: "Ask the Treasurer or Fundraising Chair",
              note: "Larger gifts, in-kind gifts, matching programmes, bequests",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
