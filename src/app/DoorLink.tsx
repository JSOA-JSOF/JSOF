"use client";

import Link from "next/link";

/**
 * A door on the front page.
 *
 * Marks that the visitor arrived through the door, so the entity home can
 * play its opening sequence. Crossing the threshold is the moment the film
 * belongs to; moving around inside the site afterwards is not.
 *
 * The flag is the only reliable signal here. `document.referrer` does not
 * change on a client-side navigation, which is exactly what a Link does, so
 * the arrival has to be recorded at the point of departure.
 */
export const FROM_DOOR_KEY = "jsoa:from-door";

export function DoorLink({
  href,
  className,
  style,
  children,
}: {
  href: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      style={style}
      onClick={() => {
        try {
          sessionStorage.setItem(FROM_DOOR_KEY, "1");
        } catch {
          // Blocked storage: the sequence simply does not play. Harmless.
        }
      }}
    >
      {children}
    </Link>
  );
}
