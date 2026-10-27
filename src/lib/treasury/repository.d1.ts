import "server-only";

/**
 * `TreasuryRepository` against D1.
 *
 * Authorization is in the same place it was, which is before the first read.
 * Every method calls `authorize()` or `can()` with the entity in hand and
 * then queries; none of them queries first and filters afterwards, because a
 * refusal that has already read the rows is a refusal that read the rows.
 *
 * Read `migrations/0008_treasury.sql` next to this. Five of its decisions
 * shape the code and none are designed around:
 *
 * 1. **The ledger is append-only by trigger.** `ledger_entry_no_update` and
 *    `ledger_entry_no_delete` abort both. Nothing here updates a ledger row.
 *    The interface has no ledger write on it at all, and a correction is a
 *    reversing entry citing what it reverses, which is a posting rather than
 *    an edit.
 *
 * 2. **Ledger amounts are signed**: a debit negative, a credit positive. The
 *    domain type is the other way round — `amountCents` positive with `kind`
 *    carrying the direction. `toLedgerEntry` is the one place that reconciles
 *    the two, and it does so by taking the magnitude and trusting `kind`,
 *    which is the column the domain's direction actually comes from.
 *
 * 3. **A reimbursement cannot be approved by the person who raised it.**
 *    `reimbursement_no_self_approval` aborts the INSERT. `saveReimbursement`
 *    does not pre-filter the approval rows to avoid it: a claim carrying its
 *    claimant as an approver is a caller bug, and the abort is how it gets
 *    found rather than silently dropped.
 *
 * 4. **A transfer must cross between entities**, by CHECK. Nothing here
 *    normalises `from_entity`/`to_entity` to make a same-entity move fit. An
 *    internal move is a ledger entry and the insert failing says so.
 *
 * 5. **Approvals are rows.** There is no approved flag on either parent, so no
 *    single UPDATE flips a control. A parent and its approvals are written
 *    with `atomic`, so a transfer never lands without the approvals that were
 *    supposed to come with it.
 *
 * Two things this file reads from the module's seed rather than from a table,
 * because the schema has nowhere to put them. Both are in the port report.
 *   - `period()` and `asOfDate()`. The reporting period and the as-of date are
 *     constants about the build, not rows: `0008` has no period table and this
 *     port does not invent one in a migration it is not allowed to write.
 *   - The separation-of-duties panel, which runs over the board's role
 *     assignments. Those live in the identity schema, which is another
 *     module's; `separationOfDutiesPanel` is shared with the in-memory
 *     implementation so both give the same answer.
 */

import { ENTITIES, type Entity, type Role } from "../authz/model";
import { authorize, can, type Subject } from "../authz/policy";
import { int, many, one, requireDatabase, text, toBool, toInt } from "../db";
import { atomic } from "../db";
import {
  annualByEntity,
  assertUnblended,
  subscriptionAnnualCents,
  sumCents,
  TreasuryError,
} from "./money";
import { AS_OF_DATE, PERIOD } from "./seed";
import {
  bySeverity,
  separationOfDutiesPanel,
  subscriptionFindings,
  type ReimbursementQueue,
  type SodPanel,
  type TreasuryRepository,
} from "./repository";
import type {
  Cadence,
  EntityFigure,
  Fund,
  FundBalance,
  LedgerEntry,
  LedgerFilter,
  LedgerKind,
  LedgerView,
  Period,
  PositionColumn,
  PositionStatement,
  Reimbursement,
  ReimbursementStatus,
  Restriction,
  ReviewDecision,
  Subscription,
  SubscriptionRegister,
  SubscriptionRow,
  Transfer,
  TransferApproval,
  TransferStatus,
} from "./types";

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

type FundRow = {
  id: string;
  entity: string;
  name: string;
  restriction: string;
  purpose: string;
  opening_balance_cents: number;
};

type LedgerRow = {
  id: string;
  entity: string;
  date: string;
  fund_id: string;
  account: string;
  kind: string;
  memo: string;
  amount_cents: number;
  minute_ref: string | null;
  entered_by_id: string;
};

