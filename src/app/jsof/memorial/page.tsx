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
  title: "Memorial and pavers · JSOF",
  description:
    "The memorial recognizing members of the JSOC community who died in " +
    "service, and the paver plaza around it. What the memorial is, the phases " +
    "planned, and how a paver is dedicated.",
  alternates: { canonical: "/jsof/memorial" },
};

const MEMORIAL_CHAIR = contactBySlug("JSOF", "memorial-chair");

export default function MemorialPage() {
  return (
    <PublicShell
      entity="JSOF"
      currentPath="/jsof/memorial"
      crumbs={[{ href: "/jsof/memorial", label: "Memorial" }]}
    >
      <PageHead
        eyebrow="Memorial"
        title="The memorial and the paver plaza"
        lede={
          "Recognizing those who have given their lives in defense of the " +
          "Nation is the first of the organization's three lines of effort. " +
          "The memorial is the physical form of it."
        }
      />

      <Section title="What it is" id="what-it-is">
        <p>
          A memorial to members of the JSOC community who died in service,
          with a plaza of inscribed pavers around it. The first phase is
          dedicated. It was built with the support of the command&rsquo;s
          leadership and of donors who paid for it without being asked twice.
        </p>
        <p>
          It is deliberately not finished. Later phases are planned to take in
          people the first phase could not, and each phase is funded before it
          is begun rather than announced and then hoped for.
        </p>
        <Bullets
          items={[
            "Enabling forces, whose losses belong on it and are easily left off.",
            "International partners who died alongside the command.",
            "Military working dogs.",
            "Members of the command who died from causes other than combat while assigned to it.",
          ]}
        />
        <p>
          That last category matters more than its position in a list
          suggests. A death that was not in combat is still a death on
          assignment, and families in that position are used to being left out
          of the recognition.
        </p>
      </Section>

      <Callout title="What this page does not publish" marker="By design">
        <p>
          There is no roll of names here, and no register of paver
          inscriptions. Publishing a searchable list of the fallen and their
          families, against a command, is not ours to do on a public website,
          and consent from one family is not consent from another.
        </p>
        <p>
          The plaza&rsquo;s location and access arrangements are also not
          published. If you are visiting, write to the Memorial Chair and it
          will be arranged with you directly.
        </p>
      </Callout>

      <Section title="Dedicating a paver" id="pavers">
        <p>
          A paver in the plaza can be dedicated in two ways: to commemorate
          your own service with the command, or to memorialize someone who was
          lost. Both carry an inscription, and the inscription is the part that
          takes care.
        </p>
        <Steps
          items={[
            {
              lead: "Choose what the paver is for.",
              detail:
                "Your own service, or a dedication to someone else. If it is a dedication to someone who was lost, say so at the start, because those are handled differently.",
            },
            {
              lead: "Draft the inscription.",
              detail:
                "There is a character limit set by the paver itself. The Memorial Chair will tell you what will fit and will show you the layout before anything is cut.",
            },
            {
              lead: "A person reviews it.",
              detail:
                "Every inscription is read and approved by the Memorial Chair, and an inscription naming a fallen service member needs a second approver as well. Nothing about the fallen is approved by one pair of eyes, and nothing is approved by the person who wrote it.",
            },
            {
              lead: "It is cut and laid with the next batch.",
              detail:
                "Pavers are laid in batches rather than one at a time. The Memorial Chair will tell you which batch yours is in.",
            },
          ]}
        />
        <p>
          A dedication for a fallen service member is confirmed with the
          family first. If you are not the family, that step is not a
          formality and it is not something the Foundation will skip because
          the intention is a good one.
        </p>
      </Section>

      <Section title="At a glance" id="at-a-glance">
        <Facts
          rows={[
            { label: "Owning office", value: MEMORIAL_CHAIR ? MEMORIAL_CHAIR.role : "Memorial Chair" },
            {
              label: "Replies within",
              value: MEMORIAL_CHAIR ? MEMORIAL_CHAIR.respondsWithin : "three business days",
            },
            { label: "Entity", value: "Joint Special Operations Foundation, 501(c)(3)" },
            { label: "Gift", value: "Deductible. A paver may be funded as a restricted gift." },
            { label: "Paver cost", value: "To be confirmed. Ask the Memorial Chair." },
            { label: "Inscription approval", value: "Two approvers where a fallen service member is named." },
            { label: "Published roll of names", value: "None." },
          ]}
        />
      </Section>

      <Section title="How to start" id="how-to-start">
        <p>
          Write to the Memorial Chair. If that mailbox is not yet routed, write
          to <a href={`mailto:${SECRETARY_MAILBOX}`}>{SECRETARY_MAILBOX}</a>{" "}
          and ask for the Memorial Chair.
        </p>
        <OutboundLinks
          items={[
            {
              href: "/jsof/contact",
              label: "Contact the Memorial Chair",
              note: "Pavers, inscriptions, and visiting",
            },
            {
              href: "/donate",
              label: "Give to the memorial fund",
              note: "A gift can be restricted to the memorial",
            },
            {
              href: "/jsoa/mission",
              label: "The three lines of effort",
              note: "Where the memorial sits in the mission",
            },
          ]}
        />
      </Section>
    </PublicShell>
  );
}
