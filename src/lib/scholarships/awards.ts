/**
 * Awards: the amount, the message that carries it, and the recusal.
 *
 * Three of the chair's own points are the design of this file.
 *
 * THE AMOUNT IS A FIELD. `Award.amountCents` is set once, on the record, from
 * the band the committee score falls in. The notification merges it. She
 * retypes 183 award amounts into emails by hand each cycle and it is the
 * single most time-consuming task in the role; there is no step anywhere in
 * this module where a person types an amount into a message.
 *
 * THE SPONSOR IS A RECIPIENT. Every message to an applicant carries the
 * sponsoring member as a named recipient with a stated reason, not as a bcc.
 * Students frequently do not read or answer email and she currently leaves the
 * platform to chase the sponsor. `AwardNotification.recipients` has no bcc
 * field to hide one in.
 *
 * A BOARD MEMBER'S DEPENDENT GOES TO THE FULL BOARD. Surfaced, never
 * auto-approved: `recordFullBoardDecision` is the only way one of these moves,
 * it needs a minute reference and named approvers, and the recused member
 * cannot be one of them.
 */

import { assertNotSelfApproval, type Subject } from "../authz/policy";

import { guard } from "./guard";
import { SCHOLARSHIPS_CHAIR_INBOX, enqueue } from "./notify";
import { nextId, type ScholarshipRepository } from "./repository";
import {
  MERIT_BANDS,
  TOP_WINNER,
  WOUNDED_PATRIOT,
  committeeScore,
  formatCents,
  meritBandFor,
  type CommitteeScore,
} from "./scoring";
import { qualifiesForWoundedPatriot } from "./verification";
import {
  PROGRAM_LABELS,
  SCHOLARSHIP_CURRENCY,
  SCHOLARSHIP_ENTITY,
  type Application,
  type Award,
  type AwardNotification,
  type BoardReview,
  type GuardianConsent,
  type Program,
  type Recipient,
} from "./types";

/* ------------------------------------------------------------------ *
 * Proposing
 * ------------------------------------------------------------------ */

export type ProposalOptions = {
  /** The chair's occasional designation. Never reached by score alone. */
  designateTopWinner?: boolean;
};

export type Proposal = {
  applicationId: string;
  reference: string;
  applicantName: string;
  score: CommitteeScore | null;
  merit: { amountCents: number; basis: string } | null;
  woundedPatriot: { amountCents: number; basis: string } | null;
  /** Set when any award here would have to go to the full board. */
  recusedBoardMemberPersonId: string | null;
};

export async function proposalFor(
  repo: ScholarshipRepository,
  applicationId: string,
  options: ProposalOptions = {},
): Promise<Proposal> {
  const application = await repo.getApplication(applicationId);
  if (!application) throw new Error(`No application ${applicationId}`);

  const score = committeeScore(await repo.listScoreSheets(applicationId));
  const band = score ? meritBandFor(score.average) : null;

  const topWinner =
    options.designateTopWinner === true &&
    score !== null &&
    score.average >= TOP_WINNER.eligibleFromScore;

  const merit = band
    ? {
        amountCents: topWinner ? TOP_WINNER.amountCents : band.amountCents,
        basis: topWinner
          ? `Committee average ${score!.average} across ${score!.sheets} sheets. ` +
            `Designated top winner by the chair.`
          : `Committee average ${score!.average} across ${score!.sheets} sheets, band ${band.label}.`,
      }
    : null;

  const verification = await repo.getVerification(applicationId);
  const woundedPatriot =
    application.woundedPatriot && qualifiesForWoundedPatriot(verification)
      ? {
          amountCents: WOUNDED_PATRIOT.amountCents,
          basis:
            `Flat award. Service connection verified by ${verification!.verifiedByPersonId} ` +
            `on ${verification!.verifiedAt.slice(0, 10)}.`,
        }
      : null;

  return {
    applicationId,
    reference: application.reference,
    applicantName: application.applicant.fullName,
    score,
    merit,
    woundedPatriot,
    recusedBoardMemberPersonId: application.boardMemberPersonId,
  };
}

/**
 * Write the proposed awards.
 *
 * An award to a board member's dependent is created in BOARD_REVIEW with the
 * member named as recused. It is not approved here and there is no option on
 * this function that would approve it.
 */
