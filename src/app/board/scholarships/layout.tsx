import type { CSSProperties } from "react";

import { WorkspaceTabs } from "./WorkspaceTabs";

/**
 * The Scholarships Chair's workspace shell.
 *
 * Holds two things and nothing else: the entity hue, set once so no screen
 * beneath it names a colour, and the tab spine from
 * docs/ROLE-WORKSPACE.md — Overview, Dashboard, Planning, Projects, Outside
 * view, then this role's five function tabs.
 */

const HUE: CSSProperties = {
  ["--hue" as string]: "var(--jsof)",
  ["--hueTint" as string]: "var(--jsof-tint)",
};

export default function ScholarshipsWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={HUE}>
      <WorkspaceTabs />
      {children}
    </div>
  );
}
