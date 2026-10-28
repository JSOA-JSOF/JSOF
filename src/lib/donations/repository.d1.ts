/**
 * `DonationsRepository` against Cloudflare D1.
 *
 * Same interface, same refusals, same messages. Nothing here authorizes
 * anything: every caller still goes through actions.ts, which calls
 * `authorize()` first.
 *
 * ## What this file deliberately does not do
 *
 * **It does not work around the entity trigger.** `migrations/0006_donations.sql`
 * carries `allocation_entity_must_match`, which aborts an insert of an
 * allocation pointing at the other entity's fund. That confusion — which
 * entity owns which programme — is what the board review found running through
 * the public site, so when the trigger fires it is this code that is wrong.
 * The error is allowed out. There is no catch, no retry, and no "allocate it
 * to the general fund instead".
 *
 * `validateAllocations` rejects the same mistake earlier and with a sentence a
 * person can act on, so in practice the trigger is a backstop. A backstop that
 * is never reached is the point of it.
 *
 * **It does not guess a fair market value.** A gift carrying benefits with no
 * valuation cannot produce a lawful receipt, so the write is refused with the
 * same message the in-memory implementation uses.
 *
 * **It does not generate an acknowledgment string.** `approved_acknowledgment`
 * is stored wording that the board approved; one adjective turns an
 * acknowledgment into advertising and converts the whole payment. It is read
 * and written verbatim.
 *
 * **It does not read then increment a receipt number.** `nextReceiptSequence`
 * goes through `nextInSequence`, which allocates in one statement. Two donors
 * holding the same receipt number is the failure that prevents.
 *
 * ## Writes that span tables
 *
 * A donation, its allocations and its benefits go through `atomic`, which is
 * one D1 batch and therefore one transaction. The alternative leaves a gift
 * with no allocations in the ledger when the second call fails, and nothing
 * ever tells you.
 */

import type { Entity } from "../authz/model";
import {
  atomic,
  int,
  many,
  newId,
  nextInSequence,
  one,
  orNull,
  text,
  toBool,
  toInt,
} from "../db";
import { validateAllocations } from "./allocation";
import { CURRENCY, type Currency } from "./money";
import {
  BENEFITS_WITHOUT_FMV_MESSAGE,
  RepositoryError,
  assertApprovable,
  assertSubmittableForRelease,
  normaliseFundDraft,
  normaliseSponsorshipDraft,
  type DonationsRepository,
  type FundDraft,
  type GiftBehindFund,
  type PlacementDraft,
  type SponsorshipDraft,
} from "./repository";
import type {
  Allocation,
  BenefitKind,
  Donation,
  DonationIntent,
  DonationStatus,
  Fund,
  FundBalance,
  FundRestriction,
  GiftBenefit,
  PlacementKind,
  PlacementPublicationState,
  SponsorPlacement,
  Sponsorship,
} from "./types";

/* ------------------------------------------------------------------ *
 * Row shapes
 *
 * One type per table, named as the columns are named. The mapping to the
 * domain happens in one place per table and nowhere else, so a column rename
 * breaks in a spot a reviewer can find.
 * ------------------------------------------------------------------ */

type FundRow = {
  id: string;
  entity: string;
  name: string;
  restriction: string;
  purpose: string;
  currency: string;
  open_to_gifts: number;
};

type DonationRow = {
  id: string;
  entity: string;
  donor_display_name: string;
  donor_email: string;
  amount_cents: number;
  currency: string;
  benefit_fmv_cents: number | null;
  sponsorship_id: string | null;
  status: string;
  received_at: string;
  checkout_session_ref: string | null;
  created_by_id: string;
};

type AllocationRow = {
  donation_id: string;
  fund_id: string;
  amount_cents: number;
};

type BenefitRow = {
  donation_id: string;
  line_no: number;
  kind: string;
  description: string;
  quantity: number;
  unit_fmv_cents: number;
};

type SponsorshipRow = {
  id: string;
  entity: string;
  sponsor_name: string;
  event_name: string;
  tier: string;
  payment_cents: number;
  currency: string;
  contingent_on_attendance: number;
  exclusivity: string;
  received_at: string;
  created_by_id: string;
};

type PlacementRow = {
  id: string;
  sponsorship_id: string;
  entity: string;
  kind: string;
  approved_acknowledgment: string;
  benefit_fmv_cents: number;
  publication_state: string;
  authored_by_id: string;
  approved_by_id: string | null;
  notes: string;
};

