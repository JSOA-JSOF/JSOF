/**
 * The reads and writes this module needs, and an in-memory implementation
 * backed by seed.ts.
 *
 * No authorization happens here. The repository is dumb on purpose: every
 * caller goes through actions.ts, which calls `authorize()` first. Keeping the
 * two apart means a reviewer can see, in one file, every place a permission
 * decision is made.
 *
 * Swapping to Prisma later is one new file implementing `DonationsRepository`.
 */

import type { Entity } from "../authz/model";
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
  listFunds(entity: Entity): Fund[];
  getFund(fundId: string): Fund | undefined;
  fundBalances(entity: Entity): FundBalance[];
  giftsBehindFund(fundId: string): GiftBehindFund[];

  /* Gifts */
  listDonations(entity: Entity): Donation[];
  getDonation(donationId: string): Donation | undefined;
  /** Records a cleared payment. Refuses if the arithmetic does not hold. */
  recordClearedDonation(
    intent: DonationIntent,
    meta: { createdById: string; checkoutSessionRef: string; receivedAt: string },
  ): Donation;
  setDonationBenefitFairMarketValue(donationId: string, cents: number): Donation;
  /** Per-entity receipt numbering. Receipts are never numbered across entities. */
  nextReceiptSequence(entity: Entity): number;

  /* Sponsorship */
  listSponsorships(entity: Entity): Sponsorship[];
  getSponsorship(sponsorshipId: string): Sponsorship | undefined;
  savePlacement(sponsorshipId: string, draft: PlacementDraft): SponsorPlacement;
}

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

  listFunds(entity: Entity): Fund[] {
    return this.funds.filter((f) => f.entity === entity);
  }

  getFund(fundId: string): Fund | undefined {
    return this.funds.find((f) => f.id === fundId);
  }

  fundBalances(entity: Entity): FundBalance[] {
    return this.listFunds(entity).map((fund) => {
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

  giftsBehindFund(fundId: string): GiftBehindFund[] {
    const fund = this.getFund(fundId);
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

  listDonations(entity: Entity): Donation[] {
    return this.donations
      .filter((d) => d.entity === entity)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  getDonation(donationId: string): Donation | undefined {
    return this.donations.find((d) => d.id === donationId);
  }

  recordClearedDonation(
    intent: DonationIntent,
    meta: { createdById: string; checkoutSessionRef: string; receivedAt: string },
  ): Donation {
    const check = validateAllocations({
      entity: intent.entity,
      totalCents: intent.amountCents,
      allocations: intent.allocations,
      funds: this.listFunds(intent.entity),
      allowClosedFunds: true,
    });
    if (!check.ok) {
      throw new RepositoryError(check.message, "ALLOCATIONS_INVALID");
    }
    if (intent.benefits.length > 0 && intent.benefitFairMarketValueCents === null) {
      // Recorded anyway would mean a gift that can never be receipted, so the
      // write is refused at the boundary rather than discovered months later.
      throw new RepositoryError(
        "This gift carries benefits and no fair market value. Record the value of " +
          "what the donor received before the gift is filed, because a receipt for " +
          "it cannot be issued without one.",
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

  setDonationBenefitFairMarketValue(donationId: string, cents: number): Donation {
    const donation = this.donations.find((d) => d.id === donationId);
    if (!donation) throw new RepositoryError(`No gift ${donationId}`, "NOT_FOUND");
    donation.benefitFairMarketValueCents = cents;
    return clone(donation);
  }

  nextReceiptSequence(entity: Entity): number {
    this.receiptCounters[entity] += 1;
    return this.receiptCounters[entity];
  }

  listSponsorships(entity: Entity): Sponsorship[] {
    return this.sponsorships.filter((s) => s.entity === entity);
  }

  getSponsorship(sponsorshipId: string): Sponsorship | undefined {
    return this.sponsorships.find((s) => s.id === sponsorshipId);
  }

  savePlacement(sponsorshipId: string, draft: PlacementDraft): SponsorPlacement {
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

/**
 * The instance the route handlers use. A module-level singleton is fine while
 * persistence is deferred; it disappears with the Prisma implementation.
 */
export const donationsRepository: DonationsRepository =
  new InMemoryDonationsRepository();
