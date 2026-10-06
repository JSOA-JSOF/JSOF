/**
 * Treasury control tests.
 *
 * These are requirements, not coverage. Each one is a thing that would be a
 * serious problem in the real organization if the code let it happen:
 *
 *   - one entity's treasurer reading the other entity's ledger
 *   - any view presenting a single figure covering both entities
 *   - a transfer recorded on one signature, or without a minute reference
 *   - a treasurer approving their own reimbursement
 *   - a subscription's annual cost coming out wrong, which is how a register
 *     stops being comparable and therefore stops being used
 *
 * Imports are relative: the test runner has no `@/` path alias configured.
 */

import { describe, expect, it } from "vitest";

import { ENTITIES, type Entity } from "../src/lib/authz/model";
import { AuthzError, type Subject } from "../src/lib/authz/policy";
import {
  annualByEntity,
  annualCostCents,
  apportion,
  assertUnblended,
  formatCents,
  subscriptionAnnualCents,
  sumCents,
  TreasuryError,
} from "../src/lib/treasury/money";
import {
  bySeverity,
  InMemoryTreasuryRepository,
  seedSubject,
  subscriptionFindings,
  treasurySubject,
} from "../src/lib/treasury/repository";
import {
  approvalsRequired,
  approveReimbursement,
  previewApproval,
  statusFor,
} from "../src/lib/treasury/reimbursements";
import {
  canRecordTransfer,
  recordTransfer,
  transferRuleStatuses,
  unmetTransferRules,
} from "../src/lib/treasury/transfers";
import {
  PERIOD,
  personName,
  REIMBURSEMENTS,
  SUBSCRIPTIONS,
  TRANSFERS,
} from "../src/lib/treasury/seed";
import type { Reimbursement, Subscription, Transfer } from "../src/lib/treasury/types";

const repo = new InMemoryTreasuryRepository();

const treasurerJsoa = seedSubject("p-halloran");
const treasurerJsof = seedSubject("p-okonkwo");
const president = seedSubject("p-mercer");
const secretary = seedSubject("p-vance");
const financeReviewer = seedSubject("p-brill");
const webmaster = seedSubject("p-ferro");

function member(): Subject {
  return { personId: "p-nobody", assignments: [{ role: "MEMBER", entity: "JSOA" }], mfaSatisfied: true };
}