export async function proposeAwards(
  repo: ScholarshipRepository,
  subject: Subject,
  applicationId: string,
  options: ProposalOptions = {},
  now: Date = new Date(),
): Promise<Award[]> {
  await guard(repo, subject, {
    action: "PROPOSE_AWARDS",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: true,
    subjectRef: applicationId,
  });

  const application = await repo.getApplication(applicationId);
  if (!application) throw new Error(`No application ${applicationId}`);
  const proposal = await proposalFor(repo, applicationId, options);

  const created: Award[] = [];
  const parts: { program: Program; amountCents: number; basis: string }[] = [];
  if (proposal.merit) parts.push({ program: "MERIT", ...proposal.merit });
  if (proposal.woundedPatriot) parts.push({ program: "WOUNDED_PATRIOT", ...proposal.woundedPatriot });

  for (const part of parts) {
    const boardReview: BoardReview | null = application.boardMemberPersonId
      ? {
          reason: "BOARD_MEMBER_DEPENDENT",
          recusedPersonId: application.boardMemberPersonId,
          requestedAt: now.toISOString(),
          requestedByPersonId: subject.personId,
          minuteRef: null,
          decidedAt: null,
          outcome: null,
          approverPersonIds: [],
        }
      : null;

    created.push(
      await repo.createAward({
        id: nextId("schaward"),
        entity: SCHOLARSHIP_ENTITY,
        cycleId: application.cycleId,
        applicationId,
        program: part.program,
        amountCents: part.amountCents,
        currency: SCHOLARSHIP_CURRENCY,
        status: boardReview ? "BOARD_REVIEW" : "PROPOSED",
        basis: part.basis,
        proposedAt: now.toISOString(),
        decidedByPersonId: null,
        decidedAt: null,
        boardReview,
        notifiedAt: null,
      }),
    );
  }

  return created;
}

/* ------------------------------------------------------------------ *
 * Approving
 * ------------------------------------------------------------------ */

export class BoardReviewRequiredError extends Error {
  constructor(readonly awardId: string, readonly recusedPersonId: string) {
    super(
      `Award ${awardId} is to a board member's dependent. It goes to the full ` +
        `board with ${recusedPersonId} recused, and cannot be approved here.`,
    );
    this.name = "BoardReviewRequiredError";
  }
}

export async function approveAward(
  repo: ScholarshipRepository,
  subject: Subject,
  awardId: string,
  now: Date = new Date(),
): Promise<Award> {
  await guard(repo, subject, {
    action: "APPROVE_AWARD",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: true,
    subjectRef: awardId,
  });
  const award = await repo.getAward(awardId);
  if (!award) throw new Error(`No award ${awardId}`);
  if (award.boardReview && award.boardReview.outcome === null) {
    throw new BoardReviewRequiredError(awardId, award.boardReview.recusedPersonId);
  }
  return repo.updateAward(awardId, {
    status: "APPROVED",
    decidedByPersonId: subject.personId,
    decidedAt: now.toISOString(),
  });
}

export class RecusedApproverError extends Error {
  constructor(readonly personId: string) {
    super(`${personId} is recused on this award and cannot be one of its approvers`);
    this.name = "RecusedApproverError";
  }
}

export const FULL_BOARD_MINIMUM_APPROVERS = 3;

/**
 * Record what the full board decided.
 *
 * Needs a minute reference, needs named approvers, and refuses the recused
 * member among them. Nothing here happens on a timer or by default: an award
 * in BOARD_REVIEW that the board never reaches stays in BOARD_REVIEW.
 */
