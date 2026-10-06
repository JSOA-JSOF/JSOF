import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { loadAwardsBoard } from "@/lib/scholarships/awards";
import { loadCycleExceptions } from "@/lib/scholarships/board";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { AwardBands } from "@/components/workspace/AwardBands";
import type { AwardBand, AwardException } from "@/components/workspace/types";

export const metadata = {
  title: "Awards — Scholarships",
  robots: { index: false, follow: false },
};

/**
 * Banding plus the exceptions a rule should not decide.
 *
 * The exceptions come from the library's own analysis rather than from a rule
 * repeated here, so what the chair is shown stays in step with what the module
 * actually knows: board dependents, scores near a band line, committees that
 * disagreed widely, sponsor checks that failed, minors without consent, and
 * verifications still outstanding.
 */
export default async function AwardsPage() {
  const subject = await getCurrentSubject();
  const repo = scholarshipRepository();

  let board: Awaited<ReturnType<typeof loadAwardsBoard>>;
  let exceptions: Awaited<ReturnType<typeof loadCycleExceptions>> | null = null;
  try {
    board = await loadAwardsBoard(repo, subject);
    exceptions = await loadCycleExceptions(repo, subject);
  } catch (error) {
    return (
      <div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>Awards</h1>
        <p style={{ color: "var(--warn)", maxWidth: "68ch" }}>
          {error instanceof AuthzError ? error.message : "The awards board could not be opened."}
        </p>
      </div>
    );
  }

  const bands: AwardBand[] = board.bands.map((band, index) => ({
    key: band.key,
    label: band.label,
    from: band.minScore,
    to: index === 0 ? 100 : board.bands[index - 1].minScore - 1,
    defaultAmountCents: band.amountCents,
    count: band.count,
  }));

  const rows: AwardException[] = [
    ...exceptions.boardMemberDependents.map((row) => ({
      id: row.applicationId,
      applicantName: row.applicantName,
      kind: "BOARD_DEPENDENT" as const,
      note:
        `Sponsored by a board member, who is recused. ` +
        (row.boardDecisionRecorded
          ? "The full board's decision is recorded."
          : "This needs the full board before anything is sent."),
    })),
    ...exceptions.nearBandBoundary.map((row) => ({
      id: row.applicationId,
      applicantName: row.applicantName,
      kind: "BAND_BOUNDARY" as const,
      note:
        row.nextBandLabel && row.pointsToNextBand !== null
          ? `Scored ${row.average.toFixed(1)}, ${row.pointsToNextBand} point${
              row.pointsToNextBand === 1 ? "" : "s"
            } below ${row.nextBandLabel}. One sheet is the difference between two amounts.`
          : `Scored ${row.average.toFixed(1)}, close to the Merit floor.`,
    })),
    ...exceptions.wideSpread.map((row) => ({
      id: row.applicationId,
      applicantName: row.applicantName,
      kind: "MANUAL_OVERRIDE" as const,
      note: `The committee disagreed: ${row.low} to ${row.high}, a spread of ${row.spread}. The average hides that.`,
    })),
    ...exceptions.sponsorProblems.map((row) => ({
      id: row.applicationId,
      applicantName: row.applicantName,
      kind: "MANUAL_OVERRIDE" as const,
      note: row.onRoster
        ? `Sponsor ${row.sponsorMemberId} is on the roster but not in good standing.`
        : `Sponsor ${row.sponsorMemberId} is not on the roster.`,
    })),
    ...exceptions.minorsWithoutConsent.map((row) => ({
      id: row.applicationId,
      applicantName: row.applicantName,
      kind: "MANUAL_OVERRIDE" as const,
      note: "Under 18 with no guardian consent on file. This cannot proceed.",
    })),
    ...exceptions.verificationsOutstanding.map((row) => ({
      id: row.applicationId,
      applicantName: row.applicantName,
      kind: "MANUAL_OVERRIDE" as const,
      note: "Wounded Patriot claim not yet verified. Only you can verify it.",
    })),
  ];

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: 6 }}>Awards</h1>
      <p style={{ color: "var(--ink-2)", maxWidth: "70ch", marginTop: 0 }}>
        {board.meritAwards} Merit and {board.woundedPatriotAwards} Wounded Patriot
        awards across {board.applications} applications. {board.bothPrograms}{" "}
        received both and {board.neither} neither.
      </p>
      <AwardBands bands={bands} exceptions={rows} budgetCents={null} />
    </div>
  );
}
