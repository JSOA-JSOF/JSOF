/**
 * Every handler in this module. Each one that touches a data class calls
 * `authorize()` first, before it reads anything.
 *
 * Three notes on the permission choices, because two of them are not obvious:
 *
 * 1. The sponsor register is split across two data classes rather than one.
 *    Payment amounts and benefit valuations are FINANCIAL and need READ.
 *    The approved acknowledgment wording is PUBLIC_CONTENT, because that is
 *    what it is: copy that will be published. That split is what lets the
 *    Fundraising Chair do the job the role exists for. The Chair holds
 *    AGGREGATE on FINANCIAL and WRITE on PUBLIC_CONTENT, so the Chair can
 *    write the wording and see totals, and cannot read the money row by row.
 *    See the report: the brief assumes one register, and one register would
 *    either lock the Chair out or hand them the ledger.
 *
 * 2. The public donate flow writes nothing. It produces a validated
 *    `DonationIntent`, which is a value, not a FINANCIAL row, and hands it to
 *    hosted checkout. The row is created by `recordClearedDonation`, which
 *    needs FINANCIAL WRITE. That is the only honest way to have both an
 *    unauthenticated donate form and no unauthenticated write to the ledger.
 *
 * 3. Fund names and purposes are published, so `listPublicFundOptions` needs
 *    no authorization — and it returns no figures at all. Balances are
 *    FINANCIAL and go through `readFundAggregates` or `readFundRegister`.
 */

import type { Entity } from "../authz/model";
import { authorize, type Subject } from "../authz/policy";
import { validateAllocations, type AllocationResult } from "./allocation";
import { buildCheckoutHandoff, type CheckoutHandoff } from "./checkout";
import { formatCents } from "./money";
import {
  donationsRepository,
  type DonationsRepository,
  type GiftBehindFund,
  type PlacementDraft,
} from "./repository";
import {
  buildReceipt,
  renderReceiptHtml,
  renderReceiptText,
  ReceiptError,
  type Receipt,
} from "./receipts";
import {
  assessSponsorship,
  categorySummary,
  reviewAcknowledgment,
  type AcknowledgmentReview,
  type SafeHarbourAssessment,
} from "./sponsorship";
import {
  PLACEMENT_CATEGORY,
  PLACEMENT_LABEL,
  type Allocation,
  type Donation,
  type DonationIntent,
  type FundBalance,
  type GiftBenefit,
  type PlacementCategory,
  type SponsorPlacement,
} from "./types";

type Repo = DonationsRepository;
const defaultRepo = () => donationsRepository;

/* ================================================================== *
 * Public: the donate flow. No data class is touched, so no authorize.
 * ================================================================== */

/** What the public form may show about a fund: no figures, ever. */
export type PublicFundOption = {
  id: string;
  entity: Entity;
  name: string;
  restriction: string;
  purpose: string;
};

export function listPublicFundOptions(
  entity: Entity,
  repo: Repo = defaultRepo(),
): PublicFundOption[] {
  return repo
    .listFunds(entity)
    .filter((fund) => fund.openToGifts)
    .map((fund) => ({
      id: fund.id,
      entity: fund.entity,
      name: fund.name,
      restriction: fund.restriction,
      purpose: fund.purpose,
    }));
}

export type PrepareIntentInput = {
  /**
   * Required. The donor picks the entity first and the platform never infers
   * one: there is no default, no "we'll decide later", and no fallback to the
   * Foundation because most gifts go there.
   */
  entity: Entity;
  donorDisplayName: string;
  donorEmail: string;
  amountCents: number;
  allocations: Allocation[];
  benefits?: GiftBenefit[];
  benefitFairMarketValueCents?: number | null;
};

export type PrepareIntentResult =
  | { ok: true; intent: DonationIntent }
  | { ok: false; code: string; message: string; field?: string };

