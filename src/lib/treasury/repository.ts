/**
 * The treasury repository: the reads and writes this module needs, and an
 * in-memory implementation over the seed.
 *
 * Every method that touches FINANCIAL calls `authorize()` or `can()` from
 * `@/lib/authz/policy` with the entity in hand, before it reads anything.
 * There is no method on this interface that takes no entity and returns a
 * money figure, which is the structural reason a blended total cannot be
 * requested: you ask per entity, or you ask for a list of columns.
 *
 * The D1 implementation of `TreasuryRepository` is in `repository.d1.ts`;
 * `treasuryRepository()` at the bottom of this file picks between the two on
 * whether a binding exists.
 *
 * Every method returns a Promise, including `period()` and `asOfDate()`, which
 * the in-memory implementation answers from a constant. An interface with a
 * mix of synchronous and asynchronous methods is one the caller has to
 * remember things about, and the two cheap ones are not worth that.
 */

import { ENTITIES, type Entity } from "../authz/model";
import { database } from "../db";
import {
  authorize,
  can,
  effectiveLevel,
  separationOfDutiesFindings,
  type RoleAssignment,
  type SodFinding,
  type Subject,
} from "../authz/policy";
import {
  annualByEntity,
  assertUnblended,
  subscriptionAnnualCents,
  sumCents,
  TreasuryError,
} from "./money";
import {
  AS_OF_DATE,
  FUNDS,
  LEDGER_ENTRIES,
  PEOPLE,
  PERIOD,
  PROPOSED_CONSOLIDATION,
  REIMBURSEMENTS,
  SUBSCRIPTIONS,
  TRANSFERS,
  type SeededPerson,
} from "./seed";
import type {
  EntityFigure,
  Fund,
  FundBalance,
  LedgerEntry,
  LedgerFilter,
  LedgerView,
  Period,
  PositionColumn,
  PositionStatement,
  Reimbursement,
  Subscription,
  SubscriptionFinding,
  SubscriptionRegister,
  SubscriptionRow,
  Transfer,
} from "./types";

/* ------------------------------------------------------------------ *
 * Subjects
 *
 * The board shell owns the dev role switcher (`@/lib/authz/session`), so this
 * module builds no switcher of its own. It does need one bridge.
 *
 * The switcher's subjects are identified by persona: `dev:treasurer-jsoa`.
 * Treasury's records are identified by person: `p-halloran`. Self-approval,
 * "already approved by you", and "this finding is about you" all compare
 * identities, so without a bridge a treasurer could approve their own
 * reimbursement in the demo simply because the two ids never matched.
 *
 * `treasurySubject` keeps the switcher's ASSIGNMENTS untouched — those are the
 * authority on what may be read — and substitutes the seeded person's id so
 * the identity comparisons mean something. Dev only; when Auth.js lands the
 * subject arrives with a real person id and this function becomes identity.
 * ------------------------------------------------------------------ */

export const PERSONA_TO_PERSON: Record<string, string> = {
  "dev:president": "p-mercer",
  "dev:vp-ops": "p-sayles",
  "dev:vp-membership": "p-lindqvist",
  "dev:secretary": "p-vance",
  "dev:treasurer-jsoa": "p-halloran",
  "dev:treasurer-jsof": "p-okonkwo",
  "dev:treasurer-store": "p-halloran",
  "dev:finance-review": "p-brill",
  "dev:webmaster": "p-ferro",
  "dev:comms": "p-ferro",
};

export function treasurySubject(subject: Subject): Subject {
  const personId = PERSONA_TO_PERSON[subject.personId];
  return personId ? { ...subject, personId } : subject;
}

export function boardPeople(): SeededPerson[] {
  return PEOPLE;
}

/** Build a subject straight from a seeded person. Used by the tests. */
export function seedSubject(personId: string, mfaSatisfied = true): Subject {
  const person = PEOPLE.find((p) => p.id === personId);
  return {
    personId: person?.id ?? personId,
    assignments: person?.assignments ?? [],
    mfaSatisfied,
  };
}

