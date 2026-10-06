/**
 * Disability verification. The chair's, and nobody else's.
 *
 * This is the step the Scholarships Chair named as the one that must never run
 * without a person, and it is what decides a Wounded Patriot award. So:
 *
 *   - `recordDisabilityVerification` is the ONLY function in this module that
 *     produces a `DisabilityVerification`. Nothing else constructs one and
 *     nothing else calls the repository's write.
 *   - It requires an explicit human actor id, it refuses a blank one, and it
 *     refuses an actor who is not the signed-in subject. There is no default
 *     actor, no system actor and no service account.
 *   - There is no "verify all", no "verify on submission", no rule that reads
 *     the applicant's own narrative and decides. The absence of a record is
 *     the unverified state, so there is no status to flip in passing.
 *   - The caller has to pass a method saying who was spoken to, and a note.
 *     A verification with nothing in the note is not a verification.
 *
 * tests/scholarships.test.ts asserts all of that, including by reading this
 * module's source for a path that sets a verified outcome without an actor.
 */

import { AuthzError, type Subject } from "../authz/policy";

import { assertScholarshipsChair, guard } from "./guard";
import { nextId, type ScholarshipRepository } from "./repository";
import {
  SCHOLARSHIP_ENTITY,
  VERIFICATION_METHODS,
  type Application,
  type DisabilityVerification,
  type VerificationMethod,
  type VerificationOutcome,
} from "./types";

export class MissingHumanActorError extends Error {
  constructor(readonly applicationId: string) {
    super(
      "A disability verification records who checked. It cannot be written " +
        "without the person's id, and there is no path in this module that " +
        "writes one on anybody's behalf.",
    );
    this.name = "MissingHumanActorError";
  }
}

export class VerificationNoteMissingError extends Error {
  constructor() {
    super("A verification records what was established and from whom. Write the note.");
    this.name = "VerificationNoteMissingError";
  }
}

export type VerificationInput = {
  applicationId: string;
  outcome: VerificationOutcome;
  method: VerificationMethod;
  note: string;
  /** Required. The person who did it. No default. */
  actorPersonId: string;
};

/**
 * Record that a person checked.
 *
 * Requires APPLICANT_SENSITIVE at WRITE on JSOF, and additionally the
 * Scholarships Chair seat. Both, not either: the Family Support Chair holds
 * the same data class for her own case files and has no business in a
 * scholarship applicant's.
 */
export async function recordDisabilityVerification(
  repo: ScholarshipRepository,
  subject: Subject,
  input: VerificationInput,
  now: Date = new Date(),
): Promise<DisabilityVerification> {
  await guard(repo, subject, {
    action: "RECORD_DISABILITY_VERIFICATION",
    dataClass: "APPLICANT_SENSITIVE",
    required: "WRITE",
    rowLevel: true,
    subjectRef: input.applicationId,
  });
  await assertScholarshipsChair(
    repo,
    subject,
    "RECORD_DISABILITY_VERIFICATION",
    input.applicationId,
  );

  const actor = input.actorPersonId?.trim() ?? "";
  if (!actor) throw new MissingHumanActorError(input.applicationId);
  if (actor !== subject.personId) {
    throw new AuthzError(
      `${subject.personId} cannot record a verification as ${actor}. ` +
        `The person who checked is the person who signs it.`,
      "DENIED",
    );
  }
  if (!input.note.trim()) throw new VerificationNoteMissingError();
  if (!VERIFICATION_METHODS.includes(input.method)) {
    throw new Error(`Unknown verification method ${input.method}`);
  }

  const record: DisabilityVerification = {
    id: nextId("schver"),
    entity: SCHOLARSHIP_ENTITY,
    applicationId: input.applicationId,
    outcome: input.outcome,
    verifiedByPersonId: actor,
    verifiedAt: now.toISOString(),
    method: input.method,
    note: input.note.trim(),
  };
  return repo.recordVerification(record);
}

/* ------------------------------------------------------------------ *
 * The queue
 * ------------------------------------------------------------------ */

export type VerificationQueueRow = {
  applicationId: string;
  reference: string;
  applicantName: string;
  serviceMemberRelationship: string;
  narrative: string;
  claimedServiceConnection: string;
  verificationContact: string;
  verification: DisabilityVerification | null;
};

export type VerificationQueue = {
  cycleId: string;
  waiting: VerificationQueueRow[];
  decided: VerificationQueueRow[];
  /** What a decided verification is worth, so the screen can say it plainly. */
  verified: number;
  notVerified: number;
};

export async function loadVerificationQueue(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
): Promise<VerificationQueue> {
  await guard(repo, subject, {
    action: "READ_VERIFICATION_QUEUE",
    dataClass: "APPLICANT_SENSITIVE",
    required: "READ",
    rowLevel: true,
  });
  await assertScholarshipsChair(repo, subject, "READ_VERIFICATION_QUEUE", null);

  const cycle = cycleId ?? (await repo.currentCycle()).id;
  const applications = await repo.listApplications({ cycleId: cycle });

  const waiting: VerificationQueueRow[] = [];
  const decided: VerificationQueueRow[] = [];
  let verified = 0;
  let notVerified = 0;

  for (const application of applications) {
    if (!application.woundedPatriot) continue;
    if (application.state === "WITHDRAWN") continue;
    const verification = await repo.getVerification(application.id);
    const row = rowFor(application, verification);
    if (!verification) {
      waiting.push(row);
      continue;
    }
    decided.push(row);
    if (verification.outcome === "VERIFIED") verified += 1;
    else notVerified += 1;
  }

  return { cycleId: cycle, waiting, decided, verified, notVerified };
}

function rowFor(
  application: Application,
  verification: DisabilityVerification | null,
): VerificationQueueRow {
  const section = application.woundedPatriot!;
  return {
    applicationId: application.id,
    reference: application.reference,
    applicantName: application.applicant.fullName,
    serviceMemberRelationship: section.serviceMemberRelationship,
    narrative: section.disabilityEvidence.narrative,
    claimedServiceConnection: section.disabilityEvidence.claimedServiceConnection,
    verificationContact: section.disabilityEvidence.verificationContact,
    verification,
  };
}

/** True only when a person recorded a verified outcome. Null reads as not verified. */
export function qualifiesForWoundedPatriot(
  verification: DisabilityVerification | null,
): boolean {
  return verification?.outcome === "VERIFIED";
}
