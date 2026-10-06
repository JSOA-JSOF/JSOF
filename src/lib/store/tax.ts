/**
 * North Carolina sales and use tax for the store.
 *
 * The premise this file is built on: a 501(c)(19) or 501(c)(3) exemption is an
 * exemption from income tax. It is not an exemption from collecting sales tax
 * on merchandise. North Carolina requires the organization to register, collect
 * on taxable retail sales, and remit. The organization's own purchases are a
 * separate question (NC repealed the nonprofit refund cap regime's generosity
 * in stages and a purchase exemption is not assumed here either way).
 *
 * There is an annual-fundraising exemption, and it does not help a year-round
 * store. Its conditions are conjunctive, so failing one fails all of them, and
 * a permanent catalogue fails at least two outright. `ANNUAL_FUNDRAISING_
 * EXEMPTION_CONDITIONS` below records them so the board can see why the answer
 * is no, rather than being told it is no.
 *
 * Rates are integer basis points. 700 basis points is 7.00 percent. No float
 * is used anywhere in this module.
 *
 * CPA. The rates in the table are placeholders for a demo. See
 * `TAX_RATE_SOURCING_NOTE` for how this must be wired for real.
 */

import type { ShipTo, TaxTreatment } from "./types";

export type TaxJurisdiction = {
  code: string;
  label: string;
  /** State general rate. */
  stateBasisPoints: number;
  /** County local rate, including any transit or special district rate. */
  localBasisPoints: number;
};

/**
 * NC sources a delivered sale to the destination, so the rate follows the
 * ship-to county and not the seller's location. The real table has one row per
 * county plus transit districts; these four are the ones the demo seed uses.
 */
export const TAX_JURISDICTIONS: TaxJurisdiction[] = [
  {
    code: "NC-CUMBERLAND",
    label: "Cumberland County, NC",
    stateBasisPoints: 475,
    localBasisPoints: 225,
  },
  {
    code: "NC-WAKE",
    label: "Wake County, NC",
    stateBasisPoints: 475,
    localBasisPoints: 250,
  },
  {
    code: "NC-MECKLENBURG",
    label: "Mecklenburg County, NC",
    stateBasisPoints: 475,
    localBasisPoints: 275,
  },
  {
    code: "NC-ONSLOW",
    label: "Onslow County, NC",
    stateBasisPoints: 475,
    localBasisPoints: 225,
  },
];

/**
 * Used for an in-person pickup at a JSOA event, and as the fallback when a
 * ship-to county is not in the table. Falling back to a rate is the wrong
 * behaviour for production and the right behaviour for a demo: see the note.
 */
export const DEFAULT_TAX_JURISDICTION_CODE = "NC-CUMBERLAND";

/**
 * Sales outside North Carolina are not charged here. Economic nexus in another
 * state is a threshold question the board has not been asked yet, and charging
 * a rate the organization is not registered to remit is worse than charging
 * none. An out-of-state order is recorded with a zero rate and a jurisdiction
 * code that says why, so the figure is reviewable rather than invisible.
 */
export const OUT_OF_STATE_JURISDICTION: TaxJurisdiction = {
  code: "OUT-OF-STATE-NOT-REGISTERED",
  label: "Outside NC, no collection obligation established",
  stateBasisPoints: 0,
  localBasisPoints: 0,
};

export const TAX_RATE_SOURCING_NOTE =
  "Rates in this table are demo placeholders. For real, the rate must come " +
  "from a rate service keyed on the ship-to address, refreshed on the state's " +
  "schedule, with the rate in force on the transaction date stored on the " +
  "order so a later rate change cannot alter a filed period. A hardcoded " +
  "table goes stale the first time a county changes its local rate.";

