/**
 * Where the roster's search term lives between requests.
 *
 * Not the URL. A roster search term is a member's surname, and
 * `src/app/apply/draft.ts` already states the reason for the applicant side of
 * the same problem: a query string ends up in browser history, in referrers
 * and in server logs. `?q=Braddock` on a board screen is a member's name in
 * three places nobody audits, so the filter goes in a short-lived httpOnly
 * cookie and the URL stays clean.
 *
 * The consequence worth knowing: the filter is sticky for half an hour. The
 * screen renders a Clear control for that reason, and says what is applied,
 * because a filtered roster that looks like the whole roster is the one
 * failure mode here that matters — a chair who thinks somebody is not on the
 * roster when they are filtered out of view.
 */

import { cookies } from "next/headers";

import {
  EMPTY_ROSTER_FILTER,
  MEMBERSHIP_CATEGORIES,
  type MembershipCategory,
  type RosterFilter,
} from "@/lib/membership/types";
import { MEMBERSHIP_STATES, type MembershipState } from "@/lib/membership/state";

export const ROSTER_FILTER_COOKIE = "jsoa_roster_filter";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/board/membership",
  maxAge: 60 * 30,
};

export async function readRosterFilter(): Promise<RosterFilter> {
  const raw = (await cookies()).get(ROSTER_FILTER_COOKIE)?.value;
  if (!raw) return EMPTY_ROSTER_FILTER;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof RosterFilter, unknown>>;
    return {
      q: typeof parsed.q === "string" ? parsed.q.slice(0, 120) : "",
      state: asState(parsed.state),
      category: asCategory(parsed.category),
      sponsorMemberId:
        typeof parsed.sponsorMemberId === "string" && parsed.sponsorMemberId
          ? parsed.sponsorMemberId.slice(0, 20)
          : null,
    };
  } catch {
    // An unreadable cookie is an empty filter, not an error. The whole roster
    // is the safe answer: it is what the page showed before search existed.
    return EMPTY_ROSTER_FILTER;
  }
}

export async function writeRosterFilter(filter: RosterFilter): Promise<void> {
  const empty =
    !filter.q && filter.state === null && filter.category === null && !filter.sponsorMemberId;
  const store = await cookies();
  if (empty) {
    store.delete({ name: ROSTER_FILTER_COOKIE, path: COOKIE_OPTIONS.path });
    return;
  }
  store.set(ROSTER_FILTER_COOKIE, JSON.stringify(filter), COOKIE_OPTIONS);
}

function asState(value: unknown): MembershipState | null {
  return typeof value === "string" && MEMBERSHIP_STATES.includes(value as MembershipState)
    ? (value as MembershipState)
    : null;
}

function asCategory(value: unknown): MembershipCategory | null {
  return typeof value === "string" &&
    MEMBERSHIP_CATEGORIES.includes(value as MembershipCategory)
    ? (value as MembershipCategory)
    : null;
}

/** Turn a submitted form into a filter. Unknown values become null, never a throw. */
export function filterFromForm(form: FormData): RosterFilter {
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  return {
    q: text("q").slice(0, 120),
    state: asState(text("state")),
    category: asCategory(text("category")),
    sponsorMemberId: text("sponsorMemberId").toUpperCase() || null,
  };
}
