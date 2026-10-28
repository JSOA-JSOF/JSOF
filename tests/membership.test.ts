/**
 * Membership module tests.
 *
 * `tests/invariants.test.ts` already covers the state machine and the policy
 * engine in isolation. These tests cover the things this module could get
 * wrong on top of them, and they are written as requirements:
 *
 *   1. The intake acknowledgment is indistinguishable across sponsor
 *      outcomes — not only in its text, but in the work done to produce it.
 *   2. Payment is unreachable from every state except AWAITING_PAYMENT. All
 *      nine states, not the two anyone thought of.
 *   3. A wrong-role request to the roster and to the composition report fails.
 *   4. An expired vouch token cannot confirm.
 *   5. The composition report's arithmetic is right against a known seed,
 *      including at the exact 97.5% boundary.
 */

import { afterAll, describe, expect, it, vi } from "vitest";

import { AuthzError, type Subject } from "../src/lib/authz/policy";
import {
  INTAKE_MESSAGE,
  MEMBERSHIP_STATES,
  type MembershipState,
} from "../src/lib/membership/state";
import {
  assignToReviewer,
  ContactCorrectionError,
  CONTACT_REFUSALS,
  correctMemberContact,
  daysWaiting,
  decideChairException,
  eligibleReviewers,
  isStaleUnassigned,
  loadApplicationQueue,
  loadChairQueue,
  loadCohortAudit,
  loadCompositionReport,
  loadMembershipAudit,
  loadRoster,
  matchesRosterFilter,
  recordCohortAudit,
} from "../src/lib/membership/board";
import { NO_IDENTITY_STORE, provisionMemberAccount } from "../src/lib/membership/account";
import {
  DUES_BASIS,
  EMAIL_CHANGE_NOT_BUILT,
  loadOwnRecord,
  NotAMember,
  OwnContactError,
  standingInWords,
  updateOwnPhone,
} from "../src/lib/membership/self";
import * as notify from "../src/lib/membership/notify";
import { PERSONAS } from "../src/lib/authz/personas";
import {
  buildCompositionReport,
  formatPercent,
  meetsThreshold,
  THRESHOLDS,
} from "../src/lib/membership/composition";
import {
  loadMembershipDashboard,
  medianOf,
  requiredNumerator,
  PROMISED_OUTCOME_DAYS,
  type MembershipDashboard,
} from "../src/lib/membership/kpis";
import { personaById, subjectFor } from "../src/lib/authz/personas";
import { PROJECTS } from "../src/lib/projects/register";
import {
  guardWorkspaceRead,
  loadMembershipOverview,
  loadMembershipPlanning,
  membershipOutside,
  membershipProjects,
} from "../src/lib/membership/workspace";
import { BOARD_CONTACTS } from "../src/lib/membership/contacts";
import {
  ACKNOWLEDGMENT_PATH,
  applicantConfirmationBody,
  submitApplication,
  validateAll,
  validateService,
  validateSponsor,
} from "../src/lib/membership/intake";
import {
  assertPaymentAvailable,
  clearDues,
  createHandoff,
  duesReceiptBody,
  formatCents,
  loadPaymentView,
  PaymentNotAvailableError,
} from "../src/lib/membership/payment";
import {
  newMembershipRepository,
  newVouchToken,
  type MembershipRepository,
} from "../src/lib/membership/repository";
import { seedMembers, seedSponsorMemberId } from "../src/lib/membership/seed";
import { answerVouch, describeVouchToken, sweepExpiredVouches } from "../src/lib/membership/vouch";
import { deriveIsWarVeteran, wartimePeriodsServed } from "../src/lib/membership/wartime";
import {
  type ApplicationFields,
  type Member,
  type RosterFilter,
  DUES_AMOUNT_CENTS,
  EMPTY_ROSTER_FILTER,
  MEMBERSHIP_ENTITY,
  UNASSIGNED_FLAG_DAYS,
} from "../src/lib/membership/types";
import { openTestDatabase, type TestDatabase } from "./support/d1";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function repo(): MembershipRepository {
  return newMembershipRepository({ seed: true });
}

/**
 * Subjects come from the shared dev personas, so these tests exercise the same
 * role assignments the browser does rather than a set of fixtures that could
 * drift away from them.
 */
function actor(id: string): Subject {
  return subjectFor(personaById(id));
}

/** The same role with no second factor. MFA is required for every non-public read. */
function withoutMfa(id: string): Subject {
  return { ...actor(id), mfaSatisfied: false };
}

const BASE_FIELDS: ApplicationFields = {
  applicantName: "Test Applicant",
  email: "test.applicant@example.org",
  phone: "(910) 555-0101",
  membershipCategory: "VETERAN",
  qualifyingRelationship: null,
  serviceFrom: "2001-09-20",
  serviceTo: "2022-10-31",
  attestedWarVeteran: true,
  isAugmentee: false,
  sponsorMemberId: "JSOA-2024-0001",
};

/**
 * Counts every repository call by method name, so a submission's work profile
 * can be compared across outcomes. A conditional lookup is a timing branch
 * whether or not anyone measured it, and this is how it gets caught.
 */