export function prepareDonationIntent(
  input: PrepareIntentInput,
  repo: Repo = defaultRepo(),
): PrepareIntentResult {
  if (input.entity !== "JSOA" && input.entity !== "JSOF") {
    return {
      ok: false,
      code: "NO_ENTITY",
      field: "entity",
      message:
        "Choose which organization this gift is for. The two keep separate books " +
        "and separate receipts, so this is not something the platform can decide.",
    };
  }

  if (!input.donorEmail.includes("@")) {
    return {
      ok: false,
      code: "NO_EMAIL",
      field: "donorEmail",
      message: "An email address is needed to send the receipt.",
    };
  }

  const benefits = input.benefits ?? [];
  const fmv = input.benefitFairMarketValueCents ?? null;

  const check = validateAllocations({
    entity: input.entity,
    totalCents: input.amountCents,
    allocations: input.allocations,
    funds: repo.listFunds(input.entity),
  });
  if (!check.ok) {
    return { ok: false, code: check.code, field: "allocations", message: check.message };
  }

  if (benefits.length > 0 && fmv === null) {
    return {
      ok: false,
      code: "BENEFITS_WITHOUT_FMV",
      field: "benefitFairMarketValueCents",
      message:
        "This gift includes tickets, entries or merchandise. The value of what you " +
        "receive has to be recorded before the gift is taken, because the receipt " +
        "must state it and must state that only the rest is deductible.",
    };
  }

  return {
    ok: true,
    intent: {
      entity: input.entity,
      donorDisplayName: input.donorDisplayName.trim(),
      donorEmail: input.donorEmail.trim(),
      amountCents: input.amountCents,
      currency: "USD",
      allocations: input.allocations,
      benefits,
      benefitFairMarketValueCents: fmv,
      sponsorshipId: null,
    },
  };
}

/** The payment step. A redirect stub: no fields, no scripts, no tags. */
export function startHostedCheckout(intent: DonationIntent): CheckoutHandoff {
  return buildCheckoutHandoff(intent);
}

/** Convenience for the UI: the allocation check on its own. */
export function checkAllocations(
  entity: Entity,
  totalCents: number,
  allocations: Allocation[],
  repo: Repo = defaultRepo(),
): AllocationResult {
  return validateAllocations({
    entity,
    totalCents,
    allocations,
    funds: repo.listFunds(entity),
  });
}

/* ================================================================== *
 * Board: gifts and funds. FINANCIAL.
 * ================================================================== */

/**
 * Called by the checkout confirmation handler once the provider says the
 * payment cleared. Needs FINANCIAL WRITE: the Treasurer of that entity, or a
 * system actor holding the same grant. Stubbed in this build — see the report.
 */
export function recordClearedDonation(
  subject: Subject,
  intent: DonationIntent,
  meta: { checkoutSessionRef: string; receivedAt: string },
  repo: Repo = defaultRepo(),
): Donation {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity: intent.entity,
    required: "WRITE",
    rowLevel: true,
  });
  return repo.recordClearedDonation(intent, {
    createdById: subject.personId,
    checkoutSessionRef: meta.checkoutSessionRef,
    receivedAt: meta.receivedAt,
  });
}

export type GiftRow = {
  donation: Donation;
  /** Set when the gift cannot be receipted, with the reason to show. */
  receiptBlockedBecause: string | null;
};

export function readDonationRegister(
  subject: Subject,
  entity: Entity,
  repo: Repo = defaultRepo(),
): GiftRow[] {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "READ",
    rowLevel: true,
  });
  return repo.listDonations(entity).map((donation) => ({
    donation,
    receiptBlockedBecause: receiptBlockReason(donation),
  }));
}

function receiptBlockReason(donation: Donation): string | null {
  if (donation.benefits.length > 0 && donation.benefitFairMarketValueCents === null) {
    return (
      "No fair market value recorded for the benefits on this gift, so no receipt " +
      "can be issued. Value what the donor received and record it."
    );
  }
  if (donation.status !== "PAID") {
    return `Gift is ${donation.status.toLowerCase().replace(/_/g, " ")}, so there is nothing to receipt yet.`;
  }
  return null;
}

