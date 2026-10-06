/**
 * Scholarships module tests.
 *
 * Written as prohibitions and requirements rather than as coverage. Eight of
 * them are the reason the file exists, and each one corresponds to something a
 * person currently does by hand, or to something the organization has been
 * told not to encode:
 *
 *   1. The eligibility rule under legal review appears in NO source file in
 *      this module. Not in code, not in a comment, not in a hedge.
 *   2. A reviewer's response object carries no disability documentation at any
 *      nesting depth. Asserted against the returned object, not the markup.
 *   3. A reviewer related to an applicant is refused the file, and the refusal
 *      is written to the log.
 *   4. No code path sets a disability verification without an explicit human
 *      actor id.
 *   5. Patriot Foundation routing sends a North Carolina resident at a North
 *      Carolina school away BEFORE any personal data is collected.
 *   6. An under-18 application cannot proceed without a separate guardian
 *      consent record.
 *   7. An award notification carries the sponsoring member as a recipient.
 *   8. The purge actually removes unsuccessful applicants' data.
 *
 * Plus the module brief's standing requirement: a wrong-role request to every
 * feature fails in a test.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { AuthzError, type Subject } from "../src/lib/authz/policy";
import { personaById, subjectFor } from "../src/lib/authz/personas";

import {
  newMembershipRepository,
  type MembershipRepository,
} from "../src/lib/membership/repository";
import { seedSponsorMemberId } from "../src/lib/membership/seed";

import {
  FULL_BOARD_MINIMUM_APPROVERS,
  RecusedApproverError,
  BoardReviewRequiredError,
  approveAward,
  awardNotificationFor,
  buildAwardNotification,
  loadAwardRows,
  loadAwardsBoard,
  proposalFor,
  proposeAwards,
  recipientsFor,
  recordFullBoardDecision,
  sendAwardNotification,
} from "../src/lib/scholarships/awards";
import {
  loadChairRows,
  loadCycleExceptions,
  loadCycleOverview,
  loadScholarshipAudit,
} from "../src/lib/scholarships/board";
import {
  buildChequeRun,
  chequeRunCsv,
  loadChequeRun,
  markChequeMailed,
} from "../src/lib/scholarships/disbursement";
import {
  ELIGIBILITY_RULE,
  eligibilityIsPlaceholder,
  evaluateEligibility,
} from "../src/lib/scholarships/eligibility";
import {
  GuardianAffirmationMissingError,
  GuardianConsentMissingError,
  RoutedAwayError,
  TooYoungError,
  checkSponsor,
  recordGuardianConsent,
  saveApplicantDetails,
  saveEnrolment,
  saveMeritSection,
  saveSponsorId,
  saveWoundedPatriotSection,
  startApplication,
  stepsFor,
  submitApplication,
} from "../src/lib/scholarships/intake";
import {
  AGE_OF_MAJORITY,
  GUARDIAN_CONSENT_STATEMENT_VERSION,
  MINIMUM_AGE,
  ageGate,
} from "../src/lib/scholarships/minors";
import { clearOutbox, readOutbox } from "../src/lib/scholarships/notify";
import {
  newScholarshipRepository,
  type ScholarshipRepository,
} from "../src/lib/scholarships/repository";
import {
  SELECTION_RECORD_RETENTION_YEARS,
  UNSUCCESSFUL_RETENTION_DAYS,
  loadRetentionSchedule,
  purgeExpiredSelectionRecords,
  purgeUnsuccessfulApplicants,
  retainSelectionRecordUntil,
} from "../src/lib/scholarships/retention";
import {
  ConflictBlockedError,
  loadReviewQueue,
  nextForReview,
  openReviewFile,
  recordScore,
  reviewerCalibration,
  reviewProgress,
} from "../src/lib/scholarships/review";
import {
  PATRIOT_FOUNDATION,
  ROUTING_QUESTIONS,
  ROUTING_RULE,
  decideRouting,
  isRoutedAway,
  programsOpenTo,
} from "../src/lib/scholarships/routing";
import {
  MAX_SCORE,
  MERIT_BANDS,
  MERIT_FLOOR_SCORE,
  SCORING_CRITERIA,
  TOP_WINNER,
  WOUNDED_PATRIOT,
  committeeScore,
  formatCents,
  meritBandFor,
  previewMeritAward,
  previewWoundedPatriotAward,
} from "../src/lib/scholarships/scoring";
import {
  CURRENT_CYCLE_ID,
  PRIOR_CYCLE_ID,
  REVIEWER_PERSON_IDS,
  SEEDED_APPLICATION_COUNT,
  SEEDED_MERIT_AWARD_COUNT,
  SEEDED_WOUNDED_PATRIOT_AWARD_COUNT,
  seedConflictedPair,
} from "../src/lib/scholarships/seed";
import {
  CRITERION_KEYS,
  SCHOLARSHIP_ENTITY,
  type Application,
  type CriterionKey,
} from "../src/lib/scholarships/types";
import {
  MissingHumanActorError,
  VerificationNoteMissingError,
  loadVerificationQueue,
  qualifiesForWoundedPatriot,
  recordDisabilityVerification,
} from "../src/lib/scholarships/verification";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const REPO_ROOT = join(import.meta.dirname, "..");

/** The two path trees this module owns and renders from. */
const MODULE_DIRS = [
  join(REPO_ROOT, "src/lib/scholarships"),
  join(REPO_ROOT, "src/app/apply/scholarship"),
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

type SourceFile = { path: string; base: string; text: string };

const SOURCES: SourceFile[] = MODULE_DIRS.flatMap(walk)
  .filter((path) => /\.(tsx?|css)$/.test(path))
  .map((path) => ({
    path: relative(REPO_ROOT, path),
    base: path.split("/").pop()!,
    text: readFileSync(path, "utf8"),
  }));

const LIB_SOURCES = SOURCES.filter((f) => f.path.startsWith("src/lib/scholarships/"));

function repo(): ScholarshipRepository {
  return newScholarshipRepository({ seed: true });
}

function roster(): MembershipRepository {
  return newMembershipRepository({ seed: true });
}

function actor(id: string): Subject {
  return subjectFor(personaById(id));
}

/** The Family Support Chair is not a persona, and is the point of one test. */
function familySupportChair(): Subject {
  return {
    personId: "dev:family-support",
    assignments: [{ role: "FAMILY_SUPPORT_CHAIR", entity: "JSOF" }],
    mfaSatisfied: true,
  };
}

function bornYearsAgo(years: number): string {
  return `${new Date().getUTCFullYear() - years}-01-01`;
}

/** Every key and value in an object graph, at any depth, with its path. */
type Visit = { keyPath: string; key: string; value: unknown };

function visitAll(value: unknown, path = "$", out: Visit[] = []): Visit[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitAll(item, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push({ keyPath: `${path}.${key}`, key, value: child });
      visitAll(child, `${path}.${key}`, out);
    }
  }
  return out;
}

async function firstApplicationWhere(
  repository: ScholarshipRepository,
  predicate: (application: Application) => boolean,
): Promise<Application> {
  const applications = await repository.listApplications({ cycleId: CURRENT_CYCLE_ID });
  const found = applications.find(predicate);
  if (!found) throw new Error("The seed no longer contains an application matching this test");
  return found;
}

const VALID_ESSAY =
  "I am applying because the first year is the only part my family cannot cover, " +
  "and I intend to finish what I start.";

async function completeDraft(
  repository: ScholarshipRepository,
  options: {
    dateOfBirth: string;
    sponsorMemberId: string;
    woundedPatriot?: boolean;
    email?: string;
  },
): Promise<Application> {
  const draft = await startApplication(repository, {
    ncResident: false,
    attendingNcSchool: false,
    applyingForWoundedPatriot: options.woundedPatriot === true,
  });
  await saveApplicantDetails(repository, draft.id, {
    fullName: "Rowan Pemberton-Hale",
    email: options.email ?? "rowan.pemberton.hale@example.org",
    phone: "(910) 555-0101",
    dateOfBirth: options.dateOfBirth,
    residenceState: "VA",
  });
  const schools = await repository.listSchools();
  await saveEnrolment(repository, draft.id, {
    schoolId: schools[0].id,
    level: "UNDERGRADUATE",
    accreditedInstitution: true,
    academicYear: "2027-2028",
    expectedCompletion: "2031-05-15",
    studentNumber: "S404401",
  });
  await saveSponsorId(repository, draft.id, options.sponsorMemberId);
  await saveMeritSection(repository, draft.id, {
    gpaHundredths: 345,
    transcriptSummary: "Transcript on file.",
    essay: VALID_ESSAY,
    activities: ["Volunteer fire company, two years"],
    recommendationFrom: "Head of mathematics",
  });
  if (options.woundedPatriot) {
    await saveWoundedPatriotSection(repository, draft.id, {
      serviceMemberRelationship: "Father, medically retired",
      disabilityEvidence: {
        narrative: "An account of a service-connected injury, in the applicant's own words.",
        claimedServiceConnection: "Service-connected",
        verificationContact: "The sponsoring member",
      },
    });
  }
  const refreshed = await repository.getApplication(draft.id);
  return refreshed!;
}

