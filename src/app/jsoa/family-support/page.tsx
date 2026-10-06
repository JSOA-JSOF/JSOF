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
import { SECRETARY_MAILBOX, contactBySlug } from "@/app/(public)/contact-roles";

export const metadata: Metadata = {
  title: "Family support · JSOA",
  description:
    "How the Joint Special Operations Association supports families of the " +
    "fallen and families under strain from illness or injury: what it covers, " +
    "who holds the request, how to ask, and how long an answer takes.",
  alternates: { canonical: "/jsoa/family-support" },
};

const OWNER = contactBySlug("JSOA", "family-support-chair");

export default function FamilySupportPage() {
  return (
    <PublicShell
      entity="JSOA"
      currentPath="/jsoa/family-support"
      crumbs={[{ href: "/jsoa/family-support", label: "Family support" }]}
    >
      <PageHead
        eyebrow="Family support"
        title="If your family is having a hard year"
        lede={
          "The Association helps families of the fallen, and families under " +
          "strain from illness or injury. One office holds these requests. " +
          "This page says what it can do and how to ask."
        }
      />

      <Callout title="Who to write to, and when you will hear back">
        <p>
          The <strong>{OWNER ? OWNER.role : "Family Support Chair"}</strong> is
          the only office that holds family-support requests. A request is
          acknowledged within{" "}
          <strong>{OWNER ? OWNER.respondsWithin : "two business days"}</strong>,
          including a request that turns out to be for something the
          Association cannot do. You will not be left wondering whether it
          arrived.
        </p>
        <p>
          Until that mailbox is routed, write to{" "}
          <a href={`mailto:${SECRETARY_MAILBOX}`}>{SECRETARY_MAILBOX}</a> and
          ask for the Family Support Chair. The Secretary passes it on without
          reading into it.
        </p>
      </Callout>

      <Section title="What it covers" id="what-it-covers">
        <p>
          Two kinds of work sit under family support, and they are worth
          separating because people usually mean the second one.
        </p>
        <Bullets
          items={[
            "Funding the events that keep the community together: the ball, the youth triathlon, and a Trunk or Treat in the autumn.",
            "Direct help for families in a period of need, including families of the fallen and families under strain from a serious illness or injury.",
          ]}
        />
        <p>
          The second kind is deliberately not defined as a fixed list of
          benefits with fixed amounts. What a family needs in a bad month is
          rarely what a published schedule would have guessed, and a list would
          mostly serve to tell people they do not qualify. Ask, and the request
          is looked at as it stands.
        </p>
      </Section>

      <Section title="How to ask" id="how-to-ask">
        <Steps
          items={[
            {
              lead: "Write to the Family Support Chair.",
              detail:
                "A few lines is enough. Say what has happened, what would help, and how to reach you. You do not need to make a case or send documents.",
            },
            {
              lead: "You get an acknowledgment.",
              detail: `Within ${
                OWNER ? OWNER.respondsWithin : "two business days"
              }, from the Chair, so you know it is with a person.`,
            },
            {
              lead: "The Chair comes back with what the Association can do.",
              detail:
                "Sometimes that is money. Sometimes it is a connection to an organization better placed to help. Sometimes it is neither, and you will be told that rather than left waiting.",
            },
          ]}
        />
        <p>
          You can also ask on behalf of a family who would not ask for
          themselves. Say that is what you are doing, and say whether the
          family knows you are writing.
        </p>
      </Section>

      <Section title="Who sees a request" id="who-sees-it">
        <p>
          A family-support request is the most sensitive thing this
          organization holds, and it is treated that way in the software rather
          than by good intentions.
        </p>
        <Bullets
          items={[
            "The Family Support Chair is the only office with access to these cases. Not the President, not the board, not the webmaster.",
            "The President can see counts and totals, and cannot open an individual case without a logged request that notifies the Secretary.",
            "Nothing about a request is published, and no family is named in any report, newsletter or accounts.",
            "A request is never a membership check. You do not have to be a member to write, and asking does not put anything on a membership record.",
          ]}
        />
      </Section>

      <Section title="At a glance" id="at-a-glance">
        <Facts
          rows={[
            { label: "Owning office", value: OWNER ? OWNER.role : "Family Support Chair" },
            {
              label: "Acknowledged within",
              value: OWNER ? OWNER.respondsWithin : "two business days",
            },
            { label: "Entity", value: "Joint Special Operations Association, 501(c)(19)" },
            {
              label: "Who else can see it",
              value: "No other office, without a logged and notified request",
            },
            {
              label: "Membership required",
              value: "No",
            },
          ]}
        />
      </Section>

      <Section title="Related" id="related">
        <OutboundLinks
          items={[
            {
              href: "/jsoa/contact",
              label: "Contact by office",
              note: "Every office, its remit, and its response time",
            },
            {
              href: "/jsof/scholarships",
              label: "Scholarships",
              note: "Education costs are handled by the Foundation, separately",
            },
            {
              href: "/jsoa/events",
              label: "Events",
              note: "The family events the Association funds",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
