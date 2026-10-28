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
import { CURRENCY, isCents } from "./money";
import type {
  Donation,
  DonationIntent,
  Fund,
  FundBalance,
  FundRestriction,
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
      | "ENTITY_MISMATCH"
      /** A fund or sponsorship draft that cannot be stored as given. */
      | "REFERENCE_DATA_INVALID"
      /** Moving a record between entities. Refused; see `assertSameEntity`. */
      | "ENTITY_IMMUTABLE"
      /** A sponsorship fee tied to attendance or impressions. */
      | "CONTINGENT_PAYMENT"
      /** Author and approver are the same person. */
      | "SELF_APPROVAL",
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

/* ------------------------------------------------------------------ *
 * Reference data: funds and sponsorships
 *
 * These two drafts close the gap `docs/PHASE2-FINDINGS.md` puts at the top
 * of the file. There was no `saveFund` and no `saveSponsorship`, so against
 * a real database the public donate form offered no funds at all and the
 * sponsor register was empty, with no code path able to change it. It was
 * invisible for as long as the data came from `seed.ts`, because the
 * in-memory implementation filled its arrays at construction.
 *
 * The fix is NOT to load the seed. That data is deliberately realistic and
 * deliberately false, and loading it would put invented funds on a live
 * donate form — including, per the board review, a Foundation golf fund
 * whose stated purpose breaches the Foundation's own published policy. The
 * fix is a path for a chair to enter the real thing.
 * ------------------------------------------------------------------ */

export type FundDraft = {
  /** Present means edit. Absent means create. */
  id?: string;
  entity: Entity;
  name: string;
  restriction: FundRestriction;
  /**
   * What the donor's money may be spent on. Required, and not only because
   * the column is NOT NULL: this string is published on the donate form, and
   * a restriction the board cannot state is a restriction it cannot honour.
   */
  purpose: string;
  /** False closes a fund to new gifts without hiding it from reporting. */
  openToGifts: boolean;
};

export type SponsorshipDraft = {
  id?: string;
  entity: Entity;
  sponsorName: string;
  eventName: string;
  tier: string;
  paymentCents: number;
  exclusivity: Sponsorship["exclusivity"];
  /** UTC. */
  receivedAt: string;
  /**
   * The person recording it. Kept on create and never rewritten by an edit,
   * because the no-self-approval rule reads it.
   */
  createdById: string;
  /**
   * Typed `false`, like the record it becomes. The answer is recorded rather
   * than assumed, and only one answer is lawful: a fee tied to attendance or
   * impressions is not a qualified sponsorship payment at all. The schema
   * carries a CHECK permitting only 0 and this type cannot express anything
   * else, so the two agree.
   */
  contingentOnAttendanceOrImpressions: false;
};

export interface DonationsRepository {
  /* Funds */
  listFunds(entity: Entity): Promise<Fund[]>;
  getFund(fundId: string): Promise<Fund | undefined>;
  fundBalances(entity: Entity): Promise<FundBalance[]>;
  giftsBehindFund(fundId: string): Promise<GiftBehindFund[]>;
  /**
   * Creates a fund, or edits one. The only way a fund comes into existence.
   *
   * Refuses rather than normalising: a blank name or purpose, and any attempt
   * to move an existing fund to the other entity.
   */
  saveFund(draft: FundDraft): Promise<Fund>;

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
  /**
   * Creates a sponsorship, or edits one. The only way one comes into
   * existence. A payment contingent on attendance or impressions is refused
   * here as well as by the schema's CHECK, so the refusal carries a sentence
   * rather than a constraint name.
   */
  saveSponsorship(draft: SponsorshipDraft): Promise<Sponsorship>;
  savePlacement(
    sponsorshipId: string,
    draft: PlacementDraft,
  ): Promise<SponsorPlacement>;
  /** DRAFT -> AWAITING_RELEASE. The author asking for a second reader. */
  submitPlacementForRelease(
    sponsorshipId: string,
    placementId: string,
  ): Promise<SponsorPlacement>;
  /**
   * AWAITING_RELEASE -> APPROVED, recording who approved it.
   *
   * It never touches `approvedAcknowledgmentString`. Approval is a signature
   * on wording that already exists: one adjective turns an acknowledgment
   * into advertising and converts the whole payment, so the string is the
   * thing being approved and is never generated, rewritten or normalised
   * here.
   */
  approvePlacement(
    sponsorshipId: string,
    placementId: string,
    approverId: string,
  ): Promise<SponsorPlacement>;
}

/* ------------------------------------------------------------------ *
 * Refusals shared by both implementations
 *
 * Same message from the in-memory repository and from D1, because they are
 * the same refusal. A message that differs by backing store is a message
 * somebody debugs instead of acting on.
 * ------------------------------------------------------------------ */

export const FUND_NAME_REQUIRED_MESSAGE =
  "A fund needs a name. The name is published on the donate form, so it is " +
  "what a donor chooses between.";

export const FUND_PURPOSE_REQUIRED_MESSAGE =
  "A fund needs a stated purpose: what the money may be spent on. It is " +
  "published beside the fund's name, and for a restricted fund it is the " +
  "restriction itself — one the board cannot state is one it cannot honour.";

export const CONTINGENT_PAYMENT_MESSAGE =
  "This payment is recorded as contingent on attendance or impressions. That " +
  "is not a qualified sponsorship payment at all, so there is no sponsorship " +
  "record that can hold it. Record it as advertising income instead.";

/** Moving a fund or a sponsorship between entities. Always refused. */
function assertSameEntity(
  what: string,
  id: string,
  existing: Entity,
  draft: Entity,
): void {
  if (existing === draft) return;
  throw new RepositoryError(
    `${what} ${id} belongs to ${existing} and cannot be moved to ${draft}. ` +
      "The two organizations never share a ledger, a donor record or a " +
      "receipt. Every gift already recorded against this would become a " +
      "cross-entity allocation, which the database refuses. Close this one " +
      `and open a new ${draft} record instead.`,
    "ENTITY_IMMUTABLE",
  );
}

/**
 * The checks a fund draft has to pass before it is stored, wherever it is
 * stored. Returns the trimmed values, so neither implementation decides on
 * its own what counts as blank.
 */
export function normaliseFundDraft(
  draft: FundDraft,
  existing?: Fund,
): { name: string; purpose: string } {
  if (existing) assertSameEntity("Fund", existing.id, existing.entity, draft.entity);
  const name = draft.name.trim();
  const purpose = draft.purpose.trim();
  if (name.length === 0) {
    throw new RepositoryError(FUND_NAME_REQUIRED_MESSAGE, "REFERENCE_DATA_INVALID");
  }
  if (purpose.length === 0) {
    throw new RepositoryError(FUND_PURPOSE_REQUIRED_MESSAGE, "REFERENCE_DATA_INVALID");
  }
  return { name, purpose };
}

export function normaliseSponsorshipDraft(
  draft: SponsorshipDraft,
  existing?: Sponsorship,
): { sponsorName: string; eventName: string; tier: string } {
  if (existing) {
    assertSameEntity("Sponsorship", existing.id, existing.entity, draft.entity);
  }
  // Typed `false`, so this only fires for a value that came in through a cast
  // or off a form. It fires rather than coercing, because coercing would file
  // an advertising fee as a sponsorship payment.
  if ((draft.contingentOnAttendanceOrImpressions as boolean) !== false) {
    throw new RepositoryError(CONTINGENT_PAYMENT_MESSAGE, "CONTINGENT_PAYMENT");
  }
  const sponsorName = draft.sponsorName.trim();
  const eventName = draft.eventName.trim();
  const tier = draft.tier.trim();
  for (const [label, value] of [
    ["sponsor's name", sponsorName],
    ["event", eventName],
    ["tier", tier],
  ] as const) {
    if (value.length === 0) {
      throw new RepositoryError(
        `A sponsorship needs the ${label}. The register is read by the ` +
          "Treasurer and by the Fundraising Chair, and a row that does not say " +
          "who or what it is for cannot be reconciled to anything.",
        "REFERENCE_DATA_INVALID",
      );
    }
  }
  if (!isCents(draft.paymentCents) || draft.paymentCents === 0) {
    throw new RepositoryError(
      "A sponsorship payment is a whole number of cents above zero. Money is " +
        "never a decimal here, and a sponsorship of nothing is not a record.",
      "REFERENCE_DATA_INVALID",
    );
  }
  if (draft.exclusivity !== "NONE" && draft.exclusivity !== "EXCLUSIVE_SPONSOR") {
    throw new RepositoryError(
      `Exclusivity is "${String(draft.exclusivity)}". Exclusive sponsor is ` +
        "acceptable; exclusive provider is advertising and is not a value this " +
        "register accepts.",
      "REFERENCE_DATA_INVALID",
    );
  }
  return { sponsorName, eventName, tier };
}

/**
 * The two placement transitions, checked once for both implementations.
 *
 * Release is a gate and not a formality, so the checks are stated as
 * refusals: nothing publishes straight out of draft, nothing publishes on its
 * author's own signature, and nothing publishes with no words in it.
 */
export function assertSubmittableForRelease(placement: SponsorPlacement): void {
  if (placement.publicationState === "AWAITING_RELEASE") {
    throw new RepositoryError(
      `Placement ${placement.id} is already waiting for a second reader.`,
      "ILLEGAL_TRANSITION",
    );
  }
  if (placement.publicationState === "APPROVED") {
    throw new RepositoryError(
      `Placement ${placement.id} is already approved. To change what publishes, ` +
        "edit the wording — that returns it here on its own, because the " +
        "previous approval was of different words.",
      "ILLEGAL_TRANSITION",
    );
  }
  if (placement.approvedAcknowledgmentString.trim().length === 0) {
    throw new RepositoryError(
      `Placement ${placement.id} has no wording. There is nothing to approve ` +
        "and nothing that could be published.",
      "REFERENCE_DATA_INVALID",
    );
  }
}

export function assertApprovable(
  placement: SponsorPlacement,
  approverId: string,
): void {
  if (placement.publicationState !== "AWAITING_RELEASE") {
    throw new RepositoryError(
      `Placement ${placement.id} is at ${placement.publicationState} and cannot ` +
        "be approved from there. Sponsor copy goes through the release gate: " +
        "the author sends it, then a different person reads it and approves it.",
      "ILLEGAL_TRANSITION",
    );
  }
  if (placement.approvedAcknowledgmentString.trim().length === 0) {
    throw new RepositoryError(
      `Placement ${placement.id} has no wording, so there is nothing to approve.`,
      "REFERENCE_DATA_INVALID",
    );
  }
  if (approverId === placement.authoredById) {
    throw new RepositoryError(
      `${approverId} wrote the wording on placement ${placement.id} and cannot ` +
        "also approve it. The release gate is a second pair of eyes, and one " +
        "person is not two.",
      "SELF_APPROVAL",
    );
  }
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

  async saveFund(draft: FundDraft): Promise<Fund> {
    const existing = draft.id ? this.funds.find((f) => f.id === draft.id) : undefined;
    if (draft.id && !existing) {
      throw new RepositoryError(`No fund ${draft.id}`, "NOT_FOUND");
    }
    const { name, purpose } = normaliseFundDraft(draft, existing);

    if (existing) {
      existing.name = name;
      existing.purpose = purpose;
      existing.restriction = draft.restriction;
      existing.openToGifts = draft.openToGifts;
      return clone(existing);
    }

    this.sequence += 1;
    const fund: Fund = {
      id: draft.id ?? `fund-${draft.entity.toLowerCase()}-new-${this.sequence}`,
      entity: draft.entity,
      name,
      restriction: draft.restriction,
      purpose,
      currency: CURRENCY,
      openToGifts: draft.openToGifts,
    };
    this.funds.push(fund);
    return clone(fund);
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
      // Every fund the allocations actually name, from BOTH entities, not
      // this entity's list. Validating against one entity's funds turns the
      // most consequential mistake in the module — a Foundation gift pointed
      // at an Association fund — into "there is no fund with the reference
      // 40d228b8…". It is refused either way; the difference is whether the
      // Treasurer is told which organization owns that fund.
      funds: this.funds.filter((fund) =>
        intent.allocations.some((allocation) => allocation.fundId === fund.id),
      ),
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

  async saveSponsorship(draft: SponsorshipDraft): Promise<Sponsorship> {
    const existing = draft.id
      ? this.sponsorships.find((s) => s.id === draft.id)
      : undefined;
    if (draft.id && !existing) {
      throw new RepositoryError(`No sponsorship ${draft.id}`, "NOT_FOUND");
    }
    const { sponsorName, eventName, tier } = normaliseSponsorshipDraft(draft, existing);

    if (existing) {
      existing.sponsorName = sponsorName;
      existing.eventName = eventName;
      existing.tier = tier;
      existing.paymentCents = draft.paymentCents;
      existing.exclusivity = draft.exclusivity;
      existing.receivedAt = draft.receivedAt;
      return clone(existing);
    }

    this.sequence += 1;
    const sponsorship: Sponsorship = {
      id: draft.id ?? `s-${draft.entity.toLowerCase()}-new-${this.sequence}`,
      entity: draft.entity,
      sponsorName,
      eventName,
      tier,
      paymentCents: draft.paymentCents,
      currency: CURRENCY,
      contingentOnAttendanceOrImpressions: false,
      exclusivity: draft.exclusivity,
      placements: [],
      receivedAt: draft.receivedAt,
      createdById: draft.createdById,
    };
    this.sponsorships.push(sponsorship);
    return clone(sponsorship);
  }

  /** The placement, or the refusal that says which part is missing. */
  private locatePlacement(
    sponsorshipId: string,
    placementId: string,
  ): SponsorPlacement {
    const sponsorship = this.sponsorships.find((s) => s.id === sponsorshipId);
    if (!sponsorship) {
      throw new RepositoryError(`No sponsorship ${sponsorshipId}`, "NOT_FOUND");
    }
    const placement = sponsorship.placements.find((p) => p.id === placementId);
    if (!placement) {
      throw new RepositoryError(`No placement ${placementId}`, "NOT_FOUND");
    }
    return placement;
  }

  async submitPlacementForRelease(
    sponsorshipId: string,
    placementId: string,
  ): Promise<SponsorPlacement> {
    const placement = this.locatePlacement(sponsorshipId, placementId);
    assertSubmittableForRelease(placement);
    placement.publicationState = "AWAITING_RELEASE";
    placement.approvedById = null;
    return clone(placement);
  }

  async approvePlacement(
    sponsorshipId: string,
    placementId: string,
    approverId: string,
  ): Promise<SponsorPlacement> {
    const placement = this.locatePlacement(sponsorshipId, placementId);
    assertApprovable(placement, approverId);
    // The state and the approver change. The wording does not: it is what was
    // approved, so it is read and written verbatim and never regenerated.
    placement.publicationState = "APPROVED";
    placement.approvedById = approverId;
    return clone(placement);
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
        // And the author becomes whoever wrote the new words.
        //
        // This used to keep the original author, which looked conservative
        // and was a hole: B rewrites A's wording, the record still says A
        // wrote it, and B then approves it as a "second" reader. One person
        // is not two, so authorship follows the words.
        existing.authoredById = draft.authoredById;
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
 *
 * ## Why it hangs off `globalThis` rather than a module-level `let`
 *
 * A module-level `let` was not enough, and the way it failed is worth
 * recording because it looked like it worked. `next dev` re-evaluates server
 * modules, so the binding resets while the process keeps running: a fund
 * opened on the board screen was there on the redirect that followed the
 * write, and gone from `/donate` a moment later. Observed, not inferred —
 * the register went back from five funds to four with no recompile in the
 * log between the two reads.
 *
 * Nothing about that is specific to funds. It applied to every write this
 * repository has ever taken, and it was invisible for as long as the only
 * writes were gifts recorded by a checkout flow nobody drove twice.
 *
 * A key on `globalThis` survives module re-evaluation within one process,
 * which is the usual shape for a dev-only singleton. It changes nothing in
 * production: with a D1 binding `donationsRepository()` never reaches this
 * at all, and the binding is the only thing two routes actually share.
 */
const FALLBACK_KEY = Symbol.for("jsoa.donations.fallbackRepository");

type FallbackHolder = {
  [FALLBACK_KEY]?: InMemoryDonationsRepository;
};

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

  const holder = globalThis as FallbackHolder;
  if (!holder[FALLBACK_KEY]) {
    holder[FALLBACK_KEY] = new InMemoryDonationsRepository();
  }
  return holder[FALLBACK_KEY];
}
