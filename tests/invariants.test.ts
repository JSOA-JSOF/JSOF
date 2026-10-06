/**
 * The control tests. These are the ones that try to break the rules, and they
 * are written as requirements rather than as coverage. A feature is not done
 * until the wrong-role request to it fails here.
 */

import { describe, expect, it } from "vitest";

import { ROLE_DEFINITIONS, type Entity, type Role } from "../src/lib/authz/model";
import {
  assertNoConflictingWrites,
  assertNotSelfApproval,
  assertReleasable,
  assertRoleTableValid,
  assertTransferApprovable,
  AuthzError,
  can,
  effectiveLevel,
  requiresSecondApproval,
  separationOfDutiesFindings,
  type InterEntityTransfer,
  type Subject,
} from "../src/lib/authz/policy";
import {
  acknowledge,
  grantsMemberAccess,
  INTAKE_MESSAGE,
  isWellFormedMemberId,
  mayRequestPayment,
  next,
  TransitionError,
  type MembershipState,
} from "../src/lib/membership/state";

function subject(
  personId: string,
  assignments: Subject["assignments"],
  mfaSatisfied = true,
): Subject {
  return { personId, assignments, mfaSatisfied };
}

describe("invariant 1: no write on FINANCIAL and APPLICANT together", () => {
  it("holds for every role in the table", () => {
    expect(() => assertRoleTableValid()).not.toThrow();
  });

  it("rejects the combination when two legal roles add up to it", () => {
    // Treasurer writes FINANCIAL; Scholarships Chair writes APPLICANT. Each is
    // fine alone. On the same entity, together, they are not.
    const conflicted = subject("p1", [
      { role: "TREASURER", entity: "JSOF" },
      { role: "SCHOLARSHIPS_CHAIR", entity: "JSOF" },
    ]);
    expect(() => assertNoConflictingWrites(conflicted, "JSOF")).toThrow(AuthzError);
  });

  it("allows the same pair when they sit on different entities", () => {
    const split = subject("p2", [
      { role: "TREASURER", entity: "JSOA" },
      { role: "SCHOLARSHIPS_CHAIR", entity: "JSOF" },
    ]);
    expect(() => assertNoConflictingWrites(split, "JSOA")).not.toThrow();
    expect(() => assertNoConflictingWrites(split, "JSOF")).not.toThrow();
  });

  it("denies access rather than throwing out of can()", () => {
    const conflicted = subject("p1", [
      { role: "TREASURER", entity: "JSOF" },
      { role: "SCHOLARSHIPS_CHAIR", entity: "JSOF" },
    ]);
    expect(
      can({ subject: conflicted, dataClass: "FINANCIAL", entity: "JSOF", required: "READ" }),
    ).toBe(false);
  });
});

describe("invariant 2: no self-approval", () => {
  it("refuses an approval by the creator", () => {
    expect(() =>
      assertNotSelfApproval("p1", { id: "spend-1", createdById: "p1", entity: "JSOA" }),
    ).toThrow(AuthzError);
  });

  it("allows a different approver", () => {
    expect(() =>
      assertNotSelfApproval("p2", { id: "spend-1", createdById: "p1", entity: "JSOA" }),
    ).not.toThrow();
  });

  it("thresholds: routine spend over $1,000, related party over $250", () => {
    expect(requiresSecondApproval(99_900, false)).toBe(false);
    expect(requiresSecondApproval(100_100, false)).toBe(true);
    expect(requiresSecondApproval(30_000, true)).toBe(true);
    expect(requiresSecondApproval(24_900, true)).toBe(false);
  });
});

describe("invariant 3: the release gate", () => {
  const author = "p-author";
  const candidate = {
    id: "post-1",
    createdById: author,
    entity: "JSOA" as Entity,
    carriesIdentity: true,
  };

  it("refuses the author publishing their own identity-carrying content", () => {
    const webmaster = subject(author, [{ role: "WEBMASTER", entity: "JSOA" }]);
    expect(() => assertReleasable(webmaster, candidate)).toThrow(AuthzError);
  });

  it("refuses a second pair of eyes that lacks APPROVE_RELEASE", () => {
    const comms = subject("p-comms", [{ role: "COMMUNICATIONS_CHAIR", entity: "JSOA" }]);
    expect(() => assertReleasable(comms, candidate)).toThrow(/APPROVE_RELEASE/);
  });

  it("allows VP Operations as the standing approver", () => {
    const vpOps = subject("p-vpops", [{ role: "VP_OPERATIONS", entity: "JSOA" }]);
    expect(() => assertReleasable(vpOps, candidate)).not.toThrow();
  });

  it("still refuses self-approval even when content carries no identity", () => {
    const vpOps = subject(author, [{ role: "VP_OPERATIONS", entity: "JSOA" }]);
    expect(() =>
      assertReleasable(vpOps, { ...candidate, carriesIdentity: false }),
    ).toThrow(/Self-approval/);
  });
});

