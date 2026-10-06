/**
 * Domain types for donations, funds, receipts and sponsorship.
 *
 * Two rules from docs/ARCHITECTURE.md are encoded in the types themselves
 * rather than left to a validator:
 *
 *   - `Sponsorship.contingentOnAttendanceOrImpressions` is typed `false`. A
 *     payment tied to attendance or impressions is not a qualified sponsorship
 *     payment at all, so there is no shape of this record that can hold one.
 *   - `Sponsorship.exclusivity` admits `EXCLUSIVE_SPONSOR` but has no
 *     `EXCLUSIVE_PROVIDER` member. Exclusive sponsor is fine; exclusive
 *     provider is advertising.
 *
 * Money is `...Cents: number`, integer, always.
 */

import type { Entity } from "../authz/model";
import type { Currency } from "./money";

/* ------------------------------------------------------------------ *
 * Funds
 * ------------------------------------------------------------------ */

export const FUND_RESTRICTIONS = ["RESTRICTED", "UNRESTRICTED"] as const;
export type FundRestriction = (typeof FUND_RESTRICTIONS)[number];

export type Fund = {
  id: string;
  entity: Entity;
  name: string;
  restriction: FundRestriction;
  /**
   * What the donor's money may be spent on. Required for a restricted fund:
   * a restriction the board cannot state is a restriction it cannot honour.
   */
  purpose: string;
  currency: Currency;
  /** Whether the fund is offered on the public donate form. */
  openToGifts: boolean;
};

export type FundBalance = {
  fundId: string;
  entity: Entity;
  name: string;
  restriction: FundRestriction;
  /** Sum of PAID gift allocations to this fund. Aggregate, no row identity. */
  balanceCents: number;
  giftCount: number;
};

/* ------------------------------------------------------------------ *
 * Gifts
 * ------------------------------------------------------------------ */

export const BENEFIT_KINDS = [
  "EVENT_TICKET",
  "TOURNAMENT_ENTRY",
  "BANQUET_SEAT",
  "MERCHANDISE",
  "OTHER",
] as const;
export type BenefitKind = (typeof BENEFIT_KINDS)[number];

export type GiftBenefit = {
  kind: BenefitKind;
  description: string;
  quantity: number;
  unitFairMarketValueCents: number;
};

export type Allocation = {
  fundId: string;
  amountCents: number;
};

export const DONATION_STATUSES = [
  "INTENT",
  "AWAITING_PAYMENT",
  "PAID",
  "ABANDONED",
  "REFUNDED",
] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

/**
 * A validated gift, before any money has moved. This is what the public
 * donate flow produces and what is handed to hosted checkout. It is not a
 * FINANCIAL row: nothing is persisted to the ledger until the provider says
 * the payment cleared.
 */
export type DonationIntent = {
  entity: Entity;
  donorDisplayName: string;
  donorEmail: string;
  amountCents: number;
  currency: Currency;
  allocations: Allocation[];
  benefits: GiftBenefit[];
  /**
   * Required whenever `benefits` is non-empty. A gift carrying benefits with
   * no fair market value recorded cannot produce a receipt — see receipts.ts.
   */
  benefitFairMarketValueCents: number | null;
  /** Set when the gift is the charitable portion of a sponsorship payment. */
  sponsorshipId: string | null;
};

export type Donation = DonationIntent & {
  id: string;
  status: DonationStatus;
  /** UTC. Rendered in America/New_York. */
  receivedAt: string;
  /** Opaque provider reference. Never a token, never card data. */
  checkoutSessionRef: string | null;
  /** The person or system actor that recorded it. Used by the no-self-approval rule. */
  createdById: string;
};

/* ------------------------------------------------------------------ *
 * Sponsorship
 * ------------------------------------------------------------------ */

export const PLACEMENT_KINDS = [
  "WEBSITE_FOOTER",
  "EVENT_TSHIRT",
  "SIGNAGE",
  "PROGRAMME_AD",
  "NEWSLETTER_AD",
] as const;
export type PlacementKind = (typeof PLACEMENT_KINDS)[number];

/**
 * A tee sign is an acknowledgment. A programme or newsletter advert is not:
 * it is advertising, and advertising revenue is unrelated business income for
 * a veterans' organization. The two are tagged separately because they are
 * taxed separately.
 */
export type PlacementCategory = "ACKNOWLEDGMENT" | "ADVERTISING";

export const PLACEMENT_CATEGORY: Record<PlacementKind, PlacementCategory> = {
  WEBSITE_FOOTER: "ACKNOWLEDGMENT",
  EVENT_TSHIRT: "ACKNOWLEDGMENT",
  SIGNAGE: "ACKNOWLEDGMENT",
  PROGRAMME_AD: "ADVERTISING",
  NEWSLETTER_AD: "ADVERTISING",
};

export const PLACEMENT_LABEL: Record<PlacementKind, string> = {
  WEBSITE_FOOTER: "Website footer",
  EVENT_TSHIRT: "Event T-shirt",
  SIGNAGE: "Signage",
  PROGRAMME_AD: "Programme advert",
  NEWSLETTER_AD: "Newsletter advert",
};

export type PlacementPublicationState = "DRAFT" | "AWAITING_RELEASE" | "APPROVED";

export type SponsorPlacement = {
  id: string;
  sponsorshipId: string;
  entity: Entity;
  kind: PlacementKind;
  /**
   * The exact wording that may be published. Nothing else goes out. A single
   * message containing both advertising and acknowledgment is entirely
   * advertising, so this string is the whole compliance surface.
   */
  approvedAcknowledgmentString: string;
  benefitFairMarketValueCents: number;
  publicationState: PlacementPublicationState;
  /** Sponsor-supplied copy passes the release gate before publication. */
  approvedById: string | null;
  authoredById: string;
  notes: string;
};

export type Sponsorship = {
  id: string;
  entity: Entity;
  sponsorName: string;
  eventName: string;
  tier: string;
  paymentCents: number;
  currency: Currency;
  /**
   * Typed `false`, not `boolean`. A fee tied to attendance or impressions is
   * not a qualified sponsorship payment, so the record cannot express one.
   */
  contingentOnAttendanceOrImpressions: false;
  /** No `EXCLUSIVE_PROVIDER` member exists on purpose. */
  exclusivity: "NONE" | "EXCLUSIVE_SPONSOR";
  placements: SponsorPlacement[];
  receivedAt: string;
  createdById: string;
};