/* ================================================================== *
 * 1. The eligibility rule is configuration, and the rule under review
 *    appears nowhere.
 * ================================================================== */

const RULE_UNDER_REVIEW = "dependent child of a current jsoa member";

/**
 * Fragments as well as the whole sentence. A rule split across a line break,
 * or paraphrased in a comment "for context", is still the organization
 * asserting it in a file a regulator can read.
 */
const RULE_FRAGMENTS_UNDER_REVIEW = [
  "dependent child",
  "dependent children",
  "child of a current jsoa member",
  "child of a jsoa member",
  "children of members",
  "children of current members",
  "member's child",
  "members' children",
];

describe("the eligibility rule is configuration, not code", () => {
  it("does not appear in any source file in this module", () => {
    for (const file of SOURCES) {
      const lowered = file.text.toLowerCase();
      expect(lowered.includes(RULE_UNDER_REVIEW), file.path).toBe(false);
      for (const fragment of RULE_FRAGMENTS_UNDER_REVIEW) {
        expect(lowered.includes(fragment), `${file.path} contains "${fragment}"`).toBe(false);
      }
    }
  });

  it("does not appear in any seeded or configured value either", () => {
    const configured = {
      rule: ELIGIBILITY_RULE,
      routing: ROUTING_RULE,
      criteria: SCORING_CRITERIA,
      bands: MERIT_BANDS,
    };
    for (const visit of visitAll(configured)) {
      if (typeof visit.value !== "string") continue;
      const lowered = visit.value.toLowerCase();
      expect(lowered.includes(RULE_UNDER_REVIEW), visit.keyPath).toBe(false);
      for (const fragment of RULE_FRAGMENTS_UNDER_REVIEW) {
        expect(lowered.includes(fragment), `${visit.keyPath} contains "${fragment}"`).toBe(false);
      }
    }
  });

  it("carries a status flag and a clearly marked placeholder", () => {
    expect(ELIGIBILITY_RULE.status).toBe("UNDER_LEGAL_REVIEW");
    expect(ELIGIBILITY_RULE.placeholder).toBe(true);
    expect(ELIGIBILITY_RULE.marker.toLowerCase()).toContain("placeholder");
    expect(ELIGIBILITY_RULE.marker.toLowerCase()).toContain("counsel");
    expect(ELIGIBILITY_RULE.criteria).toHaveLength(0);
    expect(eligibilityIsPlaceholder()).toBe(true);
  });

  it("returns UNDETERMINED for every applicant while the placeholder is in force", () => {
    const facts = [
      { enrolmentLevel: "UNDERGRADUATE", accreditedInstitution: true, sponsorInGoodStanding: true, declaredServiceConnection: true },
      { enrolmentLevel: "", accreditedInstitution: false, sponsorInGoodStanding: false, declaredServiceConnection: false },
      { enrolmentLevel: "GRADUATE", accreditedInstitution: true, sponsorInGoodStanding: false, declaredServiceConnection: true },
    ];
    for (const fact of facts) {
      const determination = evaluateEligibility(fact);
      expect(determination.outcome).toBe("UNDETERMINED");
      expect(determination.needsHumanDetermination).toBe(true);
      expect(determination.ruleVersion).toBe(ELIGIBILITY_RULE.version);
    }
  });

  it("is the only file in the module that reads the criteria", () => {
    const readers = LIB_SOURCES.filter(
      (file) => file.base !== "eligibility.ts" && /ELIGIBILITY_RULE\.criteria/.test(file.text),
    ).map((f) => f.path);
    expect(readers).toEqual([]);
  });

  it("is applied through one function, called from one place", () => {
    const callers = LIB_SOURCES.filter(
      (file) => file.base !== "eligibility.ts" && /evaluateEligibility\(/.test(file.text),
    ).map((f) => f.base);
    expect(callers).toEqual(["intake.ts"]);
  });

  it("stamps the rule version onto a submitted application", async () => {
    const repository = repo();
    const draft = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(25),
      sponsorMemberId: seedSponsorMemberId(),
    });
    await submitApplication(repository, draft.id, new Date(), roster());
    const submitted = await repository.getApplication(draft.id);
    expect(submitted!.eligibilityOutcome).toBe("UNDETERMINED");
    expect(submitted!.eligibilityRuleVersion).toBe(ELIGIBILITY_RULE.version);
    expect(submitted!.flags).toContain("ELIGIBILITY_NEEDS_DETERMINATION");
  });
});

/* ================================================================== *
 * 2. The reviewer's file carries no disability documentation.
 * ================================================================== */

/** Keys that would be the evidence, or a piece of it, under any name. */
const SENSITIVE_KEY_PATTERN =
  /disab|medical|diagnos|documentation|evidence|narrative|claimedservice|verificationcontact|servicemember|rating|injur/i;

describe("the reviewer's file withholds the disability documentation", () => {
  it("contains no sensitive field at any nesting depth", async () => {
    const repository = repo();
    const conflicted = seedConflictedPair();
    const application = await firstApplicationWhere(
      repository,
      (a) => a.woundedPatriot !== null && a.id !== conflicted.applicationId,
    );

    // The evidence really is on the application, so this is a withholding test
    // and not a test that the seed happened to be empty.
    expect(application.woundedPatriot!.disabilityEvidence.narrative.length).toBeGreaterThan(10);

    const file = await openReviewFile(repository, actor("scholarship-reviewer"), application.id);

    expect(file).not.toHaveProperty("woundedPatriot");
    for (const visit of visitAll(file)) {
      expect(SENSITIVE_KEY_PATTERN.test(visit.key), `${visit.keyPath} is a withheld field`).toBe(
        false,
      );
    }

    const serialized = JSON.stringify(file);
    expect(serialized).not.toContain(application.woundedPatriot!.disabilityEvidence.narrative);
    expect(serialized).not.toContain(
      application.woundedPatriot!.disabilityEvidence.verificationContact,
    );
    expect(serialized).not.toContain(application.woundedPatriot!.serviceMemberRelationship);
  });

  it("tells the reviewer only that a Wounded Patriot application exists", async () => {
    const repository = repo();
    const conflicted = seedConflictedPair();
    const application = await firstApplicationWhere(
      repository,
      (a) => a.woundedPatriot !== null && a.id !== conflicted.applicationId,
    );
    const file = await openReviewFile(repository, actor("scholarship-reviewer"), application.id);
    expect(file.appliedForWoundedPatriot).toBe(true);
    expect(file.merit).not.toBeNull();
    expect(file.merit!.essay).toBe(application.merit!.essay);
  });

  it("is built by construction, so a new application field cannot leak into it", () => {
    const review = LIB_SOURCES.find((f) => f.base === "review.ts")!;
    // No object spread of the source record into the reviewer's view. A
    // nested array copy is fine; spreading the application is what would let a
    // field added later arrive here without anyone deciding it should.
    expect(review.text).not.toMatch(/\.\.\.application\s*[,}]/);
    expect(review.text).not.toMatch(/\.\.\.input\.application\s*[,}]/);
    expect(review.text).not.toMatch(/\.\.\.woundedPatriot/);
  });

  it("refuses a role with no applicant grant at all", async () => {
    const repository = repo();
    const application = await firstApplicationWhere(repository, () => true);
    await expect(
      openReviewFile(repository, actor("member"), application.id),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      openReviewFile(repository, actor("president-no-mfa"), application.id),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("refuses the whole queue to a role holding only aggregate", async () => {
    const repository = repo();
    // The President holds APPLICANT at AGGREGATE, deliberately, so that
    // leaning on the committee cannot happen quietly.
    await expect(loadReviewQueue(repository, actor("president"))).rejects.toBeInstanceOf(
      AuthzError,
    );
    // And can still see the shape of the cycle.
    await expect(loadCycleOverview(repository, actor("president"))).resolves.toBeTruthy();
  });
});

/* ================================================================== *
 * 3. Conflict blocking, and the log.
 * ================================================================== */

describe("a reviewer related to an applicant cannot open the file", () => {
  it("is refused, and the refusal is logged", async () => {
    const repository = repo();
    const { reviewerPersonId, applicationId } = seedConflictedPair();
    const reviewer = actor("scholarship-reviewer");
    expect(reviewer.personId).toBe(reviewerPersonId);

    await expect(
      openReviewFile(repository, reviewer, applicationId),
    ).rejects.toBeInstanceOf(ConflictBlockedError);

    const log = await repository.listAudit();
    const blocked = log.filter((entry) => entry.action.includes("CONFLICT_BLOCKED"));
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].personId).toBe(reviewerPersonId);
    expect(blocked[0].subjectRef).toBe(applicationId);
    expect(blocked[0].entity).toBe(SCHOLARSHIP_ENTITY);
    expect(blocked[0].rowLevel).toBe(true);
  });

  it("cannot be worked around by recording a score instead", async () => {
    const repository = repo();
    const { applicationId } = seedConflictedPair();
    const points = {} as Record<CriterionKey, number>;
    for (const key of CRITERION_KEYS) points[key] = 1;

    await expect(
      recordScore(repository, actor("scholarship-reviewer"), {
        applicationId,
        points,
        comment: "trying anyway",
      }),
    ).rejects.toBeInstanceOf(ConflictBlockedError);

    expect(await repository.getScoreSheet(applicationId, "dev:scholarship-reviewer")).toBeNull();
    const log = await repository.listAudit();
    expect(log.some((e) => e.action === "RECORD_SCORE:CONFLICT_BLOCKED")).toBe(true);
  });

  it("keeps the blocked file out of the queue, and names no applicant in it", async () => {
    const repository = repo();
    const { applicationId } = seedConflictedPair();
    const application = await repository.getApplication(applicationId);
    const queue = await loadReviewQueue(repository, actor("scholarship-reviewer"));

    expect(queue.waiting.some((row) => row.applicationId === applicationId)).toBe(false);
    expect(queue.done.some((row) => row.applicationId === applicationId)).toBe(false);
    expect(queue.blocked.some((row) => row.reference === application!.reference)).toBe(true);
    expect(JSON.stringify(queue.blocked)).not.toContain(application!.applicant.fullName);
  });

  it("is honoured by the next-file accessor", async () => {
    const repository = repo();
    const conflictedIds = new Set(
      (await repository.listRelationships("dev:scholarship-reviewer")).map((r) => r.applicationId),
    );
    expect(conflictedIds.size).toBeGreaterThan(0);

    const next = await nextForReview(repository, actor("scholarship-reviewer"));
    expect(next.file).not.toBeNull();
    expect(conflictedIds.has(next.file!.applicationId)).toBe(false);
    expect(next.progress.blocked).toBe(conflictedIds.size);
    expect(next.progress.remaining).toBeGreaterThan(0);
    expect(next.progress.total).toBe(
      next.progress.remaining + next.progress.reviewed + next.progress.blocked,
    );
  });

  it("reports remaining and reviewed counts that move when a score is recorded", async () => {
    const repository = repo();
    const reviewer = actor("scholarship-reviewer");
    const before = await reviewProgress(repository, reviewer);
    const next = await nextForReview(repository, reviewer);

    const points = {} as Record<CriterionKey, number>;
    for (const criterion of SCORING_CRITERIA) points[criterion.key] = criterion.maxPoints - 2;
    await recordScore(repository, reviewer, {
      applicationId: next.file!.applicationId,
      points,
      comment: "Scored in a test.",
    });

    const after = await reviewProgress(repository, reviewer);
    expect(after.remaining).toBe(before.remaining - 1);
    expect(after.reviewed).toBe(before.reviewed + 1);
  });

  it("will not let a reviewer record a score in somebody else's name", async () => {
    const repository = repo();
    const application = await firstApplicationWhere(repository, () => true);
    const points = {} as Record<CriterionKey, number>;
    for (const key of CRITERION_KEYS) points[key] = 1;
    await expect(
      recordScore(repository, actor("scholarship-reviewer"), {
        applicationId: application.id,
        points,
        comment: "",
        reviewerPersonId: REVIEWER_PERSON_IDS[1],
      }),
    ).rejects.toBeInstanceOf(AuthzError);
  });
});

