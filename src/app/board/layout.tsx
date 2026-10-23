import Link from "next/link";

import { findingsFor, getCurrentPersona, PERSONAS, subjectFor } from "@/lib/authz/session";
import styles from "./board.module.css";
import { RoleSwitcher } from "./RoleSwitcher";

export const metadata = {
  title: "Board — JSOA / JSOF",
  // Nothing behind the board shell is ever indexed.
  robots: { index: false, follow: false },
};

/**
 * Never prerendered.
 *
 * Every board screen is a function of who is signed in, so there is no such
 * thing as a correct static version of one. Next tried to build them anyway
 * and ran straight into `assertDevOnly()`, which refuses to let the dev
 * persona switcher into a production build. That guard is right and stays:
 * the fix is to stop asking for a static render, not to weaken it.
 *
 * At runtime these routes are rewritten to /not-yet by src/middleware.ts for
 * as long as STAGE is not "live", so this code does not execute in the
 * preview at all. If the middleware were ever removed, the guard would still
 * throw rather than serve a screen with fake authentication, which is the
 * right way round to fail.
 */
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/board", label: "Overview" },
  { href: "/board/membership", label: "Membership" },
  { href: "/board/scholarships", label: "Scholarships" },
  { href: "/board/treasury", label: "Treasury" },
  { href: "/board/meetings", label: "Meetings" },
  { href: "/board/donations", label: "Donations" },
  { href: "/board/store", label: "Store" },
];

export default async function BoardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const persona = await getCurrentPersona();
  const findings = findingsFor(subjectFor(persona));

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link href="/" className={styles.brand}>
          JSOA / JSOF <span>· board</span>
        </Link>
        <nav className={styles.nav}>
          {NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <RoleSwitcher
          personas={PERSONAS.map(({ id, label, note }) => ({ id, label, note }))}
          currentId={persona.id}
        />
      </header>

      <div className={styles.devStrip}>
        <strong>Demo</strong>
        <span>
          No authentication yet, and no live member data. The role switcher above
          stands in for sign-in so each screen can be checked against the
          permissions it will really have.
        </span>
      </div>

      {findings.length > 0 ? (
        <div className={styles.findings}>
          {findings.map((finding, index) => (
            <p key={index} className={styles.finding}>
              <span
                className={`${styles.sev} ${
                  finding.severity === "critical" ? styles.critical : styles.high
                }`}
              >
                {finding.severity}
              </span>
              <span>
                {finding.finding} <em>{finding.mitigation}</em>
              </span>
            </p>
          ))}
        </div>
      ) : null}

      <div className={styles.body}>{children}</div>
    </div>
  );
}
