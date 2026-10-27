/**
 * The reads and writes this module needs, and an in-memory implementation
 * backed by seed.ts.
 *
 * No authorization happens here. The repository is dumb on purpose: every
 * caller goes through actions.ts, which calls `authorize()` first. Keeping the
 * two apart means a reviewer can see, in one file, every place a permission
 * decision is made.
 *
 * ## Every method returns a Promise, and that is not decoration
 *
 * This interface used to be twelve synchronous methods, because the only
 * implementation held arrays. D1 is async, so the interface is async, and the
 * `await` runs all the way out through actions.ts, kpis.ts, workspace.ts and
 * every screen in `src/app/donate` and `src/app/board/donations`. The
 * alternative — a synchronous facade over a database — is a cache with no
 * invalidation rule, which is the wrong thing to discover in production.
 *
 * The in-memory implementation is kept, async and otherwise unchanged. It is
 * what the test suite runs against and what keeps the suite fast.
 */

import type { Entity } from "../authz/model";
import { database } from "../db";
import { validateAllocations } from "./allocation";
import type {
  Donation,
  DonationIntent,
  Fund,
  FundBalance,
  PlacementKind,
  PlacementPublicationState,
  SponsorPlacement,
  Sponsorship,
} from "./types";
import { D1DonationsRepository } from "./repository.d1";
import { SEED_DONATIONS, SEED_FUNDS, SEED_SPONSORSHIPS } from "./seed";

export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "ALLOCATIONS_INVALID"
      | "BENEFITS_WITHOUT_FMV"
      | "ILLEGAL_TRANSITION"
      | "ENTITY_MISMATCH",
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export type GiftBehindFund = {
  donationId: string;
  donorDisplayName: string;
  receivedAt: string;
  amountCents: number;
  status: Donation["status"];
};

export type PlacementDraft = {
  id?: string;
  kind: PlacementKind;
  approvedAcknowledgmentString: string;
  benefitFairMarketValueCents: number;
  publicationState?: PlacementPublicationState;
  authoredById: string;
  notes?: string;
};

export interface DonationsRepository {
  /* Funds */
  listFunds(entity: Entity): Promise<Fund[]>;
  getFund(fundId: string): Promise<Fund | undefined>;
  fundBalances(entity: Entity): Promise<FundBalance[]>;
  giftsBehindFund(fundId: string): Promise<GiftBehindFund[]>;

  /* Gifts */
  listDonations(entity: Entity): Promise<Donation[]>;
  getDonation(donationId: string): Promise<Donation | undefined>;
  /** Records a cleared payment. Refuses if the arithmetic does not hold. */
  recordClearedDonation(
    intent: DonationIntent,
    meta: { createdById: string; checkoutSessionRef: string; receivedAt: string },
  ): Promise<Donation>;
  setDonationBenefitFairMarketValue(
    donationId: string,
    cents: number,
  ): Promise<Donation>;
  /** Per-entity receipt numbering. Receipts are never numbered across entities. */
  nextReceiptSequence(entity: Entity): Promise<number>;

  /* Sponsorship */
  listSponsorships(entity: Entity): Promise<Sponsorship[]>;
  getSponsorship(sponsorshipId: string): Promise<Sponsorship | undefined>;
  savePlacement(
    sponsorshipId: string,
    draft: PlacementDraft,
  ): Promise<SponsorPlacement>;
}

/**
 * The message a gift carrying benefits with no valuation is refused with.
 *
 * Shared by both implementations because it is the same refusal: a gift
 * recorded this way can never produce a lawful receipt, so the write is
 * refused at the boundary rather than discovered months later by whoever has
 * to explain the missing receipt.
 */
export const BENEFITS_WITHOUT_FMV_MESSAGE =
  "This gift carries benefits and no fair market value. Record the value of " +
  "what the donor received before the gift is filed, because a receipt for " +
  "it cannot be issued without one.";