/* ================================================================== *
 * 4. Disability verification never runs without a person.
 * ================================================================== */

describe("disability verification cannot run without a human actor", () => {
  it("refuses a blank actor id", async () => {
    const repository = repo();
    const application = await firstApplicationWhere(repository, (a) => a.woundedPatriot !== null);
    await expect(
      recordDisabilityVerification(repository, actor("scholarships"), {
        applicationId: application.id,
        outcome: "VERIFIED",
        method: "SPOKE_TO_APPLICANT",
        note: "Spoke to her.",
        actorPersonId: "   ",
      }),
    ).rejects.toBeInstanceOf(MissingHumanActorError);
  });

  it("refuses an actor who is not the person signed in", async () => {
    const repository = repo();
    const application = await firstApplicationWhere(repository, (a) => a.woundedPatriot !== null);
    await expect(
      recordDisabilityVerification(repository, actor("scholarships"), {
        applicationId: application.id,
        outcome: "VERIFIED",
        method: "SPOKE_TO_APPLICANT",
        note: "Spoke to her.",
        actorPersonId: "dev:president",
      }),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("refuses a verification with no note", async () => {
    const repository = repo();
    const application = await firstApplicationWhere(repository, (a) => a.woundedPatriot !== null);
    const chair = actor("scholarships");
    await expect(
      recordDisabilityVerification(repository, chair, {
        applicationId: application.id,
        outcome: "VERIFIED",
        method: "SPOKE_TO_APPLICANT",
        note: "",
        actorPersonId: chair.personId,
      }),
    ).rejects.toBeInstanceOf(VerificationNoteMissingError);
  });

  it("records the person, the time and the method when it does run", async () => {
    const repository = repo();
    const chair = actor("scholarships");
    const application = await firstApplicationWhere(
      repository,
      (a) => a.woundedPatriot !== null && a.state !== "WITHDRAWN",
    );
    const record = await recordDisabilityVerification(repository, chair, {
      applicationId: application.id,
      outcome: "VERIFIED",
      method: "SPOKE_TO_VERIFICATION_CONTACT",
      note: "Spoke to the contact named on the application.",
      actorPersonId: chair.personId,
    });
    expect(record.verifiedByPersonId).toBe(chair.personId);
    expect(record.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.method).toBe("SPOKE_TO_VERIFICATION_CONTACT");
    expect(qualifiesForWoundedPatriot(record)).toBe(true);
    expect(qualifiesForWoundedPatriot(null)).toBe(false);
  });

  it("is the chair's seat, not merely the sensitive data class", async () => {
    const repository = repo();
    const application = await firstApplicationWhere(repository, (a) => a.woundedPatriot !== null);
    const other = familySupportChair();
    // Holds APPLICANT_SENSITIVE at WRITE on JSOF, and is still refused.
    await expect(
      recordDisabilityVerification(repository, other, {
        applicationId: application.id,
        outcome: "VERIFIED",
        method: "COMMITTEE_REVIEW",
        note: "Not my case file.",
        actorPersonId: other.personId,
      }),
    ).rejects.toBeInstanceOf(AuthzError);
    const log = await repository.listAudit();
    expect(log.some((entry) => entry.action.includes("NOT_THE_CHAIR"))).toBe(true);
  });

  it("refuses a scorer outright", async () => {
    const repository = repo();
    const application = await firstApplicationWhere(repository, (a) => a.woundedPatriot !== null);
    const reviewer = actor("scholarship-reviewer");
    await expect(
      recordDisabilityVerification(repository, reviewer, {
        applicationId: application.id,
        outcome: "VERIFIED",
        method: "COMMITTEE_REVIEW",
        note: "Not mine to do.",
        actorPersonId: reviewer.personId,
      }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(loadVerificationQueue(repository, reviewer)).rejects.toBeInstanceOf(AuthzError);
  });

  it("has no auto-approving path anywhere in the module's source", () => {
    const forbidden = [
      "autoverify",
      "auto_verify",
      "autoapprove",
      "auto_approve",
      "verifyall",
      "verify_all",
      "systemverified",
      "system_actor",
      "systemactor",
      "bulkverify",
    ];
    for (const file of SOURCES) {
      const lowered = file.text.toLowerCase();
      for (const token of forbidden) {
        expect(lowered.includes(token), `${file.path} contains "${token}"`).toBe(false);
      }
    }
  });

  it("writes a verification from exactly one function", () => {
    const callers = LIB_SOURCES.filter((file) => /\.recordVerification\(/.test(file.text)).map(
      (f) => f.base,
    );
    expect(callers).toEqual(["verification.ts"]);
  });

  it("never assigns a verified outcome as a literal outside the seed", () => {
    const offenders = LIB_SOURCES.filter(
      (file) => file.base !== "seed.ts" && /outcome:\s*"VERIFIED"/.test(file.text),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("requires the actor on the record type itself", () => {
    const types = LIB_SOURCES.find((f) => f.base === "types.ts")!;
    expect(types.text).toMatch(/verifiedByPersonId:\s*string;/);
    expect(types.text).not.toMatch(/verifiedByPersonId\?:/);
    expect(types.text).not.toMatch(/verifiedByPersonId:\s*string\s*\|\s*null/);
    expect(types.text).toMatch(/verifiedAt:\s*string;/);
  });

  it("requires an actor on every verification function signature", () => {
    const verification = LIB_SOURCES.find((f) => f.base === "verification.ts")!;
    expect(verification.text).toMatch(/actorPersonId:\s*string;/);
    // No default value is supplied for the actor anywhere.
    expect(verification.text).not.toMatch(/actorPersonId\s*=\s*/);
  });
});

/* ================================================================== *
 * 5. Patriot Foundation routing, before anything is collected.
 * ================================================================== */

describe("Patriot Foundation routing runs before any personal data is collected", () => {
  it("asks the three questions that decide it", () => {
    expect(ROUTING_QUESTIONS.map((q) => q.key)).toEqual([
      "ncResident",
      "attendingNcSchool",
      "applyingForWoundedPatriot",
    ]);
  });

  it("sends a North Carolina resident at a North Carolina school away", () => {
    const decision = decideRouting({
      ncResident: true,
      attendingNcSchool: true,
      applyingForWoundedPatriot: true,
    });
    expect(decision.outcome).toBe("APPLY_TO_PATRIOT_FOUNDATION");
    expect(isRoutedAway(decision)).toBe(true);
    expect(decision.referral?.name).toBe(PATRIOT_FOUNDATION.name);
    expect(decision.referral?.href).toBe(PATRIOT_FOUNDATION.href);
    expect(decision.explanation.toLowerCase()).toContain("patriot foundation");
    expect(decision.explanation.toLowerCase()).toContain("north carolina");
    expect(programsOpenTo(decision)).toEqual({ merit: false, woundedPatriot: false });
  });

  it("sends them away whether or not they asked for Wounded Patriot", () => {
    for (const applyingForWoundedPatriot of [true, false]) {
      const decision = decideRouting({
        ncResident: true,
        attendingNcSchool: true,
        applyingForWoundedPatriot,
      });
      expect(decision.outcome).toBe("APPLY_TO_PATRIOT_FOUNDATION");
    }
    expect(ROUTING_RULE.requiresWoundedPatriot).toBe(false);
  });

  it("keeps everyone else here", () => {
    const cases = [
      { ncResident: true, attendingNcSchool: false, applyingForWoundedPatriot: true },
      { ncResident: false, attendingNcSchool: true, applyingForWoundedPatriot: true },
      { ncResident: false, attendingNcSchool: false, applyingForWoundedPatriot: false },
    ];
    for (const answers of cases) {
      const decision = decideRouting(answers);
      expect(decision.outcome).toBe("CONTINUE_HERE");
      expect(decision.referral).toBeNull();
    }
  });

  it("creates no record and collects nothing from a routed applicant", async () => {
    const repository = repo();
    const before = await repository.listApplications();

    let thrown: unknown = null;
    try {
      await startApplication(repository, {
        ncResident: true,
        attendingNcSchool: true,
        applyingForWoundedPatriot: true,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RoutedAwayError);
    expect((thrown as RoutedAwayError).decision.referral?.href).toBe(PATRIOT_FOUNDATION.href);

    const after = await repository.listApplications();
    expect(after).toHaveLength(before.length);
    // And nothing was written under any state, including a half-made draft.
    expect(after.some((a) => a.applicant.fullName === "")).toBe(false);
  });

  it("is the first step of the form, ahead of the applicant's own details", () => {
    const steps = stepsFor(null).map((s) => s.key);
    expect(steps[0]).toBe("routing");
    expect(steps.indexOf("routing")).toBeLessThan(steps.indexOf("applicant"));
  });

  it("gates the whole form: there is no other way to create a draft", () => {
    const intake = LIB_SOURCES.find((f) => f.base === "intake.ts")!;
    const createCalls = intake.text.match(/\.createDraft\(/g) ?? [];
    expect(createCalls).toHaveLength(1);
    // And that one call sits after the routing check.
    const routingIndex = intake.text.indexOf("if (isRoutedAway(routing)) throw");
    const createIndex = intake.text.indexOf(".createDraft(");
    expect(routingIndex).toBeGreaterThan(-1);
    expect(routingIndex).toBeLessThan(createIndex);
  });
});

/* ================================================================== *
 * 6. Minors.
 * ================================================================== */

describe("minors", () => {
  it("collects nothing at all from an applicant under 13", async () => {
    const repository = repo();
    const draft = await startApplication(repository, {
      ncResident: false,
      attendingNcSchool: false,
      applyingForWoundedPatriot: false,
    });

    await expect(
      saveApplicantDetails(repository, draft.id, {
        fullName: "Too Young Appleby",
        email: "too.young@example.org",
        phone: "(910) 555-0199",
        dateOfBirth: bornYearsAgo(11),
        residenceState: "VA",
      }),
    ).rejects.toBeInstanceOf(TooYoungError);

    expect(await repository.getApplication(draft.id)).toBeNull();
    const everything = JSON.stringify(await repository.listApplications());
    expect(everything).not.toContain("Too Young Appleby");
    expect(everything).not.toContain("too.young@example.org");
  });

  it("knows where the two lines are", () => {
    expect(MINIMUM_AGE).toBe(13);
    expect(AGE_OF_MAJORITY).toBe(18);
    expect(ageGate(bornYearsAgo(12)).decision).toBe("REFUSE_COLLECTION");
    expect(ageGate(bornYearsAgo(13)).decision).toBe("GUARDIAN_CONSENT_REQUIRED");
    expect(ageGate(bornYearsAgo(17)).decision).toBe("GUARDIAN_CONSENT_REQUIRED");
    expect(ageGate(bornYearsAgo(18)).decision).toBe("MAY_PROCEED");
    expect(ageGate("").decision).toBe("DATE_OF_BIRTH_NOT_GIVEN");
  });

  it("will not let an under-18 application proceed without a guardian consent record", async () => {
    const repository = repo();
    const draft = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(16),
      sponsorMemberId: seedSponsorMemberId(),
      email: "sixteen.applicant@example.org",
    });
    expect(draft.flags).toContain("APPLICANT_IS_A_MINOR");
    expect(await repository.getGuardianConsentForApplication(draft.id)).toBeNull();

    await expect(
      submitApplication(repository, draft.id, new Date(), roster()),
    ).rejects.toBeInstanceOf(GuardianConsentMissingError);

    const stillDraft = await repository.getApplication(draft.id);
    expect(stillDraft!.state).toBe("DRAFT");
    expect(stillDraft!.submittedAt).toBeNull();
  });

  it("captures the consent as a separate record, in the guardian's own name", async () => {
    const repository = repo();
    const draft = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(16),
      sponsorMemberId: seedSponsorMemberId(),
      email: "sixteen.applicant@example.org",
    });

    const consent = await recordGuardianConsent(repository, draft.id, {
      guardianName: "Marguerite Pemberton-Hale",
      guardianEmail: "marguerite.ph@example.org",
      guardianPhone: "(910) 555-0202",
      relationship: "PARENT",
      affirmed: true,
    });

    // A record of its own, with the guardian's own details, not a flag on the
    // application. The application only points at it.
    expect(consent.applicationId).toBe(draft.id);
    expect(consent.guardianEmail).not.toBe(draft.applicant.email);
    expect(consent.statementVersion).toBe(GUARDIAN_CONSENT_STATEMENT_VERSION);
    expect(consent.consentedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const linked = await repository.getApplication(draft.id);
    expect(linked!.guardianConsentId).toBe(consent.id);
    expect(await repository.getGuardianConsent(consent.id)).not.toBeNull();

    const acknowledgment = await submitApplication(repository, draft.id, new Date(), roster());
    expect(acknowledgment.received).toBe(true);
    expect((await repository.getApplication(draft.id))!.state).toBe("SUBMITTED");
  });

  it("refuses a consent record that was not affirmed", async () => {
    const repository = repo();
    const draft = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(16),
      sponsorMemberId: seedSponsorMemberId(),
    });
    await expect(
      recordGuardianConsent(repository, draft.id, {
        guardianName: "Someone",
        guardianEmail: "someone@example.org",
        guardianPhone: "(910) 555-0203",
        relationship: "PARENT",
        affirmed: false,
      }),
    ).rejects.toBeInstanceOf(GuardianAffirmationMissingError);
    expect(await repository.getGuardianConsentForApplication(draft.id)).toBeNull();
  });

  it("adds the guardian step only for a minor", async () => {
    const repository = repo();
    const minor = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(16),
      sponsorMemberId: seedSponsorMemberId(),
      email: "minor.steps@example.org",
    });
    const adult = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(25),
      sponsorMemberId: seedSponsorMemberId(),
      email: "adult.steps@example.org",
    });
    expect(stepsFor(minor).map((s) => s.key)).toContain("guardian");
    expect(stepsFor(adult).map((s) => s.key)).not.toContain("guardian");
  });

  it("has no field anywhere for a national identifier or a document upload", () => {
    // Field-shaped, not prose-shaped. Several files SAY we refuse a DD-214,
    // which is the point; what must not exist is somewhere to put one.
    const forbiddenSource = [
      'name="ssn"',
      "socialsecuritynumber",
      'type="file"',
      "enctype",
      "multipart/form-data",
      "formdata.get(\"file",
    ];
    const forbiddenField = [
      /\bssn\s*[?]?:/i,
      /dd[_-]?214\s*[?]?:/i,
      /\b(upload|attachment|documentUrl|fileName|mimeType)\s*[?]?:/i,
    ];
    for (const file of SOURCES) {
      const lowered = file.text.toLowerCase();
      for (const token of forbiddenSource) {
        expect(lowered.includes(token.toLowerCase()), `${file.path} contains "${token}"`).toBe(
          false,
        );
      }
      for (const pattern of forbiddenField) {
        expect(pattern.test(file.text), `${file.path} declares ${pattern}`).toBe(false);
      }
    }
  });

  it("has no field for an attachment on any seeded record", async () => {
    const repository = repo();
    const everything = {
      applications: await repository.listApplications(),
      cheques: await repository.listCheques(),
      awards: await repository.listAwards(),
      selectionRecords: await repository.listSelectionRecords(),
    };
    const forbiddenKey = /ssn$|socialsecurity|dd214|upload|attachment|filename|mimetype|documenturl/i;
    for (const visit of visitAll(everything)) {
      expect(forbiddenKey.test(visit.key), `${visit.keyPath} is a forbidden field`).toBe(false);
    }
  });
});

/* ================================================================== *
 * The automatic membership check.
 * ================================================================== */

describe("the sponsoring member's standing is checked automatically", () => {
  it("reads the roster rather than a copy of it", async () => {
    const check = await checkSponsor(seedSponsorMemberId(), new Date(), roster());
    expect(check.onRoster).toBe(true);
    expect(check.inGoodStanding).toBe(true);
    expect(check.rosterMemberId).not.toBeNull();
    expect(check.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("flags an ID that matches nobody, and one that is not even well formed", async () => {
    const unknown = await checkSponsor("JSOA-1999-9999", new Date(), roster());
    expect(unknown.onRoster).toBe(false);
    expect(unknown.inGoodStanding).toBe(false);
    expect(unknown.rosterMemberId).toBeNull();
    expect(unknown.sponsorName).toBeNull();

    const malformed = await checkSponsor("not a member id", new Date(), roster());
    expect(malformed.onRoster).toBe(false);
  });

  it("runs on submission and writes what it found to the chair's flags", async () => {
    const repository = repo();
    const good = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(25),
      sponsorMemberId: seedSponsorMemberId(),
      email: "good.sponsor@example.org",
    });
    const bad = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(25),
      sponsorMemberId: "JSOA-1999-9999",
      email: "bad.sponsor@example.org",
    });

    await submitApplication(repository, good.id, new Date(), roster());
    await submitApplication(repository, bad.id, new Date(), roster());

    const goodAfter = await repository.getApplication(good.id);
    const badAfter = await repository.getApplication(bad.id);
    expect(goodAfter!.sponsor!.onRoster).toBe(true);
    expect(goodAfter!.flags).not.toContain("SPONSOR_NOT_ON_ROSTER");
    expect(badAfter!.sponsor!.onRoster).toBe(false);
    expect(badAfter!.flags).toContain("SPONSOR_NOT_ON_ROSTER");
  });

  it("gives the applicant the same acknowledgment either way", async () => {
    const repository = repo();
    const good = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(25),
      sponsorMemberId: seedSponsorMemberId(),
      email: "ack.good@example.org",
    });
    const bad = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(25),
      sponsorMemberId: "JSOA-1999-9999",
      email: "ack.bad@example.org",
    });
    const malformed = await completeDraft(repository, {
      dateOfBirth: bornYearsAgo(25),
      sponsorMemberId: "nonsense",
      email: "ack.malformed@example.org",
    });

    const acks = [];
    for (const draft of [good, bad, malformed]) {
      acks.push(await submitApplication(repository, draft.id, new Date(), roster()));
    }

    // Same shape, same keys, same message, and nothing sponsor-derived.
    const shapes = acks.map((ack) => Object.keys(ack).sort().join(","));
    expect(new Set(shapes).size).toBe(1);
    const messages = new Set(acks.map((ack) => ack.message));
    expect(messages.size).toBe(1);
    for (const ack of acks) {
      expect(ack.received).toBe(true);
      // Nothing the roster said reaches the applicant. The message does name
      // the sponsoring member, identically in all three cases, because the
      // sponsor is copied on the decision either way.
      expect(JSON.stringify(ack).toLowerCase()).not.toContain("roster");
      expect(JSON.stringify(ack).toLowerCase()).not.toContain("good standing");
      expect(JSON.stringify(ack).toLowerCase()).not.toContain("not on");
      expect(JSON.stringify(ack).toLowerCase()).not.toContain("verified");
    }

    // A replayed submit on a draft that no longer exists answers the same way.
    const replay = await submitApplication(repository, "nope", new Date(), roster());
    expect(replay.message).toBe(acks[0].message);
    expect(Object.keys(replay).sort()).toEqual(Object.keys(acks[0]).sort());
  });
});

