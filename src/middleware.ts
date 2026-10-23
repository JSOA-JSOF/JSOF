import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the unfinished half of the platform out of a public deployment.
 *
 * The public tier is content and deploys honestly. The board workspaces and
 * the application flows are not deployable yet: six modules hold their state
 * in `globalThis`, and on Workers an isolate can be recycled between two
 * requests. Nothing throws when that happens. A volunteer would submit an
 * application, the isolate would recycle, and the application would be gone
 * with no error anywhere.
 *
 * A visibly absent feature reads as "not built yet", which is true. One that
 * silently loses an application reads as broken, and costs more trust than it
 * saves. So while STAGE is anything other than "live", these routes say so
 * rather than half-working.
 *
 * The dev persona switcher is the second reason. It stands in for
 * authentication and must never be reachable from the internet.
 */

const GATED = ["/board", "/apply", "/design"];

export function middleware(request: NextRequest) {
  const stage = process.env.STAGE ?? "live";
  if (stage === "live") return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (GATED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/not-yet";
    url.search = "";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/board/:path*", "/apply/:path*", "/design/:path*"],
};