function counting(inner: MembershipRepository): {
  proxy: MembershipRepository;
  calls: () => Record<string, number>;
  reset: () => void;
} {
  let tally: Record<string, number> = {};
  const proxy = new Proxy(inner, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const name = String(prop);
        tally[name] = (tally[name] ?? 0) + 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as MembershipRepository;
  return { proxy, calls: () => ({ ...tally }), reset: () => { tally = {}; } };
}

async function submitWith(
  store: MembershipRepository,
  overrides: Partial<ApplicationFields>,
) {
  const draft = await store.createDraft({ ...BASE_FIELDS, ...overrides });
  return submitApplication(store, draft.id);
}

/* ------------------------------------------------------------------ *
 * 1. The intake form is not a membership oracle
 * ------------------------------------------------------------------ */

describe("the intake acknowledgment is indistinguishable across sponsor outcomes", () => {
  const strip = (message: string, received: boolean) => JSON.stringify({ message, received });

  it("returns the same message and shape for a valid, unknown and malformed sponsor", async () => {
    const store = repo();
    const valid = await submitWith(store, { sponsorMemberId: seedSponsorMemberId() });
    const unknown = await submitWith(store, {
      sponsorMemberId: "JSOA-1998-9999",
      email: "b@example.org",
    });
    const malformed = await submitWith(store, {
      sponsorMemberId: "not-a-member-id",
      email: "c@example.org",
    });
    const blank = await submitWith(store, { sponsorMemberId: "", email: "d@example.org" });

    const baseline = strip(valid.acknowledgment.message, valid.acknowledgment.received);
    for (const result of [unknown, malformed, blank]) {
      expect(strip(result.acknowledgment.message, result.acknowledgment.received)).toBe(baseline);
      expect(Object.keys(result.acknowledgment).sort()).toEqual([
        "message",
        "received",
        "reference",
      ]);
    }
  });

  it("returns the same acknowledgment for a duplicate application", async () => {
    const store = repo();
    const first = await submitWith(store, { email: "same.person@example.org" });
    const second = await submitWith(store, { email: "same.person@example.org" });
    expect(second.acknowledgment.message).toBe(first.acknowledgment.message);
    expect(second.debug.flags).toContain("DUPLICATE_EMAIL");
    expect(first.debug.flags).not.toContain("DUPLICATE_EMAIL");
  });

  it("returns the same acknowledgment for a replayed submission and an unknown draft", async () => {
    const store = repo();
    const draft = await store.createDraft(BASE_FIELDS);
    const first = await submitApplication(store, draft.id);
    const replay = await submitApplication(store, draft.id);
    const ghost = await submitApplication(store, "app_does_not_exist");

    expect(replay.acknowledgment.message).toBe(first.acknowledgment.message);
    expect(ghost.acknowledgment.message).toBe(first.acknowledgment.message);
    expect(ghost.acknowledgment.received).toBe(true);
    // A replay must not move the application on a second time.
    expect(replay.debug.state).toBe("AWAITING_VOUCH");
  });

  it("gives every reference a different value, derived from nothing submitted", async () => {
    const store = repo();
    const a = await submitWith(store, { sponsorMemberId: seedSponsorMemberId() });
    const b = await submitWith(store, {
      sponsorMemberId: seedSponsorMemberId(),
      email: "b@example.org",
    });
    expect(a.acknowledgment.reference).not.toBe(b.acknowledgment.reference);
    expect(a.acknowledgment.reference).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("does the identical amount of work whatever the sponsor turns out to be", async () => {
    const store = repo();
    const meter = counting(store);

    const profiles: Record<string, number>[] = [];
    for (const [index, sponsor] of [
      seedSponsorMemberId(),
      "JSOA-1998-9999",
      "nonsense",
      "",
    ].entries()) {
      const draft = await meter.proxy.createDraft({
        ...BASE_FIELDS,
        sponsorMemberId: sponsor,
        email: `profile-${index}@example.org`,
      });
      meter.reset();
      await submitApplication(meter.proxy, draft.id);
      profiles.push(meter.calls());
    }

    // Same methods, same number of times, in every case.
    for (const profile of profiles.slice(1)) {
      expect(profile).toEqual(profiles[0]);
    }
  });

  it("writes a vouch request record even when there is nobody to send it to", async () => {
    const store = repo();
    const unknown = await submitWith(store, { sponsorMemberId: "JSOA-1998-9999" });
    const request = await store.getVouchRequestForApplication(unknown.debug.applicationId);
    expect(request).not.toBeNull();
    expect(request?.deliverable).toBe(false);
    // And it waits out the window like every other application rather than
    // being routed somewhere special at intake.
    expect(unknown.debug.state).toBe("AWAITING_VOUCH");
  });

  it("has exactly one destination for every submission", () => {
    expect(ACKNOWLEDGMENT_PATH).toBe("/apply/submitted");
  });

  it("never rejects a submission because of the sponsor field's shape", () => {
    expect(validateSponsor({ sponsorMemberId: "nonsense" })).toEqual({});
    expect(validateSponsor({ sponsorMemberId: "JSOA-2026-0142" })).toEqual({});
    // A blank field is the one sponsor error, and it is about the applicant
    // having left a required box empty, not about the roster.
    expect(validateSponsor({ sponsorMemberId: "" }).sponsorMemberId).toBeTruthy();
  });

  it("still validates the applicant's own answers", () => {
    const errors = validateAll({ ...BASE_FIELDS, email: "not-an-email", phone: "12" });
    expect(errors.email).toBeTruthy();
    expect(errors.phone).toBeTruthy();
    expect(
      validateService({ membershipCategory: "QUALIFYING_RELATIVE" }).qualifyingRelationship,
    ).toBeTruthy();
    expect(validateService({ membershipCategory: "VETERAN" }).serviceFrom).toBeTruthy();
  });

  it("sends an augmentee to the chair whatever the sponsor says", async () => {
    const store = repo();
    const result = await submitWith(store, {
      isAugmentee: true,
      sponsorMemberId: seedSponsorMemberId(),
    });
    expect(result.debug.state).toBe("CHAIR_QUEUE");
    expect(result.debug.flags).toContain("AUGMENTEE");
  });
});

/* ------------------------------------------------------------------ *
 * 2. Payment is unreachable from every state except AWAITING_PAYMENT
 * ------------------------------------------------------------------ */

describe("payment is unreachable from every state except AWAITING_PAYMENT", () => {
  it("refuses all nine states but one", () => {
    const allowed: MembershipState[] = ["AWAITING_PAYMENT"];
    expect(MEMBERSHIP_STATES).toHaveLength(9);
    for (const state of MEMBERSHIP_STATES) {
      if (allowed.includes(state)) {
        expect(() => assertPaymentAvailable(state)).not.toThrow();
      } else {
        expect(() => assertPaymentAvailable(state)).toThrow(PaymentNotAvailableError);
      }
    }
  });

  it("refuses the payment view for an application in any other state", async () => {
    const store = repo();
    for (const state of MEMBERSHIP_STATES) {
      const draft = await store.createDraft(BASE_FIELDS);
      await store.setApplicationState(draft.id, state);
      if (state === "AWAITING_PAYMENT") {
        const view = await loadPaymentView(store, draft.id);
        expect(view.amountCents).toBe(DUES_AMOUNT_CENTS);
        expect(view.currency).toBe("USD");
      } else {
        await expect(loadPaymentView(store, draft.id)).rejects.toThrow(PaymentNotAvailableError);
      }
    }
  });

  it("refuses a checkout handoff outside AWAITING_PAYMENT", async () => {
    const store = repo();
    const draft = await store.createDraft(BASE_FIELDS);
    await store.setApplicationState(draft.id, "CHAIR_QUEUE");
    await expect(createHandoff(store, draft.id)).rejects.toThrow(PaymentNotAvailableError);
  });

  it("refuses an unknown application id the same way, so it reveals nothing", async () => {
    const store = repo();
    await expect(loadPaymentView(store, "app_nope")).rejects.toThrow(PaymentNotAvailableError);
  });

  it("holds dues in integer cents and renders two hundred dollars", () => {
    expect(Number.isInteger(DUES_AMOUNT_CENTS)).toBe(true);
    expect(DUES_AMOUNT_CENTS).toBe(20_000);
    expect(formatCents(DUES_AMOUNT_CENTS)).toBe("$200.00");
  });

  it("creates the roster record only once dues clear, and derives war-veteran status", async () => {
    const store = repo();
    const draft = await store.createDraft({ ...BASE_FIELDS, attestedWarVeteran: false });
    await store.setApplicationState(draft.id, "AWAITING_PAYMENT");
    const handoff = await createHandoff(store, draft.id);
    expect(handoff.amountCents).toBe(DUES_AMOUNT_CENTS);
    expect(handoff.entity).toBe(MEMBERSHIP_ENTITY);
    expect(handoff.hostedUrl.startsWith("https://checkout.stripe.com/")).toBe(true);

    const member = await clearDues(store, handoff.id);
    expect(member.state).toBe("PROBATIONARY");
    // Derived from the dates, not copied from the checkbox.
    expect(member.attestedWarVeteran).toBe(false);
    expect(member.isWarVeteran).toBe(true);
    expect(member.memberId).toMatch(/^JSOA-\d{4}-\d{4}$/);

    // And a second clearing of the same session cannot happen.
    await expect(clearDues(store, handoff.id)).rejects.toThrow(PaymentNotAvailableError);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Wrong-role requests fail
 * ------------------------------------------------------------------ */

describe("a wrong-role request to the roster and the composition report fails", () => {
  it("refuses the roster to a role with no member data at all", async () => {
    const store = repo();
    await expect(loadRoster(store, actor("member"))).rejects.toThrow(AuthzError);
  });

  it("refuses the roster to a role holding AGGREGATE, and allows the report", async () => {
    const store = repo();
    // This is the distinction the report was built around: VP Operations must
    // be able to see a failing exemption test without being able to read the
    // roster it was computed from.
    await expect(loadRoster(store, actor("vp-ops"))).rejects.toThrow(AuthzError);
    const report = await loadCompositionReport(store, actor("vp-ops"));
    expect(report.denominator).toBeGreaterThan(0);

    await expect(loadRoster(store, actor("treasurer-jsoa"))).rejects.toThrow(AuthzError);
    await expect(loadCompositionReport(store, actor("treasurer-jsoa"))).resolves.toBeTruthy();
  });

  it("refuses the composition report to a role with no member data", async () => {
    const store = repo();
    await expect(loadCompositionReport(store, actor("member"))).rejects.toThrow(
      AuthzError,
    );
  });

  it("refuses both to a Foundation role, because membership is an Association function", async () => {
    const store = repo();
    await expect(loadRoster(store, actor("treasurer-jsof"))).rejects.toThrow(AuthzError);
    await expect(loadCompositionReport(store, actor("treasurer-jsof"))).rejects.toThrow(
      AuthzError,
    );
  });

  it("refuses the right role without MFA", async () => {
    const store = repo();
    await expect(loadRoster(store, withoutMfa("vp-membership"))).rejects.toThrow(AuthzError);
    await expect(
      loadCompositionReport(store, withoutMfa("vp-membership")),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses a chair decision to a role that can only read the queue", async () => {
    const store = repo();
    const president = actor("president");
    // The President can see the queue and cannot decide in it.
    await expect(loadChairQueue(store, president)).resolves.toBeTruthy();
    await expect(
      decideChairException(store, president, {
        applicationId: "seed-app-003",
        outcome: "APPROVED",
        reason: "Known to me.",
      }),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses a cohort audit decision to a read-only role", async () => {
    const store = repo();
    const { rows } = await loadCohortAudit(store, actor("secretary"));
    expect(rows.length).toBeGreaterThan(0);
    await expect(
      recordCohortAudit(store, actor("secretary"), {
        memberId: rows[0].member.id,
        outcome: "PASSED",
        note: "",
      }),
    ).rejects.toThrow(AuthzError);
  });

  it("logs the denial as well as the read", async () => {
    const store = repo();
    await expect(loadRoster(store, actor("member"))).rejects.toThrow(AuthzError);
    await loadRoster(store, actor("vp-membership"));
    const log = await loadMembershipAudit(store, actor("secretary"));
    const actions = log.map((e) => e.action);
    expect(actions).toContain("READ_ROSTER:DENIED");
    expect(actions).toContain("READ_ROSTER");
    expect(log.every((e) => e.dataClass === "MEMBER_PII" || e.dataClass === "AUDIT_LOG")).toBe(true);
  });

  it("gives VP Membership no reach into the audit log", async () => {
    const store = repo();
    await loadRoster(store, actor("vp-membership"));
    // The person who writes the roster does not curate the record of who read it.
    expect(await loadMembershipAudit(store, actor("vp-membership"))).toEqual([]);
    expect((await loadMembershipAudit(store, actor("secretary"))).length).toBeGreaterThan(0);
  });

  it("logs the composition report as an aggregate read, not a row-level one", async () => {
    const store = repo();
    await loadCompositionReport(store, actor("vp-ops"));
    const log = await loadMembershipAudit(store, actor("secretary"));
    const entry = log.find((e) => e.action === "READ_COMPOSITION_REPORT");
    expect(entry?.rowLevel).toBe(false);
  });

  it("refuses every role that holds no member data on the Association", async () => {
    const store = repo();
    for (const id of ["member", "fundraising", "webmaster", "scholarships", "memorial"]) {
      await expect(loadRoster(store, actor(id))).rejects.toThrow(AuthzError);
      await expect(loadCompositionReport(store, actor(id))).rejects.toThrow(AuthzError);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 4. An expired vouch token cannot confirm
 * ------------------------------------------------------------------ */

describe("the sponsor vouch", () => {
  async function openVouch(store: MembershipRepository) {
    const result = await submitWith(store, { sponsorMemberId: seedSponsorMemberId() });
    const request = await store.getVouchRequestForApplication(result.debug.applicationId);
    if (!request) throw new Error("expected a vouch request");
    return { applicationId: result.debug.applicationId, token: request.token, request };
  }

  it("an expired token cannot confirm", async () => {
    const store = repo();
    const { token, applicationId } = await openVouch(store);
    // Same token, one second past the window.
    const past = new Date(Date.now() + 73 * 3_600_000);
    expect(await answerVouch(store, token, "CONFIRMED", past)).toEqual({
      ok: false,
      reason: "EXPIRED",
    });
    const application = await store.getApplication(applicationId);
    expect(application?.state).toBe("AWAITING_VOUCH");
    expect(application?.state).not.toBe("AWAITING_PAYMENT");
  });

  it("an expired token cannot decline either, so nothing is written after the window", async () => {
    const store = repo();
    const { token } = await openVouch(store);
    const past = new Date(Date.now() + 100 * 3_600_000);
    for (const outcome of ["DECLINED", "DO_NOT_KNOW"] as const) {
      expect((await answerVouch(store, token, outcome, past)).ok).toBe(false);
    }
    expect((await store.getVouchRequest(token))?.answeredAt).toBeNull();
  });

  it("renders an unknown token and an expired token the same way", async () => {
    const store = repo();
    const { token } = await openVouch(store);
    const past = new Date(Date.now() + 73 * 3_600_000);
    const expired = await describeVouchToken(store, token, past);
    const unknown = await describeVouchToken(store, newVouchToken());
    expect(expired.kind).toBe("EXPIRED");
    expect(unknown.kind).toBe("UNKNOWN");
    // Both are dead ends carrying no data: neither view exposes an applicant.
    expect(Object.keys(expired)).toEqual(["kind"]);
    expect(Object.keys(unknown)).toEqual(["kind"]);
  });

  it("shows the applicant only on an open request, with the hours left", async () => {
    const store = repo();
    const { token } = await openVouch(store);
    const view = await describeVouchToken(store, token);
    expect(view.kind).toBe("OPEN");
    if (view.kind === "OPEN") {
      expect(view.applicantName).toBe(BASE_FIELDS.applicantName);
      expect(view.hoursLeft).toBeGreaterThan(70);
      expect(view.hoursLeft).toBeLessThanOrEqual(72);
    }
  });

  it("confirms once and refuses a replay", async () => {
    const store = repo();
    const { token, applicationId } = await openVouch(store);
    expect(await answerVouch(store, token, "CONFIRMED")).toMatchObject({ ok: true });
    expect((await store.getApplication(applicationId))?.state).toBe("AWAITING_PAYMENT");
    expect(await answerVouch(store, token, "DECLINED")).toEqual({ ok: false, reason: "ANSWERED" });
    expect((await store.getApplication(applicationId))?.state).toBe("AWAITING_PAYMENT");
  });

  it("sends a decline and a do-not-know to the chair queue, not to a rejection", async () => {
    for (const outcome of ["DECLINED", "DO_NOT_KNOW"] as const) {
      const store = repo();
      const { token, applicationId } = await openVouch(store);
      expect(await answerVouch(store, token, outcome)).toMatchObject({ ok: true });
      expect((await store.getApplication(applicationId))?.state).toBe("CHAIR_QUEUE");
    }
  });

  it("moves an unanswered application to the chair when the window closes", async () => {
    const store = repo();
    const { applicationId } = await openVouch(store);
    const past = new Date(Date.now() + 73 * 3_600_000);
    expect(await sweepExpiredVouches(store, past)).toBeGreaterThanOrEqual(1);
    expect((await store.getApplication(applicationId))?.state).toBe("CHAIR_QUEUE");
    // Idempotent: a second sweep moves nothing.
    expect(await sweepExpiredVouches(store, past)).toBe(0);
  });

  it("takes an application with an unreachable sponsor down the same path", async () => {
    const store = repo();
    const result = await submitWith(store, { sponsorMemberId: "JSOA-1998-9999" });
    expect(result.debug.state).toBe("AWAITING_VOUCH");
    await sweepExpiredVouches(store, new Date(Date.now() + 73 * 3_600_000));
    expect((await store.getApplication(result.debug.applicationId))?.state).toBe("CHAIR_QUEUE");
  });

  it("takes no payment from an application the chair denies", async () => {
    const store = repo();
    const { queue } = await loadChairQueue(store, actor("vp-membership"));
    const target = queue[0];
    const denied = await decideChairException(store, actor("vp-membership"), {
      applicationId: target.id,
      outcome: "DENIED",
      reason: "No qualifying connection.",
    });
    expect(denied.state).toBe("DECLINED");
    await expect(loadPaymentView(store, target.id)).rejects.toThrow(PaymentNotAvailableError);
  });

  it("opens payment after a chair approval", async () => {
    const store = repo();
    const { queue } = await loadChairQueue(store, actor("vp-membership"));
    const approved = await decideChairException(store, actor("vp-membership"), {
      applicationId: queue[0].id,
      outcome: "APPROVED",
      reason: "Augmentee, known to two members.",
    });
    expect(approved.state).toBe("AWAITING_PAYMENT");
    await expect(loadPaymentView(store, approved.id)).resolves.toBeTruthy();
  });

  it("refuses a chair decision on an application that is not in the queue", async () => {
    const store = repo();
    await expect(
      decideChairException(store, actor("vp-membership"), {
        applicationId: "seed-app-001",
        outcome: "APPROVED",
        reason: "",
      }),
    ).rejects.toThrow(/not in the chair queue/);
  });

  it("refuses a board member deciding their own application", async () => {
    const store = repo();
    const chair = actor("vp-membership");
    const ownAddress = BOARD_CONTACTS[chair.personId];
    expect(ownAddress).toBeTruthy();
    const draft = await store.createDraft({
      ...BASE_FIELDS,
      email: ownAddress,
      isAugmentee: true,
    });
    const submitted = await submitApplication(store, draft.id);
    expect(submitted.debug.state).toBe("CHAIR_QUEUE");
    // Invariant 2 from the policy engine, applied where it can actually arise:
    // a board member who applies is an applicant like any other.
    await expect(
      decideChairException(store, chair, {
        applicationId: draft.id,
        outcome: "APPROVED",
        reason: "It is me.",
      }),
    ).rejects.toThrow(/Self-approval/);
  });
});

/* ------------------------------------------------------------------ *
 * 5. The composition report's arithmetic
 * ------------------------------------------------------------------ */

describe("the composition report's maths against a known seed", () => {
  const report = buildCompositionReport(seedMembers());

  it("counts 43 member records and 40 members", () => {
    expect(seedMembers()).toHaveLength(43);
    expect(report.denominator).toBe(40);
    expect(report.excludedRecords).toBe(3);
    expect(report.countedStates).toEqual(["PROBATIONARY", "GOOD_STANDING"]);
  });

  it("puts every counted member in exactly one category", () => {
    expect(report.categoryCounts).toEqual({
      VETERAN: 35,
      CADET: 2,
      QUALIFYING_RELATIVE: 2,
      NON_QUALIFYING: 1,
    });
    const total = Object.values(report.categoryCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(report.denominator);
  });

  it("passes the 75% armed-forces test at 35 of 40", () => {
    const test = report.tests.find((t) => t.key === "ARMED_FORCES")!;
    expect(test.numerator).toBe(35);
    expect(test.denominator).toBe(40);
    expect(test.thresholdPermille).toBe(750);
    expect(test.passes).toBe(true);
    expect(formatPercent(test.numerator, test.denominator)).toBe("87.5%");
  });

  it("passes the 97.5% test at exactly 39 of 40", () => {
    const test = report.tests.find((t) => t.key === "MEMBERS_CADETS_RELATIVES")!;
    expect(test.numerator).toBe(39);
    expect(test.passes).toBe(true);
    expect(formatPercent(test.numerator, test.denominator)).toBe("97.5%");
    // Exactly on the line. One more non-qualifying member and the exemption goes.
    expect(meetsThreshold(38, 40, THRESHOLDS.MEMBERS_CADETS_RELATIVES)).toBe(false);
    expect(meetsThreshold(39, 40, THRESHOLDS.MEMBERS_CADETS_RELATIVES)).toBe(true);
  });

  it("fails the 90% war-veteran test at 33 of 40", () => {
    const test = report.tests.find((t) => t.key === "WAR_VETERANS")!;
    expect(test.numerator).toBe(33);
    expect(test.passes).toBe(false);
    expect(formatPercent(test.numerator, test.denominator)).toBe("82.5%");
    // Deductibility only. Exemption is unaffected, and the report says so.
    expect(test.governs).toMatch(/deductible/);
    expect(test.governs).toMatch(/Exemption is unaffected/);
  });

  it("does not build the 75% test on war-veteran status, which is the deleted rule", () => {
    // Treas. Reg. 1.501(c)(19)-1 still says 75% must be war veterans. Congress
    // deleted that in 1982. Building the exemption test that way would fail a
    // roster the statute passes, and this asserts we did not.
    const armedForces = report.tests.find((t) => t.key === "ARMED_FORCES")!;
    const warVeterans = report.tests.find((t) => t.key === "WAR_VETERANS")!;
    expect(armedForces.numerator).not.toBe(warVeterans.numerator);
    expect(meetsThreshold(warVeterans.numerator, 40, THRESHOLDS.ARMED_FORCES)).toBe(true);
    expect(armedForces.passes).toBe(true);
    expect(armedForces.authority).toMatch(/501\(c\)\(19\)/);
    expect(armedForces.authority).not.toMatch(/1\.501/);
  });

  it("shows the counts behind each figure, and they add up", () => {
    for (const test of report.tests) {
      expect(test.breakdown.length).toBeGreaterThan(0);
      for (const line of test.breakdown) expect(line.count).toBeGreaterThanOrEqual(0);
    }
    const armedForces = report.tests.find((t) => t.key === "ARMED_FORCES")!;
    expect(armedForces.breakdown.reduce((a, b) => a + b.count, 0)).toBe(35);
    const warVeterans = report.tests.find((t) => t.key === "WAR_VETERANS")!;
    expect(warVeterans.breakdown.reduce((a, b) => a + b.count, 0)).toBe(40);
  });

  it("counts the records that need fixing rather than hiding them", () => {
    expect(report.attestationMismatches).toBe(2);
    expect(report.missingServiceDates).toBe(1);
  });

  it("does not divide by zero on an empty roster", () => {
    const empty = buildCompositionReport([]);
    expect(empty.denominator).toBe(0);
    for (const test of empty.tests) expect(test.passes).toBe(false);
    expect(formatPercent(0, 0)).toBe("n/a");
  });

  it("compares thresholds in integers, so the 97.5% boundary is not a float argument", () => {
    // 0.975 * 40 is 39.000000000000004 in binary floating point. Integer
    // permille arithmetic has no opinion about that.
    expect(meetsThreshold(39, 40, 975)).toBe(true);
    expect(meetsThreshold(78, 80, 975)).toBe(true);
    expect(meetsThreshold(77, 80, 975)).toBe(false);
    expect(meetsThreshold(3, 4, 750)).toBe(true);
    expect(meetsThreshold(9, 10, 900)).toBe(true);
    expect(meetsThreshold(899, 1000, 900)).toBe(false);
  });

  it("excludes lapsed and revoked records from the denominator", () => {
    const members = seedMembers();
    const offRoster = members.filter((m) => m.state === "LAPSED" || m.state === "REVOKED");
    expect(offRoster).toHaveLength(3);
    const withThemCounted = buildCompositionReport(
      members.map((m): Member => ({ ...m, state: "GOOD_STANDING" })),
    );
    expect(withThemCounted.denominator).toBe(43);
    // And the 97.5% test tips over, which is exactly why the denominator is a
    // decision and not an accident.
    expect(
      withThemCounted.tests.find((t) => t.key === "MEMBERS_CADETS_RELATIVES")!.passes,
    ).toBe(true);
    expect(withThemCounted.tests.find((t) => t.key === "ARMED_FORCES")!.numerator).toBe(38);
  });
});

/* ------------------------------------------------------------------ *
 * War-veteran derivation
 * ------------------------------------------------------------------ */

describe("war-veteran status is derived, not asserted", () => {
  it("treats the Persian Gulf period as never terminated", () => {
    expect(deriveIsWarVeteran("2014-01-01", "2020-01-01")).toBe(true);
    expect(deriveIsWarVeteran("1990-08-02", "1990-08-02")).toBe(true);
    expect(wartimePeriodsServed("2014-01-01", "2020-01-01")[0].name).toBe("Persian Gulf War");
  });

  it("does not count service that falls between wartime periods", () => {
    expect(deriveIsWarVeteran("1978-06-01", "1984-05-31")).toBe(false);
    expect(deriveIsWarVeteran("1956-03-01", "1960-08-31")).toBe(false);
    expect(deriveIsWarVeteran("1975-05-08", "1990-08-01")).toBe(false);
  });

  it("counts service that overlaps a period by a single day", () => {
    expect(deriveIsWarVeteran("1946-12-31", "1949-01-01")).toBe(true);
    expect(deriveIsWarVeteran("1947-01-01", "1949-01-01")).toBe(false);
  });

  it("counts an open end date, because it runs to today", () => {
    expect(deriveIsWarVeteran("2020-01-01", null)).toBe(true);
  });

  it("returns nothing for a record with no service dates", () => {
    expect(deriveIsWarVeteran(null, null)).toBe(false);
    expect(wartimePeriodsServed(null, "2020-01-01")).toEqual([]);
  });

  it("ignores a malformed date rather than guessing", () => {
    expect(deriveIsWarVeteran("2020", "2021")).toBe(false);
    expect(deriveIsWarVeteran("not-a-date", null)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Queues and the 30-day audit
 * ------------------------------------------------------------------ */

describe("the board queues", () => {
  it("lists the applications awaiting a vouch and awaiting payment", async () => {
    const store = repo();
    const queue = await loadApplicationQueue(store, actor("vp-membership"));
    expect(queue.awaitingVouch.length).toBeGreaterThan(0);
    expect(queue.awaitingPayment.length).toBeGreaterThan(0);
    for (const application of [...queue.awaitingVouch, ...queue.awaitingPayment]) {
      expect(application.entity).toBe(MEMBERSHIP_ENTITY);
    }
  });

  it("sweeps a lapsed vouch into the chair queue when the queue loads", async () => {
    const store = repo();
    const before = await store.listApplications(["CHAIR_QUEUE"]);
    const queue = await loadApplicationQueue(store, actor("vp-membership"));
    expect(queue.sweptToChair).toBe(1);
    const after = await store.listApplications(["CHAIR_QUEUE"]);
    expect(after.length).toBe(before.length + 1);
  });

  it("puts the 30-day cohort in front of the chair with the record findings", async () => {
    const store = repo();
    const { rows, dueCount } = await loadCohortAudit(store, actor("vp-membership"));
    expect(rows).toHaveLength(4);
    expect(dueCount).toBe(2);
    expect(rows[0].daysSincePayment).toBeGreaterThanOrEqual(rows[1].daysSincePayment);
    expect(rows.every((r) => r.member.state === "PROBATIONARY")).toBe(true);
  });

  it("passes an audit into good standing without changing what the member can reach", async () => {
    const store = repo();
    const { rows } = await loadCohortAudit(store, actor("vp-membership"));
    const due = rows.find((r) => r.dueNow)!;
    const after = await recordCohortAudit(store, actor("vp-membership"), {
      memberId: due.member.id,
      outcome: "PASSED",
      note: "Record complete.",
    });
    expect(after.state).toBe("GOOD_STANDING");
    expect(after.lastAuditedAt).not.toBeNull();
  });

  it("holds a failed audit instead of revoking, because the bylaws have not said", async () => {
    const store = repo();
    const { rows } = await loadCohortAudit(store, actor("vp-membership"));
    const due = rows.find((r) => r.dueNow)!;
    const after = await recordCohortAudit(store, actor("vp-membership"), {
      memberId: due.member.id,
      outcome: "HELD",
      note: "Service dates do not match the attestation.",
    });
    // No transition. The member keeps access until the board decides what
    // revocation means here. docs/PRIVACY-AND-PAYMENTS.md, membership revocation.
    expect(after.state).toBe("PROBATIONARY");
    const log = await loadMembershipAudit(store, actor("secretary"));
    expect(log.map((e) => e.action)).toContain("COHORT_AUDIT_FINDING_HELD");
  });

  it("refuses to audit a member who is not in the cohort", async () => {
    const store = repo();
    const members = await store.listMembers();
    const settled = members.find((m) => m.state === "GOOD_STANDING")!;
    await expect(
      recordCohortAudit(store, actor("vp-membership"), {
        memberId: settled.id,
        outcome: "PASSED",
        note: "",
      }),
    ).rejects.toThrow(/not in the probationary cohort/);
  });

  it("keeps the roster on the Association and names nobody in the report", async () => {
    const store = repo();
    const roster = await loadRoster(store, actor("vp-membership"));
    expect(roster.members.every((m) => m.entity === MEMBERSHIP_ENTITY)).toBe(true);
    expect(roster.counted).toBe(40);
    expect(roster.offRoster).toBe(3);

    const report = await loadCompositionReport(store, actor("vp-ops"));
    const serialized = JSON.stringify(report);
    for (const member of roster.members) {
      expect(serialized).not.toContain(member.displayName);
      expect(serialized).not.toContain(member.email);
    }
  });
});

/* ------------------------------------------------------------------ *
 * What this module refuses to collect
 * ------------------------------------------------------------------ */

describe("the intake collects no document and no national identifier", () => {
  it("has no field for one", async () => {
    const store = repo();
    const draft = await store.createDraft(BASE_FIELDS);
    const keys = Object.keys(draft).map((k) => k.toLowerCase());
    for (const forbidden of ["ssn", "socialsecurity", "dd214", "dd_214", "document", "upload", "attachment", "file"]) {
      expect(keys.some((k) => k.includes(forbidden))).toBe(false);
    }
  });

  it("has no field for one on the roster record either", () => {
    const keys = Object.keys(seedMembers()[0]).map((k) => k.toLowerCase());
    for (const forbidden of ["ssn", "socialsecurity", "dd214", "document", "upload", "rank", "unit"]) {
      expect(keys.some((k) => k.includes(forbidden))).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The VP Membership dashboard
 *
 * Written as requirements, like the rest of this file:
 *
 *   1. A wrong-role request to it fails, and the denial is logged.
 *   2. A role holding AGGREGATE gets the three composition tests and gets
 *      the four record-level figures withheld, not zeroed. The report is
 *      readable at aggregate on purpose; the records behind it are not, and
 *      the dashboard must not widen the grant to fill a tile.
 *   3. No tile substitutes zero for a figure that cannot be computed.
 *   4. Reading the dashboard mutates nothing.
 * ------------------------------------------------------------------ */

describe("the membership dashboard", () => {
  function tile(dashboard: MembershipDashboard, key: string) {
    const found = dashboard.kpis.find((k) => k.key === key);
    expect(found, `no tile ${key}`).toBeDefined();
    return found!;
  }

  it("refuses a role with no member data at all", async () => {
    const store = repo();
    await expect(loadMembershipDashboard(store, actor("member"))).rejects.toThrow(AuthzError);
    await expect(loadMembershipDashboard(store, actor("webmaster"))).rejects.toThrow(AuthzError);
    await expect(loadMembershipDashboard(store, actor("scholarships"))).rejects.toThrow(AuthzError);
  });

  it("refuses the right role without a second factor", async () => {
    const store = repo();
    await expect(
      loadMembershipDashboard(store, withoutMfa("vp-membership")),
    ).rejects.toThrow(AuthzError);
  });

  it("logs the denial, not only the read", async () => {
    const store = repo();
    await expect(loadMembershipDashboard(store, actor("member"))).rejects.toThrow(AuthzError);
    const log = await loadMembershipAudit(store, actor("secretary"));
    expect(log.map((e) => e.action)).toContain("READ_MEMBERSHIP_DASHBOARD:DENIED");
  });

  it("gives the roster's owner all seven tiles", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    expect(dashboard.kpis).toHaveLength(7);
    expect(dashboard.scope).toEqual({ aggregate: true, records: true, decide: true });
  });

  it("reports the 90% war-veteran test as a problem at 33 of 40", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    const war = tile(dashboard, "composition-war-veterans");
    expect(war.status).toBe("problem");
    // The fraction, not only a percentage: the denominator is the whole point
    // of this test and a bare 82.5% hides it.
    expect(war.value).toContain("33 of 40");
    expect(war.target).toContain("36 of 40");
  });

  it("calls a test that passes with nothing to spare a watch, not a good", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    expect(tile(dashboard, "composition-armed-forces").status).toBe("good");
    // 39 of 40 is exactly 97.5%. One more non-qualifying member ends the
    // exemption, so this is not an unremarkable green.
    const line = tile(dashboard, "composition-members-cadets-relatives");
    expect(line.value).toContain("39 of 40");
    expect(line.status).toBe("watch");
  });

  it("withholds the record-level figures from a role holding aggregate only", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-ops"));
    expect(dashboard.scope.records).toBe(false);

    // The three tests still compute. That is the point of the split.
    for (const key of [
      "composition-war-veterans",
      "composition-armed-forces",
      "composition-members-cadets-relatives",
    ]) {
      expect(tile(dashboard, key).value).not.toBeNull();
    }

    // The four behind them are withheld, with what it would take. Not zero.
    for (const key of ["oldest-undecided", "vouch-expiry", "record-defects", "contactable"]) {
      const withheld = tile(dashboard, key);
      expect(withheld.value).toBeNull();
      // `withheld`, not `unmeasured`. Both are null and neither is zero, but
      // "not measurable yet" and "not yours to see" are different answers and
      // the shared tile renders them differently on purpose.
      expect(withheld.status).toBe("withheld");
      expect(withheld.needs).toMatch(/READ on member records/);
    }

    // And the same role is refused the roster itself, which is what makes the
    // withholding honest rather than decorative.
    await expect(loadRoster(store, actor("vp-ops"))).rejects.toThrow(AuthzError);
  });

  it("offers an aggregate-only role no link into work it cannot open", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-ops"));
    const composition = dashboard.actions.find((a) => a.key === "composition")!;
    expect(composition.href).toBe("/board/membership/composition");
    for (const key of ["exceptions", "audit", "roster", "queue"]) {
      const action = dashboard.actions.find((a) => a.key === key)!;
      expect(action.href).toBeNull();
      // The count is withheld rather than zero, for the same reason the tile
      // is: a zero would read as "there is no work here".
      expect(action.count).toBe("withheld");
      expect(action.note).toMatch(/^Withheld\./);
      expect(action.urgent).toBe(false);
    }
  });

  it("degrades to read-only for a role that can read records but not write them", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("president"));
    expect(dashboard.scope).toEqual({ aggregate: true, records: true, decide: false });
    // Every figure computes; the actions say who may act.
    expect(dashboard.kpis.filter((k) => k.value === null).map((k) => k.key)).toEqual([
      "contactable",
    ]);
    const decide = dashboard.actions.find((a) => a.key === "exceptions")!;
    expect(decide.href).toBe("/board/membership/exceptions");
    expect(decide.note).toMatch(/Read-only for this role/);
  });

  it("measures the oldest undecided application against the four days promised", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    const oldest = tile(dashboard, "oldest-undecided");
    expect(oldest.target).toBe(`${PROMISED_OUTCOME_DAYS} days`);
    expect(oldest.value).toBe("8 days");
    expect(oldest.status).toBe("problem");
    // The promise the tile is measured against is the one the applicant was
    // actually given, not an invented service level.
    expect(INTAKE_MESSAGE).toContain("four days");
  });

  it("rates vouch expiry against settled requests, not against open windows", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    const vouch = tile(dashboard, "vouch-expiry");
    // Three seeded requests: one window closed unanswered, two still open. An
    // open window has not failed, so it is not in the denominator.
    expect(vouch.value).toBe("1 of 1 settled");
    expect(vouch.from).toContain("still inside the 72-hour window");
    expect(vouch.from).toMatch(/too few to read as a rate/);
  });

  it("counts a self-contradicting record once, however many findings it carries", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    const defects = tile(dashboard, "record-defects");
    // One peacetime veteran who ticked the war-veteran box, and one veteran
    // record with no dates at all which therefore also disagrees with its
    // attestation. Two records, three findings.
    expect(defects.value).toBe("2 of 40");
    const report = await loadCompositionReport(store, actor("vp-membership"));
    expect(report.attestationMismatches + report.missingServiceDates).toBe(3);
  });

  it("will not call an unverified address a verified one", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    const contact = tile(dashboard, "contactable");
    expect(contact.value).toBeNull();
    expect(contact.needs).toMatch(/confirmed-at timestamp/);
    // A count of addresses present is a different figure, and it belongs in
    // the provenance line rather than in the value.
    expect(contact.from).toContain("40 of 40");
  });

  it("has no raw member count anywhere on it", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    for (const kpi of dashboard.kpis) {
      // Every figure on this screen is a fraction, an age or a rate. A bare
      // count of members only goes up and changes no decision.
      expect(kpi.label.toLowerCase()).not.toMatch(/^(total|members on the roster)/);
      expect(kpi.value).not.toBe("40");
    }
  });

  it("states what every tile was computed from", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    for (const kpi of dashboard.kpis) {
      expect(kpi.from.length, kpi.key).toBeGreaterThan(30);
      if (kpi.value === null) expect(kpi.needs, kpi.key).toBeTruthy();
    }
  });

  it("mutates nothing, so the figures do not depend on who looked first", async () => {
    const store = repo();
    const before = (await store.listApplications()).map((a) => `${a.id}:${a.state}`);
    await loadMembershipDashboard(store, actor("vp-membership"));
    const after = (await store.listApplications()).map((a) => `${a.id}:${a.state}`);
    expect(after).toEqual(before);

    // The queue screen sweeps, and that is a write. After it runs, the
    // dashboard's own count of what is with the chair is unchanged, because it
    // was already counting a closed window as the chair's.
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    await loadApplicationQueue(store, actor("vp-membership"));
    const swept = await loadMembershipDashboard(store, actor("vp-membership"));
    const chairBefore = dashboard.actions.find((a) => a.key === "exceptions")!.count;
    const chairAfter = swept.actions.find((a) => a.key === "exceptions")!.count;
    expect(chairAfter).toBe(chairBefore);
  });

  it("medians honestly, including when there is nothing to median", async () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([4])).toBe(4);
    expect(medianOf([1, 2, 3])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(3);
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    const row = dashboard.rows.find((r) => r.key === "median-decision")!;
    // One recorded decision. The row says so rather than presenting one
    // observation as a median.
    expect(row.detail).toMatch(/1 recorded chair decision/);
  });

  it("rounds its thresholds up, in integers", () => {
    expect(requiredNumerator(THRESHOLDS.WAR_VETERANS, 40)).toBe(36);
    expect(requiredNumerator(THRESHOLDS.MEMBERS_CADETS_RELATIVES, 40)).toBe(39);
    expect(requiredNumerator(THRESHOLDS.ARMED_FORCES, 40)).toBe(30);
    // 97.5% of 41 is 39.975. Forty records, not thirty-nine.
    expect(requiredNumerator(THRESHOLDS.MEMBERS_CADETS_RELATIVES, 41)).toBe(40);
  });
});

/* ------------------------------------------------------------------ *
 * The VP Membership role workspace
 *
 * `docs/ROLE-WORKSPACE.md` as requirements:
 *
 *   1. The Dashboard leads with three figures, and the 90% war-veteran test is
 *      one of them. The other four still exist.
 *   2. Tasks are DERIVED. Nothing can be typed, a count of zero is not a task,
 *      and a count the reader may not see is withheld rather than shown as
 *      none.
 *   3. Projects is a FILTER over the one register, not a copy.
 *   4. A wrong-role request to every tab fails, and the denial is logged.
 *   5. The two outside audiences are never merged.
 * ------------------------------------------------------------------ */

describe("the membership role workspace", () => {
  it("leads the dashboard with three tiles and keeps the other four", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));

    expect(dashboard.headline).toHaveLength(3);
    expect(dashboard.more).toHaveLength(4);
    // The partition is a view of one list, so nothing is lost and nothing is
    // counted twice.
    expect([...dashboard.headline, ...dashboard.more].map((k) => k.key).sort()).toEqual(
      dashboard.kpis.map((k) => k.key).sort(),
    );
  });

  it("puts the failing 90% test first, because it is the one that contradicts the site", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    expect(dashboard.headline[0].key).toBe("composition-war-veterans");
    expect(dashboard.headline[0].status).toBe("problem");
    // The 75% test passes with margin, and good is unremarkable, so it is not
    // one of the three.
    expect(dashboard.more.map((k) => k.key)).toContain("composition-armed-forces");
  });

  it("derives every task from the dashboard's own actions", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    const overview = await loadMembershipOverview(store, actor("vp-membership"), dashboard);

    // One list, two renderings. A task that is not an action would mean a
    // second source of truth, which is the thing the spine forbids.
    for (const task of overview.tasks) {
      const action = dashboard.actions.find((a) => `task-${a.key}` === task.key);
      expect(action, task.key).toBeDefined();
      expect(task.count).toBe(action!.n);
      expect(task.because.length).toBeGreaterThan(30);
    }
    expect(overview.tasks.length).toBeGreaterThan(0);
  });

  it("does not render a task for work with nothing waiting", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    const overview = await loadMembershipOverview(store, actor("vp-membership"), dashboard);
    // A count of zero is a figure, and it has a tile. It is not a task.
    for (const task of overview.tasks) expect(task.count).not.toBe(0);
  });

  it("withholds a task rather than showing an aggregate reader no work", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-ops"));
    const overview = await loadMembershipOverview(store, actor("vp-ops"), dashboard);

    // The composition item survives: the report needs only AGGREGATE, so the
    // board matter the roster produced still reaches the reader.
    expect(overview.tasks.map((t) => t.key)).toEqual(["task-composition"]);
    expect(overview.withheld?.items).toHaveLength(4);
    expect(overview.withheld?.why).toMatch(/READ on member records/);
    // The thing that must never happen: a withheld count rendered as none.
    for (const task of overview.tasks) expect(task.count).not.toBeNull();
  });

  it("marks a calendar date nobody has established as unverified", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-membership"));
    const overview = await loadMembershipOverview(store, actor("vp-membership"), dashboard);

    const hygiene = overview.calendar.find((item) => item.key === "cal-roster-hygiene")!;
    expect(hygiene.unverified).toBe(true);
    // Everything else on the calendar is a real date out of the data or the
    // register, so nothing else may claim to be unverified or need to.
    for (const item of overview.calendar.filter((i) => i.key !== "cal-roster-hygiene")) {
      expect(item.unverified, item.key).toBeUndefined();
      expect(item.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("keeps the cohort audit and vouch dates off an aggregate reader's calendar", async () => {
    const store = repo();
    const dashboard = await loadMembershipDashboard(store, actor("vp-ops"));
    const overview = await loadMembershipOverview(store, actor("vp-ops"), dashboard);
    const keys = overview.calendar.map((item) => item.key);
    // Both are derived from one member's cleared payment and one applicant's
    // window, so they are record-level however short they look.
    expect(keys).not.toContain("cal-cohort-audit");
    expect(keys).not.toContain("cal-vouch-window");
    expect(keys).toContain("cal-roster-hygiene");
  });

  it("takes the failing test to the board and the record fixes to the chair", async () => {
    const store = repo();
    const planning = await loadMembershipPlanning(store, actor("vp-membership"));
    const ids = planning.items.map((item) => item.id);

    expect(ids).toContain("plan-war-veteran-test");
    expect(ids).toContain("plan-augmentee-decider");
    // Correcting a self-contradicting record is the chair's own work and is a
    // task on the Overview. It is not an agenda item.
    expect(ids).not.toContain("plan-record-defects");

    const war = planning.items.find((item) => item.id === "plan-war-veteran-test")!;
    expect(war.type).toBe("DECISION");
    expect(war.reason).toContain("33 of 40");
    expect(war.proposedByRole).toBe("VP_MEMBERSHIP");
    // Nothing is on an agenda until the Secretary puts it there, and that
    // handoff is not built yet.
    expect(war.acceptedForMeetingId).toBeNull();
    expect(planning.handoffWired).toBe(false);
  });

  it("gives an aggregate reader the composition items and withholds the augmentee count", async () => {
    const store = repo();
    const planning = await loadMembershipPlanning(store, actor("vp-ops"));
    const ids = planning.items.map((item) => item.id);
    expect(ids).toContain("plan-war-veteran-test");
    expect(ids).not.toContain("plan-augmentee-decider");
    expect(planning.withheld?.items).toHaveLength(1);
  });

  it("filters the one register instead of keeping a membership copy", async () => {
    const { owned, contributing } = membershipProjects();
    // Every row came out of the shared register, by identity.
    for (const project of [...owned, ...contributing]) {
      expect(PROJECTS.find((p) => p.id === project.id), project.id).toBeDefined();
    }
    // This office owns nothing and contributes to the scholarship cycle, which
    // is the handoff the tab exists to make visible.
    expect(owned).toHaveLength(0);
    expect(contributing.map((p) => p.id)).toContain("prj-scholarship-cycle");
    for (const project of contributing) {
      expect(project.contributorRoles).toContain("VP_MEMBERSHIP");
    }
  });

  it("never merges the two outside audiences", () => {
    const outside = membershipOutside(actor("vp-membership"));
    expect(outside.surface.noExternalSurface).toBe(false);

    const audiences = new Set(outside.surface.items.map((item) => item.audience));
    expect(audiences).toEqual(new Set(["PUBLIC", "MEMBER_OR_DONOR"]));
    // Every item belongs to exactly one audience, so no row can be rendered
    // into both columns.
    for (const item of outside.surface.items) {
      expect(["PUBLIC", "MEMBER_OR_DONOR"], item.key).toContain(item.audience);
      if (item.problem !== "NONE") expect(item.note, item.key).toBeTruthy();
    }
  });

  it("flags the dead membership URL and the unqualified dues statement", () => {
    const outside = membershipOutside(actor("vp-membership"));
    const dead = outside.surface.items.find((item) => item.key === "out-membership-404")!;
    expect(dead.audience).toBe("PUBLIC");
    expect(dead.problem).toBe("DEAD_LINK");
    expect(dead.note).toMatch(/404/);

    const dues = outside.surface.items.find((item) => item.key === "out-dues-deductibility")!;
    expect(dues.note).toMatch(/not a charitable contribution/);
  });

  it("reads this role's reach over public content from the role table", () => {
    // The office that owns membership cannot change a word of the pages that
    // describe it. Computed, so it stays true if the role table changes.
    expect(membershipOutside(actor("vp-membership")).publicContentLevel).toBe("NONE");
    expect(membershipOutside(actor("vp-ops")).publicContentLevel).toBe("READ");
  });

  it("refuses every workspace tab to a role with no member data at all", async () => {
    const store = repo();
    for (const persona of ["member", "webmaster", "scholarships"]) {
      await expect(
        guardWorkspaceRead(store, actor(persona), "READ_MEMBERSHIP_PROJECTS"),
      ).rejects.toThrow(AuthzError);
      await expect(loadMembershipPlanning(store, actor(persona))).rejects.toThrow(AuthzError);
    }
    await expect(
      guardWorkspaceRead(store, withoutMfa("vp-membership"), "READ_MEMBERSHIP_OUTSIDE_VIEW"),
    ).rejects.toThrow(AuthzError);

    const log = await loadMembershipAudit(store, actor("secretary"));
    expect(log.map((e) => e.action)).toContain("READ_MEMBERSHIP_PROJECTS:DENIED");
  });
});

/* ------------------------------------------------------------------ *
 * E07. The applicant's confirmation
 *
 * The thing that did not exist: the handler wrote to the sponsor and to the
 * chair and never to the person who filled the form in.
 *
 * Written as the acceptance criteria, and one of them is a property rather
 * than an output: the confirmation must not be the place the enumeration
 * defence leaks from. So there are tests here about what the message is NOT a
 * function of, as well as what it says.
 * ------------------------------------------------------------------ */

describe("the applicant gets a confirmation, and it is the same one every time", () => {
  it("enqueues one on submission", async () => {
    const store = repo();
    const result = await submitWith(store, { sponsorMemberId: seedSponsorMemberId() });
    expect(result.debug.confirmation.kind).toBe("APPLICANT_CONFIRMATION");
  });

  it("says the reference, the four days, and that nothing has been charged", () => {
    const body = applicantConfirmationBody("ABCD-2345");
    expect(body).toContain("ABCD-2345");
    // The same promise the screen makes, from the same constant, so the two
    // cannot drift into saying different numbers of days.
    expect(body).toContain("four days");
    expect(body).toContain(INTAKE_MESSAGE);
    expect(body).toContain("Nothing has been charged");
    // Settled on 27 October: one payment, no renewal. Three published
    // statements disagreed before that and two of them were wrong.
    expect(body).toContain("paid once and not renewed");
    expect(body).not.toMatch(/a year|annual/i);
  });

  it("differs between two applicants only in the reference", () => {
    const a = applicantConfirmationBody("AAAA-2345");
    const b = applicantConfirmationBody("BBBB-6789");
    expect(a.replace("AAAA-2345", "·")).toBe(b.replace("BBBB-6789", "·"));
  });

  it("is byte-identical across a valid, unknown, malformed and blank sponsor", async () => {
    const store = repo();
    const bodies: string[] = [];
    const states: string[] = [];
    for (const [index, sponsor] of [
      seedSponsorMemberId(),
      "JSOA-1998-9999",
      "nonsense",
      "",
    ].entries()) {
      const result = await submitWith(store, {
        sponsorMemberId: sponsor,
        email: `confirm-${index}@example.org`,
      });
      const application = await store.getApplication(result.debug.applicationId);
      bodies.push(applicantConfirmationBody(application!.reference).replace(application!.reference, "·"));
      states.push(result.debug.confirmation.state);
    }
    for (const body of bodies.slice(1)) expect(body).toBe(bodies[0]);
    // And the queued state is the same too, because it is a function of the
    // APPLICANT's address and of nothing about the sponsor.
    for (const state of states.slice(1)) expect(state).toBe(states[0]);
  });

  it("records a confirmation with nowhere to go rather than skipping it", async () => {
    const store = repo();
    // A typo'd address is the edge case the chair needs a view of. The queue
    // writes the row either way; the state is what makes it visible.
    const result = await submitWith(store, { email: "" });
    expect(result.debug.confirmation.state).toBe("UNDELIVERABLE");
    // And the submission still completed, with the usual acknowledgment.
    expect(result.acknowledgment.message).toBe(INTAKE_MESSAGE);
    expect(result.debug.state).toBe("AWAITING_VOUCH");
  });

  it("acknowledges a submission for a draft that no longer exists, and still queues one", async () => {
    const store = repo();
    const ghost = await submitApplication(store, "app_does_not_exist");
    expect(ghost.acknowledgment.received).toBe(true);
    expect(ghost.debug.confirmation.kind).toBe("APPLICANT_CONFIRMATION");
    expect(ghost.debug.confirmation.state).toBe("UNDELIVERABLE");
  });

  it("sends membership mail on the transactional stream, as the Association", async () => {
    const message = await notify.enqueue({
      kind: "DUES_RECEIPT",
      to: "member@example.org",
      subject: "s",
      body: "b",
      stream: "TRANSACTIONAL",
    });
    // An unsubscribe from the newsletter must never stop a receipt, which is
    // what the two streams are for. `stream` has no default on
    // `MembershipDraft`, so omitting it is a type error rather than a guess.
    expect(message.stream).toBe("TRANSACTIONAL");
    expect(message.entity).toBe(MEMBERSHIP_ENTITY);
  });

  it("keeps no outbox of its own", () => {
    // The port is only a port if the old array is gone. Two outboxes would
    // mean the Communications Chair's screen showed half the mail.
    expect(Object.keys(notify)).not.toContain("readOutbox");
    expect(Object.keys(notify)).not.toContain("OutboxMessage");
  });
});

/* ------------------------------------------------------------------ *
 * E09. Reviewer assignment
 * ------------------------------------------------------------------ */

describe("a chair-queue item can be given to a named reviewer", () => {
  async function queued(store: MembershipRepository) {
    const { queue } = await loadChairQueue(store, actor("vp-membership"));
    return queue[0];
  }

  it("records who holds it and since when", async () => {
    const store = repo();
    const item = await queued(store);
    const assigned = await assignToReviewer(store, actor("vp-membership"), {
      applicationId: item.id,
      reviewerPersonId: "dev:secretary",
    });
    expect(assigned.assignedTo).toBe("dev:secretary");
    expect(assigned.assignedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records who assigned it, to whom, and when, in the audit log", async () => {
    const store = repo();
    const item = await queued(store);
    await assignToReviewer(store, actor("vp-membership"), {
      applicationId: item.id,
      reviewerPersonId: "dev:secretary",
    });
    const entry = (await loadMembershipAudit(store, actor("secretary"))).find(
      (e) => e.action === "ASSIGN_APPLICATION",
    );
    expect(entry).toBeDefined();
    expect(entry!.personId).toBe("dev:vp-membership");
    expect(entry!.subjectRef).toBe(`${item.id} to dev:secretary`);
    expect(entry!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry!.rowLevel).toBe(true);
  });

  it("leaves both the old and the new assignment in the record", async () => {
    const store = repo();
    const item = await queued(store);
    const chair = actor("vp-membership");
    await assignToReviewer(store, chair, {
      applicationId: item.id,
      reviewerPersonId: "dev:secretary",
    });
    await assignToReviewer(store, chair, {
      applicationId: item.id,
      reviewerPersonId: "dev:president",
    });

    // The column holds one current holder, because there is one. The HISTORY
    // is the append-only log, which has no update path and no delete path, so
    // the earlier assignment cannot be overwritten or removed.
    expect((await store.getApplication(item.id))?.assignedTo).toBe("dev:president");
    const refs = (await loadMembershipAudit(store, actor("secretary")))
      .filter((e) => e.action === "ASSIGN_APPLICATION")
      .map((e) => e.subjectRef);
    expect(refs).toContain(`${item.id} to dev:secretary`);
    expect(refs).toContain(`${item.id} to dev:president`);
  });

  it("treats releasing an item as an action with its own record", async () => {
    const store = repo();
    const item = await queued(store);
    const chair = actor("vp-membership");
    await assignToReviewer(store, chair, {
      applicationId: item.id,
      reviewerPersonId: "dev:secretary",
    });
    const released = await assignToReviewer(store, chair, {
      applicationId: item.id,
      reviewerPersonId: null,
    });
    expect(released.assignedTo).toBeNull();
    expect(released.assignedAt).toBeNull();
    expect(
      (await loadMembershipAudit(store, actor("secretary"))).map((e) => e.action),
    ).toContain("UNASSIGN_APPLICATION");
  });

  it("lets a reviewer see exactly their own items", async () => {
    const store = repo();
    const chair = actor("vp-membership");
    const { queue } = await loadChairQueue(store, chair);
    expect(queue.length).toBeGreaterThan(1);
    await assignToReviewer(store, chair, {
      applicationId: queue[0].id,
      reviewerPersonId: chair.personId,
    });
    await assignToReviewer(store, chair, {
      applicationId: queue[1].id,
      reviewerPersonId: "dev:secretary",
    });

    expect((await loadChairQueue(store, chair)).mine).toEqual([queue[0].id]);
    // And the Secretary, who can read the queue, sees theirs.
    expect((await loadChairQueue(store, actor("secretary"))).mine).toEqual([queue[1].id]);
  });

  it("lets a role that can only read see the assignments and not make one", async () => {
    const store = repo();
    const item = await queued(store);
    await assignToReviewer(store, actor("vp-membership"), {
      applicationId: item.id,
      reviewerPersonId: "dev:secretary",
    });

    const president = await loadChairQueue(store, actor("president"));
    expect(president.mayAssign).toBe(false);
    expect(president.queue.find((a) => a.id === item.id)?.assignedTo).toBe("dev:secretary");
    await expect(
      assignToReviewer(store, actor("president"), {
        applicationId: item.id,
        reviewerPersonId: "dev:president",
      }),
    ).rejects.toThrow(AuthzError);
  });

  it("refuses a role with no member data, and logs the refusal", async () => {
    const store = repo();
    const item = await queued(store);
    for (const persona of ["member", "webmaster", "vp-ops"]) {
      await expect(loadChairQueue(store, actor(persona))).rejects.toThrow(AuthzError);
      await expect(
        assignToReviewer(store, actor(persona), {
          applicationId: item.id,
          reviewerPersonId: "dev:secretary",
        }),
      ).rejects.toThrow(AuthzError);
    }
    expect(
      (await loadMembershipAudit(store, actor("secretary"))).map((e) => e.action),
    ).toContain("ASSIGN_APPLICATION:DENIED");
  });

  it("refuses the right role without a second factor", async () => {
    const store = repo();
    const item = await queued(store);
    await expect(
      assignToReviewer(store, withoutMfa("vp-membership"), {
        applicationId: item.id,
        reviewerPersonId: "dev:secretary",
      }),
    ).rejects.toThrow(AuthzError);
  });

  it("blocks assigning an item to its own applicant, at assignment time", async () => {
    const store = repo();
    const chair = actor("vp-membership");
    const ownAddress = BOARD_CONTACTS[chair.personId];
    const draft = await store.createDraft({
      ...BASE_FIELDS,
      email: ownAddress,
      isAugmentee: true,
    });
    await submitApplication(store, draft.id);

    // `assertNotSelfApproval` already blocks the DECISION. Blocking it here
    // too is the point: an item assigned to somebody who can never act on it
    // sits in the queue looking like work in hand.
    await expect(
      assignToReviewer(store, chair, {
        applicationId: draft.id,
        reviewerPersonId: chair.personId,
      }),
    ).rejects.toThrow(/Self-approval/);
    expect((await store.getApplication(draft.id))?.assignedTo).toBeNull();
  });

  it("refuses an item that is not in the chair queue", async () => {
    const store = repo();
    await expect(
      assignToReviewer(store, actor("vp-membership"), {
        applicationId: "seed-app-001",
        reviewerPersonId: "dev:secretary",
      }),
    ).rejects.toThrow(/not in the chair queue/);
  });

  it("flags an item nobody holds once it is older than the window", async () => {
    const store = repo();
    const { queue, staleUnassigned } = await loadChairQueue(store, actor("vp-membership"));
    // Nothing is seeded as assigned, which is the state the office is in.
    expect(queue.every((a) => a.assignedTo === null)).toBe(true);
    // The eight-day-old non-qualifying case is in there.
    expect(staleUnassigned).toContain("seed-app-005");
    expect(staleUnassigned.length).toBeGreaterThan(0);

    // And once somebody holds it, it is not flagged, however old it is.
    await assignToReviewer(store, actor("vp-membership"), {
      applicationId: "seed-app-005",
      reviewerPersonId: "dev:secretary",
    });
    const after = await loadChairQueue(store, actor("vp-membership"));
    expect(after.staleUnassigned).not.toContain("seed-app-005");
  });

  it("measures the unheld window in whole days, from the submission", () => {
    const base = new Date("2026-10-27T12:00:00Z");
    const application = {
      assignedTo: null,
      submittedAt: "2026-10-27T12:00:00Z",
      createdAt: "2026-10-01T00:00:00Z",
    } as never;
    expect(daysWaiting(application, base)).toBe(0);
    expect(isStaleUnassigned(application, base)).toBe(false);
    const later = new Date(base.getTime() + UNASSIGNED_FLAG_DAYS * 86_400_000);
    expect(isStaleUnassigned(application, later)).toBe(true);
    // Held is never stale.
    expect(
      isStaleUnassigned({ ...(application as object), assignedTo: "dev:secretary" } as never, later),
    ).toBe(false);
  });

  it("offers only people the role table says may read member records", () => {
    const candidates = PERSONAS.map((persona) => ({
      personId: `dev:${persona.id}`,
      label: persona.label,
      assignments: persona.assignments,
    }));
    const ids = eligibleReviewers(candidates).map((c) => c.personId);

    // Computed from the role table, not from a list kept in the module, so a
    // membership committee becomes assignable the moment the grant is made.
    expect(ids).toContain("dev:vp-membership");
    expect(ids).toContain("dev:president");
    expect(ids).toContain("dev:secretary");
    // AGGREGATE is not READ. These roles can see the composition report and
    // cannot be handed an application.
    expect(ids).not.toContain("dev:vp-ops");
    expect(ids).not.toContain("dev:treasurer-jsoa");
    expect(ids).not.toContain("dev:member");
    expect(ids).not.toContain("dev:webmaster");
    // A Foundation role is not eligible for an Association function.
    expect(ids).not.toContain("dev:scholarships");
  });
});

/* ------------------------------------------------------------------ *
 * E11. The account that follows a cleared payment
 * ------------------------------------------------------------------ */

describe("a cleared payment creates an account, not only a roster row", () => {
  it("carries a person link on the member type at all", () => {
    // The whole of the gap: the column existed in 0003 and the domain type had
    // no field for it, so nothing could write it and nothing read it back.
    expect(Object.keys(seedMembers()[0])).toContain("personId");
  });

  it("stores and reads back a person link", async () => {
    const store = repo();
    const member = await store.createMember({ ...newMemberFields(), personId: "p-linked" });
    expect(member.personId).toBe("p-linked");
    expect((await store.getMember(member.id))?.personId).toBe("p-linked");
    expect((await store.getMemberByPersonId("p-linked"))?.id).toBe(member.id);
  });

  it("creates the member and says so when there is no identity store to link to", async () => {
    const store = repo();
    const draft = await store.createDraft(BASE_FIELDS);
    await store.setApplicationState(draft.id, "AWAITING_PAYMENT");
    const handoff = await createHandoff(store, draft.id);
    const member = await clearDues(store, handoff.id);

    // There is no D1 binding under test, so there is no `person` table to
    // write to. The roster record is still created — the money was taken —
    // and the fact that the account is missing is on the record rather than
    // in a log nobody reads.
    expect(member.personId).toBeNull();
    const entry = (await loadMembershipAudit(store, actor("secretary"))).find((e) =>
      e.action.startsWith("MEMBER_ACCOUNT_"),
    );
    expect(entry?.action).toBe("MEMBER_ACCOUNT_NOT_LINKED");
    expect(entry?.subjectRef).toContain(member.memberId);
    expect(entry?.subjectRef).toContain(draft.id);
    expect(entry?.subjectRef).toContain(handoff.id);
  });

  it("reports a missing identity store rather than throwing on a cleared payment", async () => {
    const provisioning = await provisionMemberAccount({
      email: "new.member@example.org",
      displayName: "New Member",
      entity: MEMBERSHIP_ENTITY,
    });
    expect(provisioning.linked).toBe(false);
    expect(provisioning.personId).toBeNull();
    if (!provisioning.linked) expect(provisioning.reason).toBe(NO_IDENTITY_STORE);
  });

  it("sends a receipt that says what was paid and that it is not deductible", async () => {
    const store = repo();
    const draft = await store.createDraft(BASE_FIELDS);
    await store.setApplicationState(draft.id, "AWAITING_PAYMENT");
    const handoff = await createHandoff(store, draft.id);
    const member = await clearDues(store, handoff.id);

    const body = duesReceiptBody(member);
    expect(body).toContain(member.memberId);
    expect(body).toContain("$200.00");
    expect(body).toContain("not a charitable contribution");
    expect(body).toContain("does not renew");
  });
});

/* ------------------------------------------------------------------ *
 * E13. Roster search and filter
 *
 * The property worth testing is not that the search works. It is that the
 * log does not record what was searched for, and that a narrowed list says
 * it is narrowed — a chair who reads a filtered roster as the whole roster
 * concludes somebody is not a member when they are.
 * ------------------------------------------------------------------ */

describe("the roster can be searched and filtered", () => {
  const filter = (patch: Partial<RosterFilter>): RosterFilter => ({
    ...EMPTY_ROSTER_FILTER,
    ...patch,
  });

  it("matches part of a surname, a member number and an email, in any case", () => {
    const member = seedMembers()[0];
    const surname = member.displayName.split(" ").pop()!;
    expect(matchesRosterFilter(member, filter({ q: surname.slice(1, 5).toLowerCase() }))).toBe(true);
    expect(matchesRosterFilter(member, filter({ q: member.memberId.slice(-4) }))).toBe(true);
    expect(matchesRosterFilter(member, filter({ q: member.email.split("@")[0].toUpperCase() }))).toBe(
      true,
    );
    expect(matchesRosterFilter(member, filter({ q: "zzz-not-there" }))).toBe(false);
  });

  it("shows the whole roster when nothing is asked for", async () => {
    const store = repo();
    const roster = await loadRoster(store, actor("vp-membership"));
    expect(roster.members).toHaveLength(43);
    expect(roster.total).toBe(43);
    expect(roster.counted).toBe(40);
    expect(roster.offRoster).toBe(3);
  });

  it("narrows to one standing, and the count matches the rows rendered", async () => {
    const store = repo();
    const roster = await loadRoster(store, actor("vp-membership"), filter({ state: "LAPSED" }));
    expect(roster.members.length).toBeGreaterThan(0);
    expect(roster.members.every((m) => m.state === "LAPSED")).toBe(true);
    // The figures at the top of the screen describe the rows underneath, and
    // `total` is what makes "2 of 43" sayable without either number lying.
    expect(roster.counted + roster.offRoster).toBe(roster.members.length);
    expect(roster.offRoster).toBe(roster.members.length);
    expect(roster.total).toBe(43);
  });

  it("narrows by partial member number, and the result carries the number", async () => {
    const store = repo();
    const all = await loadRoster(store, actor("vp-membership"));
    const target = all.members[3];
    const found = await loadRoster(
      store,
      actor("vp-membership"),
      filter({ q: target.memberId }),
    );
    expect(found.members.map((m) => m.memberId)).toContain(target.memberId);
    // Two members with the same name is common here, so every row has to
    // carry the number the chair disambiguates on.
    for (const member of found.members) expect(member.memberId).toMatch(/^JSOA-\d{4}-\d{4}$/);
  });

  it("narrows by category and by sponsor", async () => {
    const store = repo();
    const cadets = await loadRoster(
      store,
      actor("vp-membership"),
      filter({ category: "CADET" }),
    );
    expect(cadets.members.length).toBeGreaterThan(0);
    expect(cadets.members.every((m) => m.membershipCategory === "CADET")).toBe(true);

    const sponsor = cadets.sponsorMemberIds[0];
    const bySponsor = await loadRoster(
      store,
      actor("vp-membership"),
      filter({ sponsorMemberId: sponsor }),
    );
    expect(bySponsor.members.every((m) => m.sponsorMemberId === sponsor)).toBe(true);
  });

  it("writes the same audit entry whether the search matched everything or nothing", async () => {
    const store = repo();
    await loadRoster(store, actor("vp-membership"), filter({ q: "" }));
    await loadRoster(store, actor("vp-membership"), filter({ q: "nobody-by-this-name" }));

    const reads = (await loadMembershipAudit(store, actor("secretary"))).filter(
      (e) => e.action === "READ_ROSTER",
    );
    expect(reads).toHaveLength(2);
    // Same action, same class, same row-level flag, and no trace of the term.
    for (const entry of reads) {
      expect(entry.subjectRef).toBeNull();
      expect(entry.rowLevel).toBe(true);
      expect(JSON.stringify(entry)).not.toContain("nobody-by-this-name");
    }
  });

  it("still refuses an aggregate-only role, filter or no filter", async () => {
    const store = repo();
    await expect(
      loadRoster(store, actor("vp-ops"), filter({ q: "a" })),
    ).rejects.toThrow(AuthzError);
    await expect(
      loadRoster(store, withoutMfa("vp-membership"), filter({ state: "LAPSED" })),
    ).rejects.toThrow(AuthzError);
  });
});

/* ------------------------------------------------------------------ *
 * E30. Correcting contact details, chair side
 * ------------------------------------------------------------------ */

describe("the chair can correct a member's contact details", () => {
  async function anyMember(store: MembershipRepository): Promise<Member> {
    const roster = await loadRoster(store, actor("vp-membership"));
    return roster.members.find((m) => m.personId === null)!;
  }

  it("changes a phone number and puts the reason on the record", async () => {
    const store = repo();
    const member = await anyMember(store);
    const after = await correctMemberContact(store, actor("vp-membership"), {
      memberId: member.id,
      phone: "(910) 555-9999",
      reason: "Telephoned me; the old number is disconnected.",
    });
    expect(after.phone).toBe("(910) 555-9999");
    expect((await store.getMember(member.id))?.phone).toBe("(910) 555-9999");

    const entry = (await loadMembershipAudit(store, actor("secretary"))).find(
      (e) => e.action === "MEMBER_PHONE_CORRECTED",
    );
    expect(entry?.personId).toBe("dev:vp-membership");
    expect(entry?.subjectRef).toContain(member.memberId);
    expect(entry?.subjectRef).toContain("disconnected");
  });

  it("changes an email address and tells the address it replaced", async () => {
    const store = repo();
    const member = await anyMember(store);
    const after = await correctMemberContact(store, actor("vp-membership"), {
      memberId: member.id,
      email: "corrected@example.org",
      reason: "Typo at import. Confirmed on the phone.",
    });
    expect(after.email).toBe("corrected@example.org");
    expect(
      (await loadMembershipAudit(store, actor("secretary"))).map((e) => e.action),
    ).toContain("MEMBER_EMAIL_CORRECTED");
  });

  it("keeps the addresses out of the audit entry", async () => {
    const store = repo();
    const member = await anyMember(store);
    const before = member.email;
    await correctMemberContact(store, actor("vp-membership"), {
      memberId: member.id,
      email: "somewhere.else@example.org",
      reason: "Confirmed on the phone.",
    });
    const entry = (await loadMembershipAudit(store, actor("secretary"))).find(
      (e) => e.action === "MEMBER_EMAIL_CORRECTED",
    );
    // The log holds the member number and the reason. A history of every
    // address the organization has ever held for a person is more than the
    // log needs in order to answer who changed what.
    expect(entry?.subjectRef).not.toContain(before);
    expect(entry?.subjectRef).not.toContain("somewhere.else@example.org");
  });

  it("will not touch anything except the two contact fields", async () => {
    const store = repo();
    const member = await anyMember(store);
    const after = await correctMemberContact(store, actor("vp-membership"), {
      memberId: member.id,
      phone: "(910) 555-0000",
      reason: "Confirmed on the phone.",
    });
    for (const field of [
      "displayName",
      "membershipCategory",
      "serviceFrom",
      "serviceTo",
      "isWarVeteran",
      "state",
      "sponsorMemberId",
      "memberId",
    ] as const) {
      expect(after[field], field).toEqual(member[field]);
    }
  });

  it("refuses a correction with no reason, and a correction that changes nothing", async () => {
    const store = repo();
    const member = await anyMember(store);
    await expect(
      correctMemberContact(store, actor("vp-membership"), {
        memberId: member.id,
        phone: "(910) 555-1111",
        reason: "   ",
      }),
    ).rejects.toThrow(ContactCorrectionError);
    await expect(
      correctMemberContact(store, actor("vp-membership"), {
        memberId: member.id,
        email: member.email,
        phone: member.phone,
        reason: "Nothing is actually different.",
      }),
    ).rejects.toThrow(CONTACT_REFUSALS.NOTHING_TO_CHANGE);
  });

  it("refuses an address another record already holds, without saying whose", async () => {
    const store = repo();
    const roster = await loadRoster(store, actor("vp-membership"));
    const [first, second] = roster.members;
    let caught: unknown = null;
    try {
      await correctMemberContact(store, actor("vp-membership"), {
        memberId: first.id,
        email: second.email,
        reason: "Couple consolidating mailboxes.",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContactCorrectionError);
    const message = (caught as Error).message;
    expect(message).toBe(CONTACT_REFUSALS.EMAIL_TAKEN);
    // The refusal must not confirm that the address belongs to a member here,
    // which is the same question `/apply` refuses to answer.
    expect(message).not.toContain(second.email);
    expect(message).not.toContain(second.displayName);
    expect(message).not.toContain(second.memberId);
    expect((await store.getMember(first.id))?.email).toBe(first.email);
  });

  it("refuses an email change for a member with an account when the identity store is unreachable", async () => {
    const store = repo();
    const member = await store.createMember({
      ...newMemberFields(),
      personId: "p-has-an-account",
    });
    // `person.email` is the identity and `member.email` is the roster
    // contact. Moving one without the other leaves somebody unable to sign
    // in, so neither moves.
    await expect(
      correctMemberContact(store, actor("vp-membership"), {
        memberId: member.id,
        email: "moved@example.org",
        reason: "Confirmed on the phone.",
      }),
    ).rejects.toThrow(CONTACT_REFUSALS.NO_IDENTITY_STORE);
    expect((await store.getMember(member.id))?.email).toBe(member.email);

    // The phone number is not affected by any of that.
    const after = await correctMemberContact(store, actor("vp-membership"), {
      memberId: member.id,
      phone: "(910) 555-2222",
      reason: "Confirmed on the phone.",
    });
    expect(after.phone).toBe("(910) 555-2222");
  });

  it("refuses a role that can read records but not write them, and logs it", async () => {
    const store = repo();
    const member = await anyMember(store);
    for (const persona of ["president", "secretary", "member", "vp-ops"]) {
      await expect(
        correctMemberContact(store, actor(persona), {
          memberId: member.id,
          phone: "(910) 555-3333",
          reason: "Trying it on.",
        }),
      ).rejects.toThrow(AuthzError);
    }
    await expect(
      correctMemberContact(store, withoutMfa("vp-membership"), {
        memberId: member.id,
        phone: "(910) 555-3333",
        reason: "No second factor.",
      }),
    ).rejects.toThrow(AuthzError);
    expect(
      (await loadMembershipAudit(store, actor("secretary"))).map((e) => e.action),
    ).toContain("UPDATE_MEMBER_CONTACT:DENIED");
    expect((await store.getMember(member.id))?.phone).toBe(member.phone);
  });
});

/* ------------------------------------------------------------------ *
 * E28. A member sees their own record
 *
 * The acceptance criterion worth reading is the second one: changing the id in
 * the URL shows nothing, not a different record and not an error that confirms
 * the record exists. These functions take no member id, so there is no id to
 * change — the property is structural rather than checked.
 * ------------------------------------------------------------------ */

describe("a member sees their own record and nothing else", () => {
  async function linkedMember(
    store: MembershipRepository,
    personId: string,
    patch: Partial<Member> = {},
  ): Promise<Member> {
    return store.createMember({ ...newMemberFields(), personId, ...patch });
  }

  it("takes no member id, so there is no id to change", () => {
    // Arity: repository, subject, and an optional clock. A member id
    // parameter is the whole class of bug this avoids.
    expect(loadOwnRecord.length).toBe(2);
    expect(updateOwnPhone.length).toBe(3);
  });

  it("returns the record linked to the person asking", async () => {
    const store = repo();
    const viewer = actor("member");
    const mine = await linkedMember(store, viewer.personId, { displayName: "Mine" });
    await linkedMember(store, "dev:somebody-else", { displayName: "Theirs" });

    const view = await loadOwnRecord(store, viewer);
    expect(view.memberId).toBe(mine.memberId);
    expect(view.displayName).toBe("Mine");
    expect(JSON.stringify(view)).not.toContain("Theirs");
  });

  it("says the same thing to a person with no record as to a person with somebody else's", async () => {
    const store = repo();
    await linkedMember(store, "dev:somebody-else");
    const stranger = await rejection(() => loadOwnRecord(store, actor("member")));
    expect(stranger).toBeInstanceOf(NotAMember);

    // And an unlinked roster record is the same answer, because there is no
    // link from the account to it and matching on email address would make a
    // shared family mailbox into two people's access to one record.
    const unlinkedOnly = newMembershipRepository({ seed: true });
    expect(await rejection(() => loadOwnRecord(unlinkedOnly, actor("member")))).toBeInstanceOf(
      NotAMember,
    );
  });

  it("refuses a session that has not been through the second factor", async () => {
    const store = repo();
    await linkedMember(store, "dev:member");
    await expect(loadOwnRecord(store, withoutMfa("member"))).rejects.toThrow(NotAMember);
  });

  it("tells a probationary member exactly what it tells a settled one", async () => {
    const store = repo();
    const probationary = await linkedMember(store, "dev:member", { state: "PROBATIONARY" });
    const settled = await linkedMember(store, "dev:president", { state: "GOOD_STANDING" });

    const a = await loadOwnRecord(store, actor("member"));
    const b = await loadOwnRecord(store, actor("president"));
    // The 30-day audit is a check on the record, not a probation the member
    // serves. Telling them otherwise would be making them wait for something
    // they have already paid for.
    expect(a.standing).toBe(b.standing);
    expect(a.standing).not.toMatch(/probation/i);
    expect(standingInWords(probationary.state)).toBe(standingInWords(settled.state));
  });

  it("states the dues basis where a renewal date would be", async () => {
    const store = repo();
    await linkedMember(store, "dev:member");
    const view = await loadOwnRecord(store, actor("member"));
    expect(view.duesBasis).toBe(DUES_BASIS);
    expect(view.duesBasis).toContain("does not renew");
    expect(view).not.toHaveProperty("renewalDate");
    expect(JSON.stringify(view)).not.toMatch(/renewal date/i);
  });

  it("shows the member nothing the chair has about them that they cannot act on", async () => {
    const store = repo();
    await linkedMember(store, "dev:member", { attestedWarVeteran: false, isWarVeteran: true });
    const view = await loadOwnRecord(store, actor("member"));
    // The derived war-veteran flag and its disagreement with the attestation
    // are a record for the chair to fix. "Attestation disagrees", with no
    // explanation and no way to fix it, is a phone call rather than
    // information.
    for (const field of ["isWarVeteran", "attestedWarVeteran", "lastAuditedAt", "personId"]) {
      expect(view).not.toHaveProperty(field);
    }
  });

  it("logs the member's own read, with the member as the subject", async () => {
    const store = repo();
    const mine = await linkedMember(store, "dev:member");
    await loadOwnRecord(store, actor("member"));
    const entry = (await loadMembershipAudit(store, actor("secretary"))).find(
      (e) => e.action === "READ_OWN_MEMBER_RECORD",
    );
    expect(entry?.personId).toBe("dev:member");
    expect(entry?.subjectRef).toBe(mine.memberId);
    expect(entry?.rowLevel).toBe(true);
  });

  it("logs a refusal without recording whose record was asked for", async () => {
    const store = repo();
    await expect(loadOwnRecord(store, actor("member"))).rejects.toThrow(NotAMember);
    const entry = (await loadMembershipAudit(store, actor("secretary"))).find(
      (e) => e.action === "READ_OWN_MEMBER_RECORD:DENIED",
    );
    expect(entry).toBeDefined();
    expect(entry?.subjectRef).toBeNull();
  });

  it("cannot reach the roster, the queue or the composition report", async () => {
    const store = repo();
    await linkedMember(store, "dev:member");
    const viewer = actor("member");
    await expect(loadRoster(store, viewer)).rejects.toThrow(AuthzError);
    await expect(loadChairQueue(store, viewer)).rejects.toThrow(AuthzError);
    await expect(loadCompositionReport(store, viewer)).rejects.toThrow(AuthzError);
    await expect(loadApplicationQueue(store, viewer)).rejects.toThrow(AuthzError);
  });

  it("says plainly what a lapsed member can do about it, which is telephone", async () => {
    const store = repo();
    await linkedMember(store, "dev:member", { state: "LAPSED" });
    const view = await loadOwnRecord(store, actor("member"));
    expect(view.standing).toMatch(/Lapsed/);
    // There is no reinstatement path, and the page says so rather than
    // offering a control that does nothing.
    expect(view.standing).toMatch(/membership chair/);
  });

  it("lets a member change their own phone number, and records it against them", async () => {
    const store = repo();
    const mine = await linkedMember(store, "dev:member");
    const view = await updateOwnPhone(store, actor("member"), "(910) 555-7777");
    expect(view.phone).toBe("(910) 555-7777");
    expect((await store.getMember(mine.id))?.phone).toBe("(910) 555-7777");

    const entry = (await loadMembershipAudit(store, actor("secretary"))).find(
      (e) => e.action === "OWN_PHONE_UPDATED",
    );
    // The member is both actor and subject, which is criterion 1.
    expect(entry?.personId).toBe("dev:member");
    expect(entry?.subjectRef).toBe(mine.memberId);
  });

  it("refuses a phone number that is not a phone number, and refuses a stranger", async () => {
    const store = repo();
    await linkedMember(store, "dev:member");
    await expect(updateOwnPhone(store, actor("member"), "12")).rejects.toThrow(OwnContactError);
    await expect(updateOwnPhone(store, actor("president"), "(910) 555-7777")).rejects.toThrow(
      NotAMember,
    );
  });

  it("explains why the member cannot change their own email here", () => {
    // Not a stub. Verify-new, keep-old-until-used, notify-old needs a
    // pending-change record with a hashed single-use token, and there is no
    // table for one. Built in that order or not at all: a link sent to a
    // mistyped new address locks the member out with no way to tell us.
    expect(EMAIL_CHANGE_NOT_BUILT).toMatch(/telephone the membership chair/i);
    expect(EMAIL_CHANGE_NOT_BUILT).toMatch(/old one keeps working/);
  });
});

/** The first rejection, as a value, so a test can assert on its type. */
async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

/** A complete member record, for a test that only cares about one field. */
function newMemberFields(): Omit<Member, "id" | "memberId"> {
  return {
    entity: MEMBERSHIP_ENTITY,
    personId: null,
    displayName: "Test Member",
    email: `test.member.${Math.random().toString(36).slice(2, 8)}@example.org`,
    phone: "(910) 555-0100",
    membershipCategory: "VETERAN",
    qualifyingRelationship: null,
    serviceFrom: "2001-09-20",
    serviceTo: "2022-10-31",
    isWarVeteran: true,
    attestedWarVeteran: true,
    state: "GOOD_STANDING",
    sponsorMemberId: null,
    joinedAt: "2026-01-15T00:00:00.000Z",
    paymentClearedAt: "2026-01-15T00:00:00.000Z",
    lastAuditedAt: null,
    applicationId: null,
  };
}

/* ------------------------------------------------------------------ *
 * The same things, against a real database
 *
 * Everything above runs against the in-memory repository, which is right for
 * speed and proves nothing about the SQL. These few run the D1 implementation
 * against SQLite built from the real `migrations/` files, because two of the
 * changes in this module are specifically about columns:
 *
 *   - `member.person_id` was bound as the literal NULL and never read back;
 *   - `application.assigned_to` and `assigned_at` are new in 0012 and have a
 *     foreign key to `person(id)` that the in-memory repository cannot have
 *     an opinion about.
 *
 * The module is imported dynamically, after mocking the Cloudflare boundary,
 * so the statically imported modules the rest of this file uses are
 * untouched. `tests/d1.test.ts` does the same thing at file scope; this is
 * the same idea, scoped to one block, because switching this whole file to D1
 * would switch the other hundred tests with it.
 * ------------------------------------------------------------------ */

describe("against a database built from the real migrations", () => {
  let open: TestDatabase | null = null;

  async function d1Repository() {
    open?.close();
    open = openTestDatabase();
    const held = open;
    vi.resetModules();
    vi.doMock("@opennextjs/cloudflare", () => ({
      getCloudflareContext: () => ({ env: { DB: held.binding } }),
    }));
    const { d1MembershipRepositoryIfBound } = await import(
      "../src/lib/membership/repository.d1"
    );
    const repository = d1MembershipRepositoryIfBound();
    if (!repository) throw new Error("expected the D1 repository to be selected");
    return { repository, raw: held.raw };
  }

  afterAll(() => {
    open?.close();
    open = null;
    vi.doUnmock("@opennextjs/cloudflare");
    vi.resetModules();
  });

  it("writes and reads back the person link", async () => {
    const { repository, raw } = await d1Repository();
    raw.exec(
      "INSERT INTO person (id, email, display_name, created_at) " +
        "VALUES ('p-1', 'linked@example.org', 'Linked Person', '2026-01-01T00:00:00Z')",
    );
    const member = await repository.createMember({
      ...newMemberFields(),
      personId: "p-1",
      email: "linked@example.org",
    });
    expect(member.personId).toBe("p-1");
    // Read back out of the column, not out of the object we passed in.
    expect((await repository.getMember(member.id))?.personId).toBe("p-1");
    expect((await repository.getMemberByPersonId("p-1"))?.id).toBe(member.id);
    const row = raw
      .prepare("SELECT person_id FROM member WHERE id = ?")
      .get(member.id) as { person_id: string | null };
    expect(row.person_id).toBe("p-1");
  });

  it("still accepts a member with no account, because most have none", async () => {
    const { repository } = await d1Repository();
    const member = await repository.createMember(newMemberFields());
    expect(member.personId).toBeNull();
  });

  it("refuses a person link to an identity that does not exist", async () => {
    const { repository } = await d1Repository();
    // The foreign key is the reason the caller resolves the person first
    // rather than writing an id it hopes is real.
    await expect(
      repository.createMember({ ...newMemberFields(), personId: "p-nobody" }),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("assigns a chair-queue item, and refuses a reviewer who is not a person", async () => {
    const { repository, raw } = await d1Repository();
    raw.exec(
      "INSERT INTO person (id, email, display_name, created_at) " +
        "VALUES ('p-reviewer', 'reviewer@example.org', 'Reviewer', '2026-01-01T00:00:00Z')",
    );
    const draft = await repository.createDraft(BASE_FIELDS);
    await repository.setApplicationState(draft.id, "CHAIR_QUEUE");

    const assigned = await repository.assignApplication(
      draft.id,
      "p-reviewer",
      "2026-10-27T12:00:00.000Z",
    );
    expect(assigned.assignedTo).toBe("p-reviewer");
    expect(assigned.assignedAt).toBe("2026-10-27T12:00:00.000Z");

    const released = await repository.assignApplication(draft.id, null, null);
    expect(released.assignedTo).toBeNull();
    expect(released.assignedAt).toBeNull();

    await expect(
      repository.assignApplication(draft.id, "p-nobody", "2026-10-27T12:00:00.000Z"),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });

  it("moves the roster address and the sign-in address together, or neither", async () => {
    const { repository, raw } = await d1Repository();
    raw.exec(
      "INSERT INTO person (id, email, display_name, created_at) " +
        "VALUES ('p-2', 'before@example.org', 'Linked Person', '2026-01-01T00:00:00Z')",
    );
    raw.exec(
      "INSERT INTO person (id, email, display_name, created_at) " +
        "VALUES ('p-3', 'taken@example.org', 'Somebody Else', '2026-01-01T00:00:00Z')",
    );
    const member = await repository.createMember({
      ...newMemberFields(),
      personId: "p-2",
      email: "before@example.org",
    });

    const moved = await repository.updateMemberContact(
      member.id,
      { email: "after@example.org" },
      { alsoPersonEmail: true },
    );
    expect(moved.email).toBe("after@example.org");
    expect(
      (raw.prepare("SELECT email FROM person WHERE id = 'p-2'").get() as { email: string }).email,
    ).toBe("after@example.org");

    // `person.email` is UNIQUE, so a collision fails the batch and neither
    // table moves. That is the backstop behind the caller's own check, which
    // refuses without saying whose address it is.
    await expect(
      repository.updateMemberContact(
        member.id,
        { email: "taken@example.org" },
        { alsoPersonEmail: true },
      ),
    ).rejects.toThrow();
    expect((await repository.getMember(member.id))?.email).toBe("after@example.org");
    expect(
      (raw.prepare("SELECT email FROM person WHERE id = 'p-2'").get() as { email: string }).email,
    ).toBe("after@example.org");
  });

  it("writes the applicant's confirmation to the one shared outbox", async () => {
    const { repository, raw } = await d1Repository();
    const { submitApplication: submit } = await import("../src/lib/membership/intake");

    const draft = await repository.createDraft({
      ...BASE_FIELDS,
      email: "applicant@example.org",
    });
    const result = await submit(repository, draft.id);

    const rows = raw
      .prepare(
        "SELECT kind, stream, entity, to_address, state, body_text FROM outbound_message " +
          "WHERE kind = 'APPLICANT_CONFIRMATION'",
      )
      .all() as {
      kind: string;
      stream: string;
      entity: string;
      to_address: string;
      state: string;
      body_text: string;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0].stream).toBe("TRANSACTIONAL");
    expect(rows[0].entity).toBe("JSOA");
    expect(rows[0].to_address).toBe("applicant@example.org");
    expect(rows[0].body_text).toContain(draft.reference);
    expect(rows[0].body_text).toContain("four days");
    // The Association's sending domain is not verified yet, so it queues
    // rather than going out wearing the Foundation's name.
    expect(rows[0].state).toBe("QUEUED");
    expect(result.acknowledgment.reference).toBe(draft.reference);

    // The sponsor's request is in the same table, which is the point of the
    // port: one outbox, so the Communications Chair's screen is not half the
    // mail.
    const kinds = (
      raw.prepare("SELECT DISTINCT kind FROM outbound_message").all() as { kind: string }[]
    ).map((r) => r.kind);
    expect(kinds).toContain("VOUCH_REQUEST");
  });

  it("writes a row for a sponsor who does not exist, instead of skipping the call", async () => {
    const { repository, raw } = await d1Repository();
    const { submitApplication: submit } = await import("../src/lib/membership/intake");

    const draft = await repository.createDraft({
      ...BASE_FIELDS,
      sponsorMemberId: "JSOA-1998-9999",
      email: "unknown.sponsor@example.org",
    });
    await submit(repository, draft.id);

    const vouch = raw
      .prepare("SELECT state, state_reason FROM outbound_message WHERE kind = 'VOUCH_REQUEST'")
      .get() as { state: string; state_reason: string | null };
    // UNDELIVERABLE, not absent. A call that is skipped when there is nobody
    // to write to is measurably faster than one that is not, and that
    // difference is the answer the form exists to refuse.
    expect(vouch.state).toBe("UNDELIVERABLE");
    expect(vouch.state_reason).toBe("no address on file");

    const events = raw
      .prepare("SELECT COUNT(*) AS n FROM delivery_event")
      .get() as { n: number };
    expect(events.n).toBeGreaterThanOrEqual(2);
  });
});
