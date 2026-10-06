import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import type { Entity } from "@/lib/authz/model";
import type { Persona } from "@/lib/authz/session";
import { ENTITY_LONG_NAME, ENTITY_SUBSECTION } from "@/lib/meetings/distribution";
import styles from "./meetings.module.css";

/**
 * The shell every Secretary page sits in. Entity is set here as `--hue` and
 * `--hueTint` on the outer wrapper so no page beneath ever names a colour, and
 * so the entity is visible from any screenshot of any page in the module.
 */

export function hueFor(entity: Entity | null): CSSProperties {
  if (!entity) return {} as CSSProperties;
  return {
    ["--hue" as string]: `var(--${entity.toLowerCase()})`,
    ["--hueTint" as string]: `var(--${entity.toLowerCase()}-tint)`,
  } as CSSProperties;
}

export type NavKey =
  | "meetings"
  | "agenda"
  | "distribute"
  | "minutes"
  | "transcript"
  | "decisions"
  | "calendar";

function navFor(meetingId: string | null): { key: NavKey; href: string; label: string }[] {
  const base = [
    { key: "meetings" as NavKey, href: "/board/meetings", label: "Meetings" },
  ];
  const perMeeting = meetingId
    ? [
        { key: "agenda" as NavKey, href: `/board/meetings/${meetingId}/agenda`, label: "Agenda" },
        {
          key: "distribute" as NavKey,
          href: `/board/meetings/${meetingId}/distribute`,
          label: "Send agenda",
        },
        { key: "minutes" as NavKey, href: `/board/meetings/${meetingId}/minutes`, label: "Minutes" },
        {
          key: "transcript" as NavKey,
          href: `/board/meetings/${meetingId}/transcript`,
          label: "Transcript",
        },
      ]
    : [];
  return [
    ...base,
    ...perMeeting,
    { key: "decisions" as NavKey, href: "/board/meetings/decisions", label: "Decisions" },
    { key: "calendar" as NavKey, href: "/board/meetings/calendar", label: "Compliance" },
  ];
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
  persona,
  children,
}: {
  entity: Entity | null;
  meetingId: string | null;
  active: NavKey;
  persona: Persona;
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
        <span className={styles.rowMeta}>Viewing as {persona.label}</span>
      </header>

      <nav className={styles.nav}>
        {navFor(meetingId).map((link) => (
          <Link
            key={link.key}
            href={link.href}
            className={`${styles.navLink} ${link.key === active ? styles.navLinkActive : ""}`}
          >
            {link.label}
          </Link>
        ))}
      </nav>

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