export async function recordFullBoardDecision(
  repo: ScholarshipRepository,
  subject: Subject,
  input: {
    awardId: string;
    outcome: "APPROVED" | "DECLINED";
    minuteRef: string;
    approverPersonIds: string[];
  },
  now: Date = new Date(),
): Promise<Award> {
  await guard(repo, subject, {
    action: "RECORD_FULL_BOARD_DECISION",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: true,
    subjectRef: input.awardId,
  });

  const award = await repo.getAward(input.awardId);
  if (!award) throw new Error(`No award ${input.awardId}`);
  if (!award.boardReview) {
    throw new Error(`Award ${input.awardId} is not with the full board`);
  }
  if (!input.minuteRef.trim()) {
    throw new Error("A full-board decision needs the minute reference it was taken under");
  }
  const approvers = input.approverPersonIds.map((id) => id.trim()).filter(Boolean);
  if (approvers.length < FULL_BOARD_MINIMUM_APPROVERS) {
    throw new Error(
      `A full-board decision needs at least ${FULL_BOARD_MINIMUM_APPROVERS} named approvers`,
    );
  }
  if (approvers.includes(award.boardReview.recusedPersonId)) {
    throw new RecusedApproverError(award.boardReview.recusedPersonId);
  }
  // The person who proposed the award is not one of the people who approve it.
  //
  // The check is against the APPROVERS, not against whoever is typing. The
  // chair proposes these and the chair keeps the records, so pointing the
  // no-self-approval invariant at the recorder would mean nobody could write
  // down what the board decided: the only other roles holding APPLICANT WRITE
  // on JSOF have no business in a scholarship file at all. What the invariant
  // is actually for is that the proposer does not vote on her own proposal,
  // and that is what this asserts.
  for (const approver of approvers) {
    assertNotSelfApproval(approver, {
      id: award.id,
      createdById: award.boardReview.requestedByPersonId,
      entity: award.entity,
    });
  }

  return repo.updateAward(input.awardId, {
    status: input.outcome === "APPROVED" ? "APPROVED" : "DECLINED",
    decidedByPersonId: subject.personId,
    decidedAt: now.toISOString(),
    boardReview: {
      ...award.boardReview,
      minuteRef: input.minuteRef.trim(),
      decidedAt: now.toISOString(),
      outcome: input.outcome,
      approverPersonIds: approvers,
    },
  });
}

/* ------------------------------------------------------------------ *
 * The notification
 * ------------------------------------------------------------------ */

/**
 * Who is on an award message, and why.
 *
 * The applicant, always. The sponsoring member, always: not a copy, not a bcc,
 * a recipient with a reason that is printed in the message. The guardian when
 * the applicant is under 18, because that household consented to the
 * application and is entitled to the decision.
 *
 * When the roster did not resolve a sponsor address the sponsor slot is still
 * filled, addressed to the chair, saying plainly that the sponsor could not be
 * reached and has to be. Dropping the recipient would quietly restore exactly
 * the problem this is here to fix.
 */
export function recipientsFor(
  application: Application,
  consent: GuardianConsent | null,
): Recipient[] {
  const recipients: Recipient[] = [
    {
      role: "APPLICANT",
      name: application.applicant.fullName,
      address: application.applicant.email,
      because: "You applied for this scholarship.",
    },
  ];

  const sponsor = application.sponsor;
  recipients.push(
    sponsor?.sponsorEmail
      ? {
          role: "SPONSOR",
          name: sponsor.sponsorName ?? sponsor.sponsorMemberId,
          address: sponsor.sponsorEmail,
          because:
            "You sponsored this application. You are copied on every message " +
            "to the applicant so that nothing depends on a student answering email.",
        }
      : {
          role: "SPONSOR",
          name: sponsor?.sponsorMemberId ?? "Sponsor not resolved",
          address: SCHOLARSHIPS_CHAIR_INBOX,
          because:
            "The sponsoring member could not be matched on the roster, so this " +
            "copy comes to the Scholarships Chair to forward by hand.",
        },
  );

  if (consent) {
    recipients.push({
      role: "GUARDIAN",
      name: consent.guardianName,
      address: consent.guardianEmail,
      because: "You consented to this application on behalf of the applicant.",
    });
  }

  return recipients;
}

/**
 * Build the message.
 *
 * Pure, and the amount comes from `award.amountCents`. Nothing is typed.
 */
export function buildAwardNotification(input: {
  award: Award;
  application: Application;
  consent: GuardianConsent | null;
  schoolName: string | null;
  now?: Date;
}): AwardNotification {
  const { award, application, consent } = input;
  const now = input.now ?? new Date();
  const amount = formatCents(award.amountCents);
  const program = PROGRAM_LABELS[award.program];
  const school = input.schoolName ?? "your school";

  const body = [
    `${application.applicant.fullName},`,
    "",
    `The Foundation has awarded you the ${program} for the coming academic ` +
      `year. The amount is ${amount}.`,
    "",
    `The cheque is made out to ${school} and sent to their bursar, not to you. ` +
      `It carries your student number so that it is applied to your account. ` +
      `If your enrolment changes, tell the Scholarships Chair before the ` +
      `cheque is mailed.`,
    "",
    `Your sponsoring member is copied on this message. If we cannot reach you, ` +
      `we will reach them.`,
    "",
    `Reference ${application.reference}.`,
  ].join("\n");

  return {
    awardId: award.id,
    applicationId: application.id,
    entity: award.entity,
    recipients: recipientsFor(application, consent),
    subject: `${program}: ${amount} for ${application.reference}`,
    body,
    mergedAmountCents: award.amountCents,
    builtAt: now.toISOString(),
  };
}

