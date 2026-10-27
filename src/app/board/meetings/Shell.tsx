import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { RoleTabs } from "@/components/workspace-shell/RoleTabs";
import type { Entity } from "@/lib/authz/model";
import { ENTITY_LONG_NAME, ENTITY_SUBSECTION } from "@/lib/meetings/distribution";
import { WORKSPACE_TABS, type WorkspaceTab } from "@/lib/workspace/types";
import styles from "./meetings.module.css";

/**
 * The shell every Secretary page sits in. Entity is set here as `--hue` and
 * `--hueTint` on the outer wrapper so no page beneath ever names a colour, and
 * so the entity is visible from any screenshot of any page in the module.
 *
 * The tab strip is the shared `RoleTabs` from the workspace spine, not this
 * module's own nav: five spine tabs, then this office's function tabs. See
 * `docs/ROLE-WORKSPACE.md`. The function tabs kept the routes they already
 * had, so every link anywhere else in the platform still lands.
 */

export function hueFor(entity: Entity | null): CSSProperties {
  if (!entity) return {} as CSSProperties;
  return {
    ["--hue" as string]: `var(--${entity.toLowerCase()})`,
    ["--hueTint" as string]: `var(--${entity.toLowerCase()}-tint)`,
  } as CSSProperties;
}

export const WORKSPACE_BASE = "/board/meetings";

/** A spine tab, or one of this office's function tabs. */
export type NavKey =
  | WorkspaceTab
  | "agenda"
  | "distribute"
  | "minutes"
  | "transcript"
  | "decisions"
  | "calendar";

type FunctionKey = Exclude<NavKey, WorkspaceTab>;

/**
 * The function tabs, with the routes they already had. The per-meeting four
 * only appear once a meeting is in hand — a link to another meeting's agenda
 * from a list of meetings is not a tab.
 */
function functionTabsFor(
  meetingId: string | null,
): { key: FunctionKey; href: string; label: string }[] {
  const perMeeting: { key: FunctionKey; href: string; label: string }[] = meetingId
    ? [
        { key: "agenda", href: `${WORKSPACE_BASE}/${meetingId}/agenda`, label: "Agenda" },
        {
          key: "distribute",
          href: `${WORKSPACE_BASE}/${meetingId}/distribute`,
          label: "Send agenda",
        },
        { key: "minutes", href: `${WORKSPACE_BASE}/${meetingId}/minutes`, label: "Minutes" },
        {
          key: "transcript",
          href: `${WORKSPACE_BASE}/${meetingId}/transcript`,
          label: "Transcript",
        },
      ]
    : [];
  return [
    ...perMeeting,
    { key: "decisions", href: `${WORKSPACE_BASE}/decisions`, label: "Decisions" },
    { key: "calendar", href: `${WORKSPACE_BASE}/calendar`, label: "Compliance" },
  ];
}

function isSpineTab(key: NavKey): key is WorkspaceTab {
  return (WORKSPACE_TABS as readonly string[]).includes(key);
}

export function EntityBanner({ entity }: { entity: Entity }) {
  const other: Entity = entity === "JSOA" ? "JSOF" : "JSOA";
  return (
    <div className={styles.entityBanner}>
      <div className={styles.entityBannerName}>
        {ENTITY_LONG_NAME[entity]} &middot; {entity} &middot; {ENTITY_SUBSECTION[entity]}
      </div>
      <p className={styles.entityBannerNote}>
        This is the {entity} board&apos;s book. Business of {other} is not before
        this board, is not minuted here, and is not counted with anything here,
        whatever else is on the calendar for the same evening.
      </p>
    </div>
  );
}

export function Shell({
  entity,
  meetingId,
  active,
  viewerLabel,
  children,
}: {
  entity: Entity | null;
  meetingId: string | null;
  active: NavKey;
  /** Who the corner says is looking. A string, so it works for a
   * real session and for the dev persona alike. */
  viewerLabel: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.page} style={hueFor(entity)}>
      <header className={styles.bar}>
        <div className={styles.barLeft}>
          <Link href="/" className={styles.back}>
            &larr; Both entities
          </Link>
          <span className={styles.entityMark}>
            Board &middot; Secretary
            {entity ? ` · ${entity}` : ""}
          </span>
        </div>
        <span className={styles.rowMeta}>Viewing as {viewerLabel}</span>
      </header>

      <div className={styles.tabStrip}>
        <RoleTabs
          base={WORKSPACE_BASE}
          current={
            isSpineTab(active)
              ? active
              : (functionTabsFor(meetingId).find((tab) => tab.key === active)?.href ?? active)
          }
          functionTabs={functionTabsFor(meetingId).map(({ href, label }) => ({ href, label }))}
        />
      </div>

      <div className={styles.body}>{children}</div>
    </div>
  );
}

export function Refused({ reason }: { reason: string }) {
  return (
    <div className={styles.refused}>
      <div className={styles.eyebrow}>Refused</div>
      <p className={styles.rowNote}>{reason}</p>
      <p className={styles.rowNote}>
        Nothing was read and nothing was written. Use the role switcher in the
        board header if you are walking the demo.
      </p>
    </div>
  );
}

export { styles as shellStyles };