describe("an attested count is independent of the ledger", () => {
  it("no role holds both ATTEST_COUNT and FINANCIAL WRITE", () => {
    for (const [role, def] of Object.entries(ROLE_DEFINITIONS)) {
      const attests = (def.capabilities ?? []).includes("ATTEST_COUNT");
      if (attests) {
        expect(
          def.grants.FINANCIAL,
          `${role} attests counts and must not write the ledger`,
        ).not.toBe("WRITE");
      }
    }
  });

  it("someone independent of the treasury can actually record a count", () => {
    // The control the store's quarterly inventory count depends on: if only
    // TREASURER could attest, a Treasurer who also chairs the store would be
    // the only person able to perform the count that checks them.
    const attesters = Object.entries(ROLE_DEFINITIONS).filter(([, def]) =>
      (def.capabilities ?? []).includes("ATTEST_COUNT"),
    );
    expect(attesters.length).toBeGreaterThan(0);
    for (const [, def] of attesters) {
      expect(def.grants.FINANCIAL === "WRITE").toBe(false);
    }
  });

  it("the Treasurer and the Store Chair cannot attest", () => {
    expect(ROLE_DEFINITIONS.TREASURER.capabilities ?? []).not.toContain("ATTEST_COUNT");
    expect(ROLE_DEFINITIONS.STORE_CHAIR.capabilities ?? []).not.toContain("ATTEST_COUNT");
  });
});

describe("the Finance Review Officer cannot be granted write", () => {
  it("declares no write scope anywhere", () => {
    const def = ROLE_DEFINITIONS.FINANCE_REVIEW_OFFICER;
    expect(def.readOnly).toBe(true);
    expect(Object.values(def.grants)).not.toContain("WRITE");
  });

  it("cannot write FINANCIAL even on its own entity", () => {
    const fro = subject("p-fro", [{ role: "FINANCE_REVIEW_OFFICER", entity: "JSOA" }]);
    expect(
      can({ subject: fro, dataClass: "FINANCIAL", entity: "JSOA", required: "WRITE" }),
    ).toBe(false);
    expect(
      can({ subject: fro, dataClass: "FINANCIAL", entity: "JSOA", required: "READ" }),
    ).toBe(true);
  });
});

describe("entity scoping", () => {
  it("a JSOA treasurer reaches nothing on JSOF", () => {
    const t = subject("p-t", [{ role: "TREASURER", entity: "JSOA" }]);
    expect(effectiveLevel(t, "FINANCIAL", "JSOA")).toBe("WRITE");
    expect(effectiveLevel(t, "FINANCIAL", "JSOF")).toBe("NONE");
  });

  it("VP Membership is JSOA only, even if assigned to JSOF by mistake", () => {
    const vp = subject("p-vp", [{ role: "VP_MEMBERSHIP", entity: "JSOF" }]);
    expect(effectiveLevel(vp, "MEMBER_PII", "JSOF")).toBe("NONE");
  });

  it("MFA is required for every non-public read", () => {
    const president = subject("p-pres", [{ role: "PRESIDENT", entity: "JSOA" }], false);
    expect(
      can({ subject: president, dataClass: "MEMBER_PII", entity: "JSOA", required: "READ" }),
    ).toBe(false);
  });
});

describe("applicant data is not reachable by the President at row level", () => {
  it("gives aggregate only, so named detail needs break-glass", () => {
    const president = subject("p-pres", [{ role: "PRESIDENT", entity: "JSOF" }]);
    expect(
      can({ subject: president, dataClass: "APPLICANT", entity: "JSOF", required: "READ" }),
    ).toBe(false);
    expect(
      can({ subject: president, dataClass: "APPLICANT", entity: "JSOF", required: "AGGREGATE" }),
    ).toBe(true);
  });
});

