/**
 * One register of lines of effort, for the whole organization.
 *
 * Deliberately not per-role. Most of this work crosses roles — the Ball is
 * Events plus Fundraising plus Treasury plus Communications — and a per-role
 * store would hide exactly the handoffs where this organization loses things.
 * A role's Projects tab is a FILTER over this, never a copy.
 *
 * The three top-level lines of effort are the organization's own, published on
 * its site: memorialize the fallen, scholarships and grants for JSOC families,
 * and support JSOC family events.
 */

import type { Entity, Role } from "../authz/model";

export const LINE_OF_EFFORT_KEYS = ["MEMORIAL", "SCHOLARSHIPS", "FAMILY_EVENTS"] as const;
export type LineOfEffortKey = (typeof LINE_OF_EFFORT_KEYS)[number];

export const LINES_OF_EFFORT: Record<LineOfEffortKey, { title: string; carriedBy: Entity }> = {
  MEMORIAL: { title: "Memorialize the fallen", carriedBy: "JSOF" },
  SCHOLARSHIPS: { title: "Scholarships and grants for JSOC families", carriedBy: "JSOF" },
  FAMILY_EVENTS: { title: "Support JSOC family events", carriedBy: "JSOA" },
};

export type ProjectStatus = "PLANNED" | "ACTIVE" | "BLOCKED" | "DONE";

export type Project = {
  id: string;
  title: string;
  lineOfEffort: LineOfEffortKey;
  entity: Entity;
  status: ProjectStatus;
  /** The one role accountable. Never a name. */
  ownerRole: Role;
  /** Roles that hold a part of it. This is where handoffs live. */
  contributorRoles: Role[];
  /** One sentence: what done looks like. */
  outcome: string;
  /** ISO date, or null where nobody has set one. A null is not a failure. */
  targetDate: string | null;
  /** Why it is blocked, when it is. */
  blockedBy?: string;
};

/**
 * Seeded from what the board is actually doing, including the parts that are
 * stuck. A register showing only healthy work is a register nobody checks.
 */
export const PROJECTS: Project[] = [
  {
    id: "prj-scholarship-cycle",
    title: "Run the 2027 scholarship cycle on the platform",
    lineOfEffort: "SCHOLARSHIPS",
    entity: "JSOF",
    status: "ACTIVE",
    ownerRole: "SCHOLARSHIPS_CHAIR",
    contributorRoles: ["TREASURER", "VP_MEMBERSHIP"],
    outcome:
      "Applications, scoring, awards and cheques run end to end without an " +
      "email thread, and every applicant hears an outcome.",
    targetDate: "2026-12-15",
  },
  {
    id: "prj-eligibility-rule",
    title: "Settle the scholarship eligibility rule with counsel",
    lineOfEffort: "SCHOLARSHIPS",
    entity: "JSOF",
    status: "BLOCKED",
    ownerRole: "PRESIDENT",
    contributorRoles: ["SCHOLARSHIPS_CHAIR"],
    outcome:
      "A published eligibility rule that defines the class by service " +
      "connection rather than by dues status.",
    targetDate: null,
    blockedBy:
      "With counsel. Restricting awards to dependents of dues-paying members " +
      "is the pattern the IRS uses to deny or revoke exemption.",
  },
  {
    id: "prj-wounded-patriot-amount",
    title: "Confirm the Wounded Patriot award amount",
    lineOfEffort: "SCHOLARSHIPS",
    entity: "JSOF",
    status: "BLOCKED",
    ownerRole: "SCHOLARSHIPS_CHAIR",
    contributorRoles: ["TREASURER"],
    outcome: "The flat award amount is a confirmed figure rather than a placeholder.",
    targetDate: "2026-12-01",
    blockedBy:
      "Never supplied. It now propagates into the cumulative totals as well " +
      "as the notifications.",
  },
  {
    id: "prj-memorial-pavers",
    title: "Paver dedications and the memorial plaza",
    lineOfEffort: "MEMORIAL",
    entity: "JSOF",
    status: "ACTIVE",
    ownerRole: "MEMORIAL_CHAIR",
    contributorRoles: ["TREASURER", "COMMUNICATIONS_CHAIR"],
    outcome: "A dedication can be ordered, approved, cut and acknowledged without email.",
    targetDate: null,
  },
  {
    id: "prj-ball",
    title: "The JSOC Ball",
    lineOfEffort: "FAMILY_EVENTS",
    entity: "JSOA",
    status: "PLANNED",
    ownerRole: "EVENTS_CHAIR",
    contributorRoles: [
      "VP_OPERATIONS",
      "FUNDRAISING_CHAIR",
      "TREASURER",
      "COMMUNICATIONS_CHAIR",
    ],
    outcome:
      "Tickets sold with the donation portion stated separately, sponsors " +
      "acknowledged in approved wording, and the cash counted by two people.",
    targetDate: null,
  },
  {
    id: "prj-golf",
    title: "The golf tournament",
    lineOfEffort: "FAMILY_EVENTS",
    entity: "JSOA",
    status: "PLANNED",
    ownerRole: "EVENTS_CHAIR",
    contributorRoles: ["FUNDRAISING_CHAIR", "TREASURER", "STORE_CHAIR"],
    outcome:
      "Entry fees priced apart from merchandise so bundling does not pull " +
      "them into sales tax, and volunteer hours recorded as they happen.",
    targetDate: null,
  },
  {
    id: "prj-sponsor-ladder",
    title: "Publish a sponsor ladder",
    lineOfEffort: "FAMILY_EVENTS",
    entity: "JSOF",
    status: "PLANNED",
    ownerRole: "FUNDRAISING_CHAIR",
    contributorRoles: ["PRESIDENT", "TREASURER", "COMMUNICATIONS_CHAIR"],
    outcome:
      "A published ladder with logo credit, benefit values recorded against " +
      "each tier, and a become-a-sponsor path that currently does not exist.",
    targetDate: null,
  },
  {
    id: "prj-account-ownership",
    title: "Move every account to organizational ownership",
    lineOfEffort: "FAMILY_EVENTS",
    entity: "JSOA",
    status: "BLOCKED",
    ownerRole: "PRESIDENT",
    contributorRoles: ["WEBMASTER", "TREASURER", "SECRETARY"],
    outcome:
      "Every account org-owned with a named second administrator, so a board " +
      "turnover loses nothing.",
    targetDate: null,
    blockedBy:
      "The website is owned by an individual no longer involved with the " +
      "organization. Nothing else can be sequenced until that is resolved.",
  },
];

export function projectsForRole(role: Role): { owned: Project[]; contributing: Project[] } {
  return {
    owned: PROJECTS.filter((project) => project.ownerRole === role),
    contributing: PROJECTS.filter((project) => project.contributorRoles.includes(role)),
  };
}

export function projectById(id: string): Project | undefined {
  return PROJECTS.find((project) => project.id === id);
}
