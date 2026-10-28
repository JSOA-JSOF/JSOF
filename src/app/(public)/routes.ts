import { EVENTS } from "./events";
import { SCHOLARSHIP_PROGRAMS } from "./scholarships";

/**
 * Every public URL, in one place.
 *
 * It exists because the sitemap kept being the thing nobody updated.
 * Deriving it from the registries that already drive the pages means a
 * programme or an event added to its own module appears here without
 * anybody remembering, and a test holds that the static list matches
 * the routes on disk.
 *
 * What is deliberately absent: /sign-in, /apply, /board, /drop and the
 * holding pages. A sitemap is a list of pages we want found. The drop
 * pages in particular are reached by scanning a code on a sign and
 * carry a noindex header, so listing them would undo the one thing
 * that keeps them unlisted.
 */

/** Pages that exist whatever is in the registries. */
export const STATIC_PUBLIC_ROUTES = [
  "/",
  "/jsoa",
  "/jsoa/mission",
  "/jsoa/events",
  "/jsoa/membership",
  "/jsoa/scholarships",
  "/jsoa/family-support",
  "/jsoa/contact",
  "/jsof",
  "/jsof/mission",
  "/jsof/events",
  "/jsof/scholarships",
  "/jsof/memorial",
  "/jsof/sponsors",
  "/jsof/partners",
  "/jsof/why-the-foundation",
  "/jsof/contact",
  "/donate",
  "/donate/sponsor",
  "/store",
] as const;

/** Every public URL, static and generated. */
export function publicRoutes(): string[] {
  return [
    ...STATIC_PUBLIC_ROUTES,
    ...EVENTS.map((event) => `/jsoa/events/${event.slug}`),
    ...SCHOLARSHIP_PROGRAMS.map((p) => `/jsof/scholarships/${p.slug}`),
  ];
}

/**
 * How often each is worth recrawling.
 *
 * Honest rather than optimistic. Telling a crawler a page changes
 * daily when it changes twice a year wastes its budget and ours, and
 * the ones that genuinely move are the event and sponsor pages.
 */
export function changeFrequency(route: string): "weekly" | "monthly" | "yearly" {
  if (route.includes("/events") || route === "/jsof/sponsors") return "weekly";
  if (route === "/" || route.endsWith("/jsoa") || route.endsWith("/jsof")) return "monthly";
  return "yearly";
}
