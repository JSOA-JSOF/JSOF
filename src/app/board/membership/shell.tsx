import Link from "next/link";

import type { Persona } from "@/lib/authz/session";

import styles from "./board.module.css";

export const BOARD_TABS = [
  { key: "overview", href: "/board/membership", label: "Overview" },
  { key: "queue", href: "/board/membership/queue", label: "Application queue" },
  { key: "exceptions", href: "/board/membership/exceptions", label: "Chair exceptions" },
  { key: "roster", href: "/board/membership/roster", label: "Roster" },
  { key: "audit", href: "/board/membership/audit", label: "30-day audit" },
  { key: "composition", href: "/board/membership/composition", label: "Composition" },
] as const;

export type BoardTab = (typeof BOARD_TABS)[number]["key"];

/**
 * Chrome for the membership pages: the module's own tabs, inside the shared
 * board shell. The role switcher and the controls findings strip belong to the
 * shell and are not repeated here.
 */
export function MembershipShell({
  current,
  children,
}: {
  current: BoardTab;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page} style={{ ["--hue" as string]: "var(--jsoa)" }}>
      <nav className={styles.nav} aria-label="Membership">
        {BOARD_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`${styles.navLink} ${tab.key === current ? styles.navHere : ""}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className={styles.body}>{children}</div>
    </div>
  );
}

/**
 * What a refused request looks like.
 *
 * It names the role and says what would have to change. A board member who
 * cannot open the roster should learn why from the page rather than from a
 * colleague, and should not be offered a way around it.
 */
export function Refused({
  persona,
  what,
  detail,
}: {
  persona: Persona;
  what: string;
  detail?: string;
}) {
  return (
    <div className={styles.refused}>
      <p className={styles.refusedTitle}>This role cannot open {what}</p>
      <p className={styles.refusedBody}>
        You are acting as <strong>{persona.label}</strong>.{persona.note ? ` ${persona.note}` : ""}{" "}
        Nothing was read and the attempt is in the audit log. If you need this, ask the
        President to change the role assignment rather than working around it.
      </p>
      {detail && <p className={styles.refusedDetail}>{detail}</p>}
    </div>
  );
}
