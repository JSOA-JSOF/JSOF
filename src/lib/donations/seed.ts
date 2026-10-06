/**
 * Seed data. Fictional throughout.
 *
 * Every sponsor name, donor name and figure here is invented. No figure in
 * this file is attributed to the real JSOA or JSOF, and no real company
 * appears as a sponsor. The rows are chosen to exercise the awkward cases
 * rather than the happy path:
 *
 *   - `d-jsof-004` carries benefits with NO fair market value recorded, so it
 *     is a gift that cannot produce a receipt. It is in the seed on purpose:
 *     the board screen has to show that state.
 *   - `s-jsof-002` breaks the 2% safe harbour and mixes an acknowledgment
 *     placement with a programme advert.
 *   - `s-jsoa-001` sits exactly at the 2% ceiling, which is inside the harbour.
 *   - `s-jsof-003` has acknowledgment copy that the validator will flag.
 */

import type { Donation, Fund, Sponsorship } from "./types";

export const SEED_FUNDS: Fund[] = [
  {
    id: "fund-jsof-general",
    entity: "JSOF",
    name: "General Fund",
    restriction: "UNRESTRICTED",
    purpose: "Any charitable purpose of the Foundation, at the board's discretion.",
    currency: "USD",
    openToGifts: true,
  },
  {
    id: "fund-jsof-scholarship",
    entity: "JSOF",
    name: "Scholarship Fund",
    restriction: "RESTRICTED",
    purpose:
      "Scholarship awards only. Held pending counsel review of the eligibility rule; " +
      "gifts accrue and nothing is awarded from this fund yet.",
    currency: "USD",
    openToGifts: true,
  },
  {
    id: "fund-jsof-golf",
    entity: "JSOF",
    name: "Golf Tournament Fund",
    restriction: "RESTRICTED",
    purpose: "Direct costs of the annual golf tournament and its charitable proceeds.",
    currency: "USD",
    openToGifts: true,
  },
  {
    id: "fund-jsof-family",
    entity: "JSOF",
    name: "Family Support Fund",
    restriction: "RESTRICTED",
    purpose:
      "Emergency assistance to families of the special operations community, on the " +
      "Family Support Chair's recommendation.",
    currency: "USD",
    openToGifts: true,
  },
  {
    id: "fund-jsof-pavers-2019",
    entity: "JSOF",
    name: "Memorial Paver Campaign 2019",
    restriction: "RESTRICTED",
    purpose: "Closed campaign. Retained for reporting; no further gifts accepted.",
    currency: "USD",
    openToGifts: false,
  },
  {
    id: "fund-jsoa-operating",
    entity: "JSOA",
    name: "General Operating",
    restriction: "UNRESTRICTED",
    purpose: "Association operations, at the board's discretion.",
    currency: "USD",
    openToGifts: true,
  },
  {
    id: "fund-jsoa-memorial",
    entity: "JSOA",
    name: "Memorial Wall Fund",
    restriction: "RESTRICTED",
    purpose: "Maintenance and additions to the memorial wall.",
    currency: "USD",
    openToGifts: true,
  },
  {
    id: "fund-jsoa-ball",
    entity: "JSOA",
    name: "Annual Ball Fund",
    restriction: "RESTRICTED",
    purpose: "Direct costs of the annual ball.",
    currency: "USD",
    openToGifts: true,
  },
];