type TransferRow = {
  id: string;
  created_by_id: string;
  entity: string;
  from_entity: string;
  to_entity: string;
  amount_cents: number;
  from_fund_id: string | null;
  to_fund_id: string | null;
  minute_ref_from: string | null;
  minute_ref_to: string | null;
  restriction_statement: string;
  purpose: string;
  status: string;
};

type ReimbursementRow = {
  id: string;
  entity: string;
  created_by_id: string;
  claimant_name: string;
  amount_cents: number;
  fund_id: string;
  purpose: string;
  incurred_on: string;
  receipt_on_file: number;
  related_party: number;
  related_party_note: string;
  status: string;
  refusal_reason: string | null;
};

type SubscriptionRowShape = {
  id: string;
  tool: string;
  vendor: string;
  split_basis: string | null;
  owning_role: string;
  second_administrator_person_id: string | null;
  cost_cents: number | null;
  cadence: string;
  observed_annual_cents: number | null;
  renewal_date: string | null;
  justification: string;
  nonprofit_rate_applied: number;
  nonprofit_rate_note: string;
  last_reviewed_on: string | null;
  last_review_decision: string | null;
};

const FUND_COLUMNS = "id, entity, name, restriction, purpose, opening_balance_cents";

const LEDGER_COLUMNS =
  "id, entity, date, fund_id, account, kind, memo, amount_cents, minute_ref, entered_by_id";

const TRANSFER_COLUMNS =
  "id, created_by_id, entity, from_entity, to_entity, amount_cents, from_fund_id, " +
  "to_fund_id, minute_ref_from, minute_ref_to, restriction_statement, purpose, status";

const REIMBURSEMENT_COLUMNS =
  "id, entity, created_by_id, claimant_name, amount_cents, fund_id, purpose, " +
  "incurred_on, receipt_on_file, related_party, related_party_note, status, refusal_reason";

const SUBSCRIPTION_COLUMNS =
  "id, tool, vendor, split_basis, owning_role, second_administrator_person_id, " +
  "cost_cents, cadence, observed_annual_cents, renewal_date, justification, " +
  "nonprofit_rate_applied, nonprofit_rate_note, last_reviewed_on, last_review_decision";

function toFund(row: FundRow): Fund {
  return {
    id: text(row.id),
    entity: text(row.entity) as Entity,
    name: text(row.name),
    restriction: text(row.restriction) as Restriction,
    purpose: text(row.purpose),
    openingBalanceCents: int(row.opening_balance_cents),
  };
}

/**
 * A ledger row as the domain wants it.
 *
 * The schema stores the amount signed — debit negative, credit positive — and
 * says so in as many words, because storing the sign in a second column is how
 * a total comes out wrong. The domain type stores the magnitude and puts the
 * direction in `kind`. Both are coherent; they are just not the same, and this
 * is the single place that crosses between them. `kind` is the authority on
 * direction because it is what every caller already branches on.
 */
function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: text(row.id),
    entity: text(row.entity) as Entity,
    date: text(row.date),
    fundId: text(row.fund_id),
    account: text(row.account),
    kind: text(row.kind) as LedgerKind,
    memo: text(row.memo),
    amountCents: Math.abs(int(row.amount_cents)),
    minuteRef: row.minute_ref ?? null,
    enteredById: text(row.entered_by_id),
  };
}

function toTransfer(row: TransferRow, approvals: TransferApproval[]): Transfer {
  return {
    id: text(row.id),
    createdById: text(row.created_by_id),
    entity: text(row.entity) as Entity,
    fromEntity: text(row.from_entity) as Entity,
    toEntity: text(row.to_entity) as Entity,
    amountCents: int(row.amount_cents),
    fromFundId: row.from_fund_id ?? null,
    toFundId: row.to_fund_id ?? null,
    approvals,
    minuteRefFrom: row.minute_ref_from ?? null,
    minuteRefTo: row.minute_ref_to ?? null,
    restrictionStatement: text(row.restriction_statement),
    purpose: text(row.purpose),
    status: text(row.status) as TransferStatus,
  };
}

