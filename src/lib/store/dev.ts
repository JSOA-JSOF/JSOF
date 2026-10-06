/**
 * The dev-only viewer switcher for the storefront.
 *
 * Board-side subjects come from the shared dev persona switcher in
 * `@/lib/authz/session`, which is the platform's single stand-in for sign-in.
 * What that switcher cannot express is the STOREFRONT side of the question:
 * whether the person looking at the catalogue is a visitor, a member in good
 * standing, a probationary member, or somebody whose membership has lapsed.
 * Membership state is not a board role, so it needs its own switcher, and this
 * is it.
 *
 * It is not an auth system and is not pretending to be one. It is keyed by a
 * query parameter, which is safe only because the whole thing is a demo with
 * fictional data, and it must not survive contact with real records.
 */

import type { MembershipState } from "../membership/state";

import type { CatalogueViewer } from "./catalogue";

/* ------------------------------------------------------------------ *
 * Store-front viewers. A buyer is not a board subject.
 * ------------------------------------------------------------------ */

export type DevViewerOption = {
  key: string;
  label: string;
  note: string;
  viewer: CatalogueViewer;
};

function memberViewer(
  personId: string,
  memberId: string,
  membershipState: MembershipState,
): CatalogueViewer {
  return { kind: "member", personId, memberId, membershipState };
}

export const DEV_VIEWERS: DevViewerOption[] = [
  {
    key: "visitor",
    label: "Visitor",
    note: "Not signed in. Public catalogue only.",
    viewer: { kind: "visitor" },
  },
  {
    key: "good-standing",
    label: "Member, good standing",
    note: "Full catalogue and seasonal collections.",
    viewer: memberViewer("p-mem-1", "JSOA-2019-0114", "GOOD_STANDING"),
  },
  {
    key: "probationary",
    label: "Member, probationary",
    note: "Identical access to good standing. The audit is a check on the record.",
    viewer: memberViewer("p-mem-2", "JSOA-2026-0031", "PROBATIONARY"),
  },
  {
    key: "lapsed",
    label: "Former member, lapsed",
    note: "No member access. Buys as a non-member from today on.",
    viewer: memberViewer("p-mem-3", "JSOA-2015-0088", "LAPSED"),
  },
  {
    key: "awaiting-payment",
    label: "Applicant, awaiting payment",
    note: "Vouched but has not paid. No member access yet.",
    viewer: memberViewer("p-app-1", "JSOA-2026-0142", "AWAITING_PAYMENT"),
  },
];

export const DEFAULT_DEV_VIEWER_KEY = "visitor";

export function resolveDevViewer(key: string | null | undefined): DevViewerOption {
  const found = DEV_VIEWERS.find((o) => o.key === key);
  if (found) return found;
  const fallback = DEV_VIEWERS.find((o) => o.key === DEFAULT_DEV_VIEWER_KEY);
  if (!fallback) throw new Error("No default dev viewer");
  return fallback;
}

export const DEV_SWITCHER_WARNING =
  "Development affordance. There is no sign-in behind this yet, so the role " +
  "and the membership state are chosen from a list. Nothing here is a real " +
  "session and none of the data is real.";
