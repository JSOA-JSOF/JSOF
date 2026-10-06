import Link from "next/link";

import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { loadCycleOverview } from "@/lib/scholarships/board";
import { ELIGIBILITY_RULE, eligibilityIsPlaceholder } from "@/lib/scholarships/eligibility";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { WOUNDED_PATRIOT } from "@/lib/scholarships/scoring";
import { formatCents } from "@/components/workspace/types";
import styles from "@/components/workspace/workspace.module.css";

export const metadata = {
  title: "Scholarships",
  robots: { index: false, follow: false },
};

const AREAS = [
  {
    href: "/board/scholarships/review",
    title: "Review",
    blurb: "One application at a time, with your calibration against the committee.",
  },
  {
    href: "/board/scholarships/awards",
    title: "Awards",
    blurb: "Banding, and the exceptions a rule should not decide.",
  },
];

export default async function ScholarshipsHome() {
  const subject = await getCurrentSubject();

  let overview: Awaited<ReturnType<typeof loadCycleOverview>> | null = null;
  let denial: string | null = null;
  try {
    overview = await loadCycleOverview(scholarshipRepository(), subject);
  } catch (error) {
    denial = error instanceof AuthzError ? error.message : String(error);
  }

  return (
    <div className={styles.shell}>
      <div>
        <h1 style={{ fontSize: "1.6rem", marginBottom: 6 }}>Scholarships</h1>
        <p style={{ color: "var(--ink-2)", maxWidth: "70ch", margin: 0 }}>
          The Foundation&rsquo;s cycle, end to end: scoring, the money, and the
          notifications that currently get typed by hand.
        </p>
      </div>

      {/* Two things are unresolved and both change what the cycle can do, so
          they sit above the work rather than in a footnote. */}
      {eligibilityIsPlaceholder() ? (
        <div className={styles.pause}>
          <strong>Eligibility is with counsel.</strong>{" "}
          {ELIGIBILITY_RULE.guidance}
        </div>
      ) : null}

      {!WOUNDED_PATRIOT.amountConfirmed ? (
        <div className={styles.pause}>
          <strong>The Wounded Patriot amount is a placeholder</strong> at{" "}
          {formatCents(WOUNDED_PATRIOT.amountCents)}. It is a flat award and the
          real figure has not been given, so nothing should be sent until you
          confirm it.
        </div>
      ) : null}

      {denial ? (
        <p style={{ color: "var(--warn)", maxWidth: "70ch" }}>{denial}</p>
      ) : overview ? (
        <div className={styles.card}>
          <div className={styles.closingFigures}>
            <span className={styles.closingFigure}>
              <strong>{overview.applications}</strong>
              <span>applications</span>
            </span>
            <span className={styles.closingFigure}>
              <strong>{overview.unscored}</strong>
              <span>not yet scored</span>
            </span>
            <span className={styles.closingFigure}>
              <strong>{overview.partlyScored}</strong>
              <span>short of a full committee</span>
            </span>
            <span className={styles.closingFigure}>
              <strong>{overview.verificationsOutstanding}</strong>
              <span>verifications outstanding</span>
            </span>
            <span className={styles.closingFigure}>
              <strong>{overview.awards}</strong>
              <span>awards</span>
            </span>
            <span className={styles.closingFigure}>
              <strong>{overview.awardsAwaitingNotification}</strong>
              <span>not yet notified</span>
            </span>
          </div>
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
        {AREAS.map((area) => (
          <Link key={area.href} href={area.href} className={styles.card} style={{ gap: 6 }}>
            <strong style={{ fontSize: "1.05rem" }}>{area.title}</strong>
            <span style={{ fontSize: ".88rem", color: "var(--mute)" }}>{area.blurb}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