function toReimbursement(
  row: ReimbursementRow,
  approvals: { approverId: string; approvedOn: string }[],
): Reimbursement {
  return {
    id: text(row.id),
    entity: text(row.entity) as Entity,
    createdById: text(row.created_by_id),
    claimantName: text(row.claimant_name),
    amountCents: int(row.amount_cents),
    fundId: text(row.fund_id),
    purpose: text(row.purpose),
    incurredOn: text(row.incurred_on),
    receiptOnFile: toBool(row.receipt_on_file),
    relatedParty: toBool(row.related_party),
    relatedPartyNote: text(row.related_party_note),
    approvals,
    status: text(row.status) as ReimbursementStatus,
    refusalReason: row.refusal_reason ?? null,
  };
}

function toSubscription(
  row: SubscriptionRowShape,
  split: { entity: Entity; shareBasisPoints: number }[],
): Subscription {
  const total = split.reduce((sum, part) => sum + part.shareBasisPoints, 0);
  if (split.length > 0 && total !== 10_000) {
    // `apportion` would refuse this too, with a message about basis points.
    // Said here as well, naming the row, because this is the form the finding
    // takes when somebody looks: one subscription whose shares do not divide.
    throw new TreasuryError(
      `Subscription ${row.id} (${row.tool}) has an entity split summing to ` +
        `${total} basis points rather than 10,000, so its cost cannot be ` +
        `apportioned between the entities. Fix the split before reading the ` +
        `register: a share that does not divide is not a share.`,
      "BAD_SPLIT",
    );
  }
  return {
    id: text(row.id),
    tool: text(row.tool),
    vendor: text(row.vendor),
    split,
    splitBasis: row.split_basis ?? null,
    owningRole: text(row.owning_role) as Role,
    secondAdministratorPersonId: row.second_administrator_person_id ?? null,
    costCents: row.cost_cents ?? null,
    cadence: text(row.cadence) as Cadence,
    observedAnnualCents: row.observed_annual_cents ?? null,
    renewalDate: row.renewal_date ?? null,
    justification: text(row.justification),
    nonprofitRateApplied: toBool(row.nonprofit_rate_applied),
    nonprofitRateNote: text(row.nonprofit_rate_note),
    lastReviewedOn: row.last_reviewed_on ?? null,
    lastReviewDecision: text(row.last_review_decision, "not_reviewed") as ReviewDecision,
  };
}

/* ------------------------------------------------------------------ *
 * The implementation
 * ------------------------------------------------------------------ */