/* ================================================================== *
 * Scoring and the bands.
 * ================================================================== */

describe("the score drives the Merit band", () => {
  it("publishes criteria that add up to the maximum", () => {
    expect(MAX_SCORE).toBe(100);
    expect(SCORING_CRITERIA.reduce((sum, c) => sum + c.maxPoints, 0)).toBe(MAX_SCORE);
    for (const criterion of SCORING_CRITERIA) {
      expect(criterion.published.length).toBeGreaterThan(20);
    }
  });

  it("bands a score by arithmetic, inside the chair's range", () => {
    expect(meritBandFor(MERIT_FLOOR_SCORE - 1)).toBeNull();
    expect(meritBandFor(50)!.amountCents).toBe(50_000);
    expect(meritBandFor(59)!.amountCents).toBe(50_000);
    expect(meritBandFor(60)!.amountCents).toBe(100_000);
    expect(meritBandFor(70)!.amountCents).toBe(150_000);
    expect(meritBandFor(80)!.amountCents).toBe(200_000);
    expect(meritBandFor(90)!.amountCents).toBe(250_000);
    expect(meritBandFor(100)!.amountCents).toBe(250_000);
    for (const band of MERIT_BANDS) {
      expect(band.amountCents).toBeGreaterThanOrEqual(50_000);
      expect(band.amountCents).toBeLessThanOrEqual(250_000);
      expect(Number.isInteger(band.amountCents)).toBe(true);
    }
  });

  it("previews an amount without committing anything", async () => {
    const repository = repo();
    const before = await repository.listAwards({ cycleId: CURRENT_CYCLE_ID });

    const low = previewMeritAward(42);
    expect(low.amountCents).toBeNull();
    expect(low.band).toBeNull();
    expect(low.eligibleForTopWinner).toBe(false);

    const mid = previewMeritAward(76);
    expect(mid.amountCents).toBe(150_000);
    expect(mid.basis).toContain("76");

    const top = previewMeritAward(96);
    expect(top.amountCents).toBe(250_000);
    expect(top.eligibleForTopWinner).toBe(true);
    expect(top.topWinnerAmountCents).toBe(TOP_WINNER.amountCents);

    const flat = previewWoundedPatriotAward();
    expect(flat.amountCents).toBe(WOUNDED_PATRIOT.amountCents);
    expect(flat.amountConfirmed).toBe(false);

    expect(await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).toHaveLength(before.length);
  });

  it("never reaches the top award by score alone", async () => {
    const repository = repo();
    const sheets = await repository.listScoreSheetsForApplications(
      (await repository.listApplications({ cycleId: CURRENT_CYCLE_ID })).map((a) => a.id),
    );
    expect(sheets.length).toBeGreaterThan(400);

    const high = await firstApplicationWhere(repository, (a) => a.state !== "WITHDRAWN");
    const withoutDesignation = await proposalFor(repository, high.id, {});
    if (withoutDesignation.merit) {
      expect(withoutDesignation.merit.amountCents).not.toBe(TOP_WINNER.amountCents);
    }
  });

  it("averages the committee and surfaces a wide spread rather than hiding it", () => {
    const base = {
      id: "x",
      entity: SCHOLARSHIP_ENTITY,
      applicationId: "a",
      points: {} as Record<CriterionKey, number>,
      comment: "",
      scoredAt: "2026-01-01T00:00:00.000Z",
    };
    const score = committeeScore([
      { ...base, reviewerPersonId: "one", total: 90 },
      { ...base, reviewerPersonId: "two", total: 50 },
    ]);
    expect(score!.average).toBe(70);
    expect(score!.spread).toBe(40);
    expect(score!.high).toBe(90);
    expect(score!.low).toBe(50);
    expect(committeeScore([])).toBeNull();
  });

  it("reports a reviewer's running average against the cycle's", async () => {
    const repository = repo();
    const calibration = await reviewerCalibration(repository, actor("scholarships"), undefined, REVIEWER_PERSON_IDS[1]);
    expect(calibration.reviewerPersonId).toBe(REVIEWER_PERSON_IDS[1]);
    expect(calibration.reviewerSheets).toBeGreaterThan(100);
    expect(calibration.cycleSheets).toBeGreaterThan(calibration.reviewerSheets);
    expect(calibration.reviewerAverage).not.toBeNull();
    expect(calibration.cycleAverage).not.toBeNull();
    expect(calibration.delta).toBe(calibration.reviewerAverage! - calibration.cycleAverage!);
    expect(calibration.sharedFiles).toBeGreaterThan(0);
    await expect(reviewerCalibration(repository, actor("member"))).rejects.toBeInstanceOf(
      AuthzError,
    );
  });

  it("refuses a score outside a criterion's range", async () => {
    const repository = repo();
    const next = await nextForReview(repository, actor("scholarship-reviewer"));
    const points = {} as Record<CriterionKey, number>;
    for (const key of CRITERION_KEYS) points[key] = 0;
    points.ACADEMIC_RECORD = 31;
    await expect(
      recordScore(repository, actor("scholarship-reviewer"), {
        applicationId: next.file!.applicationId,
        points,
        comment: "",
      }),
    ).rejects.toThrow(/outside 0 to 30/);
  });
});

