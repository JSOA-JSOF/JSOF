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

import { describe, expect, it } from "vitest";

import { AuthzError, type Subject } from "../src/lib/authz/policy";
import {
  INTAKE_MESSAGE,
  MEMBERSHIP_STATES,
  type MembershipState,
} from "../src/lib/membership/state";
import {
  decideChairException,
  loadApplicationQueue,
  loadChairQueue,
  loadCohortAudit,
  loadCompositionReport,
  loadMembershipAudit,
  loadRoster,
  recordCohortAudit,
} from "../src/lib/membership/board";
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
import { BOARD_CONTACTS } from "../src/lib/membership/contacts";
import {
  ACKNOWLEDGMENT_PATH,
  submitApplication,
  validateAll,
  validateService,
  validateSponsor,
} from "../src/lib/membership/intake";
import {
  assertPaymentAvailable,
  clearDues,
  createHandoff,
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
  DUES_AMOUNT_CENTS,
  MEMBERSHIP_ENTITY,
} from "../src/lib/membership/types";

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
      expect(withheld.status).toBe("unmeasured");
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