/** Board roles the controls panel treats as having governance standing. */
const NON_BOARD_ROLES = new Set(["MEMBER", "DONOR"]);

function isBoardMember(subject: Subject): boolean {
  return (
    subject.mfaSatisfied && subject.assignments.some((a) => !NON_BOARD_ROLES.has(a.role))
  );
}

/* ------------------------------------------------------------------ *
 * Controls panel shapes
 * ------------------------------------------------------------------ */

export type SodPanel = {
  /** Findings for the board as it is actually assigned today. */
  current: SodFinding[];
  /** The same engine run over a change the board is considering. */
  proposed: {
    personId: string;
    label: string;
    rationale: string;
    assignments: RoleAssignment[];
    findings: SodFinding[];
  };
  /** Findings the reader holds no audit scope for, reported as a count. */
  withheldCount: number;
  people: SeededPerson[];
};

export type ReimbursementQueue =
  | {
      entity: Entity;
      visible: true;
      claims: Reimbursement[];
    }
  | { entity: Entity; visible: false; withheldReason: string };

/* ------------------------------------------------------------------ *
 * The interface
 * ------------------------------------------------------------------ */

export interface TreasuryRepository {
  period(): Promise<Period>;
  asOfDate(): Promise<string>;

  /** Two labelled columns, one per entity, each visible or withheld. */
  positionStatement(subject: Subject): Promise<PositionStatement>;

  funds(subject: Subject, entity: Entity): Promise<Fund[]>;
  ledger(
    subject: Subject,
    entity: Entity,
    filter?: LedgerFilter,
  ): Promise<LedgerView>;

  subscriptionRegister(subject: Subject): Promise<SubscriptionRegister>;

  transfers(subject: Subject): Promise<Transfer[]>;
  transfer(subject: Subject, id: string): Promise<Transfer | null>;

  separationOfDuties(subject: Subject): Promise<SodPanel>;

  reimbursementQueues(subject: Subject): Promise<ReimbursementQueue[]>;
  reimbursement(subject: Subject, id: string): Promise<Reimbursement | null>;

  /**
   * Writes. The in-memory implementation authorizes and hands the record
   * straight back, which is what it did before this port: nothing outside a
   * database can keep it. The D1 implementation writes it, with the transfer
   * or claim and its approval rows in one transaction.
   */
  saveTransfer(subject: Subject, transfer: Transfer): Promise<Transfer>;
  saveReimbursement(
    subject: Subject,
    reimbursement: Reimbursement,
  ): Promise<Reimbursement>;
}

/* ------------------------------------------------------------------ *
 * Two policy questions that were methods on the in-memory class
 *
 * Neither reads any treasury data: one asks what the subject's grants say and
 * the other compares a transfer's two sides against the subject's TREASURER
 * assignments. They were methods on `InMemoryTreasuryRepository` and not on
 * the interface, which meant they existed on one implementation and not the
 * other. Moved out here, where they are the same answer whatever is behind
 * the repository.
 * ------------------------------------------------------------------ */

/** Whether any transfer is visible at all. Drives whether the tab renders. */
export function canSeeTransfers(subject: Subject): boolean {
  return ENTITIES.some((entity) =>
    can({ subject, dataClass: "FINANCIAL", entity, required: "READ" }),
  );
}

/** Which side, if any, this subject may approve. Drives the form. */
export function approvableSides(subject: Subject, transfer: Transfer): Entity[] {
  return [transfer.fromEntity, transfer.toEntity].filter((entity) =>
    subject.assignments.some((a) => a.role === "TREASURER" && a.entity === entity),
  );
}

/* ------------------------------------------------------------------ *
 * Fund and period arithmetic
 * ------------------------------------------------------------------ */

function inPeriod(entry: LedgerEntry, period: Period): boolean {
  return entry.date >= period.fromDate && entry.date <= period.toDate;
}