/** Counts and totals only. AGGREGATE is enough, and several roles hold it. */
export function readFundAggregates(
  subject: Subject,
  entity: Entity,
  repo: Repo = defaultRepo(),
): FundBalance[] {
  authorize({ subject, dataClass: "FINANCIAL", entity, required: "AGGREGATE" });
  return repo.fundBalances(entity);
}

export type FundRegisterRow = {
  balance: FundBalance;
  purpose: string;
  gifts: GiftBehindFund[];
};

/** Balances and the gifts behind them. Row-level, so READ. */
export function readFundRegister(
  subject: Subject,
  entity: Entity,
  repo: Repo = defaultRepo(),
): FundRegisterRow[] {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "READ",
    rowLevel: true,
  });
  return repo.fundBalances(entity).map((balance) => {
    const fund = repo.getFund(balance.fundId);
    return {
      balance,
      purpose: fund ? fund.purpose : "",
      gifts: repo.giftsBehindFund(balance.fundId),
    };
  });
}

export function recordBenefitFairMarketValue(
  subject: Subject,
  entity: Entity,
  donationId: string,
  cents: number,
  repo: Repo = defaultRepo(),
): Donation {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "WRITE",
    rowLevel: true,
  });
  return repo.setDonationBenefitFairMarketValue(donationId, cents);
}

/* ================================================================== *
 * Receipts. Reading a gift to receipt it is a row-level FINANCIAL read.
 * ================================================================== */

export type IssuedReceipt = {
  receipt: Receipt;
  html: string;
  text: string;
};

export function issueReceipt(
  subject: Subject,
  entity: Entity,
  donationId: string,
  repo: Repo = defaultRepo(),
  /**
   * Pass a sequence to render a preview without consuming a receipt number.
   * A receipt number that was burned on a screen refresh is a gap in the
   * numbering that somebody has to explain later.
   */
  options: { sequence?: number } = {},
): IssuedReceipt {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "READ",
    rowLevel: true,
  });
  const donation = repo.getDonation(donationId);
  if (!donation) {
    throw new ReceiptError(`No gift ${donationId}`, "NOT_PAID");
  }
  if (donation.entity !== entity) {
    // The one place a template could cross. It does not.
    throw new ReceiptError(
      `Gift ${donationId} belongs to ${donation.entity}, not ${entity}. Receipt ` +
        "templates are per entity and are never shared.",
      "ALLOCATIONS_DO_NOT_SUM",
    );
  }
  const receipt = buildReceipt({
    donation,
    funds: repo.listFunds(entity),
    sequence: options.sequence ?? repo.nextReceiptSequence(entity),
  });
  return {
    receipt,
    html: renderReceiptHtml(receipt),
    text: renderReceiptText(receipt),
  };
}

/* ================================================================== *
 * Sponsor register.
 * ================================================================== */

export type PlacementView = {
  placement: SponsorPlacement;
  label: string;
  category: PlacementCategory;
  review: AcknowledgmentReview;
};

export type SponsorRegisterRow = {
  sponsorshipId: string;
  sponsorName: string;
  eventName: string;
  tier: string;
  entity: Entity;
  paymentCents: number;
  paymentFormatted: string;
  exclusivity: string;
  assessment: SafeHarbourAssessment;
  categories: ReturnType<typeof categorySummary>;
  placements: PlacementView[];
};

/**
 * The money view. FINANCIAL READ: payment amounts and benefit valuations row
 * by row. The Fundraising Chair does not hold this, by design.
 */
