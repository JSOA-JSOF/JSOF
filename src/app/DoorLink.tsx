"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * A door on the front page.
 *
 * Two jobs, both of which need the client.
 *
 * **It records the crossing.** The entity home plays its opening sequence
 * only for someone arriving through a door, and `document.referrer` cannot
 * tell it that: the referrer does not change on a client-side navigation,
 * which is what a Link performs. So the arrival is noted at the point of
 * departure.
 *
 * **It stands in for hover on a touch screen.** The doors are grey until
 * pointed at, which is the whole gesture, and a phone has no pointer. The
 * half you have scrolled to is the one you are looking at, so that is what
 * wakes it. Desktop still uses real hover and never consults this.
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
  const ref = useRef<HTMLAnchorElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only on a touch screen. On a pointer device hover is the real signal
    // and an observer fighting it would make both halves live at once.
    if (!window.matchMedia("(hover: none)").matches) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer: fall back to colour rather than leaving it grey for good.
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      // Most of the half has to be on screen, and the band is narrowed so the
      // two stacked doors cannot both qualify at once.
      { threshold: 0.55, rootMargin: "-18% 0px -18% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Link
      ref={ref}
      href={href}
      className={className}
      style={style}
      data-inview={inView ? "true" : "false"}
      onClick={() => {
        try {
          sessionStorage.setItem(FROM_DOOR_KEY, "1");
        } catch {
          // Blocked storage: the sequence does not play. Harmless.
        }
      }}
    >
      {children}
    </Link>
  );
}