function fundBalances(entity: Entity, period: Period): FundBalance[] {
  return FUNDS.filter((f) => f.entity === entity).map((fund) => {
    const entries = LEDGER_ENTRIES.filter(
      (e) => e.entity === entity && e.fundId === fund.id && inPeriod(e, period),
    );
    const revenueCents = sumCents(
      entries.filter((e) => e.kind === "revenue").map((e) => e.amountCents),
    );
    const expenseCents = sumCents(
      entries.filter((e) => e.kind === "expense").map((e) => e.amountCents),
    );
    return {
      entity,
      fundId: fund.id,
      fundName: fund.name,
      restriction: fund.restriction,
      openingCents: fund.openingBalanceCents,
      revenueCents,
      expenseCents,
      closingCents: fund.openingBalanceCents + revenueCents - expenseCents,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Subscription findings
 * ------------------------------------------------------------------ */

export const STALE_REVIEW_DAYS = 365;
export const RENEWAL_WARNING_DAYS = 45;

function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function subscriptionFindings(
  subscription: Subscription,
  asOf: string = AS_OF_DATE,
): SubscriptionFinding[] {
  const findings: SubscriptionFinding[] = [];
  const id = subscription.id;

  if (!subscription.secondAdministratorPersonId) {
    findings.push({
      code: "MISSING_SECOND_ADMINISTRATOR",
      subscriptionId: id,
      severity: "critical",
      finding:
        "No second administrator. If the owner is unreachable, nobody on the board " +
        "can get into this account, change the card on it, or shut it off.",
      remedy:
        "Name a second administrator and record them here. Keep the credential in " +
        "the shared password manager, not in one volunteer's personal inbox.",
    });
  }

  if (subscription.split.length > 1 && !subscription.splitBasis) {
    findings.push({
      code: "MISSING_SPLIT_BASIS",
      subscriptionId: id,
      severity: "high",
      finding:
        "The cost is split across both entities with no stated basis, so neither " +
        "entity can show why it bears its share.",
      remedy: "State the basis: seats, mailboxes, messages sent, or a board decision.",
    });
  }

  if (subscription.cadence === "variable" && subscription.observedAnnualCents === null) {
    findings.push({
      code: "MISSING_OBSERVED_ANNUAL",
      subscriptionId: id,
      severity: "high",
      finding:
        "A variable cost with no observed annual figure. This line cannot be " +
        "compared with the others and is not in any budget.",
      remedy: "Record the trailing twelve months of actual spend from the vendor's statements.",
    });
  }

  if (
    subscription.lastReviewedOn === null ||
    daysBetween(subscription.lastReviewedOn, asOf) > STALE_REVIEW_DAYS
  ) {
    findings.push({
      code: "STALE_REVIEW",
      subscriptionId: id,
      severity: "moderate",
      finding:
        subscription.lastReviewedOn === null
          ? "Never reviewed by the board."
          : `Last reviewed ${subscription.lastReviewedOn}, more than a year ago.`,
      remedy: "Put it on the next meeting's agenda and record the decision here.",
    });
  }

  if (
    subscription.renewalDate &&
    daysBetween(asOf, subscription.renewalDate) >= 0 &&
    daysBetween(asOf, subscription.renewalDate) <= RENEWAL_WARNING_DAYS
  ) {
    findings.push({
      code: "RENEWAL_IMMINENT",
      subscriptionId: id,
      severity: "moderate",
      finding: `Renews ${subscription.renewalDate}, within ${RENEWAL_WARNING_DAYS} days.`,
      remedy: "Decide before it renews, or it renews by default.",
    });
  }

  if (!subscription.nonprofitRateApplied) {
    findings.push({
      code: "NO_NONPROFIT_RATE",
      subscriptionId: id,
      severity: "moderate",
      finding: `No nonprofit rate applied. ${subscription.nonprofitRateNote}`.trim(),
      remedy:
        "Confirm with the vendor that no nonprofit rate exists before the next renewal, " +
        "and record the answer here so it is not asked again.",
    });
  }

  return findings;
}

const SEVERITY_ORDER: Record<SubscriptionFinding["severity"], number> = {
  critical: 0,
  high: 1,
  moderate: 2,
};

export function bySeverity<T extends { severity: SubscriptionFinding["severity"] }>(
  findings: T[],
): T[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/* ------------------------------------------------------------------ *
 * Separation of duties
 *
 * Shared by both implementations and holding no treasury data, which is why
 * it sits here as a function rather than being written twice.
 *
 * It reads the board's role assignments and runs `separationOfDutiesFindings`
 * over them. Those assignments are `PEOPLE` in this module's seed, and they
 * stay the seed's even on the D1 path: the identity and role-grant tables are
 * another module's (`0001_identity_and_audit.sql`) and this one does not reach
 * across to them. Noted in the port report rather than solved quietly — when
 * the panel should read real grants, it reads them through whatever authz
 * exposes, not through a join from treasury.
 * ------------------------------------------------------------------ */

export function separationOfDutiesPanel(subject: Subject): SodPanel {
  if (!isBoardMember(subject)) {
    authorize({
      subject,
      dataClass: "AUDIT_LOG",
      entity: ENTITIES[0],
      required: "READ",
    });
  }

  const all = PEOPLE.flatMap((person) =>
    separationOfDutiesFindings(person.id, person.assignments),
  );

  // A person always sees a finding about themselves: the panel exists so the
  // board can look at its own arrangement, and the Treasurer holds no audit
  // scope. Findings about other people need audit read on that entity.
  const maySee = (finding: SodFinding) =>
    finding.personId === subject.personId ||
    effectiveLevel(subject, "AUDIT_LOG", finding.entity) !== "NONE";

  const current = all.filter(maySee);

  const proposedFindings = separationOfDutiesFindings(
    PROPOSED_CONSOLIDATION.personId,
    PROPOSED_CONSOLIDATION.assignments,
  ).filter(maySee);

  return {
    current: sortSod(current),
    proposed: {
      personId: PROPOSED_CONSOLIDATION.personId,
      label: PROPOSED_CONSOLIDATION.label,
      rationale: PROPOSED_CONSOLIDATION.rationale,
      assignments: PROPOSED_CONSOLIDATION.assignments,
      findings: sortSod(proposedFindings),
    },
    withheldCount: all.length - current.length,
    people: PEOPLE,
  };
}

/* ------------------------------------------------------------------ *
 * In-memory implementation
 * ------------------------------------------------------------------ */

export class InMemoryTreasuryRepository implements TreasuryRepository {
  constructor(
    private readonly data = {
      funds: FUNDS,
      entries: LEDGER_ENTRIES,
      subscriptions: SUBSCRIPTIONS,
      transfers: TRANSFERS,
      reimbursements: REIMBURSEMENTS,
      period: PERIOD,
      asOf: AS_OF_DATE,
    },
  ) {}

  async period(): Promise<Period> {
    return this.data.period;
  }

  async asOfDate(): Promise<string> {
    return this.data.asOf;
  }

  /* --- Position statement ----------------------------------------- */

  async positionStatement(subject: Subject): Promise<PositionStatement> {
    const period = this.data.period;

    const columns: PositionColumn[] = ENTITIES.map((entity) => {
      // AGGREGATE is enough for a totals column: no row-level identity here.
      const allowed = can({
        subject,
        dataClass: "FINANCIAL",
        entity,
        required: "AGGREGATE",
      });
      if (!allowed) {
        return {
          entity,
          visible: false,
          withheldReason:
            `You hold no financial scope on ${entity}, so its position is withheld. ` +
            `This column is not zero and not empty: the ${entity} figures exist and ` +
            `are not yours to see.`,
        };
      }

      const balances = fundBalances(entity, period);
      const revenueCents = sumCents(balances.map((b) => b.revenueCents));
      const expenseCents = sumCents(balances.map((b) => b.expenseCents));
      const openingNetAssetsCents = sumCents(balances.map((b) => b.openingCents));
      const closingNetAssetsCents = sumCents(balances.map((b) => b.closingCents));

      return {
        entity,
        visible: true,
        revenueCents,
        expenseCents,
        openingNetAssetsCents,
        closingNetAssetsCents,
        changeCents: closingNetAssetsCents - openingNetAssetsCents,
        unrestrictedClosingCents: sumCents(
          balances.filter((b) => b.restriction === "unrestricted").map((b) => b.closingCents),
        ),
        restrictedClosingCents: sumCents(
          balances.filter((b) => b.restriction !== "unrestricted").map((b) => b.closingCents),
        ),
        fundBalances: balances,
      };
    });

    const statement: PositionStatement = { period, columns };
    // Belt and braces: refuse to hand back a view carrying a combined figure.
    assertUnblended(statement.columns, "positionStatement.columns");
    return statement;
  }

  /* --- Ledger ------------------------------------------------------ */

  async funds(subject: Subject, entity: Entity): Promise<Fund[]> {
    authorize({ subject, dataClass: "FINANCIAL", entity, required: "READ" });
    return this.data.funds.filter((f) => f.entity === entity);
  }

  async ledger(
    subject: Subject,
    entity: Entity,
    filter: LedgerFilter = {},
  ): Promise<LedgerView> {
    // Row-level financial detail, so READ, not AGGREGATE. A JSOA treasurer
    // asking for JSOF throws here rather than returning an empty list: an
    // empty list reads as "the Foundation had no activity".
    authorize({
      subject,
      dataClass: "FINANCIAL",
      entity,
      required: "READ",
      rowLevel: true,
    });

    const period = this.data.period;
    const funds = this.data.funds.filter((f) => f.entity === entity);
    const fundIds = new Set(funds.map((f) => f.id));

    const appliedFundId = filter.fundId && fundIds.has(filter.fundId) ? filter.fundId : null;

    let entries = this.data.entries.filter(
      (e) => e.entity === entity && inPeriod(e, period),
    );
    if (appliedFundId) entries = entries.filter((e) => e.fundId === appliedFundId);
    if (filter.kind) entries = entries.filter((e) => e.kind === filter.kind);
    entries = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

    return {
      entity,
      period,
      entries,
      revenueCents: sumCents(
        entries.filter((e) => e.kind === "revenue").map((e) => e.amountCents),
      ),
      expenseCents: sumCents(
        entries.filter((e) => e.kind === "expense").map((e) => e.amountCents),
      ),
      appliedFundId,
      funds,
    };
  }

  /* --- Subscription register -------------------------------------- */

  async subscriptionRegister(subject: Subject): Promise<SubscriptionRegister> {
    const readable = ENTITIES.filter((entity) =>
      can({ subject, dataClass: "FINANCIAL", entity, required: "AGGREGATE" }),
    );

    if (readable.length === 0) {
      authorize({
        subject,
        dataClass: "FINANCIAL",
        entity: ENTITIES[0],
        required: "AGGREGATE",
      });
    }

    const readableSet = new Set<Entity>(readable);
    const visible = this.data.subscriptions.filter((s) =>
      s.split.some((part) => readableSet.has(part.entity)),
    );

    const rows: SubscriptionRow[] = visible.map((subscription) => ({
      subscription,
      annualCents: subscriptionAnnualCents(subscription),
      annualByEntity: annualByEntity(subscription),
      findings: bySeverity(subscriptionFindings(subscription, this.data.asOf)),
    }));

    const annualOperatingCost: EntityFigure[] = ENTITIES.map((entity) => {
      if (!readableSet.has(entity)) {
        return {
          entity,
          visible: false,
          withheldReason: `You hold no financial scope on ${entity}.`,
        };
      }
      return {
        entity,
        visible: true,
        amountCents: sumCents(
          rows.flatMap((row) =>
            row.annualByEntity.filter((p) => p.entity === entity).map((p) => p.amountCents),
          ),
        ),
      };
    });

    assertUnblended(annualOperatingCost, "subscriptionRegister.annualOperatingCost");

    return {
      rows,
      annualOperatingCost,
      findings: bySeverity(rows.flatMap((r) => r.findings)),
      withheldRowCount: this.data.subscriptions.length - visible.length,
    };
  }

  /* --- Transfers --------------------------------------------------- */

  /**
   * A transfer is one transaction sitting on two ledgers. A treasurer of
   * either side is a party to it and must be able to see it, otherwise the
   * approval they are required to give is one they cannot read first.
   *
   * Seeing a transfer discloses that transfer's amount, not the other entity's
   * position, so READ on either side is the right gate. A subject with scope
   * on neither entity sees nothing.
   */
  async transfers(subject: Subject): Promise<Transfer[]> {
    const readable = new Set(
      ENTITIES.filter((entity) =>
        can({ subject, dataClass: "FINANCIAL", entity, required: "READ" }),
      ),
    );
    if (readable.size === 0) {
      throw new TreasuryError(
        `${subject.personId} holds no row-level financial scope on either entity, ` +
          `so no inter-entity transfer is visible.`,
        "NOT_APPROVABLE",
      );
    }
    return this.data.transfers
      .filter((t) => readable.has(t.fromEntity) || readable.has(t.toEntity))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async transfer(subject: Subject, id: string): Promise<Transfer | null> {
    return (await this.transfers(subject)).find((t) => t.id === id) ?? null;
  }

  async saveTransfer(subject: Subject, transfer: Transfer): Promise<Transfer> {
    authorize({
      subject,
      dataClass: "FINANCIAL",
      entity: transfer.fromEntity,
      required: "WRITE",
    });
    return transfer;
  }

  /* --- Separation of duties --------------------------------------- */

  async separationOfDuties(subject: Subject): Promise<SodPanel> {
    return separationOfDutiesPanel(subject);
  }

  /* --- Reimbursements --------------------------------------------- */

  async reimbursementQueues(subject: Subject): Promise<ReimbursementQueue[]> {
    return ENTITIES.map((entity) => {
      if (!can({ subject, dataClass: "FINANCIAL", entity, required: "READ" })) {
        return {
          entity,
          visible: false,
          withheldReason:
            `You hold no row-level financial scope on ${entity}, so its ` +
            `reimbursement queue is withheld.`,
        };
      }
      return {
        entity,
        visible: true,
        claims: this.data.reimbursements
          .filter((r) => r.entity === entity)
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
    });
  }

  async reimbursement(subject: Subject, id: string): Promise<Reimbursement | null> {
    const claim = this.data.reimbursements.find((r) => r.id === id);
    if (!claim) return null;
    authorize({
      subject,
      dataClass: "FINANCIAL",
      entity: claim.entity,
      required: "READ",
      rowLevel: true,
    });
    return claim;
  }

  async saveReimbursement(
    subject: Subject,
    reimbursement: Reimbursement,
  ): Promise<Reimbursement> {
    authorize({
      subject,
      dataClass: "FINANCIAL",
      entity: reimbursement.entity,
      required: "WRITE",
    });
    return reimbursement;
  }
}

function sortSod(findings: SodFinding[]): SodFinding[] {
  const order = { critical: 0, high: 1, moderate: 2 } as const;
  return [...findings].sort(
    (a, b) => order[a.severity] - order[b.severity] || a.personId.localeCompare(b.personId),
  );
}

/**
 * Which implementation this process is holding.
 *
 * D1 where there is a binding, the in-memory one where there is not. No
 * binding is a normal state: `next dev` with no Worker behind it, a build, and
 * the test runner are all cases of it.
 *
 * The D1 implementation loads with `import()` rather than at the top of this
 * file, which keeps it and everything it pulls in out of the module graph on
 * the path with no database — the path a build and the test suite both take.
 * `database()` is a static import: answering whether there is a binding is the
 * shared layer's job, and it returns null rather than throwing when there is
 * no request context.
 */
let instance: InMemoryTreasuryRepository | null = null;

export async function treasuryRepository(): Promise<TreasuryRepository> {
  if (database()) {
    const { createD1TreasuryRepository } = await import("./repository.d1");
    return createD1TreasuryRepository();
  }
  if (!instance) instance = new InMemoryTreasuryRepository();
  return instance;
}
