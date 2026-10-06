import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { nextForReview, reviewerCalibration } from "@/lib/scholarships/review";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { ReviewQueue } from "@/components/workspace/ReviewQueue";
import type { QueueApplication, QueueState } from "@/components/workspace/types";
import { ScoreSheet } from "./ScoreSheet";

export const metadata = {
  title: "Review — Scholarships",
  robots: { index: false, follow: false },
};

/**
 * The review queue, wired to the scholarships module.
 *
 * The page fetches nothing itself beyond calling two library reads; the
 * library decides who may see what, including conflict blocking, so a reviewer
 * related to an applicant never reaches this screen with that file open.
 */
export default async function ReviewPage() {
  const subject = await getCurrentSubject();
  const repo = scholarshipRepository();

  let next: Awaited<ReturnType<typeof nextForReview>>;
  let calibration: Awaited<ReturnType<typeof reviewerCalibration>> | null = null;
  try {
    next = await nextForReview(repo, subject);
    calibration = await reviewerCalibration(repo, subject);
  } catch (error) {
    return (
      <div>
        <h1 style={{ fontSize: "1.5rem", marginBottom: 8 }}>Review</h1>
        <p style={{ color: "var(--warn)", maxWidth: "68ch" }}>
          {error instanceof AuthzError
            ? error.message
            : "This queue could not be opened."}
        </p>
        <p style={{ color: "var(--ink-2)", maxWidth: "68ch" }}>
          Scoring needs read access to applications for the Foundation. Switch to
          a scholarship reviewer or the Scholarships Chair in the header.
        </p>
      </div>
    );
  }

  const file = next.file;

  const application: QueueApplication | null = file
    ? {
        id: file.applicationId,
        applicantName: file.applicantName,
        school: file.enrolment?.schoolName ?? "Not stated",
        programme: file.enrolment?.level ?? "Not stated",
        yearOfStudy: file.enrolment?.academicYear ?? "Not stated",
        sponsorMemberId: file.reference,
        statement: file.merit?.essay ?? "No essay was submitted with this application.",
        // Stated rather than silently absent: a scorer should know the evidence
        // exists and is not theirs, instead of wondering if the record is short.
        withheld: file.appliedForWoundedPatriot
          ? {
              label: "This applicant also applied for Wounded Patriot",
              reason:
                "The disability evidence behind it is verified by the Scholarships " +
                "Chair and is not shown to scorers. Your score is for merit only.",
            }
          : undefined,
      }
    : null;

  const state: QueueState = {
    reviewed: next.progress.reviewed,
    total: next.progress.total,
    // The library counts a reviewer's sheets for the cycle rather than for this
    // sitting; until a session is tracked, showing the cycle figure here would
    // be a lie, so the meter reports what it actually knows.
    thisSession: calibration?.reviewerSheets ?? next.progress.reviewed,
    sessionAverage: calibration?.reviewerAverage ?? null,
    cycleAverage: calibration?.cycleAverage ?? null,
  };

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: 14 }}>Review</h1>
      <ReviewQueue
        application={application}
        state={state}
        scoring={
          file ? (
            <ScoreSheet
              applicationId={file.applicationId}
              criteria={file.criteria}
              existing={
                file.myScore
                  ? { points: file.myScore.points, comment: file.myScore.comment }
                  : null
              }
            />
          ) : undefined
        }
      />
      {next.progress.blocked > 0 ? (
        <p style={{ color: "var(--mute)", fontSize: ".86rem", marginTop: 14 }}>
          {next.progress.blocked} file
          {next.progress.blocked === 1 ? " is" : "s are"} withheld from you because
          you declared a relationship to the applicant. Another reviewer takes
          {next.progress.blocked === 1 ? " it" : " them"}.
        </p>
      ) : null}
    </div>
  );
}
