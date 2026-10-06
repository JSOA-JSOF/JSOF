import Link from "next/link";

import { Showcase } from "./Showcase";

export const metadata = {
  title: "Scholarships workspace — design",
  robots: { index: false, follow: false },
};

export default function WorkspaceDesignPage() {
  return (
    <div
      style={{
        maxWidth: 940,
        margin: "0 auto",
        padding: "32px 24px 80px",
      }}
    >
      <p style={{ margin: "0 0 6px" }}>
        <Link href="/board" style={{ color: "var(--mute)", fontSize: ".85rem" }}>
          ← Board
        </Link>
      </p>
      <h1
        style={{
          fontFamily: '"Barlow Semi Condensed", sans-serif',
          fontSize: "clamp(1.7rem, 3.4vw, 2.3rem)",
          fontWeight: 700,
          lineHeight: 1.05,
          margin: "0 0 10px",
        }}
      >
        The Scholarships Chair&rsquo;s workspace
      </h1>
      <p
        style={{
          color: "var(--ink-2)",
          maxWidth: "66ch",
          margin: "0 0 10px",
        }}
      >
        One volunteer, 150 applications, 183 awards, about 40 hours a month from
        January to June. These three screens are the shape of that work: scoring
        a queue, setting the money, and the 183 messages she currently types by
        hand. The reasoning behind each decision is in{" "}
        <code style={{ fontSize: ".9em" }}>docs/WORKSPACE-DESIGN.md</code>.
      </p>
      <p
        style={{
          color: "var(--mute)",
          fontSize: ".86rem",
          maxWidth: "66ch",
          margin: "0 0 28px",
        }}
      >
        Names, schools and figures are fictional. The counts mirror the real
        cycle, so the screens show the density she actually faces.
      </p>

      <Showcase />
    </div>
  );
}
