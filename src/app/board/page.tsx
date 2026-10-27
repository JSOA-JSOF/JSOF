import Link from "next/link";

import { ROLE_DEFINITIONS } from "@/lib/authz/model";
import { requireBoardViewer } from "@/lib/authz/session";
import styles from "./board.module.css";

const AREAS = [
  {
    href: "/board/membership",
    title: "Membership",
    blurb: "Application queue, exceptions, roster, the 30-day audit, composition report.",
  },
  {
    href: "/board/treasury",
    title: "Treasury",
    blurb: "Both entities side by side, ledgers, transfers, subscriptions, controls.",
  },
  {
    href: "/board/meetings",
    title: "Meetings",
    blurb: "Agendas with timings, minutes per entity, decisions, compliance calendar.",
  },
  {
    href: "/board/donations",
    title: "Donations",
    blurb: "Funds, receipts, sponsor tiers and acknowledgment wording.",
  },
  {
    href: "/board/store",
    title: "Store",
    blurb: "Orders, the member and non-member receipts split, inventory, refunds.",
  },
];

export default async function BoardHome() {
  const { subject } = await requireBoardViewer();
  const grants = subject.assignments.map((assignment) => ({
    entity: assignment.entity,
    role: assignment.role,
    definition: ROLE_DEFINITIONS[assignment.role],
  }));

  return (
    <div className={styles.home}>
      <h1>Board</h1>
      <p>
        Every screen below is scoped to what the selected role actually holds,
        per entity. Switch role in the header to see a screen refuse: that
        refusal is the product working, not a bug.
      </p>

      <div className={styles.grid}>
        {AREAS.map((area) => (
          <Link key={area.href} href={area.href} className={styles.card}>
            <h2>{area.title}</h2>
            <p>{area.blurb}</p>
          </Link>
        ))}
      </div>

      <div className={styles.grid}>
        {grants.map((grant) => (
          <div key={`${grant.entity}-${grant.role}`} className={styles.card}>
            <h2>
              {grant.role.replaceAll("_", " ").toLowerCase()} · {grant.entity}
            </h2>
            <p>
              {Object.entries(grant.definition.grants)
                .map(([dataClass, level]) => `${dataClass}: ${level}`)
                .join(" · ") || "No board data grants."}
            </p>
            {grant.definition.note ? <p>{grant.definition.note}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
