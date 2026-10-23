import { NextResponse, type NextRequest } from "next/server";

/**
 * Two gates, one file.
 *
 * `mvp` is the narrow one. It serves the front door, the two entity films
 * and the event drops, and sends everything else to a holding page. It
 * exists because the site is finished enough to look finished and not
 * finished enough to be read: there are tax statements waiting on counsel,
 * two mailboxes that do not answer yet, and an entity map that contradicts
 * itself at the point of payment. See docs/BOARD-REVIEW.md. Showing people
 * the film and the mission while that is true is honest. Showing them the
 * donate flow is not.
 *
 * `public-beta` is the wider one. It serves the whole public tier and gates
 * only what cannot work: the board workspaces and the application flows.
 * Six modules hold their state in `globalThis`, and on Workers an isolate
 * can be recycled between two requests. Nothing throws when that happens. A
 * volunteer would submit an application, the isolate would recycle, and the
 * application would be gone with no error anywhere. A visibly absent
 * feature reads as "not built yet", which is true. One that silently loses
 * an application reads as broken.
 *
 * The dev persona switcher is the second reason for that gate. It stands in
 * for authentication and must never be reachable from the internet.
 *
 * `live` gates nothing.
 */

const GATED = ["/board", "/apply", "/design"];

/**
 * What `mvp` serves. Everything else goes to the holding page.
 *
 * An allowlist rather than a blocklist, because the failure modes are not
 * symmetrical: a page that should be hidden and is not is the problem, and
 * a page that should be shown and is not is a sentence in a commit.
 */
const MVP_EXACT = ["/", "/jsoa", "/jsof", "/soon"];

/** Prefixes, because a drop's code is part of its path. */
const MVP_PREFIX = ["/drop", "/api/drop"];

function isOpenInMvp(pathname: string): boolean {
  // `/jsoa` is open and `/jsoa/mission` is not, so the entity roots match
  // exactly. Treating them as prefixes opened the whole tier, which is the
  // mistake this split exists to prevent.
  if (MVP_EXACT.includes(pathname)) return true;
  return MVP_PREFIX.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest) {
  // Typed as string, not as the literal in wrangler.jsonc. `wrangler
  // types` narrows STAGE to whatever is configured today, which makes
  // every comparison against the other stages look like dead code.
  const stage: string = process.env.STAGE ?? "live";
  if (stage === "live") return NextResponse.next();

  const { pathname } = request.nextUrl;

  if (stage === "mvp" && !isOpenInMvp(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/soon";
    url.search = "";
    return NextResponse.rewrite(url);
  }

  if (GATED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/not-yet";
    url.search = "";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's own assets, the files in /public, and the
  // metadata routes. The mvp gate has to see every page to hold the line,
  // so this cannot be the narrow per-prefix matcher it used to be.
  matcher: ["/((?!_next/|media/|favicon|robots\\.txt|sitemap).*)"],
};