describe("inter-entity transfers", () => {
  // Who actually holds what. Tagging an approval with an entity is a claim;
  // this is the fact the check must be made against.
  const ROLES: Record<string, Partial<Record<Entity, Role[]>>> = {
    "p-t-jsoa": { JSOA: ["TREASURER"] },
    "p-t-jsof": { JSOF: ["TREASURER"] },
    "p-secretary": { JSOA: ["SECRETARY"], JSOF: ["SECRETARY"] },
    "p-president": { JSOA: ["PRESIDENT"], JSOF: ["PRESIDENT", "TREASURER"] },
    "p-creator": { JSOA: ["TREASURER"] },
  };
  const rolesOf = (personId: string, entity: Entity): Role[] =>
    ROLES[personId]?.[entity] ?? [];

  const base: InterEntityTransfer = {
    id: "tx-1",
    createdById: "p-creator",
    entity: "JSOA",
    fromEntity: "JSOA",
    toEntity: "JSOF",
    amountCents: 500_000,
    approvals: [
      { approverId: "p-t-jsoa", entity: "JSOA" },
      { approverId: "p-t-jsof", entity: "JSOF" },
    ],
    minuteRefFrom: "JSOA-2026-10-min-4",
    minuteRefTo: "JSOF-2026-10-min-2",
    restrictionStatement: "Restricted to the 2027 Merit Scholarship awards.",
  };

  it("accepts a properly approved, minuted and restricted transfer", () => {
    expect(() => assertTransferApprovable(base, rolesOf)).not.toThrow();
  });

  it("refuses one signature", () => {
    expect(() =>
      assertTransferApprovable({ ...base, approvals: [base.approvals[0]] }, rolesOf),
    ).toThrow(/needs an approval from the JSOF Treasurer/);
  });

  // The regression this whole signature change exists for: two approvals from
  // one Secretary, correctly tagged one per entity, used to satisfy "one
  // treasurer approval per entity" because only the tag was checked.
  it("refuses two approvals from someone who is not a Treasurer", () => {
    expect(() =>
      assertTransferApprovable(
        {
          ...base,
          approvals: [
            { approverId: "p-secretary", entity: "JSOA" },
            { approverId: "p-secretary", entity: "JSOF" },
          ],
        },
        rolesOf,
      ),
    ).toThrow(/needs an approval from the JSOA Treasurer/);
  });

  it("refuses the President approving into the receiving entity, even as its Treasurer", () => {
    expect(() =>
      assertTransferApprovable(
        {
          ...base,
          approvals: [
            { approverId: "p-t-jsoa", entity: "JSOA" },
            { approverId: "p-president", entity: "JSOF" },
          ],
        },
        rolesOf,
      ),
    ).toThrow(/recused on the receiving side/);
  });

  it("refuses a missing minute reference on either side", () => {
    expect(() => assertTransferApprovable({ ...base, minuteRefTo: null }, rolesOf)).toThrow(
      /minute/,
    );
  });

  it("refuses a transfer with no written restriction statement", () => {
    expect(() =>
      assertTransferApprovable({ ...base, restrictionStatement: "   " }, rolesOf),
    ).toThrow(/restriction/);
  });

  it("refuses approval by the person who created it", () => {
    expect(() =>
      assertTransferApprovable(
        {
          ...base,
          approvals: [
            { approverId: "p-creator", entity: "JSOA" },
            { approverId: "p-t-jsof", entity: "JSOF" },
          ],
        },
        rolesOf,
      ),
    ).toThrow(/Self-approval/);
  });
});