export const SEED_DONATIONS: Donation[] = [
  {
    id: "d-jsof-001",
    entity: "JSOF",
    donorDisplayName: "Marguerite Ashland",
    donorEmail: "m.ashland@example.org",
    amountCents: 2_500_000,
    currency: "USD",
    allocations: [
      { fundId: "fund-jsof-golf", amountCents: 1_000_000 },
      { fundId: "fund-jsof-scholarship", amountCents: 500_000 },
      { fundId: "fund-jsof-general", amountCents: 1_000_000 },
    ],
    benefits: [],
    benefitFairMarketValueCents: null,
    sponsorshipId: null,
    status: "PAID",
    receivedAt: "2026-03-14T15:02:00Z",
    checkoutSessionRef: "co_stub_jsof_0001",
    createdById: "sys-checkout",
  },
  {
    id: "d-jsof-002",
    entity: "JSOF",
    donorDisplayName: "Theodore Brandt",
    donorEmail: "tbrandt@example.org",
    amountCents: 150_000,
    currency: "USD",
    allocations: [{ fundId: "fund-jsof-scholarship", amountCents: 150_000 }],
    benefits: [],
    benefitFairMarketValueCents: null,
    sponsorshipId: null,
    status: "PAID",
    receivedAt: "2026-04-02T11:40:00Z",
    checkoutSessionRef: "co_stub_jsof_0002",
    createdById: "sys-checkout",
  },
  {
    id: "d-jsof-003",
    entity: "JSOF",
    donorDisplayName: "Rosalind Keene",
    donorEmail: "r.keene@example.org",
    amountCents: 400_000,
    currency: "USD",
    allocations: [{ fundId: "fund-jsof-golf", amountCents: 400_000 }],
    benefits: [
      {
        kind: "TOURNAMENT_ENTRY",
        description: "Foursome, 2026 golf tournament, including cart and banquet seats",
        quantity: 1,
        unitFairMarketValueCents: 90_000,
      },
    ],
    benefitFairMarketValueCents: 90_000,
    sponsorshipId: null,
    status: "PAID",
    receivedAt: "2026-04-18T09:15:00Z",
    checkoutSessionRef: "co_stub_jsof_0003",
    createdById: "sys-checkout",
  },
  {
    id: "d-jsof-004",
    entity: "JSOF",
    donorDisplayName: "Aurelio Santangelo",
    donorEmail: "a.santangelo@example.org",
    amountCents: 250_000,
    currency: "USD",
    allocations: [{ fundId: "fund-jsof-general", amountCents: 250_000 }],
    benefits: [
      {
        kind: "BANQUET_SEAT",
        description: "Two seats at the awards banquet",
        quantity: 2,
        unitFairMarketValueCents: 12_500,
      },
    ],
    // Recorded by hand and never valued. This gift cannot be receipted.
    benefitFairMarketValueCents: null,
    sponsorshipId: null,
    status: "PAID",
    receivedAt: "2026-04-21T16:55:00Z",
    checkoutSessionRef: null,
    createdById: "p-treasurer-jsof",
  },
  {
    id: "d-jsof-005",
    entity: "JSOF",
    donorDisplayName: "Winnifred Castellan",
    donorEmail: "w.castellan@example.org",
    amountCents: 75_000,
    currency: "USD",
    allocations: [{ fundId: "fund-jsof-family", amountCents: 75_000 }],
    benefits: [],
    benefitFairMarketValueCents: null,
    sponsorshipId: null,
    status: "AWAITING_PAYMENT",
    receivedAt: "2026-04-29T20:10:00Z",
    checkoutSessionRef: "co_stub_jsof_0005",
    createdById: "sys-checkout",
  },
  {
    id: "d-jsoa-001",
    entity: "JSOA",
    donorDisplayName: "Cornelius Redfearn",
    donorEmail: "c.redfearn@example.org",
    amountCents: 50_000,
    currency: "USD",
    allocations: [{ fundId: "fund-jsoa-memorial", amountCents: 50_000 }],
    benefits: [],
    benefitFairMarketValueCents: null,
    sponsorshipId: null,
    status: "PAID",
    receivedAt: "2026-02-27T13:05:00Z",
    checkoutSessionRef: "co_stub_jsoa_0001",
    createdById: "sys-checkout",
  },
  {
    id: "d-jsoa-002",
    entity: "JSOA",
    donorDisplayName: "Philippa Vandermeer",
    donorEmail: "p.vandermeer@example.org",
    amountCents: 120_000,
    currency: "USD",
    allocations: [
      { fundId: "fund-jsoa-ball", amountCents: 90_000 },
      { fundId: "fund-jsoa-operating", amountCents: 30_000 },
    ],
    benefits: [
      {
        kind: "EVENT_TICKET",
        description: "Two tickets to the annual ball",
        quantity: 2,
        unitFairMarketValueCents: 22_500,
      },
    ],
    benefitFairMarketValueCents: 45_000,
    sponsorshipId: null,
    status: "PAID",
    receivedAt: "2026-03-08T18:22:00Z",
    checkoutSessionRef: "co_stub_jsoa_0002",
    createdById: "sys-checkout",
  },
];