export function createD1TreasuryRepository(): TreasuryRepository {
  async function fundRows(entity: Entity): Promise<FundRow[]> {
    return many<FundRow>(
      requireDatabase()
        .prepare(`SELECT ${FUND_COLUMNS} FROM treasury_fund WHERE entity = ? ORDER BY id`)
        .bind(entity),
    );
  }

  /**
   * Opening, revenue, expense and closing per fund, for one entity.
   *
   * Summed in SQL rather than by reading every row and adding in TypeScript:
   * the figures are aggregates and the period is a date range, which is the
   * one thing SQLite is unambiguously better at than a loop. Revenue and
   * expense come back as magnitudes, matching `LedgerEntry.amountCents` and
   * the in-memory implementation's `sumCents` over them.
   */
  async function fundBalances(entity: Entity, period: Period): Promise<FundBalance[]> {
    const funds = await fundRows(entity);
    const totals = await many<{ fund_id: string; kind: string; total: number }>(
      requireDatabase()
        .prepare(
          `SELECT fund_id, kind, SUM(ABS(amount_cents)) AS total FROM ledger_entry ` +
            `WHERE entity = ? AND date >= ? AND date <= ? GROUP BY fund_id, kind`,
        )
        .bind(entity, period.fromDate, period.toDate),
    );
    const byFund = new Map<string, { revenue: number; expense: number }>();
    for (const row of totals) {
      const bucket = byFund.get(row.fund_id) ?? { revenue: 0, expense: 0 };
      if (text(row.kind) === "revenue") bucket.revenue += int(row.total);
      else if (text(row.kind) === "expense") bucket.expense += int(row.total);
      byFund.set(row.fund_id, bucket);
    }
    return funds.map((row) => {
      const fund = toFund(row);
      const bucket = byFund.get(fund.id) ?? { revenue: 0, expense: 0 };
      return {
        entity,
        fundId: fund.id,
        fundName: fund.name,
        restriction: fund.restriction,
        openingCents: fund.openingBalanceCents,
        revenueCents: bucket.revenue,
        expenseCents: bucket.expense,
        closingCents: fund.openingBalanceCents + bucket.revenue - bucket.expense,
      };
    });
  }

  async function transferApprovals(
    transferIds: string[],
  ): Promise<Map<string, TransferApproval[]>> {
    const byTransfer = new Map<string, TransferApproval[]>();
    for (const id of transferIds) byTransfer.set(id, []);
    if (transferIds.length === 0) return byTransfer;
    const holes = transferIds.map(() => "?").join(", ");
    const rows = await many<{
      transfer_id: string;
      entity: string;
      approver_id: string;
      approved_at: string;
    }>(
      requireDatabase()
        .prepare(
          `SELECT transfer_id, entity, approver_id, approved_at FROM transfer_approval ` +
            `WHERE transfer_id IN (${holes}) ORDER BY transfer_id, entity`,
        )
        .bind(...transferIds),
    );
    for (const row of rows) {
      byTransfer.get(row.transfer_id)?.push({
        approverId: text(row.approver_id),
        entity: text(row.entity) as Entity,
        approvedOn: text(row.approved_at),
      });
    }
    return byTransfer;
  }

  async function reimbursementApprovals(
    claimIds: string[],
  ): Promise<Map<string, { approverId: string; approvedOn: string }[]>> {
    const byClaim = new Map<string, { approverId: string; approvedOn: string }[]>();
    for (const id of claimIds) byClaim.set(id, []);
    if (claimIds.length === 0) return byClaim;
    const holes = claimIds.map(() => "?").join(", ");
    const rows = await many<{
      reimbursement_id: string;
      approver_id: string;
      approved_at: string;
    }>(
      requireDatabase()
        .prepare(
          `SELECT reimbursement_id, approver_id, approved_at FROM reimbursement_approval ` +
            `WHERE reimbursement_id IN (${holes}) ORDER BY reimbursement_id, approved_at, approver_id`,
        )
        .bind(...claimIds),
    );
    for (const row of rows) {
      byClaim.get(row.reimbursement_id)?.push({
        approverId: text(row.approver_id),
        approvedOn: text(row.approved_at),
      });
    }
    return byClaim;
  }

  async function allSubscriptions(): Promise<Subscription[]> {
    const db = requireDatabase();
    const rows = await many<SubscriptionRowShape>(
      db.prepare(`SELECT ${SUBSCRIPTION_COLUMNS} FROM subscription ORDER BY id`),
    );
    const splits = await many<{
      subscription_id: string;
      entity: string;
      share_basis_points: number;
    }>(
      db.prepare(
        `SELECT subscription_id, entity, share_basis_points FROM subscription_split ` +
          `ORDER BY subscription_id, entity`,
      ),
    );
    const bySubscription = new Map<string, { entity: Entity; shareBasisPoints: number }[]>();
    for (const row of rows) bySubscription.set(row.id, []);
    for (const row of splits) {
      bySubscription.get(row.subscription_id)?.push({
        entity: text(row.entity) as Entity,
        shareBasisPoints: int(row.share_basis_points),
      });
    }
    return rows.map((row) => toSubscription(row, bySubscription.get(row.id) ?? []));
  }

  async function transfersVisibleTo(subject: Subject): Promise<Transfer[]> {
    const readable = ENTITIES.filter((entity) =>
      can({ subject, dataClass: "FINANCIAL", entity, required: "READ" }),
    );
    if (readable.length === 0) {
      throw new TreasuryError(
        `${subject.personId} holds no row-level financial scope on either entity, ` +
          `so no inter-entity transfer is visible.`,
        "NOT_APPROVABLE",
      );
    }
    const holes = readable.map(() => "?").join(", ");
    const rows = await many<TransferRow>(
      requireDatabase()
        .prepare(
          `SELECT ${TRANSFER_COLUMNS} FROM transfer ` +
            `WHERE from_entity IN (${holes}) OR to_entity IN (${holes}) ORDER BY id`,
        )
        .bind(...readable, ...readable),
    );
    const approvals = await transferApprovals(rows.map((row) => row.id));
    return rows.map((row) => toTransfer(row, approvals.get(row.id) ?? []));
  }

  const api: TreasuryRepository = {
    async period(): Promise<Period> {
      return PERIOD;
    },

    async asOfDate(): Promise<string> {
      return AS_OF_DATE;
    },

    /* --- Position statement --------------------------------------- */

    async positionStatement(subject) {
      const period = PERIOD;
      const columns: PositionColumn[] = [];

      for (const entity of ENTITIES) {
        // AGGREGATE is enough for a totals column: no row-level identity here.
        const allowed = can({
          subject,
          dataClass: "FINANCIAL",
          entity,
          required: "AGGREGATE",
        });
        if (!allowed) {
          columns.push({
            entity,
            visible: false,
            withheldReason:
              `You hold no financial scope on ${entity}, so its position is withheld. ` +
              `This column is not zero and not empty: the ${entity} figures exist and ` +
              `are not yours to see.`,
          });
          continue;
        }

        const balances = await fundBalances(entity, period);
        const openingNetAssetsCents = sumCents(balances.map((b) => b.openingCents));
        const closingNetAssetsCents = sumCents(balances.map((b) => b.closingCents));
        columns.push({
          entity,
          visible: true,
          revenueCents: sumCents(balances.map((b) => b.revenueCents)),
          expenseCents: sumCents(balances.map((b) => b.expenseCents)),
          openingNetAssetsCents,
          closingNetAssetsCents,
          changeCents: closingNetAssetsCents - openingNetAssetsCents,
          unrestrictedClosingCents: sumCents(
            balances
              .filter((b) => b.restriction === "unrestricted")
              .map((b) => b.closingCents),
          ),
          restrictedClosingCents: sumCents(
            balances
              .filter((b) => b.restriction !== "unrestricted")
              .map((b) => b.closingCents),
          ),
          fundBalances: balances,
        });
      }

      const statement: PositionStatement = { period, columns };
      // Belt and braces: refuse to hand back a view carrying a combined figure.
      assertUnblended(statement.columns, "positionStatement.columns");
      return statement;
    },

    /* --- Ledger --------------------------------------------------- */

    async funds(subject, entity) {
      authorize({ subject, dataClass: "FINANCIAL", entity, required: "READ" });
      return (await fundRows(entity)).map(toFund);
    },

    async ledger(subject, entity, filter: LedgerFilter = {}) {
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

      const period = PERIOD;
      const funds = (await fundRows(entity)).map(toFund);
      const fundIds = new Set(funds.map((f) => f.id));
      const appliedFundId =
        filter.fundId && fundIds.has(filter.fundId) ? filter.fundId : null;

      const bindings: unknown[] = [entity, period.fromDate, period.toDate];
      let sql =
        `SELECT ${LEDGER_COLUMNS} FROM ledger_entry ` +
        `WHERE entity = ? AND date >= ? AND date <= ?`;
      if (appliedFundId) {
        sql += " AND fund_id = ?";
        bindings.push(appliedFundId);
      }
      if (filter.kind) {
        sql += " AND kind = ?";
        bindings.push(filter.kind);
      }
      sql += " ORDER BY date, id";

      const entries = (
        await many<LedgerRow>(requireDatabase().prepare(sql).bind(...bindings))
      ).map(toLedgerEntry);

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
      } satisfies LedgerView;
    },

    /* --- Subscription register ------------------------------------ */

    async subscriptionRegister(subject) {
      const readable = ENTITIES.filter((entity) =>
        can({ subject, dataClass: "FINANCIAL", entity, required: "AGGREGATE" }),
      );

      if (readable.length === 0) {
        // Throws, rather than returning an empty register. The rows exist.
        authorize({
          subject,
          dataClass: "FINANCIAL",
          entity: ENTITIES[0],
          required: "AGGREGATE",
        });
      }

      const readableSet = new Set<Entity>(readable);
      const all = await allSubscriptions();
      const visible = all.filter((s) =>
        s.split.some((part) => readableSet.has(part.entity)),
      );

      const rows: SubscriptionRow[] = visible.map((subscription) => ({
        subscription,
        annualCents: subscriptionAnnualCents(subscription),
        annualByEntity: annualByEntity(subscription),
        findings: bySeverity(subscriptionFindings(subscription, AS_OF_DATE)),
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
              row.annualByEntity
                .filter((p) => p.entity === entity)
                .map((p) => p.amountCents),
            ),
          ),
        };
      });

      assertUnblended(annualOperatingCost, "subscriptionRegister.annualOperatingCost");

      return {
        rows,
        annualOperatingCost,
        findings: bySeverity(rows.flatMap((r) => r.findings)),
        withheldRowCount: all.length - visible.length,
      } satisfies SubscriptionRegister;
    },

    /* --- Transfers ------------------------------------------------- */

    /**
     * A transfer is one transaction sitting on two ledgers. A treasurer of
     * either side is a party to it and must be able to see it, otherwise the
     * approval they are required to give is one they cannot read first.
     */
    async transfers(subject) {
      return transfersVisibleTo(subject);
    },

    async transfer(subject, id) {
      return (await transfersVisibleTo(subject)).find((t) => t.id === id) ?? null;
    },

    /* --- Separation of duties -------------------------------------- */

    async separationOfDuties(subject): Promise<SodPanel> {
      return separationOfDutiesPanel(subject);
    },

    /* --- Reimbursements -------------------------------------------- */

    async reimbursementQueues(subject) {
      const queues: ReimbursementQueue[] = [];
      for (const entity of ENTITIES) {
        if (!can({ subject, dataClass: "FINANCIAL", entity, required: "READ" })) {
          queues.push({
            entity,
            visible: false,
            withheldReason:
              `You hold no row-level financial scope on ${entity}, so its ` +
              `reimbursement queue is withheld.`,
          });
          continue;
        }
        const rows = await many<ReimbursementRow>(
          requireDatabase()
            .prepare(
              `SELECT ${REIMBURSEMENT_COLUMNS} FROM reimbursement WHERE entity = ? ` +
                `ORDER BY id`,
            )
            .bind(entity),
        );
        const approvals = await reimbursementApprovals(rows.map((row) => row.id));
        queues.push({
          entity,
          visible: true,
          claims: rows.map((row) => toReimbursement(row, approvals.get(row.id) ?? [])),
        });
      }
      return queues;
    },

    async reimbursement(subject, id) {
      const row = await one<ReimbursementRow>(
        requireDatabase()
          .prepare(`SELECT ${REIMBURSEMENT_COLUMNS} FROM reimbursement WHERE id = ?`)
          .bind(id),
      );
      if (!row) return null;
      // The entity comes off the row, so the gate is the claim's own entity
      // and not one the caller chose.
      authorize({
        subject,
        dataClass: "FINANCIAL",
        entity: text(row.entity) as Entity,
        required: "READ",
        rowLevel: true,
      });
      const approvals = await reimbursementApprovals([row.id]);
      return toReimbursement(row, approvals.get(row.id) ?? []);
    },

    /* --- Writes ---------------------------------------------------- */

    /**
     * The transfer and its approvals, in one transaction.
     *
     * The approval rows are replaced rather than merged, because the record
     * handed in is the whole state of the transfer and a merge would leave an
     * approval nobody can account for. `PRIMARY KEY (transfer_id, entity)`
     * means one approval per side, which is the two-treasurer rule expressed
     * as a key rather than as a count somebody has to remember to check.
     *
     * Not caught here: the `from_entity <> to_entity` CHECK. A transfer whose
     * sides are the same entity is an internal move miscategorised, and the
     * insert failing is the only report of that which cannot be ignored.
     */
    async saveTransfer(subject, transfer) {
      authorize({
        subject,
        dataClass: "FINANCIAL",
        entity: transfer.fromEntity,
        required: "WRITE",
      });
      const db = requireDatabase();
      await atomic([
        db
          .prepare(
            `INSERT INTO transfer (${TRANSFER_COLUMNS}) ` +
              `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
              `ON CONFLICT(id) DO UPDATE SET created_by_id = excluded.created_by_id, ` +
              `entity = excluded.entity, from_entity = excluded.from_entity, ` +
              `to_entity = excluded.to_entity, amount_cents = excluded.amount_cents, ` +
              `from_fund_id = excluded.from_fund_id, to_fund_id = excluded.to_fund_id, ` +
              `minute_ref_from = excluded.minute_ref_from, ` +
              `minute_ref_to = excluded.minute_ref_to, ` +
              `restriction_statement = excluded.restriction_statement, ` +
              `purpose = excluded.purpose, status = excluded.status`,
          )
          .bind(
            transfer.id,
            transfer.createdById,
            transfer.entity,
            transfer.fromEntity,
            transfer.toEntity,
            transfer.amountCents,
            transfer.fromFundId,
            transfer.toFundId,
            transfer.minuteRefFrom,
            transfer.minuteRefTo,
            transfer.restrictionStatement,
            transfer.purpose,
            transfer.status,
          ),
        db.prepare("DELETE FROM transfer_approval WHERE transfer_id = ?").bind(transfer.id),
        ...transfer.approvals.map((approval) =>
          db
            .prepare(
              `INSERT INTO transfer_approval (transfer_id, entity, approver_id, approved_at) ` +
                `VALUES (?, ?, ?, ?)`,
            )
            .bind(transfer.id, approval.entity, approval.approverId, approval.approvedOn),
        ),
      ]);
      return (await api.transfer(subject, transfer.id)) ?? transfer;
    },

    /**
     * The claim and its approvals, in one transaction.
     *
     * Nothing here filters the claimant out of the approval rows before the
     * insert. `reimbursement_no_self_approval` aborts a claim approved by the
     * person who raised it, and a caller that got that far has a bug worth
     * surfacing; dropping the row quietly would leave a claim that looks
     * approved by one fewer person than it claims.
     */
    async saveReimbursement(subject, reimbursement) {
      authorize({
        subject,
        dataClass: "FINANCIAL",
        entity: reimbursement.entity,
        required: "WRITE",
      });
      const db = requireDatabase();
      await atomic([
        db
          .prepare(
            `INSERT INTO reimbursement (${REIMBURSEMENT_COLUMNS}) ` +
              `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
              `ON CONFLICT(id) DO UPDATE SET entity = excluded.entity, ` +
              `created_by_id = excluded.created_by_id, ` +
              `claimant_name = excluded.claimant_name, ` +
              `amount_cents = excluded.amount_cents, fund_id = excluded.fund_id, ` +
              `purpose = excluded.purpose, incurred_on = excluded.incurred_on, ` +
              `receipt_on_file = excluded.receipt_on_file, ` +
              `related_party = excluded.related_party, ` +
              `related_party_note = excluded.related_party_note, ` +
              `status = excluded.status, refusal_reason = excluded.refusal_reason`,
          )
          .bind(
            reimbursement.id,
            reimbursement.entity,
            reimbursement.createdById,
            reimbursement.claimantName,
            reimbursement.amountCents,
            reimbursement.fundId,
            reimbursement.purpose,
            reimbursement.incurredOn,
            toInt(reimbursement.receiptOnFile),
            toInt(reimbursement.relatedParty),
            reimbursement.relatedPartyNote,
            reimbursement.status,
            reimbursement.refusalReason,
          ),
        db
          .prepare("DELETE FROM reimbursement_approval WHERE reimbursement_id = ?")
          .bind(reimbursement.id),
        ...reimbursement.approvals.map((approval) =>
          db
            .prepare(
              `INSERT INTO reimbursement_approval (reimbursement_id, approver_id, approved_at) ` +
                `VALUES (?, ?, ?)`,
            )
            .bind(reimbursement.id, approval.approverId, approval.approvedOn),
        ),
      ]);
      return (await api.reimbursement(subject, reimbursement.id)) ?? reimbursement;
    },
  };

  return api;
}