describe("separation of duties findings", () => {
  it("flags Treasurer who is also Store and Sales chair as critical", () => {
    const findings = separationOfDutiesFindings("p-k", [
      { role: "TREASURER", entity: "JSOA" },
      { role: "STORE_CHAIR", entity: "JSOA" },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
  });

  it("flags one person holding both treasuries", () => {
    const findings = separationOfDutiesFindings("p-k", [
      { role: "TREASURER", entity: "JSOA" },
      { role: "TREASURER", entity: "JSOF" },
    ]);
    expect(findings.some((f) => f.finding.includes("both sides of every transfer"))).toBe(true);
  });

  it("says nothing about a Secretary serving both entities", () => {
    const findings = separationOfDutiesFindings("p-s", [
      { role: "SECRETARY", entity: "JSOA" },
      { role: "SECRETARY", entity: "JSOF" },
    ]);
    expect(findings).toHaveLength(0);
  });
});

describe("membership state machine", () => {
  it("runs the happy path without a human", () => {
    let s: MembershipState = "DRAFT";
    s = next(s, { type: "SUBMIT", sponsorMemberId: "JSOA-2024-0007", augmentee: false });
    expect(s).toBe("AWAITING_VOUCH");
    s = next(s, { type: "VOUCH_CONFIRMED", sponsorMemberId: "JSOA-2024-0007" });
    expect(s).toBe("AWAITING_PAYMENT");
    s = next(s, { type: "PAYMENT_CLEARED", paymentId: "pi_1" });
    expect(s).toBe("PROBATIONARY");
    s = next(s, { type: "AUDIT_PASSED", auditedById: "p-vp" });
    expect(s).toBe("GOOD_STANDING");
  });

  it("never reaches payment without a vouch or a chair approval", () => {
    for (const state of ["DRAFT", "AWAITING_VOUCH", "CHAIR_QUEUE"] as MembershipState[]) {
      expect(mayRequestPayment(state)).toBe(false);
    }
    expect(mayRequestPayment("AWAITING_PAYMENT")).toBe(true);
  });

  it("sends a declined vouch and an expiry to the chair, not to a dead end", () => {
    expect(next("AWAITING_VOUCH", { type: "VOUCH_DECLINED" })).toBe("CHAIR_QUEUE");
    expect(next("AWAITING_VOUCH", { type: "VOUCH_EXPIRED" })).toBe("CHAIR_QUEUE");
  });

  it("takes no payment from someone the chair declines", () => {
    const declined = next("CHAIR_QUEUE", { type: "CHAIR_DENIED", chairPersonId: "p-vp" });
    expect(declined).toBe("DECLINED");
    expect(mayRequestPayment(declined)).toBe(false);
  });

  it("routes augmentee cases to the chair on submission", () => {
    expect(
      next("DRAFT", { type: "SUBMIT", sponsorMemberId: "JSOA-2024-0007", augmentee: true }),
    ).toBe("CHAIR_QUEUE");
  });

  it("grants identical access in probationary and good standing", () => {
    expect(grantsMemberAccess("PROBATIONARY")).toBe(true);
    expect(grantsMemberAccess("GOOD_STANDING")).toBe(true);
    expect(grantsMemberAccess("CHAIR_QUEUE")).toBe(false);
  });

  it("refuses transitions that are not on the machine", () => {
    expect(() => next("DECLINED", { type: "PAYMENT_CLEARED", paymentId: "pi_2" })).toThrow(
      TransitionError,
    );
    expect(() => next("GOOD_STANDING", { type: "VOUCH_CONFIRMED", sponsorMemberId: "x" })).toThrow(
      TransitionError,
    );
  });
});

describe("the intake form is not a membership oracle", () => {
  it("returns an identical message whatever the sponsor ID was", () => {
    const real = acknowledge("app-1");
    const bogus = acknowledge("app-2");
    expect(real.message).toBe(bogus.message);
    expect(real.message).toBe(INTAKE_MESSAGE);
    expect(real.received).toBe(true);
    expect(bogus.received).toBe(true);
  });

  it("is byte-identical across sponsor inputs once the reference is removed", () => {
    // The real property is indistinguishability, not the absence of words: the
    // fixed message mentions a sponsor and leaks nothing, because everyone gets
    // it. What must never differ is anything derived from the submission.
    const strip = (ack: ReturnType<typeof acknowledge>) =>
      JSON.stringify({ ...ack, reference: "<ref>" });

    const realSponsor = strip(acknowledge("app-real"));
    const unknownSponsor = strip(acknowledge("app-unknown"));
    const malformedSponsor = strip(acknowledge("app-malformed"));

    expect(unknownSponsor).toBe(realSponsor);
    expect(malformedSponsor).toBe(realSponsor);
  });

  it("carries no sponsor-derived field at all", () => {
    // Guards against a later edit adding sponsorName, sponsorValid or similar.
    expect(Object.keys(acknowledge("app-4")).sort()).toEqual([
      "message",
      "received",
      "reference",
    ]);
  });

  it("validates ID shape locally without disclosing membership", () => {
    // Shape checking is a client-side courtesy and says nothing about the roster.
    expect(isWellFormedMemberId("JSOA-2026-0142")).toBe(true);
    expect(isWellFormedMemberId("jsoa-2026-0142")).toBe(true);
    expect(isWellFormedMemberId("23007")).toBe(false);
    expect(isWellFormedMemberId("JSOA-26-142")).toBe(false);
  });
});