export const SEED_SPONSORSHIPS: Sponsorship[] = [
  {
    id: "s-jsof-001",
    entity: "JSOF",
    sponsorName: "Piedmont Ironworks",
    eventName: "2026 Golf Tournament",
    tier: "Tee sponsor",
    paymentCents: 250_000,
    currency: "USD",
    contingentOnAttendanceOrImpressions: false,
    exclusivity: "NONE",
    receivedAt: "2026-02-10T14:00:00Z",
    createdById: "p-fundraising-chair",
    placements: [
      {
        id: "pl-jsof-001-a",
        sponsorshipId: "s-jsof-001",
        entity: "JSOF",
        kind: "SIGNAGE",
        approvedAcknowledgmentString:
          "Piedmont Ironworks. Structural steel fabrication. Sanford, North Carolina. " +
          "piedmontironworks.example",
        benefitFairMarketValueCents: 400,
        publicationState: "APPROVED",
        approvedById: "p-vp-operations",
        authoredById: "p-fundraising-chair",
        notes: "Single tee sign, hole 7.",
      },
    ],
  },
  {
    id: "s-jsof-002",
    entity: "JSOF",
    sponsorName: "Carraway Diesel & Fleet",
    eventName: "2026 Golf Tournament",
    tier: "Presenting sponsor",
    paymentCents: 1_500_000,
    currency: "USD",
    contingentOnAttendanceOrImpressions: false,
    exclusivity: "NONE",
    receivedAt: "2026-02-11T10:30:00Z",
    createdById: "p-fundraising-chair",
    placements: [
      {
        id: "pl-jsof-002-a",
        sponsorshipId: "s-jsof-002",
        entity: "JSOF",
        kind: "EVENT_TSHIRT",
        approvedAcknowledgmentString:
          "Carraway Diesel & Fleet. Heavy equipment service. Dunn, North Carolina.",
        benefitFairMarketValueCents: 15_000,
        publicationState: "APPROVED",
        approvedById: "p-vp-operations",
        authoredById: "p-fundraising-chair",
        notes: "Logo, shirt back, 240 shirts.",
      },
      {
        id: "pl-jsof-002-b",
        sponsorshipId: "s-jsof-002",
        entity: "JSOF",
        kind: "SIGNAGE",
        approvedAcknowledgmentString:
          "Carraway Diesel & Fleet. Heavy equipment service. Dunn, North Carolina.",
        benefitFairMarketValueCents: 5_000,
        publicationState: "APPROVED",
        approvedById: "p-vp-operations",
        authoredById: "p-fundraising-chair",
        notes: "Banner at registration and at the first tee.",
      },
      {
        id: "pl-jsof-002-c",
        sponsorshipId: "s-jsof-002",
        entity: "JSOF",
        kind: "PROGRAMME_AD",
        approvedAcknowledgmentString:
          "Carraway Diesel & Fleet. Heavy equipment service, parts and roadside " +
          "recovery. Dunn, North Carolina. 24-hour dispatch.",
        benefitFairMarketValueCents: 25_000,
        publicationState: "AWAITING_RELEASE",
        approvedById: null,
        authoredById: "p-fundraising-chair",
        notes: "Full page, inside front cover. Advertising, not acknowledgment.",
      },
    ],
  },
  {
    id: "s-jsof-003",
    entity: "JSOF",
    sponsorName: "Halverson Optics",
    eventName: "2026 Golf Tournament",
    tier: "Hole-in-one sponsor",
    paymentCents: 750_000,
    currency: "USD",
    contingentOnAttendanceOrImpressions: false,
    exclusivity: "EXCLUSIVE_SPONSOR",
    receivedAt: "2026-03-01T09:00:00Z",
    createdById: "p-fundraising-chair",
    placements: [
      {
        id: "pl-jsof-003-a",
        sponsorshipId: "s-jsof-003",
        entity: "JSOF",
        kind: "WEBSITE_FOOTER",
        // Sponsor-supplied copy, not yet cleaned up. The validator flags it.
        approvedAcknowledgmentString:
          "Halverson Optics, the region's leading name in precision optics. " +
          "Save 10% on your first order. Call today.",
        benefitFairMarketValueCents: 0,
        publicationState: "DRAFT",
        approvedById: null,
        authoredById: "p-fundraising-chair",
        notes: "Sponsor sent this wording. Needs rewriting before it goes near the site.",
      },
      {
        id: "pl-jsof-003-b",
        sponsorshipId: "s-jsof-003",
        entity: "JSOF",
        kind: "SIGNAGE",
        approvedAcknowledgmentString:
          "Halverson Optics. Precision optics. Southern Pines, North Carolina.",
        benefitFairMarketValueCents: 15_100,
        publicationState: "APPROVED",
        approvedById: "p-vp-operations",
        authoredById: "p-fundraising-chair",
        notes: "Signage plus two rounds of golf valued at the club's public rate.",
      },
    ],
  },
  {
    id: "s-jsoa-001",
    entity: "JSOA",
    sponsorName: "Two Rivers Title Company",
    eventName: "2026 Annual Ball",
    tier: "Table sponsor",
    paymentCents: 500_000,
    currency: "USD",
    contingentOnAttendanceOrImpressions: false,
    exclusivity: "NONE",
    receivedAt: "2026-01-22T15:45:00Z",
    createdById: "p-fundraising-chair",
    placements: [
      {
        id: "pl-jsoa-001-a",
        sponsorshipId: "s-jsoa-001",
        entity: "JSOA",
        kind: "PROGRAMME_AD",
        approvedAcknowledgmentString:
          "Two Rivers Title Company. Residential and commercial closings. " +
          "Fayetteville, North Carolina.",
        // Exactly 2% of the payment: inside the harbour, not outside it.
        benefitFairMarketValueCents: 10_000,
        publicationState: "APPROVED",
        approvedById: "p-secretary",
        authoredById: "p-fundraising-chair",
        notes: "Full page in the ball programme. Advertising, reported separately.",
      },
    ],
  },
];