export function jurisdictionByCode(code: string): TaxJurisdiction {
  if (code === OUT_OF_STATE_JURISDICTION.code) return OUT_OF_STATE_JURISDICTION;
  const found = TAX_JURISDICTIONS.find((j) => j.code === code);
  if (found) return found;
  const fallback = TAX_JURISDICTIONS.find((j) => j.code === DEFAULT_TAX_JURISDICTION_CODE);
  if (!fallback) throw new Error("No tax jurisdiction table entry to fall back to");
  return fallback;
}

/** Destination sourcing: the county the goods go to decides the rate. */
export function resolveJurisdiction(shipTo: ShipTo): TaxJurisdiction {
  if (shipTo.state.trim().toUpperCase() !== "NC") return OUT_OF_STATE_JURISDICTION;
  const wanted = shipTo.county.trim().toLowerCase();
  const found = TAX_JURISDICTIONS.find(
    (j) => j.label.toLowerCase().startsWith(wanted) && wanted.length > 0,
  );
  return found ?? jurisdictionByCode(DEFAULT_TAX_JURISDICTION_CODE);
}

export function combinedBasisPoints(jurisdiction: TaxJurisdiction): number {
  return jurisdiction.stateBasisPoints + jurisdiction.localBasisPoints;
}

/** Whether a line is in the tax base at all. */
export function isTaxable(treatment: TaxTreatment): boolean {
  return treatment === "tangible_goods";
}

/**
 * Tax on a base, half-up to the cent, computed once on the taxable subtotal
 * rather than per line. Per-line rounding on a five-item order drifts from the
 * figure on the remittance by a cent or two, and the return is what has to
 * reconcile.
 */
export function taxOn(taxableBaseCents: number, rateBasisPoints: number): number {
  if (taxableBaseCents <= 0 || rateBasisPoints <= 0) return 0;
  return Math.round((taxableBaseCents * rateBasisPoints) / 10_000);
}

export function formatRate(rateBasisPoints: number): string {
  return `${(rateBasisPoints / 100).toFixed(2)}%`;
}

/* ------------------------------------------------------------------ *
 * Why the fundraising exemption does not apply.
 * ------------------------------------------------------------------ */

export type ExemptionCondition = {
  condition: string;
  metByYearRoundStore: boolean;
  why: string;
};

/**
 * All six must hold. A year-round catalogue fails the sales-period and the
 * distinct-products conditions on its face, and a stocked store cannot promise
 * delivery within 60 days of the order for every line either.
 */
export const ANNUAL_FUNDRAISING_EXEMPTION_CONDITIONS: ExemptionCondition[] = [
  {
    condition: "The seller is a qualifying nonprofit or school organisation.",
    metByYearRoundStore: true,
    why: "The Association qualifies as an organisation. This is the only condition it meets cleanly.",
  },
  {
    condition: "Sales are part of an annual fundraising event, limited in number per year.",
    metByYearRoundStore: false,
    why: "A catalogue that takes orders every day is not an event.",
  },
  {
    condition: "Each sales period offers products distinct from the other periods.",
    metByYearRoundStore: false,
    why: "The core catalogue is the same coin, cap and polo all year.",
  },
  {
    condition: "Goods are delivered within 60 days of the order.",
    metByYearRoundStore: false,
    why: "Backorders and print-on-demand runs both break the window.",
  },
  {
    condition: "The organisation does not maintain inventory for resale outside the event.",
    metByYearRoundStore: false,
    why: "Holding stock for a standing catalogue is exactly that.",
  },
  {
    condition: "Proceeds are used for the organisation's purposes, not private benefit.",
    metByYearRoundStore: true,
    why: "Met, but it is one of six and the conditions are conjunctive.",
  },
];

export function annualFundraisingExemptionApplies(): boolean {
  return ANNUAL_FUNDRAISING_EXEMPTION_CONDITIONS.every((c) => c.metByYearRoundStore);
}

export const COLLECTION_POSTURE_NOTE =
  "The store collects North Carolina sales tax on merchandise. Exemption from " +
  "federal income tax is not exemption from collecting sales tax, and the " +
  "annual-fundraising exemption cannot cover a catalogue that is open all year.";
