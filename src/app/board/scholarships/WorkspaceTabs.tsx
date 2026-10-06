"use client";

import { usePathname } from "next/navigation";

import { RoleTabs } from "@/components/workspace-shell/RoleTabs";
import { WORKSPACE_TABS, type WorkspaceTab } from "@/lib/workspace/types";

/**
 * The spine, rendered once in the layout so every tab in this workspace shows
 * it — including the five function tabs, which keep their own routes and
 * needed no edit to acquire it.
 *
 * A client component for exactly one reason: `RoleTabs` needs to know which
 * tab is current, and a server layout cannot see the path. It renders the
 * shared `RoleTabs` and holds no markup of its own, so there is still one tab
 * strip in the codebase.
 */

const BASE = "/board/scholarships";

/** The role's own work, appended after the spine. Routes unchanged. */
const FUNCTION_TABS = [
  { href: `${BASE}/review`, label: "Review" },
  { href: `${BASE}/verify`, label: "Verify" },
  { href: `${BASE}/awards`, label: "Awards" },
  { href: `${BASE}/notify`, label: "Notify" },
  { href: `${BASE}/disbursement`, label: "Disbursement" },
];

function currentTab(pathname: string): WorkspaceTab | string {
  if (pathname === BASE || pathname === `${BASE}/`) return "overview";
  const rest = pathname.slice(BASE.length + 1).split("/")[0];
  if ((WORKSPACE_TABS as readonly string[]).includes(rest)) return rest as WorkspaceTab;
  // A function tab matches on its href, which is how RoleTabs compares them.
  return `${BASE}/${rest}`;
}

export function WorkspaceTabs() {
  const pathname = usePathname() ?? BASE;
  return (
    <RoleTabs base={BASE} current={currentTab(pathname)} functionTabs={FUNCTION_TABS} />
  );
}