/**
 * The notification as data, without sending anything.
 *
 * For a screen that wants to show the chair exactly what will go out, to whom,
 * and with which figure merged, before she commits to it. Reads only: nothing
 * is queued and no award status changes. `sendAwardNotification` is what sends.
 */
export async function awardNotificationFor(
  repo: ScholarshipRepository,
  subject: Subject,
  awardId: string,
  now: Date = new Date(),
): Promise<AwardNotification> {
  await guard(repo, subject, {
    action: "PREVIEW_AWARD_NOTIFICATION",
    dataClass: "APPLICANT",
    required: "READ",
    rowLevel: true,
    subjectRef: awardId,
  });

  const award = await repo.getAward(awardId);
  if (!award) throw new Error(`No award ${awardId}`);
  const application = await repo.getApplication(award.applicationId);
  if (!application) throw new Error(`No application ${award.applicationId}`);
  const consent = await repo.getGuardianConsentForApplication(application.id);
  const school = application.enrolment
    ? await repo.getSchool(application.enrolment.schoolId)
    : null;

  return buildAwardNotification({
    award,
    application,
    consent,
    schoolName: school?.name ?? null,
    now,
  });
}

export class AwardNotApprovedError extends Error {
  constructor(readonly awardId: string) {
    super(`Award ${awardId} has not been approved, so nothing is sent about it`);
    this.name = "AwardNotApprovedError";
  }
}

export async function sendAwardNotification(
  repo: ScholarshipRepository,
  subject: Subject,
  awardId: string,
  now: Date = new Date(),
): Promise<AwardNotification> {
  await guard(repo, subject, {
    action: "SEND_AWARD_NOTIFICATION",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: true,
    subjectRef: awardId,
  });

  const award = await repo.getAward(awardId);
  if (!award) throw new Error(`No award ${awardId}`);
  if (award.status !== "APPROVED") throw new AwardNotApprovedError(awardId);

  const application = await repo.getApplication(award.applicationId);
  if (!application) throw new Error(`No application ${award.applicationId}`);
  const consent = await repo.getGuardianConsentForApplication(application.id);
  const school = application.enrolment
    ? await repo.getSchool(application.enrolment.schoolId)
    : null;

  const notification = buildAwardNotification({
    award,
    application,
    consent,
    schoolName: school?.name ?? null,
    now,
  });

  enqueue({
    entity: SCHOLARSHIP_ENTITY,
    kind: "AWARD_NOTIFICATION",
    recipients: notification.recipients,
    subject: notification.subject,
    body: notification.body,
    ref: application.reference,
  });

  await repo.updateAward(awardId, { status: "NOTIFIED", notifiedAt: now.toISOString() });
  return notification;
}

/* ------------------------------------------------------------------ *
 * The awards board
 * ------------------------------------------------------------------ */

export type BandSummary = {
  key: string;
  label: string;
  minScore: number;
  amountCents: number;
  count: number;
  totalCents: number;
};

export type AwardsBoard = {
  cycleId: string;
  applications: number;
  meritAwards: number;
  woundedPatriotAwards: number;
  bothPrograms: number;
  neither: number;
  bands: BandSummary[];
  topWinners: { reference: string; amountCents: number }[];
  meritTotalCents: number;
  woundedPatriotTotalCents: number;
  totalCents: number;
  /** Awaiting the full board, with the recused member named. */
  withTheBoard: {
    awardId: string;
    reference: string;
    program: Program;
    amountCents: number;
    recusedPersonId: string;
    requestedAt: string;
  }[];
  notYetNotified: number;
};