/** Every `*Cents` number reachable in a value, with the path it sat at. */
function moneyFigures(value: unknown, path = "$"): { path: string; amountCents: number }[] {
  const found: { path: string; amountCents: number }[] = [];
  const visit = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${at}[${i}]`));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, child] of Object.entries(node)) {
      const childPath = `${at}.${key}`;
      if (typeof child === "number" && /Cents$/.test(key)) {
        found.push({ path: childPath, amountCents: child });
      } else {
        visit(child, childPath);
      }
    }
  };
  visit(value, path);
  return found;
}

/* ================================================================== *
 * 1. Entity scoping: a JSOA treasurer cannot read the JSOF ledger
 * ================================================================== */

describe("a treasurer of one entity sees nothing of the other", () => {
  it("refuses the JSOF ledger to the JSOA treasurer, and says so rather than returning nothing", () => {
    expect(() => repo.ledger(treasurerJsoa, "JSOF")).toThrow(AuthzError);
    // The refusal is a denial, not an empty result. An empty ledger would read
    // as "the Foundation had no activity", which is a different claim.
    try {
      repo.ledger(treasurerJsoa, "JSOF");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthzError);
      expect((error as AuthzError).code).toBe("DENIED");
      expect((error as AuthzError).message).toContain("JSOF");
    }
  });

  it("refuses the JSOA ledger to the JSOF treasurer, symmetrically", () => {
    expect(() => repo.ledger(treasurerJsof, "JSOA")).toThrow(AuthzError);
    expect(() => repo.ledger(treasurerJsof, "JSOF")).not.toThrow();
  });

  it("returns only its own entity's rows, under every fund filter", () => {
    const view = repo.ledger(treasurerJsoa, "JSOA");
    expect(view.entries.length).toBeGreaterThan(0);
    expect(view.entries.every((e) => e.entity === "JSOA")).toBe(true);

    for (const fund of view.funds) {
      const filtered = repo.ledger(treasurerJsoa, "JSOA", { fundId: fund.id });
      expect(filtered.entries.every((e) => e.entity === "JSOA")).toBe(true);
      expect(filtered.entries.every((e) => e.fundId === fund.id)).toBe(true);
    }
  });

  it("cannot be tricked into the other entity by passing a foreign fund id", () => {
    // jsof-scholarship is a JSOF fund. Asking for it on the JSOA ledger must
    // not reach across; the filter is ignored and the scope still holds.
    const view = repo.ledger(treasurerJsoa, "JSOA", { fundId: "jsof-scholarship" });
    expect(view.appliedFundId).toBeNull();
    expect(view.entries.every((e) => e.entity === "JSOA")).toBe(true);
  });

  it("withholds the other entity's column on the position statement, without zeroing it", () => {
    const statement = repo.positionStatement(treasurerJsoa);
    const jsoa = statement.columns.find((c) => c.entity === "JSOA");
    const jsof = statement.columns.find((c) => c.entity === "JSOF");

    expect(jsoa?.visible).toBe(true);
    expect(jsof?.visible).toBe(false);
    // Withheld carries no figure at all, so it cannot be misread as zero.
    expect(moneyFigures(jsof)).toHaveLength(0);
    if (jsof && !jsof.visible) {
      expect(jsof.withheldReason).toContain("JSOF");
      expect(jsof.withheldReason.toLowerCase()).toContain("not zero");
    }
  });

  it("withholds the other entity's reimbursement queue", () => {
    const queues = repo.reimbursementQueues(treasurerJsof);
    const jsoa = queues.find((q) => q.entity === "JSOA");
    const jsof = queues.find((q) => q.entity === "JSOF");
    expect(jsoa?.visible).toBe(false);
    expect(jsof?.visible).toBe(true);
    if (jsof?.visible) {
      expect(jsof.claims.every((c) => c.entity === "JSOF")).toBe(true);
    }
  });
});

/* ================================================================== *
 * 2. The wrong-role request fails
 * ================================================================== */

describe("a wrong-role request to every treasury read is refused", () => {
  const nobody = member();

  it("gives a member no position, no ledger, no register, no transfers", () => {
    const statement = repo.positionStatement(nobody);
    expect(statement.columns.every((c) => !c.visible)).toBe(true);
    expect(moneyFigures(statement)).toHaveLength(0);

    for (const entity of ENTITIES) {
      expect(() => repo.ledger(nobody, entity)).toThrow(AuthzError);
    }
    expect(() => repo.subscriptionRegister(nobody)).toThrow(AuthzError);
    expect(() => repo.transfers(nobody)).toThrow(TreasuryError);
  });

  it("refuses everything to a board member whose MFA is not satisfied", () => {
    const unverified = seedSubject("p-mercer", false);
    expect(() => repo.ledger(unverified, "JSOA")).toThrow(AuthzError);
    expect(repo.positionStatement(unverified).columns.every((c) => !c.visible)).toBe(true);
  });

  it("gives the Finance Review Officer read but never write", () => {
    expect(() => repo.ledger(financeReviewer, "JSOA")).not.toThrow();
    expect(() => repo.ledger(financeReviewer, "JSOF")).not.toThrow();
    const claim = REIMBURSEMENTS[0];
    expect(() => repo.saveReimbursement(financeReviewer, claim)).toThrow(AuthzError);
    // Read-only means read-only: the reviewer cannot approve a payment either.
    expect(previewApproval(financeReviewer, claim, "2026-09-30").allowed).toBe(false);
  });

  it("gives a webmaster no financial reach at all, despite being an administrator", () => {
    const pureWebmaster: Subject = {
      personId: "p-web-only",
      assignments: ENTITIES.map((entity) => ({ role: "WEBMASTER" as const, entity })),
      mfaSatisfied: true,
    };
    for (const entity of ENTITIES) {
      expect(() => repo.ledger(pureWebmaster, entity)).toThrow(AuthzError);
    }
    expect(repo.positionStatement(pureWebmaster).columns.every((c) => !c.visible)).toBe(true);
    expect(() => repo.subscriptionRegister(pureWebmaster)).toThrow(AuthzError);
  });

  it("lets two roles combine into more financial reach than either one implies", () => {
    // p-ferro is Webmaster, which holds FINANCIAL NONE, and also Communications
    // Chair, which holds AGGREGATE. The combination gets the JSOA totals. That
    // is `effectiveLevel` taking the best grant across assignments and it is
    // correct, but it is the kind of thing a role table hides, so it is
    // asserted rather than assumed.
    const statement = repo.positionStatement(webmaster);
    expect(statement.columns.find((c) => c.entity === "JSOA")?.visible).toBe(true);
    // Both seats are JSOA-only, so the Foundation stays withheld.
    expect(statement.columns.find((c) => c.entity === "JSOF")?.visible).toBe(false);
    // Aggregate is still not row level: no ledger, on either entity.
    for (const entity of ENTITIES) {
      expect(() => repo.ledger(webmaster, entity)).toThrow(AuthzError);
    }
  });

  it("gives the Secretary aggregate totals but not the ledger rows", () => {
    const statement = repo.positionStatement(secretary);
    expect(statement.columns.every((c) => c.visible)).toBe(true);
    expect(() => repo.ledger(secretary, "JSOA")).toThrow(AuthzError);
  });
});

/* ================================================================== *
 * 3. No view returns a blended cross-entity total
 * ================================================================== */

describe("no view blends the two entities into one figure", () => {
  it("presents the position statement as two columns with no combined figure", () => {
    const statement = repo.positionStatement(president);
    const [jsoa, jsof] = statement.columns;
    if (!jsoa.visible || !jsof.visible) throw new Error("expected both columns visible");

    const figures = moneyFigures(statement).map((f) => f.amountCents);

    // Every cross-entity sum a careless "total" would produce.
    const forbidden = [
      jsoa.revenueCents + jsof.revenueCents,
      jsoa.expenseCents + jsof.expenseCents,
      jsoa.changeCents + jsof.changeCents,
      jsoa.openingNetAssetsCents + jsof.openingNetAssetsCents,
      jsoa.closingNetAssetsCents + jsof.closingNetAssetsCents,
      jsoa.unrestrictedClosingCents + jsof.unrestrictedClosingCents,
      jsoa.restrictedClosingCents + jsof.restrictedClosingCents,
    ];

    for (const sum of forbidden) {
      expect(figures, `${formatCents(sum)} is a cross-entity total`).not.toContain(sum);
    }
  });

  it("has exactly one column per entity, so there is no third place for a total", () => {
    const statement = repo.positionStatement(president);
    expect(statement.columns).toHaveLength(ENTITIES.length);
    expect(statement.columns.map((c) => c.entity).sort()).toEqual([...ENTITIES].sort());
  });

  it("attributes every figure in every view to exactly one entity", () => {
    const statement = repo.positionStatement(president);
    const register = repo.subscriptionRegister(president);

    // The guard the repository runs before handing a view back.
    expect(() => assertUnblended(statement.columns)).not.toThrow();
    expect(() => assertUnblended(register.annualOperatingCost)).not.toThrow();

    for (const entity of ENTITIES) {
      const view = repo.ledger(president, entity);
      expect(() => assertUnblended(view.entries)).not.toThrow();
      expect(view.entries.every((e) => e.entity === entity)).toBe(true);
    }
  });

  it("refuses a view that carries a figure naming no entity", () => {
    // If someone adds a combined total later, this is what happens.
    expect(() =>
      assertUnblended([
        { entity: "JSOA", revenueCents: 1 },
        { entity: "JSOF", revenueCents: 2 },
        { label: "Both entities", revenueCents: 3 },
      ]),
    ).toThrow(TreasuryError);

    try {
      assertUnblended({ combinedNetAssetsCents: 42 });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(TreasuryError);
      expect((error as TreasuryError).code).toBe("BLENDED_TOTAL");
      expect((error as TreasuryError).message).toContain("never summed");
    }
  });

  it("reports the register's annual operating cost per entity and never combined", () => {
    const register = repo.subscriptionRegister(president);
    const perEntity = register.annualOperatingCost;
    expect(perEntity).toHaveLength(ENTITIES.length);

    const jsoa = perEntity.find((f) => f.entity === "JSOA");
    const jsof = perEntity.find((f) => f.entity === "JSOF");
    if (!jsoa?.visible || !jsof?.visible) throw new Error("expected both figures visible");

    const combined = jsoa.amountCents + jsof.amountCents;
    expect(moneyFigures(perEntity).map((f) => f.amountCents)).not.toContain(combined);
    expect(Object.keys(register)).not.toContain("totalAnnualCents");
  });

  it("names no field anywhere that reads as a cross-entity total", () => {
    const views: unknown[] = [
      repo.positionStatement(president),
      repo.subscriptionRegister(president),
      repo.ledger(president, "JSOA"),
      repo.ledger(president, "JSOF"),
      repo.reimbursementQueues(president),
      repo.transfers(president),
    ];
    const banned = /^(combined|consolidated|blended|group|bothEntities|allEntities)/i;
    for (const view of views) {
      for (const figure of moneyFigures(view)) {
        const key = figure.path.split(".").pop() ?? "";
        expect(key, `${figure.path} reads as a cross-entity total`).not.toMatch(banned);
      }
    }
  });

  it("keeps the per-entity operating cost consistent with the apportioned rows", () => {
    const register = repo.subscriptionRegister(president);
    for (const entity of ENTITIES) {
      const figure = register.annualOperatingCost.find((f) => f.entity === entity);
      if (!figure?.visible) throw new Error("expected a visible figure");
      const fromRows = sumCents(
        register.rows.flatMap((row) =>
          row.annualByEntity.filter((p) => p.entity === entity).map((p) => p.amountCents),
        ),
      );
      expect(figure.amountCents).toBe(fromRows);
    }
  });
});

/* ================================================================== *
 * 4. Transfers: one signature, or a missing minute reference, is refused
 * ================================================================== */

describe("inter-entity transfers", () => {
  const good = TRANSFERS.find((t) => t.id === "tr-2026-0001") as Transfer;

  it("accepts the fully approved, minuted, restriction-stated transfer", () => {
    expect(unmetTransferRules(good)).toEqual([]);
    expect(canRecordTransfer(good)).toBe(true);
    expect(recordTransfer(good).status).toBe("APPROVED");
  });

  it("refuses one signature, and names the missing side", () => {
    const oneSignature: Transfer = {
      ...good,
      approvals: [good.approvals[0]],
    };
    expect(canRecordTransfer(oneSignature)).toBe(false);
    expect(() => recordTransfer(oneSignature)).toThrow(AuthzError);

    const unmet = unmetTransferRules(oneSignature);
    expect(unmet.map((r) => r.id)).toContain("TREASURER_APPROVAL_RECEIVING");
    // The message says which rule, not "invalid".
    const message = unmet.find((r) => r.id === "TREASURER_APPROVAL_RECEIVING")!.unmetMessage;
    expect(message).toContain("JSOF");
    expect(message).toContain("Treasurer");
    expect(message.toLowerCase()).not.toContain("invalid");
  });

  it("refuses a missing minute reference on either side, and says which side", () => {
    for (const side of ["minuteRefFrom", "minuteRefTo"] as const) {
      const missing: Transfer = { ...good, [side]: null };
      expect(canRecordTransfer(missing)).toBe(false);
      expect(() => recordTransfer(missing)).toThrow(/minute/i);

      const unmet = unmetTransferRules(missing);
      const expected =
        side === "minuteRefFrom" ? "MINUTE_REF_SENDING" : "MINUTE_REF_RECEIVING";
      expect(unmet.map((r) => r.id)).toContain(expected);
      expect(unmet.find((r) => r.id === expected)!.unmetMessage).toContain(
        side === "minuteRefFrom" ? good.fromEntity : good.toEntity,
      );
    }
  });

  it("refuses a blank or token restriction statement", () => {
    expect(canRecordTransfer({ ...good, restrictionStatement: "" })).toBe(false);
    expect(canRecordTransfer({ ...good, restrictionStatement: "n/a" })).toBe(false);
    expect(() => recordTransfer({ ...good, restrictionStatement: "" })).toThrow(
      /restriction statement/i,
    );
  });

  it("refuses an approval from the person who raised it", () => {
    const selfApproved: Transfer = {
      ...good,
      createdById: "p-halloran",
    };
    expect(canRecordTransfer(selfApproved)).toBe(false);
    expect(() => recordTransfer(selfApproved)).toThrow(/Self-approval/);
  });

  it("recuses the President on the receiving side, by name", () => {
    const presidentReceiving: Transfer = {
      ...good,
      approvals: [
        { approverId: "p-halloran", entity: "JSOA", approvedOn: "2026-07-09" },
        { approverId: "p-mercer", entity: "JSOF", approvedOn: "2026-07-10" },
      ],
    };
    const unmet = unmetTransferRules(presidentReceiving);
    expect(unmet.map((r) => r.id)).toContain("PRESIDENT_RECUSED_RECEIVING");
    // Named, so the reader knows who to go back to, not "invalid approver".
    const message = unmet.find((r) => r.id === "PRESIDENT_RECUSED_RECEIVING")!.unmetMessage;
    expect(message).toContain(personName("p-mercer"));
    expect(message).toContain("recused");
    expect(message).toContain("JSOF");
    // And the receiving Treasurer's approval is still missing, separately.
    expect(unmet.map((r) => r.id)).toContain("TREASURER_APPROVAL_RECEIVING");
    expect(canRecordTransfer(presidentReceiving)).toBe(false);
  });

  it("refuses a transfer that does not cross entities", () => {
    const sameEntity: Transfer = { ...good, toEntity: good.fromEntity };
    expect(canRecordTransfer(sameEntity)).toBe(false);
    expect(() => recordTransfer(sameEntity)).toThrow(/cross entities/);
  });

  it("lists every outstanding condition at once rather than the first one", () => {
    const bare: Transfer = {
      ...good,
      approvals: [],
      minuteRefFrom: null,
      minuteRefTo: null,
      restrictionStatement: "",
    };
    const unmet = unmetTransferRules(bare).map((r) => r.id);
    expect(unmet).toContain("TREASURER_APPROVAL_SENDING");
    expect(unmet).toContain("TREASURER_APPROVAL_RECEIVING");
    expect(unmet).toContain("MINUTE_REF_SENDING");
    expect(unmet).toContain("MINUTE_REF_RECEIVING");
    expect(unmet).toContain("RESTRICTION_STATEMENT");
    expect(unmet.length).toBeGreaterThanOrEqual(5);
  });

  it("every rule states its requirement and where it is enforced", () => {
    for (const rule of transferRuleStatuses(good)) {
      expect(rule.requirement.length).toBeGreaterThan(10);
      expect(["policy.ts", "treasury"]).toContain(rule.source);
    }
  });

  it("the seeded half-approved transfer is outstanding on the receiving side", () => {
    const pending = TRANSFERS.find((t) => t.id === "tr-2026-0002") as Transfer;
    const unmet = unmetTransferRules(pending).map((r) => r.id);
    expect(unmet).toEqual(["TREASURER_APPROVAL_RECEIVING", "MINUTE_REF_RECEIVING"]);
  });
});

/* ================================================================== *
 * 5. Reimbursements: self-approval is refused
 * ================================================================== */

describe("reimbursement approval", () => {
  const ownClaim = REIMBURSEMENTS.find((r) => r.id === "rb-2026-0007") as Reimbursement;

  it("refuses a treasurer approving the claim they submitted", () => {
    // rb-2026-0007 was raised by p-halloran, the Treasurer of JSOA, who is
    // otherwise exactly the right person to approve a JSOA reimbursement.
    expect(ownClaim.createdById).toBe(treasurerJsoa.personId);
    expect(() => approveReimbursement(treasurerJsoa, ownClaim, "2026-09-30")).toThrow(
      AuthzError,
    );

    try {
      approveReimbursement(treasurerJsoa, ownClaim, "2026-09-30");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthzError);
      expect((error as AuthzError).code).toBe("SELF_APPROVAL");
      expect((error as AuthzError).message).toContain("rb-2026-0007");
    }
  });

  it("gives the screen a refusal message naming the claim, not 'invalid'", () => {
    const outcome = previewApproval(treasurerJsoa, ownClaim, "2026-09-30");
    expect(outcome.allowed).toBe(false);
    if (outcome.allowed) throw new Error("expected a refusal");
    expect(outcome.code).toBe("SELF_APPROVAL");
    expect(outcome.refusal).toContain("rb-2026-0007");
    expect(outcome.refusal.toLowerCase()).not.toContain("invalid");
  });

  it("refuses the self-approval even when the claim is small enough for one approval", () => {
    expect(approvalsRequired(ownClaim)).toBe(1);
    expect(() => approveReimbursement(treasurerJsoa, ownClaim, "2026-09-30")).toThrow(
      /Self-approval/,
    );
  });

  it("lets a different spend approver approve it", () => {
    const approved = approveReimbursement(president, ownClaim, "2026-09-30");
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvals.map((a) => a.approverId)).toEqual([president.personId]);
  });

  it("refuses an approver with no spend authority on that entity", () => {
    // The Secretary holds only AGGREGATE on FINANCIAL, so the scope check
    // refuses before the capability check is even reached. Aggregate totals do
    // not carry the right to authorise one of the payments inside them.
    expect(() => approveReimbursement(secretary, ownClaim, "2026-09-30")).toThrow(AuthzError);

    // The Finance Review Officer does hold READ, and still cannot approve:
    // the reviewer reviews, and this refusal is the capability check, not scope.
    expect(() => approveReimbursement(financeReviewer, ownClaim, "2026-09-30")).toThrow(
      TreasuryError,
    );
    try {
      approveReimbursement(financeReviewer, ownClaim, "2026-09-30");
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as TreasuryError).code).toBe("NOT_APPROVABLE");
      expect((error as TreasuryError).message).toContain("Treasurer");
    }

    // The JSOF treasurer has no reach into a JSOA claim at all.
    expect(() => approveReimbursement(treasurerJsof, ownClaim, "2026-09-30")).toThrow(
      AuthzError,
    );
  });

  it("requires a second, different approval above the routine threshold", () => {
    const big = REIMBURSEMENTS.find((r) => r.id === "rb-2026-0008") as Reimbursement;
    expect(approvalsRequired(big)).toBe(2);
    expect(statusFor(big)).toBe("AWAITING_SECOND_APPROVAL");

    // The first approver cannot supply the second approval.
    expect(() => approveReimbursement(treasurerJsoa, big, "2026-09-30")).toThrow(
      /already approved/i,
    );

    const settled = approveReimbursement(president, big, "2026-09-30");
    expect(settled.status).toBe("APPROVED");
    expect(new Set(settled.approvals.map((a) => a.approverId)).size).toBe(2);
  });

  it("uses the lower threshold for a related party", () => {
    const related = REIMBURSEMENTS.find((r) => r.id === "rb-2026-0009") as Reimbursement;
    expect(related.amountCents).toBeLessThan(100_000);
    expect(approvalsRequired(related)).toBe(2);
    // And the claimant still cannot be one of the two.
    expect(() => approveReimbursement(treasurerJsof, related, "2026-09-30")).toThrow(
      /Self-approval/,
    );
  });

  it("refuses approval while no receipt is on file, and says what to attach", () => {
    const noReceipt = REIMBURSEMENTS.find((r) => r.id === "rb-2026-0010") as Reimbursement;
    const outcome = previewApproval(treasurerJsoa, noReceipt, "2026-09-30");
    expect(outcome.allowed).toBe(false);
    if (outcome.allowed) throw new Error("expected a refusal");
    expect(outcome.code).toBe("NO_RECEIPT");
    expect(outcome.refusal).toContain("receipt");
  });
});

/* ================================================================== *
 * 6. Annual-cost normalisation
 * ================================================================== */

describe("annual cost normalisation", () => {
  it("multiplies a monthly cost by twelve", () => {
    expect(
      annualCostCents({ cadence: "monthly", costCents: 9_900, observedAnnualCents: null }),
    ).toBe(118_800);
    expect(
      annualCostCents({ cadence: "monthly", costCents: 2_700, observedAnnualCents: null }),
    ).toBe(32_400);
    // A cadence that does not divide evenly still lands on whole cents.
    expect(
      annualCostCents({ cadence: "monthly", costCents: 1_667, observedAnnualCents: null }),
    ).toBe(20_004);
  });

  it("multiplies a quarterly cost by four", () => {
    expect(
      annualCostCents({ cadence: "quarterly", costCents: 24_999, observedAnnualCents: null }),
    ).toBe(99_996);
  });

  it("passes an annual cost through unchanged", () => {
    expect(
      annualCostCents({ cadence: "annual", costCents: 15_990, observedAnnualCents: null }),
    ).toBe(15_990);
    expect(
      annualCostCents({ cadence: "annual", costCents: 0, observedAnnualCents: null }),
    ).toBe(0);
  });

  it("takes the observed trailing-twelve-month figure for a variable cost", () => {
    expect(
      annualCostCents({ cadence: "variable", costCents: null, observedAnnualCents: 421_112 }),
    ).toBe(421_112);
    // A per-period rate is meaningless for a variable cost and is not used.
    expect(
      annualCostCents({ cadence: "variable", costCents: 99, observedAnnualCents: 45_600 }),
    ).toBe(45_600);
  });

  it("refuses a variable cost with no observed figure rather than reporting zero", () => {
    expect(() =>
      annualCostCents({ cadence: "variable", costCents: 1_000, observedAnnualCents: null }),
    ).toThrow(TreasuryError);
    expect(() =>
      annualCostCents({ cadence: "monthly", costCents: null, observedAnnualCents: 1_000 }),
    ).toThrow(/needs a cost per period/);
  });

  it("refuses a fractional cent anywhere", () => {
    expect(() =>
      annualCostCents({ cadence: "monthly", costCents: 9_900.5, observedAnnualCents: null }),
    ).toThrow(/integer/);
  });

  it("normalises every seeded subscription without a float", () => {
    for (const subscription of SUBSCRIPTIONS) {
      const annual = subscriptionAnnualCents(subscription);
      expect(Number.isInteger(annual)).toBe(true);
      expect(annual).toBeGreaterThanOrEqual(0);
    }
  });

  it("apportions a shared invoice so the parts add back exactly", () => {
    // 159.90 split evenly is 79.95 each, which is exact.
    expect(apportion(15_990, [5_000, 5_000])).toEqual([7_995, 7_995]);
    // An odd cent has to land somewhere, and it lands deterministically.
    expect(apportion(101, [5_000, 5_000])).toEqual([51, 50]);
    expect(apportion(100, [6_000, 4_000])).toEqual([60, 40]);
    expect(apportion(1, [7_000, 3_000])).toEqual([1, 0]);

    for (const subscription of SUBSCRIPTIONS) {
      const parts = annualByEntity(subscription);
      expect(sumCents(parts.map((p) => p.amountCents))).toBe(
        subscriptionAnnualCents(subscription),
      );
    }
  });

  it("refuses a split that does not sum to the whole", () => {
    expect(() => apportion(100, [5_000, 4_000])).toThrow(/basis points/);
  });
});

/* ================================================================== *
 * 7. The register's findings, including the handover test
 * ================================================================== */

describe("the subscription register", () => {
  it("raises a critical finding for a blank second administrator", () => {
    const blank = SUBSCRIPTIONS.filter((s) => s.secondAdministratorPersonId === null);
    expect(blank.length).toBeGreaterThan(0);
    for (const subscription of blank) {
      const findings = subscriptionFindings(subscription);
      const handover = findings.find((f) => f.code === "MISSING_SECOND_ADMINISTRATOR");
      expect(handover, `${subscription.id} should raise the handover finding`).toBeDefined();
      expect(handover!.severity).toBe("critical");
      expect(handover!.remedy).toContain("second administrator");
    }
  });

  it("raises no handover finding where a second administrator is named", () => {
    for (const subscription of SUBSCRIPTIONS.filter(
      (s) => s.secondAdministratorPersonId !== null,
    )) {
      expect(
        subscriptionFindings(subscription).map((f) => f.code),
      ).not.toContain("MISSING_SECOND_ADMINISTRATOR");
    }
  });

  it("raises a finding for a cross-entity split with no stated basis", () => {
    const shared = SUBSCRIPTIONS.find((s) => s.split.length > 1) as Subscription;
    expect(shared.splitBasis).not.toBeNull();
    const withoutBasis: Subscription = { ...shared, splitBasis: null };
    expect(subscriptionFindings(withoutBasis).map((f) => f.code)).toContain(
      "MISSING_SPLIT_BASIS",
    );
  });

  it("raises a finding for a review older than a year, or none at all", () => {
    const never = SUBSCRIPTIONS.find((s) => s.lastReviewedOn === null) as Subscription;
    expect(subscriptionFindings(never).map((f) => f.code)).toContain("STALE_REVIEW");
    const stale: Subscription = { ...never, lastReviewedOn: "2024-01-01" };
    expect(subscriptionFindings(stale).map((f) => f.code)).toContain("STALE_REVIEW");
    const fresh: Subscription = { ...never, lastReviewedOn: "2026-08-01" };
    expect(subscriptionFindings(fresh).map((f) => f.code)).not.toContain("STALE_REVIEW");
  });

  it("orders findings by severity so the critical one is not below a renewal date", () => {
    const register = repo.subscriptionRegister(president);
    const ranks = register.findings.map((f) =>
      f.severity === "critical" ? 0 : f.severity === "high" ? 1 : 2,
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(register.findings[0]?.severity).toBe("critical");
  });

  it("sorts by severity without mutating the input", () => {
    const input = [{ severity: "moderate" as const }, { severity: "critical" as const }];
    const sorted = bySeverity(input);
    expect(sorted[0].severity).toBe("critical");
    expect(input[0].severity).toBe("moderate");
  });

  it("withholds the other entity's rows from a single-entity treasurer", () => {
    const register = repo.subscriptionRegister(treasurerJsof);
    expect(register.withheldRowCount).toBeGreaterThan(0);
    expect(register.rows.every((r) => r.subscription.split.some((s) => s.entity === "JSOF"))).toBe(
      true,
    );
    const jsoa = register.annualOperatingCost.find((f) => f.entity === "JSOA");
    expect(jsoa?.visible).toBe(false);
  });
});

/* ================================================================== *
 * 8. The controls panel renders the real finding
 * ================================================================== */

describe("the separation-of-duties panel", () => {
  it("surfaces the Treasurer-is-also-Store-Chair finding as critical", () => {
    const panel = repo.separationOfDuties(president);
    const critical = panel.current.filter((f) => f.severity === "critical");
    expect(critical.length).toBeGreaterThan(0);
    const storeChair = critical.find(
      (f) => f.roles.includes("TREASURER") && f.roles.includes("STORE_CHAIR"),
    );
    expect(storeChair).toBeDefined();
    expect(storeChair!.personId).toBe("p-halloran");
    expect(storeChair!.entity).toBe("JSOA");
    expect(storeChair!.mitigation.length).toBeGreaterThan(20);
  });

  it("shows a person their own finding even without audit scope", () => {
    // The Treasurer holds no AUDIT_LOG grant, and the panel is about them.
    const panel = repo.separationOfDuties(treasurerJsoa);
    expect(panel.current.length).toBeGreaterThan(0);
    expect(panel.current.every((f) => f.personId === treasurerJsoa.personId)).toBe(true);
    expect(panel.withheldCount).toBeGreaterThan(0);
  });

  it("flags the proposed single treasurer as sitting on both sides of every transfer", () => {
    const panel = repo.separationOfDuties(president);
    expect(
      panel.proposed.findings.some((f) => f.finding.includes("both sides of every transfer")),
    ).toBe(true);
  });

  it("refuses the panel to someone with no board seat", () => {
    expect(() => repo.separationOfDuties(member())).toThrow(AuthzError);
  });
});

/* ================================================================== *
 * 9. Housekeeping: the seed and the subject bridge
 * ================================================================== */

describe("seed and subject integrity", () => {
  it("holds every amount as an integer number of cents", () => {
    const amounts = [
      ...moneyFigures(repo.positionStatement(president)),
      ...ENTITIES.flatMap((e) => moneyFigures(repo.ledger(president, e))),
      ...moneyFigures(repo.subscriptionRegister(president)),
      ...moneyFigures(repo.transfers(president)),
    ];
    expect(amounts.length).toBeGreaterThan(0);
    for (const figure of amounts) {
      expect(Number.isInteger(figure.amountCents), `${figure.path} is not an integer`).toBe(
        true,
      );
    }
  });

  it("ties each entity's fund openings to its opening net assets", () => {
    const statement = repo.positionStatement(president);
    for (const column of statement.columns) {
      if (!column.visible) continue;
      expect(sumCents(column.fundBalances.map((b) => b.openingCents))).toBe(
        column.openingNetAssetsCents,
      );
      expect(column.closingNetAssetsCents).toBe(
        column.openingNetAssetsCents + column.revenueCents - column.expenseCents,
      );
      expect(column.changeCents).toBe(column.revenueCents - column.expenseCents);
    }
  });

  it("keeps every seeded ledger entry inside the reported period", () => {
    for (const entity of ENTITIES) {
      for (const entry of repo.ledger(president, entity).entries) {
        expect(entry.date >= PERIOD.fromDate).toBe(true);
        expect(entry.date <= PERIOD.toDate).toBe(true);
      }
    }
  });

  it("maps a switcher persona onto a seeded person so identity checks mean something", () => {
    const persona: Subject = {
      personId: "dev:treasurer-jsoa",
      assignments: [{ role: "TREASURER", entity: "JSOA" }],
      mfaSatisfied: true,
    };
    const bridged = treasurySubject(persona);
    expect(bridged.personId).toBe("p-halloran");
    // Assignments are the switcher's, untouched: the bridge changes identity only.
    expect(bridged.assignments).toEqual(persona.assignments);

    // Which is what makes the self-approval refusal reachable from the screen.
    const claim = REIMBURSEMENTS.find((r) => r.id === "rb-2026-0007") as Reimbursement;
    expect(previewApproval(bridged, claim, "2026-09-30").allowed).toBe(false);
  });

  it("leaves an unmapped subject's identity alone", () => {
    const unknown: Subject = {
      personId: "dev:scholarships",
      assignments: [{ role: "SCHOLARSHIPS_CHAIR", entity: "JSOF" }],
      mfaSatisfied: true,
    };
    expect(treasurySubject(unknown).personId).toBe("dev:scholarships");
  });

  it("renders figures with two decimal places and grouped thousands", () => {
    expect(formatCents(12_102_888)).toBe("121,028.88");
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(-2_500)).toBe("-25.00");
    expect(() => formatCents(1.5)).toThrow(/integer/);
  });

  it("names a treasurer for each entity, per the two-treasurer structure", () => {
    for (const entity of ENTITIES as readonly Entity[]) {
      const holders = [treasurerJsoa, treasurerJsof].filter((s) =>
        s.assignments.some((a) => a.role === "TREASURER" && a.entity === entity),
      );
      expect(holders).toHaveLength(1);
    }
  });
});