export function readSponsorRegister(
  subject: Subject,
  entity: Entity,
  repo: Repo = defaultRepo(),
): SponsorRegisterRow[] {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "READ",
    rowLevel: true,
  });
  return repo.listSponsorships(entity).map((sponsorship) => ({
    sponsorshipId: sponsorship.id,
    sponsorName: sponsorship.sponsorName,
    eventName: sponsorship.eventName,
    tier: sponsorship.tier,
    entity: sponsorship.entity,
    paymentCents: sponsorship.paymentCents,
    paymentFormatted: formatCents(sponsorship.paymentCents),
    exclusivity: sponsorship.exclusivity,
    assessment: assessSponsorship(sponsorship),
    categories: categorySummary(sponsorship.placements),
    placements: sponsorship.placements.map(toPlacementView),
  }));
}

function toPlacementView(placement: SponsorPlacement): PlacementView {
  return {
    placement,
    label: PLACEMENT_LABEL[placement.kind],
    category: PLACEMENT_CATEGORY[placement.kind],
    review: reviewAcknowledgment(placement.approvedAcknowledgmentString),
  };
}

export type AcknowledgmentRow = {
  sponsorshipId: string;
  sponsorName: string;
  entity: Entity;
  placements: PlacementView[];
};

/**
 * The wording view. PUBLIC_CONTENT READ and no figures: this is what the
 * Fundraising Chair, Communications Chair and Webmaster work with.
 */
export function readSponsorAcknowledgments(
  subject: Subject,
  entity: Entity,
  repo: Repo = defaultRepo(),
): AcknowledgmentRow[] {
  authorize({ subject, dataClass: "PUBLIC_CONTENT", entity, required: "READ" });
  return repo.listSponsorships(entity).map((sponsorship) => ({
    sponsorshipId: sponsorship.id,
    sponsorName: sponsorship.sponsorName,
    entity: sponsorship.entity,
    placements: sponsorship.placements.map(toPlacementView),
  }));
}

export type SaveAcknowledgmentResult = {
  placement: SponsorPlacement;
  /** Warnings, never a block. The wording was saved either way. */
  review: AcknowledgmentReview;
};

/**
 * Saves the wording. The validator's findings come back with the saved record
 * rather than preventing the save: whether a phrase is an acknowledgment or an
 * advert is a judgment, and this is a warning to a human.
 */
export function saveAcknowledgmentString(
  subject: Subject,
  entity: Entity,
  sponsorshipId: string,
  draft: Omit<PlacementDraft, "authoredById">,
  repo: Repo = defaultRepo(),
): SaveAcknowledgmentResult {
  authorize({ subject, dataClass: "PUBLIC_CONTENT", entity, required: "WRITE" });
  const placement = repo.savePlacement(sponsorshipId, {
    ...draft,
    authoredById: subject.personId,
  });
  return {
    placement,
    review: reviewAcknowledgment(placement.approvedAcknowledgmentString),
  };
}

/** Changing a benefit valuation is a FINANCIAL write, not a content edit. */
export function savePlacementValuation(
  subject: Subject,
  entity: Entity,
  sponsorshipId: string,
  placementId: string,
  benefitFairMarketValueCents: number,
  repo: Repo = defaultRepo(),
): SponsorRegisterRow {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "WRITE",
    rowLevel: true,
  });
  const sponsorship = repo.getSponsorship(sponsorshipId);
  if (!sponsorship) {
    throw new Error(`No sponsorship ${sponsorshipId}`);
  }
  const existing = sponsorship.placements.find((p) => p.id === placementId);
  if (!existing) {
    throw new Error(`No placement ${placementId}`);
  }
  repo.savePlacement(sponsorshipId, {
    id: placementId,
    kind: existing.kind,
    approvedAcknowledgmentString: existing.approvedAcknowledgmentString,
    benefitFairMarketValueCents,
    publicationState: existing.publicationState,
    authoredById: existing.authoredById,
    notes: existing.notes,
  });
  const rows = readSponsorRegister(subject, entity, repo);
  const row = rows.find((r) => r.sponsorshipId === sponsorshipId);
  if (!row) throw new Error(`No sponsorship ${sponsorshipId}`);
  return row;
}