/* ================================================================== *
 * 7. The award amount is a field, and the sponsor is a recipient.
 * ================================================================== */

describe("the award amount is a field on the record, merged into the notification", () => {
  it("carries the sponsoring member as a named recipient, not a bcc", async () => {
    const repository = repo();
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).find(
      (a) => a.boardReview === null,
    )!;
    const application = (await repository.getApplication(award.applicationId))!;
    expect(application.sponsor!.sponsorEmail).toBeTruthy();

    const notification = buildAwardNotification({
      award,
      application,
      consent: null,
      schoolName: "Carrington State University",
    });

    const roles = notification.recipients.map((r) => r.role);
    expect(roles).toContain("APPLICANT");
    expect(roles).toContain("SPONSOR");

    const sponsor = notification.recipients.find((r) => r.role === "SPONSOR")!;
    expect(sponsor.address).toBe(application.sponsor!.sponsorEmail);
    expect(sponsor.because.length).toBeGreaterThan(10);

    // No bcc, no hidden copy, at any depth, and none in the type either.
    for (const visit of visitAll(notification)) {
      expect(/bcc|blindcopy|hidden/i.test(visit.key), visit.keyPath).toBe(false);
    }
    // The types say in prose that there is no bcc. What must not exist is a
    // declared one.
    for (const file of LIB_SOURCES) {
      expect(/\bb?cc\s*[?]?:/i.test(file.text), `${file.path} declares a copy field`).toBe(false);
    }
  });

  it("merges the amount from the record rather than from anything typed", async () => {
    const repository = repo();
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).find(
      (a) => a.boardReview === null,
    )!;
    const application = (await repository.getApplication(award.applicationId))!;
    const notification = buildAwardNotification({
      award,
      application,
      consent: null,
      schoolName: "Carrington State University",
    });

    expect(notification.mergedAmountCents).toBe(award.amountCents);
    expect(notification.body).toContain(formatCents(award.amountCents));
    expect(notification.subject).toContain(formatCents(award.amountCents));
    expect(Number.isInteger(award.amountCents)).toBe(true);
  });

  it("still fills the sponsor slot when the roster did not resolve an address", async () => {
    const repository = repo();
    const application = (await firstApplicationWhere(
      repository,
      (a) => a.sponsor !== null && a.sponsor.sponsorEmail === null,
    ))!;
    const recipients = recipientsFor(application, null);
    const sponsor = recipients.find((r) => r.role === "SPONSOR");
    expect(sponsor).toBeDefined();
    expect(sponsor!.address).toContain("@");
    expect(sponsor!.because.toLowerCase()).toContain("could not be matched");
  });

  it("copies the guardian as well when the applicant is a minor", async () => {
    const repository = repo();
    const application = await firstApplicationWhere(
      repository,
      (a) => a.guardianConsentId !== null,
    );
    const consent = (await repository.getGuardianConsentForApplication(application.id))!;
    const recipients = recipientsFor(application, consent);
    expect(recipients.map((r) => r.role)).toEqual(
      expect.arrayContaining(["APPLICANT", "SPONSOR", "GUARDIAN"]),
    );
    expect(recipients.find((r) => r.role === "GUARDIAN")!.address).toBe(consent.guardianEmail);
  });

  it("queues a message with the sponsor on it, and marks the award notified", async () => {
    clearOutbox();
    const repository = repo();
    const chair = actor("scholarships");
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).find(
      (a) => a.status === "APPROVED" && a.boardReview === null,
    )!;

    const notification = await sendAwardNotification(repository, chair, award.id);
    expect(notification.recipients.map((r) => r.role)).toContain("SPONSOR");

    const queued = readOutbox().filter((m) => m.kind === "AWARD_NOTIFICATION");
    expect(queued.length).toBe(1);
    expect(queued[0].recipients.map((r) => r.role)).toContain("SPONSOR");
    expect(queued[0]).not.toHaveProperty("bcc");

    const after = await repository.getAward(award.id);
    expect(after!.status).toBe("NOTIFIED");
    expect(after!.notifiedAt).not.toBeNull();
    clearOutbox();
  });

  it("previews the notification without sending it", async () => {
    clearOutbox();
    const repository = repo();
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID }))[0];
    const preview = await awardNotificationFor(repository, actor("scholarships"), award.id);
    expect(preview.mergedAmountCents).toBe(award.amountCents);
    expect(readOutbox()).toHaveLength(0);
    expect((await repository.getAward(award.id))!.status).toBe(award.status);
  });

  it("refuses to notify on an award that is not approved", async () => {
    const repository = repo();
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).find(
      (a) => a.status === "BOARD_REVIEW",
    )!;
    await expect(
      sendAwardNotification(repository, actor("scholarships"), award.id),
    ).rejects.toThrow(/not been approved/);
  });

  it("keeps the cheque run away from the people scoring the applications", async () => {
    // A reviewer holds APPLICANT READ in order to score. Reading the cheque
    // run on that grant handed the whole disbursement to a volunteer scorer.
    // The financial arm is unchanged, so the Finance Review Officer still
    // reads it at READ, which is the independent review it exists for.
    const repository = repo();
    await expect(
      loadChequeRun(repository, actor("scholarship-reviewer")),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(loadChequeRun(repository, actor("scholarships"))).resolves.toBeTruthy();
    await expect(loadChequeRun(repository, actor("treasurer-jsof"))).resolves.toBeTruthy();
  });

  it("keeps the awards board away from the people scoring the applications", async () => {
    // A reviewer holds APPLICANT READ so they can score. The board carries
    // every amount, and a scorer who knows three points is worth $1,000 is no
    // longer scoring independently of the money. Same reasoning as withholding
    // the disability evidence from them.
    const repository = repo();
    await expect(
      loadAwardsBoard(repository, actor("scholarship-reviewer")),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      loadCycleExceptions(repository, actor("scholarship-reviewer")),
    ).rejects.toBeInstanceOf(AuthzError);
    // The chair, who decides them, still can.
    await expect(loadAwardsBoard(repository, actor("scholarships"))).resolves.toBeTruthy();
  });

  it("refuses the awards screens to the wrong role", async () => {
    const repository = repo();
    await expect(loadAwardsBoard(repository, actor("member"))).rejects.toBeInstanceOf(AuthzError);
    await expect(loadAwardRows(repository, actor("president"))).rejects.toBeInstanceOf(AuthzError);
    await expect(
      sendAwardNotification(repository, actor("scholarship-reviewer"), "whatever"),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("reports the cycle's bands against the chair's own figures", async () => {
    const repository = repo();
    const board = await loadAwardsBoard(repository, actor("scholarships"));
    expect(board.applications).toBe(SEEDED_APPLICATION_COUNT);
    expect(board.meritAwards).toBe(SEEDED_MERIT_AWARD_COUNT);
    expect(board.woundedPatriotAwards).toBe(SEEDED_WOUNDED_PATRIOT_AWARD_COUNT);
    expect(board.meritAwards + board.woundedPatriotAwards).toBe(183);
    expect(board.topWinners).toHaveLength(1);
    expect(board.totalCents).toBe(board.meritTotalCents + board.woundedPatriotTotalCents);
    expect(board.bands.reduce((sum, b) => sum + b.count, 0)).toBe(
      board.meritAwards - board.topWinners.length,
    );
  });
});

/* ================================================================== *
 * A board member's dependent goes to the full board.
 * ================================================================== */

describe("an award to a board member's dependent goes to the full board", () => {
  it("is surfaced with the member recused, and is not approved", async () => {
    const repository = repo();
    const application = await firstApplicationWhere(
      repository,
      (a) => a.boardMemberPersonId !== null,
    );
    const created = await proposeAwards(repository, actor("scholarships"), application.id);
    expect(created.length).toBeGreaterThan(0);
    for (const award of created) {
      expect(award.status).toBe("BOARD_REVIEW");
      expect(award.boardReview).not.toBeNull();
      expect(award.boardReview!.recusedPersonId).toBe(application.boardMemberPersonId);
      expect(award.boardReview!.outcome).toBeNull();
      expect(award.decidedByPersonId).toBeNull();
    }
  });

  it("cannot be approved by the chair on her own", async () => {
    const repository = repo();
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).find(
      (a) => a.boardReview !== null && a.boardReview.outcome === null,
    )!;
    await expect(
      approveAward(repository, actor("scholarships"), award.id),
    ).rejects.toBeInstanceOf(BoardReviewRequiredError);
    expect((await repository.getAward(award.id))!.status).toBe("BOARD_REVIEW");
  });

  it("refuses a decision that includes the recused member among its approvers", async () => {
    const repository = repo();
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).find(
      (a) => a.boardReview !== null && a.boardReview.outcome === null,
    )!;
    await expect(
      recordFullBoardDecision(repository, actor("scholarships"), {
        awardId: award.id,
        outcome: "APPROVED",
        minuteRef: "JSOF-2027-02-min-4",
        approverPersonIds: [
          "dev:vp-ops",
          "dev:secretary",
          award.boardReview!.recusedPersonId,
        ],
      }),
    ).rejects.toBeInstanceOf(RecusedApproverError);
  });

  it("refuses a decision with no minute reference or too few approvers", async () => {
    const repository = repo();
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).find(
      (a) => a.boardReview !== null && a.boardReview.outcome === null,
    )!;
    await expect(
      recordFullBoardDecision(repository, actor("scholarships"), {
        awardId: award.id,
        outcome: "APPROVED",
        minuteRef: "   ",
        approverPersonIds: ["dev:vp-ops", "dev:secretary", "dev:president"],
      }),
    ).rejects.toThrow(/minute reference/);

    await expect(
      recordFullBoardDecision(repository, actor("scholarships"), {
        awardId: award.id,
        outcome: "APPROVED",
        minuteRef: "JSOF-2027-02-min-4",
        approverPersonIds: ["dev:vp-ops"],
      }),
    ).rejects.toThrow(new RegExp(`${FULL_BOARD_MINIMUM_APPROVERS} named approvers`));
  });

  it("refuses the person who proposed the award as one of its approvers", async () => {
    const repository = repo();
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).find(
      (a) => a.boardReview !== null && a.boardReview.outcome === null,
    )!;
    expect(award.boardReview!.requestedByPersonId).toBe("dev:scholarships");
    await expect(
      recordFullBoardDecision(repository, actor("scholarships"), {
        awardId: award.id,
        outcome: "APPROVED",
        minuteRef: "JSOF-2027-02-min-4",
        // The chair may write down what the board decided. She may not be one
        // of the people who decided it, because she proposed it.
        approverPersonIds: ["dev:vp-ops", "dev:secretary", "dev:scholarships"],
      }),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
    expect((await repository.getAward(award.id))!.status).toBe("BOARD_REVIEW");
  });

  it("refuses a full-board decision from a role with no applicant write", async () => {
    const repository = repo();
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).find(
      (a) => a.boardReview !== null && a.boardReview.outcome === null,
    )!;
    for (const persona of ["president", "secretary", "scholarship-reviewer", "member"]) {
      await expect(
        recordFullBoardDecision(repository, actor(persona), {
          awardId: award.id,
          outcome: "APPROVED",
          minuteRef: "JSOF-2027-02-min-4",
          approverPersonIds: ["dev:vp-ops", "dev:secretary", "dev:fundraising"],
        }),
      ).rejects.toBeInstanceOf(AuthzError);
    }
  });

  it("records a proper decision with the minute reference and the approvers", async () => {
    const repository = repo();
    const award = (await repository.listAwards({ cycleId: CURRENT_CYCLE_ID })).find(
      (a) => a.boardReview !== null && a.boardReview.outcome === null,
    )!;
    const decided = await recordFullBoardDecision(repository, actor("scholarships"), {
      awardId: award.id,
      outcome: "APPROVED",
      minuteRef: "JSOF-2027-02-min-4",
      approverPersonIds: ["dev:vp-ops", "dev:secretary", "dev:fundraising"],
    });
    expect(decided.status).toBe("APPROVED");
    expect(decided.boardReview!.outcome).toBe("APPROVED");
    expect(decided.boardReview!.minuteRef).toBe("JSOF-2027-02-min-4");
    expect(decided.boardReview!.approverPersonIds).toHaveLength(3);
  });

  it("is listed in the cycle's exceptions", async () => {
    const repository = repo();
    const exceptions = await loadCycleExceptions(repository, actor("scholarships"));
    expect(exceptions.boardMemberDependents.length).toBeGreaterThan(0);
    for (const row of exceptions.boardMemberDependents) {
      expect(row.recusedPersonId).toBeTruthy();
    }
    expect(exceptions.nearBandBoundary.length).toBeGreaterThan(0);
    expect(exceptions.sponsorProblems.length).toBeGreaterThan(0);
    expect(exceptions.verificationsOutstanding.length).toBeGreaterThan(0);
    await expect(loadCycleExceptions(repository, actor("member"))).rejects.toBeInstanceOf(
      AuthzError,
    );
  });
});

