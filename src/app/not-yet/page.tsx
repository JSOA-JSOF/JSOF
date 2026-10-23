import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Not yet available",
  robots: { index: false, follow: false },
};

/**
 * What a gated route shows during the public beta. It says what is missing
 * and why, rather than pretending to be a 404.
 */
export default function NotYetPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "40px 24px",
        background: "#0B0A08",
        color: "#F4F1E8",
        fontFamily: '"Source Sans 3", system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: "42ch" }}>
        <p
          style={{
            fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
            fontSize: ".7rem",
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "#D9B451",
            margin: "0 0 12px",
          }}
        >
          Preview build
        </p>
        <h1
          style={{
            fontFamily: '"Barlow Semi Condensed", sans-serif',
            fontSize: "clamp(1.8rem, 5vw, 2.8rem)",
            lineHeight: 1.05,
            margin: "0 0 16px",
          }}
        >
          This part is not built yet
        </h1>
        <p style={{ color: "#CFC9BA", lineHeight: 1.6, margin: "0 0 14px" }}>
          Member sign-in, applications and the board workspaces need a
          database and real authentication, and neither is finished. Rather
          than show you screens that would lose what you typed, they are
          switched off in this preview.
        </p>
        <p style={{ color: "#8F897A", fontSize: ".92rem", lineHeight: 1.6 }}>
          Everything on the public side of the site is real and working.
        </p>
        <p style={{ marginTop: "28px" }}>
          <Link href="/" style={{ color: "#D9B451", fontWeight: 600 }}>
            Back to the start
          </Link>
        </p>
      </div>
    </main>
  );
}