export async function loadAwardsBoard(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
): Promise<AwardsBoard> {
  // WRITE, not READ. A scholarship reviewer holds APPLICANT READ so they can
  // score, and the awards board carries every amount. A scorer who can see
  // that three points is worth $1,000 is a scorer whose scores are no longer
  // independent of the money — the same reasoning that keeps the disability
  // evidence away from them. Deciding awards is the chair's function, and the
  // role table already spells that as APPLICANT WRITE.
  await guard(repo, subject, {
    action: "READ_AWARDS_BOARD",
    dataClass: "APPLICANT",
    required: "WRITE",
    rowLevel: true,
  });

  const cycle = cycleId ?? (await repo.currentCycle()).id;
  const applications = await repo.listApplications({ cycleId: cycle });
  const awards = await repo.listAwards({ cycleId: cycle });
  const byReference = new Map(applications.map((a) => [a.id, a.reference]));

  const merit = awards.filter((a) => a.program === "MERIT");
  const woundedPatriot = awards.filter((a) => a.program === "WOUNDED_PATRIOT");
  const meritApplications = new Set(merit.map((a) => a.applicationId));
  const woundedPatriotApplications = new Set(woundedPatriot.map((a) => a.applicationId));

  const bands: BandSummary[] = MERIT_BANDS.map((band) => {
    const inBand = merit.filter((a) => a.amountCents === band.amountCents);
    return {
      key: band.key,
      label: band.label,
      minScore: band.minScore,
      amountCents: band.amountCents,
      count: inBand.length,
      totalCents: inBand.reduce((sum, a) => sum + a.amountCents, 0),
    };
  });

  const topWinners = merit
    .filter((a) => a.amountCents === TOP_WINNER.amountCents)
    .map((a) => ({
      reference: byReference.get(a.applicationId) ?? a.applicationId,
      amountCents: a.amountCents,
    }));

  const bothPrograms = [...meritApplications].filter((id) =>
    woundedPatriotApplications.has(id),
  ).length;

  const meritTotalCents = merit.reduce((sum, a) => sum + a.amountCents, 0);
  const woundedPatriotTotalCents = woundedPatriot.reduce((sum, a) => sum + a.amountCents, 0);

  return {
    cycleId: cycle,
    applications: applications.length,
    meritAwards: merit.length,
    woundedPatriotAwards: woundedPatriot.length,
    bothPrograms,
    neither: applications.filter(
      (a) => !meritApplications.has(a.id) && !woundedPatriotApplications.has(a.id),
    ).length,
    bands,
    topWinners,
    meritTotalCents,
    woundedPatriotTotalCents,
    totalCents: meritTotalCents + woundedPatriotTotalCents,
    withTheBoard: awards
      .filter((a) => a.boardReview && a.boardReview.outcome === null)
      .map((a) => ({
        awardId: a.id,
        reference: byReference.get(a.applicationId) ?? a.applicationId,
        program: a.program,
        amountCents: a.amountCents,
        recusedPersonId: a.boardReview!.recusedPersonId,
        requestedAt: a.boardReview!.requestedAt,
      })),
    notYetNotified: awards.filter((a) => a.status === "APPROVED").length,
  };
}

/**
 * Every award, with its applicant and the recipients its notification would
 * carry. The chair's working list.
 */
export type AwardRow = {
  award: Award;
  reference: string;
  applicantName: string;
  schoolName: string;
  recipients: Recipient[];
};

export async function loadAwardRows(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
  limit = 40,
): Promise<AwardRow[]> {
  await guard(repo, subject, {
    action: "READ_AWARD_ROWS",
    dataClass: "APPLICANT",
    required: "READ",
    rowLevel: true,
  });

  const cycle = cycleId ?? (await repo.currentCycle()).id;
  const awards = (await repo.listAwards({ cycleId: cycle })).slice(0, limit);
  const schools = new Map((await repo.listSchools()).map((s) => [s.id, s.name]));
  const rows: AwardRow[] = [];

  for (const award of awards) {
    const application = await repo.getApplication(award.applicationId);
    if (!application) continue;
    const consent = await repo.getGuardianConsentForApplication(application.id);
    rows.push({
      award,
      reference: application.reference,
      applicantName: application.applicant.fullName,
      schoolName: application.enrolment
        ? (schools.get(application.enrolment.schoolId) ?? "School on file")
        : "No school given",
      recipients: recipientsFor(application, consent),
    });
  }
  return rows;
}

export { formatCents };