/* ================================================================== *
 * Disbursement: the payee is the school.
 * ================================================================== */

describe("the cheque run pays the school, not the student", () => {
  it("is readable by the Treasurer, who holds no applicant grant at all", async () => {
    const repository = repo();
    const run = await loadChequeRun(repository, actor("treasurer-jsof"));
    expect(run.readVia).toBe("FINANCIAL");
    expect(run.queued.length + run.mailed.length).toBeGreaterThan(0);
  });

  it("is readable by the chair, who holds no financial grant at all", async () => {
    const repository = repo();
    const run = await loadChequeRun(repository, actor("scholarships"));
    expect(run.readVia).toBe("APPLICANT");
  });

  it("is refused to a role holding neither", async () => {
    const repository = repo();
    await expect(loadChequeRun(repository, actor("member"))).rejects.toBeInstanceOf(AuthzError);
    await expect(
      loadChequeRun(repository, actor("president-no-mfa")),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      markChequeMailed(repository, actor("scholarship-reviewer"), "whatever"),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("names a school as payee and no applicant anywhere", async () => {
    const repository = repo();
    const run = await loadChequeRun(repository, actor("treasurer-jsof"));
    const schools = new Set((await repository.listSchools()).map((s) => s.payableTo));
    const applicantNames = (await repository.listApplications()).map(
      (a) => a.applicant.fullName,
    );

    for (const row of [...run.queued, ...run.mailed].slice(0, 40)) {
      expect(schools.has(row.cheque.payableTo)).toBe(true);
      expect(row.cheque.addressLines.length).toBeGreaterThan(0);
      expect(row.cheque.postalCode).toMatch(/^\d{5}$/);
      for (const name of applicantNames) {
        expect(row.cheque.memoReference).not.toContain(name);
      }
    }
  });

  it("exports a cheque run with no applicant name in it", async () => {
    const repository = repo();
    const csv = await chequeRunCsv(repository, actor("treasurer-jsof"));
    const applicantNames = (await repository.listApplications()).map((a) => a.applicant.fullName);
    for (const name of applicantNames) {
      expect(csv).not.toContain(name);
    }
    expect(csv.split("\n")[0]).toContain("payable_to");
    expect(csv.split("\n")[0]).toContain("amount_usd");
    // Amounts are rendered from integer cents, never from a float.
    expect(csv).toMatch(/,\d+\.\d{2},/);
  });

  it("tracks mailed status, and does not re-mail", async () => {
    const repository = repo();
    const chair = actor("scholarships");
    const run = await loadChequeRun(repository, chair);
    const queued = run.queued[0].cheque;

    const mailed = await markChequeMailed(repository, chair, queued.id, "First class, bundled.");
    expect(mailed.status).toBe("MAILED");
    expect(mailed.mailedByPersonId).toBe(chair.personId);
    expect(mailed.mailedAt).not.toBeNull();
    expect(mailed.note).toBe("First class, bundled.");

    const again = await markChequeMailed(repository, chair, queued.id);
    expect(again.mailedAt).toBe(mailed.mailedAt);
  });

  it("builds the run idempotently and does not double-pay", async () => {
    const repository = repo();
    const chair = actor("scholarships");
    const before = (await repository.listCheques(CURRENT_CYCLE_ID)).length;
    const first = await buildChequeRun(repository, chair, CURRENT_CYCLE_ID);
    const second = await buildChequeRun(repository, chair, CURRENT_CYCLE_ID);
    expect(second).toHaveLength(0);
    expect((await repository.listCheques(CURRENT_CYCLE_ID)).length).toBe(before + first.length);
  });

  it("integrates no payment provider", () => {
    const forbidden = [
      "stripe",
      "paymentintent",
      "routingnumber",
      "accountnumber",
      "ach transfer",
      "plaid",
      "checkout.session",
    ];
    for (const file of SOURCES) {
      const lowered = file.text.toLowerCase();
      for (const token of forbidden) {
        expect(lowered.includes(token), `${file.path} mentions "${token}"`).toBe(false);
      }
    }
  });
});

/* ================================================================== *
 * 8. Retention, enforced by a purge.
 * ================================================================== */

describe("retention is enforced by a purge, not by intention", () => {
  it("has both clocks as code", () => {
    expect(UNSUCCESSFUL_RETENTION_DAYS).toBe(365);
    expect(SELECTION_RECORD_RETENTION_YEARS).toBe(5);
    expect(retainSelectionRecordUntil("2026-03-01T00:00:00.000Z")).toBe("2031-03-01");
  });

  it("removes unsuccessful applicants' data and leaves a selection record", async () => {
    const repository = repo();
    const chair = actor("scholarships");

    const prior = (await repository.listApplications({ cycleId: PRIOR_CYCLE_ID })).filter(
      (a) => a.state === "NOT_AWARDED",
    );
    expect(prior.length).toBeGreaterThan(0);
    const victim = prior[0];
    const name = victim.applicant.fullName;
    const email = victim.applicant.email;
    const reference = victim.reference;
    expect(name.length).toBeGreaterThan(3);

    const result = await purgeUnsuccessfulApplicants(repository, chair);
    expect(result.applicationsPurged).toBe(prior.length);
    expect(result.selectionRecordsWritten).toBe(prior.length);
    expect(result.references).toContain(reference);

    // Gone, at the row level and from every list.
    expect(await repository.getApplication(victim.id)).toBeNull();
    expect(await repository.getApplicationByReference(reference)).toBeNull();
    const remaining = JSON.stringify(await repository.listApplications());
    expect(remaining).not.toContain(name);
    expect(remaining).not.toContain(email);
    expect(await repository.listScoreSheets(victim.id)).toHaveLength(0);
    expect(await repository.getGuardianConsentForApplication(victim.id)).toBeNull();
    expect(await repository.getVerification(victim.id)).toBeNull();

    // What remains is the decision, and it identifies nobody.
    const records = await repository.listSelectionRecords(PRIOR_CYCLE_ID);
    const kept = records.find((r) => r.applicationRef === reference)!;
    expect(kept).toBeDefined();
    expect(kept.outcome).toBe("NOT_AWARDED");
    expect(kept.retainUntil).toBe(retainSelectionRecordUntil(kept.decidedAt));
    const serialized = JSON.stringify(kept);
    expect(serialized).not.toContain(name);
    expect(serialized).not.toContain(email);
    for (const visit of visitAll(kept)) {
      expect(/name|email|phone|essay|school|dateofbirth/i.test(visit.key), visit.keyPath).toBe(
        false,
      );
    }
  });

  it("leaves applicants inside the retention window alone", async () => {
    const repository = repo();
    const current = (await repository.listApplications({ cycleId: CURRENT_CYCLE_ID })).filter(
      (a) => a.state === "NOT_AWARDED" || a.state === "WITHDRAWN",
    );
    expect(current.length).toBeGreaterThan(0);
    await purgeUnsuccessfulApplicants(repository, actor("scholarships"));
    for (const application of current) {
      expect(await repository.getApplication(application.id)).not.toBeNull();
    }
  });

  it("never purges a successful applicant", async () => {
    const repository = repo();
    const awarded = (await repository.listApplications({ cycleId: PRIOR_CYCLE_ID })).filter(
      (a) => a.state === "AWARDED",
    );
    expect(awarded.length).toBeGreaterThan(0);
    await purgeUnsuccessfulApplicants(repository, actor("scholarships"));
    for (const application of awarded) {
      expect(await repository.getApplication(application.id)).not.toBeNull();
    }
  });

  it("writes the purge to the append-only log, in references rather than names", async () => {
    const repository = repo();
    await purgeUnsuccessfulApplicants(repository, actor("scholarships"));
    const log = await repository.listAudit();
    const entry = log.find((e) => e.action === "PURGE_UNSUCCESSFUL_APPLICANTS:COMPLETED")!;
    expect(entry).toBeDefined();
    expect(entry.personId).toBe("dev:scholarships");
    expect(entry.subjectRef).toMatch(/applications/);
  });

  it("removes a selection record once its five years are up", async () => {
    const repository = repo();
    const chair = actor("scholarships");
    const expired = await repository.createSelectionRecord({
      id: "test-selrec-expired",
      entity: SCHOLARSHIP_ENTITY,
      cycleId: PRIOR_CYCLE_ID,
      applicationRef: "SCH-0000-OLD",
      outcome: "AWARDED",
      totalScore: 81,
      scoresRecorded: 4,
      awards: [{ program: "MERIT", amountCents: 150_000 }],
      eligibilityRuleVersion: "0-placeholder",
      decidedAt: "2019-04-01T00:00:00.000Z",
      retainUntil: "2024-04-01",
    });

    const before = (await repository.listSelectionRecords()).length;
    const result = await purgeExpiredSelectionRecords(repository, chair);
    expect(result.purged).toBe(1);
    expect(result.references).toContain(expired.applicationRef);
    expect((await repository.listSelectionRecords()).length).toBe(before - 1);
  });

  it("shows what is due before anything is removed", async () => {
    const repository = repo();
    const schedule = await loadRetentionSchedule(repository, actor("scholarships"));
    expect(schedule.retentionDays).toBe(UNSUCCESSFUL_RETENTION_DAYS);
    expect(schedule.selectionRecordYears).toBe(SELECTION_RECORD_RETENTION_YEARS);
    expect(schedule.dueNow.length).toBeGreaterThan(0);
    expect(schedule.upcoming.length).toBeGreaterThan(0);
    for (const row of schedule.dueNow) {
      expect(row.dueAt <= new Date().toISOString()).toBe(true);
    }
  });

  it("refuses the purge to the wrong role", async () => {
    const repository = repo();
    await expect(
      purgeUnsuccessfulApplicants(repository, actor("scholarship-reviewer")),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      purgeUnsuccessfulApplicants(repository, actor("president")),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      loadRetentionSchedule(repository, actor("member")),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("has no delete path for the audit log", () => {
    const repository = LIB_SOURCES.find((f) => f.base === "repository.ts")!;
    expect(repository.text).not.toMatch(/deleteAudit|purgeAudit|clearAudit/);
  });
});

/* ================================================================== *
 * The seeded cycle, and the board reads over it.
 * ================================================================== */

describe("the seeded cycle matches the chair's account of the last one", () => {
  it("is 150 applications, 119 Merit awards and 64 Wounded Patriot awards", async () => {
    const repository = repo();
    const applications = await repository.listApplications({ cycleId: CURRENT_CYCLE_ID });
    const awards = await repository.listAwards({ cycleId: CURRENT_CYCLE_ID });
    expect(applications).toHaveLength(150);
    expect(awards.filter((a) => a.program === "MERIT")).toHaveLength(119);
    expect(awards.filter((a) => a.program === "WOUNDED_PATRIOT")).toHaveLength(64);
    expect(awards).toHaveLength(183);
  });

  it("has applicants with both awards, one, and neither", async () => {
    const repository = repo();
    const board = await loadAwardsBoard(repository, actor("scholarships"));
    expect(board.bothPrograms).toBeGreaterThan(0);
    expect(board.neither).toBeGreaterThan(0);
    expect(board.meritAwards).toBeGreaterThan(board.bothPrograms);
    expect(board.woundedPatriotAwards).toBeGreaterThan(board.bothPrograms);
  });

  it("spreads the Merit awards across every band", async () => {
    const repository = repo();
    const board = await loadAwardsBoard(repository, actor("scholarships"));
    for (const band of board.bands) {
      expect(band.count, band.label).toBeGreaterThan(0);
    }
  });

  it("gives the chair a cycle overview and a file list, and refuses both to a member", async () => {
    const repository = repo();
    const chair = actor("scholarships");
    const overview = await loadCycleOverview(repository, chair);
    expect(overview.applications).toBe(150);
    expect(overview.verificationsOutstanding).toBeGreaterThan(0);
    expect(overview.awardsWithTheBoard).toBeGreaterThan(0);
    expect(overview.eligibilityStatus).toBe("UNDER_LEGAL_REVIEW");

    const rows = await loadChairRows(repository, chair, CURRENT_CYCLE_ID, 10);
    expect(rows).toHaveLength(10);
    expect(rows[0].reference).toMatch(/^SCH-/);

    await expect(loadCycleOverview(repository, actor("member"))).rejects.toBeInstanceOf(AuthzError);
    await expect(loadChairRows(repository, actor("member"))).rejects.toBeInstanceOf(AuthzError);
  });

  it("gives the chair a verification queue with work in it", async () => {
    const repository = repo();
    const queue = await loadVerificationQueue(repository, actor("scholarships"));
    expect(queue.waiting.length).toBeGreaterThan(0);
    expect(queue.verified).toBe(64);
    expect(queue.notVerified).toBeGreaterThan(0);
    expect(queue.waiting[0].narrative.length).toBeGreaterThan(0);
  });

  it("keeps the audit log readable by the roles that hold it, and nobody else", async () => {
    const repository = repo();
    await repository.appendAudit({
      at: new Date().toISOString(),
      personId: "dev:scholarships",
      action: "TEST",
      dataClass: "APPLICANT",
      entity: SCHOLARSHIP_ENTITY,
      rowLevel: false,
      subjectRef: null,
    });
    await expect(loadScholarshipAudit(repository, actor("secretary"))).resolves.not.toHaveLength(0);
    // The chair holds no AUDIT_LOG grant, deliberately: she is the subject of
    // most of these entries.
    await expect(loadScholarshipAudit(repository, actor("scholarships"))).rejects.toBeInstanceOf(
      AuthzError,
    );
  });

  it("uses fictional names and nothing that could ring a real person", async () => {
    const repository = repo();
    const applications = await repository.listApplications();
    for (const application of applications.slice(0, 30)) {
      expect(application.applicant.email).toMatch(/@example\.org$/);
      expect(application.applicant.phone).toContain("555-");
    }
  });
});