/* ------------------------------------------------------------------ */

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryDonationsRepository implements DonationsRepository {
  private funds: Fund[];
  private donations: Donation[];
  private sponsorships: Sponsorship[];
  private receiptCounters: Record<Entity, number> = { JSOA: 0, JSOF: 0 };
  private sequence = 0;

  constructor(
    funds: Fund[] = SEED_FUNDS,
    donations: Donation[] = SEED_DONATIONS,
    sponsorships: Sponsorship[] = SEED_SPONSORSHIPS,
  ) {
    // Deep copies, so one test cannot see another test's writes.
    this.funds = clone(funds);
    this.donations = clone(donations);
    this.sponsorships = clone(sponsorships);
  }

  async listFunds(entity: Entity): Promise<Fund[]> {
    return this.funds.filter((f) => f.entity === entity);
  }

  async getFund(fundId: string): Promise<Fund | undefined> {
    return this.funds.find((f) => f.id === fundId);
  }

  async fundBalances(entity: Entity): Promise<FundBalance[]> {
    const funds = await this.listFunds(entity);
    return funds.map((fund) => {
      const paid = this.donations.filter(
        (d) => d.entity === entity && d.status === "PAID",
      );
      let balanceCents = 0;
      let giftCount = 0;
      for (const donation of paid) {
        for (const allocation of donation.allocations) {
          if (allocation.fundId === fund.id) {
            balanceCents += allocation.amountCents;
            giftCount += 1;
          }
        }
      }
      return {
        fundId: fund.id,
        entity: fund.entity,
        name: fund.name,
        restriction: fund.restriction,
        balanceCents,
        giftCount,
      };
    });
  }

  async giftsBehindFund(fundId: string): Promise<GiftBehindFund[]> {
    const fund = await this.getFund(fundId);
    if (!fund) throw new RepositoryError(`No fund ${fundId}`, "NOT_FOUND");
    const rows: GiftBehindFund[] = [];
    for (const donation of this.donations) {
      if (donation.entity !== fund.entity) continue;
      for (const allocation of donation.allocations) {
        if (allocation.fundId !== fundId) continue;
        rows.push({
          donationId: donation.id,
          donorDisplayName: donation.donorDisplayName,
          receivedAt: donation.receivedAt,
          amountCents: allocation.amountCents,
          status: donation.status,
        });
      }
    }
    return rows.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async listDonations(entity: Entity): Promise<Donation[]> {
    return this.donations
      .filter((d) => d.entity === entity)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  async getDonation(donationId: string): Promise<Donation | undefined> {
    return this.donations.find((d) => d.id === donationId);
  }

  async recordClearedDonation(
    intent: DonationIntent,
    meta: { createdById: string; checkoutSessionRef: string; receivedAt: string },
  ): Promise<Donation> {
    const check = validateAllocations({
      entity: intent.entity,
      totalCents: intent.amountCents,
      allocations: intent.allocations,
      funds: await this.listFunds(intent.entity),
      allowClosedFunds: true,
    });
    if (!check.ok) {
      throw new RepositoryError(check.message, "ALLOCATIONS_INVALID");
    }
    if (intent.benefits.length > 0 && intent.benefitFairMarketValueCents === null) {
      // Recorded anyway would mean a gift that can never be receipted, so the
      // write is refused at the boundary rather than discovered months later.
      throw new RepositoryError(
        BENEFITS_WITHOUT_FMV_MESSAGE,
        "BENEFITS_WITHOUT_FMV",
      );
    }

    this.sequence += 1;
    const donation: Donation = {
      ...clone(intent),
      id: `d-${intent.entity.toLowerCase()}-${String(900 + this.sequence)}`,
      status: "PAID",
      receivedAt: meta.receivedAt,
      checkoutSessionRef: meta.checkoutSessionRef,
      createdById: meta.createdById,
    };
    this.donations.push(donation);
    return clone(donation);
  }

  async setDonationBenefitFairMarketValue(
    donationId: string,
    cents: number,
  ): Promise<Donation> {
    const donation = this.donations.find((d) => d.id === donationId);
    if (!donation) throw new RepositoryError(`No gift ${donationId}`, "NOT_FOUND");
    donation.benefitFairMarketValueCents = cents;
    return clone(donation);
  }

  async nextReceiptSequence(entity: Entity): Promise<number> {
    this.receiptCounters[entity] += 1;
    return this.receiptCounters[entity];
  }

  async listSponsorships(entity: Entity): Promise<Sponsorship[]> {
    return this.sponsorships.filter((s) => s.entity === entity);
  }

  async getSponsorship(sponsorshipId: string): Promise<Sponsorship | undefined> {
    return this.sponsorships.find((s) => s.id === sponsorshipId);
  }

  async savePlacement(
    sponsorshipId: string,
    draft: PlacementDraft,
  ): Promise<SponsorPlacement> {
    const sponsorship = this.sponsorships.find((s) => s.id === sponsorshipId);
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
      existing.kind = draft.kind;
      existing.approvedAcknowledgmentString = draft.approvedAcknowledgmentString;
      existing.benefitFairMarketValueCents = draft.benefitFairMarketValueCents;
      existing.notes = draft.notes ?? existing.notes;
      if (wordingChanged) {
        // Changed wording goes back through the release gate. It cannot stay
        // APPROVED on the strength of the approval of different words.
        existing.publicationState = "AWAITING_RELEASE";
        existing.approvedById = null;
      } else if (draft.publicationState) {
        existing.publicationState = draft.publicationState;
      }
      return clone(existing);
    }

    this.sequence += 1;
    const placement: SponsorPlacement = {
      id: draft.id ?? `pl-${sponsorshipId}-${this.sequence}`,
      sponsorshipId,
      entity: sponsorship.entity,
      kind: draft.kind,
      approvedAcknowledgmentString: draft.approvedAcknowledgmentString,
      benefitFairMarketValueCents: draft.benefitFairMarketValueCents,
      publicationState: draft.publicationState ?? "DRAFT",
      approvedById: null,
      authoredById: draft.authoredById,
      notes: draft.notes ?? "",
    };
    sponsorship.placements.push(placement);
    return clone(placement);
  }
}

/* ------------------------------------------------------------------ *
 * The accessor
 * ------------------------------------------------------------------ */

/**
 * The in-memory fallback, kept for the life of the process.
 *
 * It holds writes, so it has to be one instance rather than one per call:
 * `next dev` with no Worker behind it is the case this serves, and a fresh
 * repository per request would lose a gift the moment it was recorded.
 */
let fallback: InMemoryDonationsRepository | null = null;

/**
 * The repository the handlers and screens use.
 *
 * D1 when there is a binding, the seeded in-memory one when there is not.
 * `database()` returns null outside a request context and in `next dev`
 * without a Worker, which is a normal state rather than an error — see
 * `src/lib/db/index.ts`.
 *
 * Resolved per call rather than once at module load, because the binding
 * comes from the request context: a module-level singleton would capture
 * whichever answer the build happened to see first, which is null.
 */
export function donationsRepository(): DonationsRepository {
  const db = database();
  if (db) return new D1DonationsRepository(db);
  if (!fallback) fallback = new InMemoryDonationsRepository();
  return fallback;
}