type BalanceRow = {
  fund_id: string;
  entity: string;
  name: string;
  restriction: string;
  balance_cents: number;
  gift_count: number;
};

type GiftBehindFundRow = {
  donation_id: string;
  donor_display_name: string;
  received_at: string;
  amount_cents: number;
  status: string;
};

/* ------------------------------------------------------------------ *
 * Column values that the domain types constrain
 *
 * The schema has a CHECK on some of these and not on others. Where the domain
 * type is narrower than the column, the value is checked on the way out
 * rather than cast: a row that does not fit the type is a bug somewhere
 * upstream, and casting it would hide the bug behind a screen that renders
 * nonsense.
 * ------------------------------------------------------------------ */

function entityOf(value: unknown, where: string): Entity {
  const entity = text(value);
  if (entity !== "JSOA" && entity !== "JSOF") {
    throw new Error(`${where}: entity is "${entity}", which is neither JSOA nor JSOF`);
  }
  return entity;
}

function currencyOf(value: unknown, where: string): Currency {
  const currency = text(value);
  if (currency !== CURRENCY) {
    throw new Error(
      `${where}: currency is "${currency}". This module holds ${CURRENCY} only, ` +
        "and converting a stored figure here would be inventing an exchange rate.",
    );
  }
  return currency;
}

function restrictionOf(value: unknown, where: string): FundRestriction {
  const restriction = text(value);
  if (restriction !== "RESTRICTED" && restriction !== "UNRESTRICTED") {
    throw new Error(`${where}: restriction is "${restriction}"`);
  }
  return restriction;
}

/* `donation.status` carries no CHECK in the schema, so it is checked here. */
const STATUSES = new Set<string>([
  "INTENT",
  "AWAITING_PAYMENT",
  "PAID",
  "ABANDONED",
  "REFUNDED",
]);

function statusOf(value: unknown, where: string): DonationStatus {
  const status = text(value);
  if (!STATUSES.has(status)) throw new Error(`${where}: status is "${status}"`);
  return status as DonationStatus;
}

const BENEFIT_KINDS_SET = new Set<string>([
  "EVENT_TICKET",
  "TOURNAMENT_ENTRY",
  "BANQUET_SEAT",
  "MERCHANDISE",
  "OTHER",
]);

function benefitKindOf(value: unknown, where: string): BenefitKind {
  const kind = text(value);
  if (!BENEFIT_KINDS_SET.has(kind)) throw new Error(`${where}: benefit kind is "${kind}"`);
  return kind as BenefitKind;
}

const PLACEMENT_KINDS_SET = new Set<string>([
  "WEBSITE_FOOTER",
  "EVENT_TSHIRT",
  "SIGNAGE",
  "PROGRAMME_AD",
  "NEWSLETTER_AD",
]);

function placementKindOf(value: unknown, where: string): PlacementKind {
  const kind = text(value);
  if (!PLACEMENT_KINDS_SET.has(kind)) {
    throw new Error(`${where}: placement kind is "${kind}"`);
  }
  return kind as PlacementKind;
}

const PUBLICATION_STATES = new Set<string>(["DRAFT", "AWAITING_RELEASE", "APPROVED"]);

function publicationStateOf(value: unknown, where: string): PlacementPublicationState {
  const state = text(value);
  if (!PUBLICATION_STATES.has(state)) {
    throw new Error(`${where}: publication state is "${state}"`);
  }
  return state as PlacementPublicationState;
}

/* ------------------------------------------------------------------ *
 * Row to domain
 * ------------------------------------------------------------------ */

function toFund(row: FundRow): Fund {
  return {
    id: text(row.id),
    entity: entityOf(row.entity, `fund ${row.id}`),
    name: text(row.name),
    restriction: restrictionOf(row.restriction, `fund ${row.id}`),
    purpose: text(row.purpose),
    currency: currencyOf(row.currency, `fund ${row.id}`),
    openToGifts: toBool(row.open_to_gifts),
  };
}

function toAllocation(row: AllocationRow): Allocation {
  return { fundId: text(row.fund_id), amountCents: int(row.amount_cents) };
}

function toBenefit(row: BenefitRow): GiftBenefit {
  return {
    kind: benefitKindOf(row.kind, `benefit on gift ${row.donation_id}`),
    description: text(row.description),
    quantity: int(row.quantity),
    unitFairMarketValueCents: int(row.unit_fmv_cents),
  };
}

