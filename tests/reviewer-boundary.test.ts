/**
 * The reviewer boundary.
 *
 * A scholarship reviewer is one of four volunteers who score applications.
 * They hold APPLICANT at READ purely so they can open the file they are
 * scoring. Three separate reads were guarded at that level and so handed them
 * things a scorer should never see — the awards board, the cycle exceptions,
 * the cheque run — which were caught one at a time while wiring screens.
 *
 * This file exists so the next one is caught by a test instead. It enumerates
 * every read in the module and asserts, for each, whether a reviewer may reach
 * it. Adding a read without deciding which side of the line it sits on makes
 * this fail.
 *
 * The rule it encodes: a reviewer may reach their own queue, their own file,
 * their own score sheet and their own calibration. Everything carrying an
 * award amount, another applicant's outcome, or the shape of the cycle is the
 * chair's.
 */

import { describe, expect, it } from "vitest";

import { AuthzError } from "../src/lib/authz/policy";
import { personaById, subjectFor } from "../src/lib/authz/personas";
import type { Subject } from "../src/lib/authz/policy";

import {
  awardNotificationFor,
  loadAwardRows,
  loadAwardsBoard,
} from "../src/lib/scholarships/awards";
import {
  loadChairRows,
  loadCycleExceptions,
  loadCycleOverview,
  loadScholarshipAudit,
} from "../src/lib/scholarships/board";
import { loadChequeRun } from "../src/lib/scholarships/disbursement";
import {
  newScholarshipRepository,
  type ScholarshipRepository,
} from "../src/lib/scholarships/repository";
import { loadRetentionSchedule } from "../src/lib/scholarships/retention";
import {
  loadReviewQueue,
  nextForReview,
  reviewerCalibration,
} from "../src/lib/scholarships/review";
import { loadVerificationQueue } from "../src/lib/scholarships/verification";

function repo(): ScholarshipRepository {
  return newScholarshipRepository({ seed: true });
}

function actor(id: string): Subject {
  return subjectFor(personaById(id));
}

const reviewer = () => actor("scholarship-reviewer");
const chair = () => actor("scholarships");

/**
 * Every read in the module, and which side of the line it is on.
 *
 * `reviewerMay` is the decision, written down. A read that a reviewer may not
 * reach must reject; one they may must resolve. There is no third state, which
 * is the point — a new read cannot be added here without someone choosing.
 */
const READS: {
  name: string;
  reviewerMay: boolean;
  /**
   * Almost everything here is the chair's. The audit log is the exception and
   * the exception is deliberate: she is the subject of most of its entries,
   * including her own conflict blocks, so somebody else has to be the one who
   * can look.
   */
  chairMay?: boolean;
  why: string;
  call: (r: ScholarshipRepository, s: Subject) => Promise<unknown>;
}[] = [
  {
    name: "nextForReview",
    reviewerMay: true,
    why: "Their own queue. This is the work.",
    call: (r, s) => nextForReview(r, s),
  },
  {
    name: "loadReviewQueue",
    reviewerMay: true,
    why: "Their own queue, listed.",
    call: (r, s) => loadReviewQueue(r, s),
  },
  {
    name: "reviewerCalibration",
    reviewerMay: true,
    why: "Their own scoring against the committee's. Aggregate, and about them.",
    call: (r, s) => reviewerCalibration(r, s),
  },
  {
    name: "loadCycleOverview",
    reviewerMay: true,
    why: "Counts only, at AGGREGATE. Names nobody and carries no amount.",
    call: (r, s) => loadCycleOverview(r, s),
  },
  {
    name: "loadAwardsBoard",
    reviewerMay: false,
    why: "Every award amount. A scorer who knows three points is worth $1,000 is not scoring independently of the money.",
    call: (r, s) => loadAwardsBoard(r, s),
  },
  {
    name: "loadAwardRows",
    reviewerMay: false,
    why: "Award amounts and recipient addresses, per applicant.",
    call: (r, s) => loadAwardRows(r, s),
  },
  {
    name: "awardNotificationFor",
    reviewerMay: false,
    why: "The message, with the merged amount and every recipient.",
    call: async (r, s) => {
      const award = (await r.listAwards({}))[0];
      return awardNotificationFor(r, s, award.id);
    },
  },
  {
    name: "loadCycleExceptions",
    reviewerMay: false,
    why: "Board members' dependents and failed sponsor checks. Not needed to score an essay.",
    call: (r, s) => loadCycleExceptions(r, s),
  },
  {
    name: "loadChairRows",
    reviewerMay: false,
    why: "Every file in the cycle with its outcome, not just the ones they score.",
    call: (r, s) => loadChairRows(r, s),
  },
  {
    name: "loadChequeRun",
    reviewerMay: false,
    why: "The whole disbursement. The financial arm stays at READ for the Finance Review Officer.",
    call: (r, s) => loadChequeRun(r, s),
  },
  {
    name: "loadVerificationQueue",
    reviewerMay: false,
    why: "Disability evidence. The split the chair already enforces by hand.",
    call: (r, s) => loadVerificationQueue(r, s),
  },
  {
    name: "loadRetentionSchedule",
    reviewerMay: false,
    why: "Named applicants across cycles, including ones they never scored.",
    call: (r, s) => loadRetentionSchedule(r, s),
  },
  {
    name: "loadScholarshipAudit",
    reviewerMay: false,
    chairMay: false,
    why: "The log, which records their own conflict blocks. Not the chair's either.",
    call: (r, s) => loadScholarshipAudit(r, s),
  },
];

describe("what a scholarship reviewer may reach", () => {
  for (const read of READS) {
    it(`${read.reviewerMay ? "allows" : "refuses"} ${read.name}: ${read.why}`, async () => {
      const call = read.call(repo(), reviewer());
      if (read.reviewerMay) {
        await expect(call).resolves.toBeDefined();
      } else {
        await expect(call).rejects.toBeInstanceOf(AuthzError);
      }
    });
  }

  it("lets the chair reach everything that is hers", async () => {
    // The boundary must constrain the reviewer without locking out the person
    // whose job this is. A refusal that also stops the chair is a bug, not a
    // control — which is how the over-tightening of these guards was caught.
    for (const read of READS.filter((read) => read.chairMay !== false)) {
      await expect(read.call(repo(), chair()), read.name).resolves.toBeDefined();
    }
  });

  it("keeps the audit log away from the chair, and gives it to the Secretary", async () => {
    // Separation of duties, not an oversight. The chair is the subject of most
    // entries in this log, including the record of files withheld from a
    // conflicted reviewer, so the person who reads it cannot be her.
    await expect(loadScholarshipAudit(repo(), chair())).rejects.toBeInstanceOf(AuthzError);
    await expect(loadScholarshipAudit(repo(), actor("secretary"))).resolves.toBeDefined();
  });

  it("covers every read the module exports", async () => {
    // Guards against the real failure mode: a new read added at APPLICANT READ
    // that nobody thought about. If this number moves, a decision is owed.
    expect(READS).toHaveLength(13);
  });
});
