import { RoleTabs } from "@/components/workspace-shell/RoleTabs";
import type { WorkspaceTab } from "@/lib/workspace/types";

import styles from "./board.module.css";

/**
 * The membership module's own work, appended after the spine.
 *
 * These five kept their routes when the workspace was built on top of them.
 * The spine's five tabs are new screens; nothing that already worked moved or
 * changed address, because a bookmark a volunteer has is a thing to keep.
 */
export const FUNCTION_TABS = [
  { href: "/board/membership/queue", label: "Application queue" },
  { href: "/board/membership/exceptions", label: "Chair exceptions" },
  { href: "/board/membership/roster", label: "Roster" },
  { href: "/board/membership/audit", label: "30-day audit" },
  { href: "/board/membership/composition", label: "Composition" },
];

/**
 * Chrome for the membership pages: the shared role-workspace tab strip, inside
 * the shared board shell. The tab strip itself is `@/components/workspace-shell`
 * and is not reimplemented here — six roles rendering six slightly different
 * tab strips is how a platform stops being one platform.
 *
 * The role switcher and the controls findings strip belong to the board shell
 * and are not repeated.
 */
export function MembershipShell({
  current,
  children,
}: {
  /** A spine tab, or the href of one of the function tabs. */
  current: WorkspaceTab | string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.page} style={{ ["--hue" as string]: "var(--jsoa)" }}>
      <div className={styles.body}>
        <RoleTabs base="/board/membership" current={current} functionTabs={FUNCTION_TABS} />
        {children}
      </div>
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
  viewerLabel,
  what,
  detail,
}: {
  /** Who the page says is looking. A string, so a real session and the
   * dev persona both produce one. */
  viewerLabel: string;
  what: string;
  detail?: string;
}) {
  return (
    <div className={styles.refused}>
      <p className={styles.refusedTitle}>This role cannot open {what}</p>
      <p className={styles.refusedBody}>
        You are acting as <strong>{viewerLabel}</strong>.{" "}
        Nothing was read and the attempt is in the audit log. If you need this, ask the
        President to change the role assignment rather than working around it.
      </p>
      {detail && <p className={styles.refusedDetail}>{detail}</p>}
    </div>
  );
}
