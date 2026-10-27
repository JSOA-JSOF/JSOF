import { redirect } from "next/navigation";

import { signInWithToken } from "@/lib/auth/actions";

/**
 * Where a sign-in link lands.
 *
 * A GET, because it is clicked from a mail client, and that is the one
 * uncomfortable part of magic links: a link-prefetching mailbox can
 * spend the token before the person clicks. The token is single use, so
 * the cost is a dead link and another request rather than an opening,
 * and the session cookie is only set on a request that carries it back.
 *
 * The token never reaches a page: this handler consumes it and
 * redirects, so it does not sit in the address bar, in history, or in
 * a referrer header.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const outcome = token ? await signInWithToken(token) : "bad";
  redirect(outcome === "ok" ? "/sign-in/verify" : "/sign-in?expired=1");
}