function toDonation(
  row: DonationRow,
  allocations: Allocation[],
  benefits: GiftBenefit[],
): Donation {
  return {
    id: text(row.id),
    entity: entityOf(row.entity, `gift ${row.id}`),
    donorDisplayName: text(row.donor_display_name),
    donorEmail: text(row.donor_email),
    amountCents: int(row.amount_cents),
    currency: currencyOf(row.currency, `gift ${row.id}`),
    allocations,
    benefits,
    // Null is a real state and the one the receipt code refuses on, so it is
    // never defaulted to zero.
    benefitFairMarketValueCents: orNull(row.benefit_fmv_cents),
    sponsorshipId: orNull(row.sponsorship_id),
    status: statusOf(row.status, `gift ${row.id}`),
    receivedAt: text(row.received_at),
    checkoutSessionRef: orNull(row.checkout_session_ref),
    createdById: text(row.created_by_id),
  };
}

function toPlacement(row: PlacementRow): SponsorPlacement {
  return {
    id: text(row.id),
    sponsorshipId: text(row.sponsorship_id),
    entity: entityOf(row.entity, `placement ${row.id}`),
    kind: placementKindOf(row.kind, `placement ${row.id}`),
    // Verbatim. The board approved this string, so it is never rebuilt from
    // parts and never normalised.
    approvedAcknowledgmentString: text(row.approved_acknowledgment),
    benefitFairMarketValueCents: int(row.benefit_fmv_cents),
    publicationState: publicationStateOf(row.publication_state, `placement ${row.id}`),
    approvedById: orNull(row.approved_by_id),
    authoredById: text(row.authored_by_id),
    notes: text(row.notes),
  };
}

