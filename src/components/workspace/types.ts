/**
 * The data the workspace renders. Presentation only: these types describe what
 * a screen needs, not how the scholarships module stores anything, so the
 * module's repository can hand these over without either side knowing the
 * other's shape.
 */

export type QueueApplication = {
  id: string;
  /** Named, not numbered. These are people, and she knows some of them. */
  applicantName: string;
  school: string;
  programme: string;
  yearOfStudy: string;
  sponsorMemberId: string;
  /** The application text a scorer reads. */
  statement: string;
  /**
   * What is deliberately absent from this payload for this viewer. Naming it
   * is better than silence: a scorer should know evidence exists and is not
   * theirs, rather than wonder whether the record is incomplete.
   */
  withheld?: { label: string; reason: string };
};

export type QueueState = {
  /** Honest. Never padded to manufacture momentum. */
  reviewed: number;
  total: number;
  /** Scored in this sitting, for the session meter. */
  thisSession: number;
  /** Mean score so far this session, and across the whole cycle. */
  sessionAverage: number | null;
  cycleAverage: number | null;
};

export type AwardBand = {
  key: string;
  label: string;
  /** Inclusive score range that lands in this band. */
  from: number;
  to: number;
  defaultAmountCents: number;
  count: number;
};

export type AwardException = {
  id: string;
  applicantName: string;
  kind: "BOARD_DEPENDENT" | "BAND_BOUNDARY" | "MANUAL_OVERRIDE";
  note: string;
};

export type NotificationPreview = {
  applicantName: string;
  applicantEmail: string;
  /**
   * The sponsoring member, as a first-class recipient rather than a bcc.
   * Students frequently do not read or answer email, and chasing the sponsor
   * from outside the system is the failure this removes.
   */
  sponsorName: string;
  sponsorEmail: string;
  subject: string;
  /** Body with `{{award}}` where the amount is merged in. */
  bodyTemplate: string;
  awardAmountCents: number;
};

export type CycleSummary = {
  studentsNotified: number;
  totalAwardedCents: number;
  schoolsPaid: number;
  cycleLabel: string;
};

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
