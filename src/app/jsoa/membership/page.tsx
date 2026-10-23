import type { Metadata } from "next";

import {
  ActionBar,
  Bullets,
  Callout,
  Facts,
  PageHead,
  Section,
  Steps,
} from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";

export const metadata: Metadata = {
  title: "Membership · JSOA",
  description:
    "Who may join the Joint Special Operations Association, what membership " +
    "costs, and how an application is sponsored and confirmed.",
  alternates: { canonical: "/jsoa/membership" },
};

/**
 * Membership.
 *
 * The three steps were a paragraph each. They are now a line each, which is
 * what a step is for: the reasoning behind them is real and worth keeping,
 * but it belongs in the application itself, at the moment it applies, not
 * stacked up in front of somebody deciding whether to start.
 *
 * Two things stay long. The dues callout, because the live site's habit of
 * implying dues are deductible is the single most expensive misunderstanding
 * on it. And the sponsor line, because "we will not tell you whether that
 * person is a member" is the anti-oracle rule, and a reader who does not
 * know that will read the silence as a bug.
 */
export default function MembershipPage() {
  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/membership"
      crumbs={[{ href: "/jsoa/membership", label: "Membership" }]}
    >
      <PageHead
        eyebrow="Membership"
        title="Join the Association"
        lede="One payment, no renewal. An existing member confirms your application before anything is charged."
      />

      <ActionBar
        items={[
          { key: "apply", label: "Apply for membership", href: "/apply" },
          { key: "ask", label: "Ask about eligibility", href: "/jsoa/contact" },
        ]}
      />

      <Section title="Three steps" id="how">
        <Steps
          items={[
            { lead: "Apply.", detail: "Who you are, your connection to the command, and your sponsor." },
            { lead: "Your sponsor confirms.", detail: "A current member vouches for you." },
            { lead: "Pay.", detail: "$200, once. Taken on the payment provider's own page." },
          ]}
        />
        <p>
          We will not tell you whether the person you named is a member. That
          would turn this form into a way of checking the roster.
        </p>
      </Section>

      <Section title="Who may join" id="eligibility">
        <Bullets
          items={[
            "Serving at JSOC or an associated unit, military or civilian.",
            "Formerly at JSOC or an associated unit, two years' service, left in good standing.",
            "Augmentees, case by case.",
          ]}
        />
        <p>
          Open to all eligible personnel regardless of race, colour, creed,
          religion, age, sex, disability or national origin.
        </p>
      </Section>

      <Section title="What it costs" id="dues">
        <Facts
          rows={[
            { label: "Membership", value: "$200, one time" },
            { label: "Renewal", value: "None" },
            { label: "Tax deductible", value: "No" },
          ]}
        />
        <Callout title="Dues are not a charitable contribution">
          <p>
            The $200 buys membership, and no receipt from us will describe it
            as a deductible gift. If that is what you want, give to the Joint
            Special Operations Foundation instead. It is a separate 501(c)(3).
          </p>
        </Callout>
      </Section>
    </PublicShell>
  );
}