function toSponsorship(row: SponsorshipRow, placements: SponsorPlacement[]): Sponsorship {
  if (toBool(row.contingent_on_attendance)) {
    // The column has a CHECK permitting only 0, so reaching this means the
    // check was dropped. A fee tied to attendance or impressions is not a
    // sponsorship payment at all, and the domain type cannot express one, so
    // this refuses rather than coercing the flag to false.
    throw new Error(
      `sponsorship ${row.id} is recorded as contingent on attendance or ` +
        "impressions. That is not a qualified sponsorship payment, and this " +
        "record cannot be read as one.",
    );
  }
  const exclusivity = text(row.exclusivity);
  if (exclusivity !== "NONE" && exclusivity !== "EXCLUSIVE_SPONSOR") {
    throw new Error(
      `sponsorship ${row.id}: exclusivity is "${exclusivity}". Exclusive sponsor ` +
        "is acceptable; exclusive provider is advertising and is not a value here.",
    );
  }
  return {
    id: text(row.id),
    entity: entityOf(row.entity, `sponsorship ${row.id}`),
    sponsorName: text(row.sponsor_name),
    eventName: text(row.event_name),
    tier: text(row.tier),
    paymentCents: int(row.payment_cents),
    currency: currencyOf(row.currency, `sponsorship ${row.id}`),
    contingentOnAttendanceOrImpressions: false,
    exclusivity,
    placements,
    receivedAt: text(row.received_at),
    createdById: text(row.created_by_id),
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(key(row));
    if (existing) existing.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
}

/* ------------------------------------------------------------------ */

export class D1DonationsRepository implements DonationsRepository {
  constructor(private readonly db: D1Database) {}

  /* Funds ---------------------------------------------------------- */

  /**
   * One entity's funds.
   *
   * Unrestricted first, then by name. The public donate form seeds the first
   * fund with the whole gift, and the general fund is the right default for a
   * donor who does not want to choose a restriction.
   */
  async listFunds(entity: Entity): Promise<Fund[]> {
    const rows = await many<FundRow>(
      this.db
        .prepare(
          "SELECT id, entity, name, restriction, purpose, currency, open_to_gifts " +
            "FROM fund WHERE entity = ? " +
            "ORDER BY CASE restriction WHEN 'UNRESTRICTED' THEN 0 ELSE 1 END, name",
        )
        .bind(entity),
    );
    return rows.map(toFund);
  }

  async getFund(fundId: string): Promise<Fund | undefined> {
    const row = await one<FundRow>(
      this.db
        .prepare(
          "SELECT id, entity, name, restriction, purpose, currency, open_to_gifts " +
            "FROM fund WHERE id = ?",
        )
        .bind(fundId),
    );
    return row ? toFund(row) : undefined;
  }

  /**
   * Creates a fund, or edits one.
   *
   * `open_to_gifts` is the one boolean this interface now writes, so `toInt`
   * is used rather than binding a JavaScript boolean: D1 refuses a boolean
   * bind, and the test double refuses it too, on purpose.
   *
   * An edit does not touch `entity`, and `normaliseFundDraft` refuses a draft
   * that tries to change it. A fund that moved entity would re-home every
   * gift already allocated to it, and the allocation trigger would then abort
   * writes against a fund that had been legal when the gift was taken.
   */
  async saveFund(draft: FundDraft): Promise<Fund> {
    const existing = draft.id ? await this.getFund(draft.id) : undefined;
    if (draft.id && !existing) {
      throw new RepositoryError(`No fund ${draft.id}`, "NOT_FOUND");
    }
    const { name, purpose } = normaliseFundDraft(draft, existing);

    if (existing) {
      await this.db
        .prepare(
          "UPDATE fund SET name = ?, restriction = ?, purpose = ?, " +
            "  open_to_gifts = ? WHERE id = ?",
        )
        .bind(name, draft.restriction, purpose, toInt(draft.openToGifts), existing.id)
        .run();
      const saved = await this.getFund(existing.id);
      if (!saved) throw new RepositoryError(`No fund ${existing.id}`, "NOT_FOUND");
      return saved;
    }

    const id = draft.id ?? newId();
    await this.db
      .prepare(
        "INSERT INTO fund (id, entity, name, restriction, purpose, currency, " +
          "  open_to_gifts) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        draft.entity,
        name,
        draft.restriction,
        purpose,
        CURRENCY,
        toInt(draft.openToGifts),
      )
      .run();
    const saved = await this.getFund(id);
    if (!saved) throw new RepositoryError(`No fund ${id}`, "NOT_FOUND");
    return saved;
  }

  /**
   * Balance and gift count per fund, for one entity.
   *
   * Cleared gifts only: a gift awaiting payment is not money, so there is no
   * state in which it shows as a balance. The join is scoped to the entity on
   * both sides, which is belt and braces against the thing the trigger
   * already refuses.
   */
  async fundBalances(entity: Entity): Promise<FundBalance[]> {
    const rows = await many<BalanceRow>(
      this.db
        .prepare(
          "SELECT f.id AS fund_id, f.entity AS entity, f.name AS name, " +
            "  f.restriction AS restriction, " +
            "  COALESCE(SUM(paid.amount_cents), 0) AS balance_cents, " +
            "  COUNT(paid.donation_id) AS gift_count " +
            "FROM fund f " +
            "LEFT JOIN ( " +
            "  SELECT a.fund_id, a.donation_id, a.amount_cents " +
            "  FROM donation_allocation a " +
            "  JOIN donation d ON d.id = a.donation_id " +
            "  WHERE d.status = 'PAID' AND d.entity = ? " +
            ") paid ON paid.fund_id = f.id " +
            "WHERE f.entity = ? " +
            "GROUP BY f.id, f.entity, f.name, f.restriction " +
            "ORDER BY CASE f.restriction WHEN 'UNRESTRICTED' THEN 0 ELSE 1 END, f.name",
        )
        .bind(entity, entity),
    );
    return rows.map((row) => ({
      fundId: text(row.fund_id),
      entity: entityOf(row.entity, `fund ${row.fund_id}`),
      name: text(row.name),
      restriction: restrictionOf(row.restriction, `fund ${row.fund_id}`),
      balanceCents: int(row.balance_cents),
      giftCount: int(row.gift_count),
    }));
  }

  /**
   * The gifts behind one fund, newest first.
   *
   * Every status, not only PAID: a pledge against a restricted fund is
   * something the Treasurer needs to see sitting there, and the balance above
   * already excludes it.
   */
  async giftsBehindFund(fundId: string): Promise<GiftBehindFund[]> {
    const fund = await this.getFund(fundId);
    if (!fund) throw new RepositoryError(`No fund ${fundId}`, "NOT_FOUND");
    const rows = await many<GiftBehindFundRow>(
      this.db
        .prepare(
          "SELECT d.id AS donation_id, d.donor_display_name AS donor_display_name, " +
            "  d.received_at AS received_at, a.amount_cents AS amount_cents, " +
            "  d.status AS status " +
            "FROM donation_allocation a " +
            "JOIN donation d ON d.id = a.donation_id " +
            "WHERE a.fund_id = ? AND d.entity = ? " +
            "ORDER BY d.received_at DESC",
        )
        .bind(fundId, fund.entity),
    );
    return rows.map((row) => ({
      donationId: text(row.donation_id),
      donorDisplayName: text(row.donor_display_name),
      receivedAt: text(row.received_at),
      amountCents: int(row.amount_cents),
      status: statusOf(row.status, `gift ${row.donation_id}`),
    }));
  }

  /* Gifts ---------------------------------------------------------- */

  async listDonations(entity: Entity): Promise<Donation[]> {
    const rows = await many<DonationRow>(
      this.db
        .prepare(
          "SELECT id, entity, donor_display_name, donor_email, amount_cents, " +
            "  currency, benefit_fmv_cents, sponsorship_id, status, received_at, " +
            "  checkout_session_ref, created_by_id " +
            "FROM donation WHERE entity = ? ORDER BY received_at DESC",
        )
        .bind(entity),
    );
    if (rows.length === 0) return [];

    // Three statements rather than one per gift. The allocations and the
    // benefits are both small per gift and unbounded in number of gifts.
    const [allocationRows, benefitRows] = await Promise.all([
      many<AllocationRow>(
        this.db
          .prepare(
            "SELECT a.donation_id, a.fund_id, a.amount_cents " +
              "FROM donation_allocation a " +
              "JOIN donation d ON d.id = a.donation_id " +
              "WHERE d.entity = ? ORDER BY a.rowid",
          )
          .bind(entity),
      ),
      many<BenefitRow>(
        this.db
          .prepare(
            "SELECT b.donation_id, b.line_no, b.kind, b.description, b.quantity, " +
              "  b.unit_fmv_cents " +
              "FROM donation_benefit b " +
              "JOIN donation d ON d.id = b.donation_id " +
              "WHERE d.entity = ? ORDER BY b.line_no",
          )
          .bind(entity),
      ),
    ]);

    const allocations = groupBy(allocationRows, (row) => text(row.donation_id));
    const benefits = groupBy(benefitRows, (row) => text(row.donation_id));

    return rows.map((row) =>
      toDonation(
        row,
        (allocations.get(text(row.id)) ?? []).map(toAllocation),
        (benefits.get(text(row.id)) ?? []).map(toBenefit),
      ),
    );
  }

  async getDonation(donationId: string): Promise<Donation | undefined> {
    const row = await one<DonationRow>(
      this.db
        .prepare(
          "SELECT id, entity, donor_display_name, donor_email, amount_cents, " +
            "  currency, benefit_fmv_cents, sponsorship_id, status, received_at, " +
            "  checkout_session_ref, created_by_id " +
            "FROM donation WHERE id = ?",
        )
        .bind(donationId),
    );
    if (!row) return undefined;

    const [allocationRows, benefitRows] = await Promise.all([
      many<AllocationRow>(
        this.db
          .prepare(
            "SELECT donation_id, fund_id, amount_cents FROM donation_allocation " +
              "WHERE donation_id = ? ORDER BY rowid",
          )
          .bind(donationId),
      ),
      many<BenefitRow>(
        this.db
          .prepare(
            "SELECT donation_id, line_no, kind, description, quantity, unit_fmv_cents " +
              "FROM donation_benefit WHERE donation_id = ? ORDER BY line_no",
          )
          .bind(donationId),
      ),
    ]);

    return toDonation(
      row,
      allocationRows.map(toAllocation),
      benefitRows.map(toBenefit),
    );
  }

  /**
   * Records a cleared payment: the gift, its allocations and its benefits, in
   * one transaction.
   *
   * The arithmetic is checked before anything is written, because a refusal
   * that names the shortfall in dollars is worth more than a constraint
   * violation. The database still has the last word: the entity trigger fires
   * inside the batch, and if it does, this throws and nothing lands.
   */
  async recordClearedDonation(
    intent: DonationIntent,
    meta: { createdById: string; checkoutSessionRef: string; receivedAt: string },
  ): Promise<Donation> {
    // Every fund the allocations actually name, looked up by id across both
    // entities rather than taken from this entity's list.
    //
    // Scoping the lookup to the gift's own entity makes a cross-entity
    // allocation read as "there is no fund with the reference 40d228b8…",
    // because the other entity's fund simply is not in the list. It is
    // refused either way and nothing is written either way; what changes is
    // whether the Treasurer is told that the fund they picked belongs to the
    // other organization, which is the confusion the board review found
    // running through the whole site.
    const referenced = [...new Set(intent.allocations.map((a) => a.fundId))];
    const resolved = (
      await Promise.all(referenced.map((fundId) => this.getFund(fundId)))
    ).filter((fund): fund is Fund => fund !== undefined);

    const check = validateAllocations({
      entity: intent.entity,
      totalCents: intent.amountCents,
      allocations: intent.allocations,
      funds: resolved,
      allowClosedFunds: true,
    });
    if (!check.ok) {
      throw new RepositoryError(check.message, "ALLOCATIONS_INVALID");
    }
    if (intent.benefits.length > 0 && intent.benefitFairMarketValueCents === null) {
      throw new RepositoryError(
        BENEFITS_WITHOUT_FMV_MESSAGE,
        "BENEFITS_WITHOUT_FMV",
      );
    }

    const id = newId();

    await atomic([
      this.db
        .prepare(
          "INSERT INTO donation (id, entity, donor_display_name, donor_email, " +
            "  amount_cents, currency, benefit_fmv_cents, sponsorship_id, status, " +
            "  received_at, checkout_session_ref, created_by_id) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?, ?)",
        )
        .bind(
          id,
          intent.entity,
          intent.donorDisplayName,
          intent.donorEmail,
          intent.amountCents,
          intent.currency,
          intent.benefitFairMarketValueCents,
          intent.sponsorshipId,
          meta.receivedAt,
          meta.checkoutSessionRef,
          meta.createdById,
        ),
      ...intent.allocations.map((allocation) =>
        this.db
          .prepare(
            "INSERT INTO donation_allocation (donation_id, fund_id, amount_cents) " +
              "VALUES (?, ?, ?)",
          )
          .bind(id, allocation.fundId, allocation.amountCents),
      ),
      ...intent.benefits.map((benefit, index) =>
        this.db
          .prepare(
            "INSERT INTO donation_benefit (donation_id, line_no, kind, description, " +
              "  quantity, unit_fmv_cents) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            id,
            index + 1,
            benefit.kind,
            benefit.description,
            benefit.quantity,
            benefit.unitFairMarketValueCents,
          ),
      ),
    ]);

    const written = await this.getDonation(id);
    if (!written) {
      throw new RepositoryError(
        `Gift ${id} was written and cannot be read back`,
        "NOT_FOUND",
      );
    }
    return written;
  }

  async setDonationBenefitFairMarketValue(
    donationId: string,
    cents: number,
  ): Promise<Donation> {
    await this.db
      .prepare("UPDATE donation SET benefit_fmv_cents = ? WHERE id = ?")
      .bind(cents, donationId)
      .run();
    const donation = await this.getDonation(donationId);
    if (!donation) throw new RepositoryError(`No gift ${donationId}`, "NOT_FOUND");
    return donation;
  }

  /**
   * The next receipt number for one entity.
   *
   * One counter per entity, allocated in a single statement by
   * `nextInSequence`. The entities never share a numbering run, and reading
   * the highest and adding one is a race that two concurrent requests both
   * win — which is two donors holding the same receipt number.
   */
  async nextReceiptSequence(entity: Entity): Promise<number> {
    return nextInSequence(`donation-receipt-${entity}`);
  }

  /* Sponsorship ---------------------------------------------------- */

  async listSponsorships(entity: Entity): Promise<Sponsorship[]> {
    const rows = await many<SponsorshipRow>(
      this.db
        .prepare(
          "SELECT id, entity, sponsor_name, event_name, tier, payment_cents, " +
            "  currency, contingent_on_attendance, exclusivity, received_at, " +
            "  created_by_id " +
            "FROM sponsorship WHERE entity = ? ORDER BY received_at DESC",
        )
        .bind(entity),
    );
    if (rows.length === 0) return [];

    const placementRows = await many<PlacementRow>(
      this.db
        .prepare(
          "SELECT p.id, p.sponsorship_id, p.entity, p.kind, p.approved_acknowledgment, " +
            "  p.benefit_fmv_cents, p.publication_state, p.authored_by_id, " +
            "  p.approved_by_id, p.notes " +
            "FROM sponsor_placement p " +
            "JOIN sponsorship s ON s.id = p.sponsorship_id " +
            "WHERE s.entity = ? ORDER BY p.rowid",
        )
        .bind(entity),
    );
    const placements = groupBy(placementRows, (row) => text(row.sponsorship_id));

    return rows.map((row) =>
      toSponsorship(row, (placements.get(text(row.id)) ?? []).map(toPlacement)),
    );
  }

  async getSponsorship(sponsorshipId: string): Promise<Sponsorship | undefined> {
    const row = await one<SponsorshipRow>(
      this.db
        .prepare(
          "SELECT id, entity, sponsor_name, event_name, tier, payment_cents, " +
            "  currency, contingent_on_attendance, exclusivity, received_at, " +
            "  created_by_id " +
            "FROM sponsorship WHERE id = ?",
        )
        .bind(sponsorshipId),
    );
    if (!row) return undefined;
    const placementRows = await many<PlacementRow>(
      this.db
        .prepare(
          "SELECT id, sponsorship_id, entity, kind, approved_acknowledgment, " +
            "  benefit_fmv_cents, publication_state, authored_by_id, approved_by_id, " +
            "  notes " +
            "FROM sponsor_placement WHERE sponsorship_id = ? ORDER BY rowid",
        )
        .bind(sponsorshipId),
    );
    return toSponsorship(row, placementRows.map(toPlacement));
  }

  /**
   * Creates a sponsorship, or edits one.
   *
   * `contingent_on_attendance` is bound as the literal 0 rather than from a
   * value. The column's CHECK permits only 0 and the domain type has only
   * `false`, so binding anything else would be writing a row the schema has
   * already said is not a sponsorship.
   *
   * `created_by_id` is set on insert and left alone by an edit. It is the
   * actor the no-self-approval rule reads, so an edit must not quietly
   * reassign who recorded the payment.
   */
  async saveSponsorship(draft: SponsorshipDraft): Promise<Sponsorship> {
    const existing = draft.id ? await this.getSponsorship(draft.id) : undefined;
    if (draft.id && !existing) {
      throw new RepositoryError(`No sponsorship ${draft.id}`, "NOT_FOUND");
    }
    const { sponsorName, eventName, tier } = normaliseSponsorshipDraft(draft, existing);

    if (existing) {
      await this.db
        .prepare(
          "UPDATE sponsorship SET sponsor_name = ?, event_name = ?, tier = ?, " +
            "  payment_cents = ?, exclusivity = ?, received_at = ? WHERE id = ?",
        )
        .bind(
          sponsorName,
          eventName,
          tier,
          draft.paymentCents,
          draft.exclusivity,
          draft.receivedAt,
          existing.id,
        )
        .run();
      const saved = await this.getSponsorship(existing.id);
      if (!saved) {
        throw new RepositoryError(`No sponsorship ${existing.id}`, "NOT_FOUND");
      }
      return saved;
    }

    const id = draft.id ?? newId();
    await this.db
      .prepare(
        "INSERT INTO sponsorship (id, entity, sponsor_name, event_name, tier, " +
          "  payment_cents, currency, contingent_on_attendance, exclusivity, " +
          "  received_at, created_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
      )
      .bind(
        id,
        draft.entity,
        sponsorName,
        eventName,
        tier,
        draft.paymentCents,
        CURRENCY,
        draft.exclusivity,
        draft.receivedAt,
        draft.createdById,
      )
      .run();
    const saved = await this.getSponsorship(id);
    if (!saved) throw new RepositoryError(`No sponsorship ${id}`, "NOT_FOUND");
    return saved;
  }

  /**
   * The release gate's two transitions.
   *
   * Both read the placement through the sponsorship, so a placement id
   * belonging to a different sponsorship is a NOT_FOUND rather than a write
   * against the wrong row. Neither statement mentions
   * `approved_acknowledgment`: the wording is what is being approved and is
   * never rewritten by the act of approving it.
   */
  async submitPlacementForRelease(
    sponsorshipId: string,
    placementId: string,
  ): Promise<SponsorPlacement> {
    const placement = await this.locatePlacement(sponsorshipId, placementId);
    assertSubmittableForRelease(placement);
    await this.db
      .prepare(
        "UPDATE sponsor_placement SET publication_state = 'AWAITING_RELEASE', " +
          "  approved_by_id = NULL WHERE id = ?",
      )
      .bind(placement.id)
      .run();
    return this.requirePlacement(placement.id);
  }

  async approvePlacement(
    sponsorshipId: string,
    placementId: string,
    approverId: string,
  ): Promise<SponsorPlacement> {
    const placement = await this.locatePlacement(sponsorshipId, placementId);
    assertApprovable(placement, approverId);
    await this.db
      .prepare(
        "UPDATE sponsor_placement SET publication_state = 'APPROVED', " +
          "  approved_by_id = ? WHERE id = ?",
      )
      .bind(approverId, placement.id)
      .run();
    return this.requirePlacement(placement.id);
  }

  private async locatePlacement(
    sponsorshipId: string,
    placementId: string,
  ): Promise<SponsorPlacement> {
    const sponsorship = await this.getSponsorship(sponsorshipId);
    if (!sponsorship) {
      throw new RepositoryError(`No sponsorship ${sponsorshipId}`, "NOT_FOUND");
    }
    const placement = sponsorship.placements.find((p) => p.id === placementId);
    if (!placement) {
      throw new RepositoryError(`No placement ${placementId}`, "NOT_FOUND");
    }
    return placement;
  }

  private async requirePlacement(placementId: string): Promise<SponsorPlacement> {
    const saved = await this.readPlacement(placementId);
    if (!saved) throw new RepositoryError(`No placement ${placementId}`, "NOT_FOUND");
    return saved;
  }

  /**
   * Saves a placement's wording and valuation.
   *
   * Changed wording goes back through the release gate and loses its
   * approver, exactly as the in-memory implementation does it: a placement
   * cannot stay APPROVED on the strength of the approval of different words.
   * The string itself is written verbatim.
   */
  async savePlacement(
    sponsorshipId: string,
    draft: PlacementDraft,
  ): Promise<SponsorPlacement> {
    const sponsorship = await this.getSponsorship(sponsorshipId);
    if (!sponsorship) {
      throw new RepositoryError(`No sponsorship ${sponsorshipId}`, "NOT_FOUND");
    }
    const existing = draft.id
      ? sponsorship.placements.find((p) => p.id === draft.id)
      : undefined;

    if (existing) {
      const wordingChanged =
        existing.approvedAcknowledgmentString !== draft.approvedAcknowledgmentString ||
        existing.kind !== draft.kind;
      const notes = draft.notes ?? existing.notes;
      const publicationState = wordingChanged
        ? "AWAITING_RELEASE"
        : (draft.publicationState ?? existing.publicationState);
      const approvedById = wordingChanged ? null : existing.approvedById;
      // Authorship follows the words. Keeping the original author on changed
      // wording let the editor approve their own text as a second reader.
      const authoredById = wordingChanged ? draft.authoredById : existing.authoredById;

      await this.db
        .prepare(
          "UPDATE sponsor_placement SET kind = ?, approved_acknowledgment = ?, " +
            "  benefit_fmv_cents = ?, publication_state = ?, approved_by_id = ?, " +
            "  authored_by_id = ?, notes = ? WHERE id = ?",
        )
        .bind(
          draft.kind,
          draft.approvedAcknowledgmentString,
          draft.benefitFairMarketValueCents,
          publicationState,
          approvedById,
          authoredById,
          notes,
          existing.id,
        )
        .run();

      const saved = await this.readPlacement(existing.id);
      if (!saved) {
        throw new RepositoryError(`No placement ${existing.id}`, "NOT_FOUND");
      }
      return saved;
    }

    const id = draft.id ?? newId();
    await this.db
      .prepare(
        "INSERT INTO sponsor_placement (id, sponsorship_id, entity, kind, " +
          "  approved_acknowledgment, benefit_fmv_cents, publication_state, " +
          "  authored_by_id, approved_by_id, notes) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
      )
      .bind(
        id,
        sponsorshipId,
        // The placement's entity follows the sponsorship's and is never passed
        // in: a placement on the other entity's sponsorship is the same
        // confusion the allocation trigger refuses.
        sponsorship.entity,
        draft.kind,
        draft.approvedAcknowledgmentString,
        draft.benefitFairMarketValueCents,
        draft.publicationState ?? "DRAFT",
        draft.authoredById,
        draft.notes ?? "",
      )
      .run();

    const saved = await this.readPlacement(id);
    if (!saved) throw new RepositoryError(`No placement ${id}`, "NOT_FOUND");
    return saved;
  }

  private async readPlacement(placementId: string): Promise<SponsorPlacement | null> {
    const row = await one<PlacementRow>(
      this.db
        .prepare(
          "SELECT id, sponsorship_id, entity, kind, approved_acknowledgment, " +
            "  benefit_fmv_cents, publication_state, authored_by_id, approved_by_id, " +
            "  notes FROM sponsor_placement WHERE id = ?",
        )
        .bind(placementId),
    );
    return row ? toPlacement(row) : null;
  }
}

/* This schema has two boolean columns and they are written differently on
 * purpose.
 *
 * `fund.open_to_gifts` goes in through `toInt`, because closing a fund to new
 * gifts is a thing the Fundraising Chair's screen does and `saveFund` writes
 * it. D1 refuses a boolean bind, so the conversion is explicit.
 *
 * `sponsorship.contingent_on_attendance` is never written from a value at
 * all: `saveSponsorship` binds the literal 0. There is no code path that can
 * set it, which is the same answer the column's CHECK gives and the same
 * answer the domain type gives. A fee tied to attendance or impressions is
 * not a sponsorship payment, so nothing here can file one as one. */
