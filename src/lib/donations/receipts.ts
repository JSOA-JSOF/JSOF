/**
 * Receipts. Per entity, never shared.
 *
 * Three things here are statutory rather than editorial, and all three are
 * encoded so that no one has to remember them:
 *
 * 1. N.C.G.S. Chapter 131F disclosure. Verbatim, on every written
 *    confirmation, receipt or reminder of a contribution, from BOTH entities.
 *    Minimum nine-point type, made conspicuous by underlining, border or bold.
 *    The size and the emphasis are part of the requirement, so the renderer
 *    emits them and `assertDisclosureConspicuous` checks the output.
 *
 * 2. IRS Pub. 1771 "no goods or services" language on a JSOF contribution
 *    where that is true. JSOA gets a dues-and-benefits disclaimer instead;
 *    the two templates share no paragraph.
 *
 * 3. Quid pro quo. Where a gift carries benefits, the receipt states the fair
 *    market value of those benefits and that only the excess is deductible. A
 *    gift with benefits and no recorded fair market value cannot produce a
 *    receipt at all — `buildReceipt` refuses, by design.
 *
 * Research, not advice. The EIN is a placeholder and the Branch telephone
 * number must be confirmed against the Secretary of State's current
 * publication before anything is sent. COUNSEL.
 */

import type { Entity } from "../authz/model";
import type { Draft } from "../comms/types";
import { formatCents, sumCents } from "./money";
import { validateAllocations } from "./allocation";
import {
  NC_131F_DISCLOSURE,
  NC_131F_STATUTE_LABEL,
  NC_131F_TYPE,
} from "./disclosure";
import type { Donation, Fund, GiftBenefit } from "./types";

/* ------------------------------------------------------------------ *
 * The NC Chapter 131F disclosure statement
 *
 * The text and the type specification live in disclosure.ts, because the
 * donor-facing page needs the same verbatim sentence and two copies of it is
 * one copy too many. Re-exported here so receipt code has one import.
 * ------------------------------------------------------------------ */

export {
  NC_131F_DISCLOSURE,
  NC_131F_STATUTE_LABEL,
  NC_131F_TYPE,
} from "./disclosure";

export type Disclosure = {
  statute: "N.C.G.S. Chapter 131F";
  text: string;
  minPointSize: number;
  declaredPointSize: number;
  bold: boolean;
  bordered: boolean;
};

export const NC_131F: Disclosure = {
  statute: NC_131F_STATUTE_LABEL,
  text: NC_131F_DISCLOSURE,
  minPointSize: NC_131F_TYPE.minPointSize,
  declaredPointSize: NC_131F_TYPE.declaredPointSize,
  bold: NC_131F_TYPE.bold,
  bordered: NC_131F_TYPE.bordered,
};

/* ------------------------------------------------------------------ *
 * Entity identity on a receipt
 * ------------------------------------------------------------------ */

export type EntityReceiptIdentity = {
  entity: Entity;
  legalName: string;
  subsection: string;
  /** Placeholder. The real EIN is not in this repository. */
  einPlaceholder: string;
  templateId: ReceiptTemplateId;
  receiptPrefix: string;
};

export type ReceiptTemplateId = "JSOF_CONTRIBUTION_V1" | "JSOA_PAYMENT_V1";

export const ENTITY_IDENTITY: Record<Entity, EntityReceiptIdentity> = {
  JSOF: {
    entity: "JSOF",
    legalName: "Joint Special Operations Foundation",
    subsection: "501(c)(3)",
    einPlaceholder: "EIN 00-0000000",
    templateId: "JSOF_CONTRIBUTION_V1",
    receiptPrefix: "JSOF-R",
  },
  JSOA: {
    entity: "JSOA",
    legalName: "Joint Special Operations Association",
    subsection: "501(c)(19)",
    einPlaceholder: "EIN 00-0000000",
    templateId: "JSOA_PAYMENT_V1",
    receiptPrefix: "JSOA-R",
  },
};

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

export type ReceiptRefusalCode =
  | "BENEFITS_WITHOUT_FMV"
  | "FMV_WITHOUT_BENEFITS"
  | "FMV_NOT_LESS_THAN_PAYMENT"
  | "NOT_PAID"
  | "ALLOCATIONS_DO_NOT_SUM"
  | "DISCLOSURE_NOT_CONSPICUOUS";

export class ReceiptError extends Error {
  constructor(
    message: string,
    readonly code: ReceiptRefusalCode,
  ) {
    super(message);
    this.name = "ReceiptError";
  }
}

/* ------------------------------------------------------------------ *
 * The receipt
 * ------------------------------------------------------------------ */

export type ReceiptAllocationLine = {
  fundName: string;
  restriction: string;
  amountCents: number;
};

export type Receipt = {
  templateId: ReceiptTemplateId;
  entity: Entity;
  receiptNumber: string;
  identity: EntityReceiptIdentity;
  donationId: string;
  donorDisplayName: string;
  issuedOn: string;
  /** What the donor paid. */
  amountCents: number;
  /** Fair market value of anything they received back. Zero for a pure gift. */
  benefitFairMarketValueCents: number;
  /**
   * Payment less benefit value. For JSOF this is the deductible amount. For
   * JSOA it is the excess over benefits, which is a different thing and the
   * JSOA template says so.
   */
  excessOverBenefitsCents: number;
  benefits: GiftBenefit[];
  allocations: ReceiptAllocationLine[];
  /** Paragraph blocks, in order. Entity-specific; the sets never overlap. */
  body: string[];
  disclosure: Disclosure;
};

export type BuildReceiptInput = {
  donation: Donation;
  funds: Fund[];
  /** Sequence number within the entity. Receipts are numbered per entity. */
  sequence: number;
  issuedOn?: string;
};

export function totalBenefitFairMarketValueCents(benefits: GiftBenefit[]): number {
  return sumCents(benefits.map((b) => b.quantity * b.unitFairMarketValueCents));
}

/**
 * Builds a receipt or refuses. It never returns a receipt with a missing
 * statement, and it never falls back to the other entity's template.
 */
export function buildReceipt(input: BuildReceiptInput): Receipt {
  const { donation, funds, sequence } = input;
  const identity = ENTITY_IDENTITY[donation.entity];

  if (donation.status !== "PAID") {
    throw new ReceiptError(
      `Gift ${donation.id} is ${donation.status}, not PAID. A receipt confirms money ` +
        "that arrived, so there is nothing to confirm yet.",
      "NOT_PAID",
    );
  }

  const hasBenefits = donation.benefits.length > 0;
  const fmv = donation.benefitFairMarketValueCents;

  // The refusal the brief asks for, stated in terms of what to do next.
  if (hasBenefits && fmv === null) {
    throw new ReceiptError(
      `Gift ${donation.id} carries ${donation.benefits.length} benefit ` +
        `${donation.benefits.length === 1 ? "item" : "items"} ` +
        `(${donation.benefits.map((b) => b.description).join(", ")}) and no fair market ` +
        "value has been recorded. A receipt for a gift with benefits has to state the " +
        "value of those benefits and that only the excess is deductible, so this " +
        "receipt cannot be issued. Record benefitFairMarketValueCents on the gift first.",
      "BENEFITS_WITHOUT_FMV",
    );
  }

  if (!hasBenefits && fmv !== null && fmv !== 0) {
    throw new ReceiptError(
      `Gift ${donation.id} records a benefit value of ${formatCents(fmv)} but lists no ` +
        "benefits. Either add what the donor received or clear the value.",
      "FMV_WITHOUT_BENEFITS",
    );
  }

  const benefitCents = fmv ?? 0;

  if (hasBenefits && benefitCents >= donation.amountCents) {
    throw new ReceiptError(
      `Gift ${donation.id} is ${formatCents(donation.amountCents)} against benefits ` +
        `valued at ${formatCents(benefitCents)}. Nothing was contributed above the ` +
        "value received, so this is a purchase and not a gift. Record it as a sale " +
        "instead, or re-examine the valuation.",
      "FMV_NOT_LESS_THAN_PAYMENT",
    );
  }

  const allocationCheck = validateAllocations({
    entity: donation.entity,
    totalCents: donation.amountCents,
    allocations: donation.allocations,
    funds,
    allowClosedFunds: true,
  });
  if (!allocationCheck.ok) {
    throw new ReceiptError(
      `Gift ${donation.id} cannot be receipted: ${allocationCheck.message}`,
      "ALLOCATIONS_DO_NOT_SUM",
    );
  }

  const allocations: ReceiptAllocationLine[] = donation.allocations.map((allocation) => {
    const fund = funds.find((f) => f.id === allocation.fundId);
    return {
      fundName: fund ? fund.name : allocation.fundId,
      restriction: fund ? fund.restriction : "UNRESTRICTED",
      amountCents: allocation.amountCents,
    };
  });

  const excess = donation.amountCents - benefitCents;

  const body =
    donation.entity === "JSOF"
      ? jsofBody(donation, benefitCents, excess)
      : jsoaBody(donation, benefitCents, excess);

  return {
    templateId: identity.templateId,
    entity: donation.entity,
    receiptNumber: `${identity.receiptPrefix}-${String(sequence).padStart(5, "0")}`,
    identity,
    donationId: donation.id,
    donorDisplayName: donation.donorDisplayName,
    issuedOn: input.issuedOn ?? donation.receivedAt,
    amountCents: donation.amountCents,
    benefitFairMarketValueCents: benefitCents,
    excessOverBenefitsCents: excess,
    benefits: donation.benefits,
    allocations,
    body,
    disclosure: NC_131F,
  };
}

/* ------------------------------------------------------------------ *
 * The two templates. No paragraph appears in both.
 * ------------------------------------------------------------------ */

const JSOF_NO_GOODS_OR_SERVICES =
  "No goods or services were provided in exchange for this contribution.";

const JSOA_DUES_AND_BENEFITS =
  "The Joint Special Operations Association is a veterans' organization exempt under " +
  "section 501(c)(19), not a charitable organization. Membership dues and any payment " +
  "that carries member benefits are not deductible as a charitable contribution. " +
  "Where a gift to the " +
  "Association is deductible at all, it is because the Association satisfies the " +
  "statutory war-veteran membership test in the year of the gift. This receipt is a " +
  "record of payment and is not a determination of deductibility. Ask your tax " +
  "adviser how this payment should be treated on your return.";

function jsofBody(donation: Donation, benefitCents: number, excess: number): string[] {
  const identity = ENTITY_IDENTITY.JSOF;
  const paragraphs = [
    `${identity.legalName} is recognised as exempt under section 501(c)(3) of the ` +
      `Internal Revenue Code. ${identity.einPlaceholder}.`,
  ];

  if (donation.benefits.length === 0) {
    paragraphs.push(JSOF_NO_GOODS_OR_SERVICES);
    paragraphs.push(
      `The full ${formatCents(donation.amountCents)} may be treated as a charitable ` +
        "contribution, subject to the limits that apply to you.",
    );
  } else {
    paragraphs.push(
      "Goods or services were provided in exchange for part of this payment. " +
        `Their fair market value is ${formatCents(benefitCents)}: ` +
        `${describeBenefits(donation.benefits)}.`,
    );
    paragraphs.push(
      `Only the excess of the payment over that value is deductible as a charitable ` +
        `contribution. On this payment the deductible portion is ` +
        `${formatCents(excess)} — ${formatCents(donation.amountCents)} paid less ` +
        `${formatCents(benefitCents)} received.`,
    );
  }

  paragraphs.push(
    "Keep this receipt with your tax records. The Foundation does not provide tax advice.",
  );
  return paragraphs;
}

function jsoaBody(donation: Donation, benefitCents: number, excess: number): string[] {
  const identity = ENTITY_IDENTITY.JSOA;
  const paragraphs = [
    `${identity.legalName} is exempt under section 501(c)(19) of the Internal ` +
      `Revenue Code. ${identity.einPlaceholder}.`,
    JSOA_DUES_AND_BENEFITS,
  ];

  if (donation.benefits.length > 0) {
    paragraphs.push(
      "You received goods or services in exchange for part of this payment. Their " +
        `fair market value is ${formatCents(benefitCents)}: ` +
        `${describeBenefits(donation.benefits)}. Only the excess over that value — ` +
        `${formatCents(excess)} — could be deductible, and only if the Association ` +
        "meets the war-veteran membership test for this year.",
    );
  }

  paragraphs.push(
    "Keep this receipt with your records. The Association does not provide tax advice.",
  );
  return paragraphs;
}

function describeBenefits(benefits: GiftBenefit[]): string {
  return benefits
    .map(
      (b) =>
        `${b.quantity} × ${b.description} at ${formatCents(b.unitFairMarketValueCents)} each`,
    )
    .join("; ");
}

/* ------------------------------------------------------------------ *
 * Rendering
 *
 * Receipts go out by mail, so the styles are inline and there is no external
 * resource of any kind: no font host, no image, no tracking pixel. See
 * docs/PRIVACY-AND-PAYMENTS.md on tags.
 * ------------------------------------------------------------------ */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The disclosure block, carrying its statutory size and emphasis. */
export function renderDisclosureHtml(disclosure: Disclosure = NC_131F): string {
  const style = [
    `font-size:${disclosure.declaredPointSize}pt`,
    "line-height:1.35",
    disclosure.bold ? "font-weight:700" : "",
    disclosure.bordered ? "border:1.5pt solid #000000" : "",
    "padding:8pt",
    "margin:16pt 0 0",
  ]
    .filter(Boolean)
    .join(";");
  return `<p data-statute="131F" style="${style}">${escapeHtml(disclosure.text)}</p>`;
}

export function renderReceiptHtml(receipt: Receipt): string {
  const rows = receipt.allocations
    .map(
      (line) =>
        `<tr><td style="padding:2pt 12pt 2pt 0">${escapeHtml(line.fundName)}` +
        ` (${escapeHtml(line.restriction.toLowerCase())})</td>` +
        `<td style="padding:2pt 0;text-align:right;font-variant-numeric:tabular-nums">` +
        `${escapeHtml(formatCents(line.amountCents))}</td></tr>`,
    )
    .join("");

  return [
    `<div data-template="${receipt.templateId}" data-entity="${receipt.entity}"`,
    ` style="font-family:Georgia,serif;font-size:11pt;color:#000000;max-width:6.5in">`,
    `<h1 style="font-size:14pt;margin:0">${escapeHtml(receipt.identity.legalName)}</h1>`,
    `<p style="font-size:10pt;margin:2pt 0 14pt">${escapeHtml(receipt.identity.subsection)}`,
    ` · ${escapeHtml(receipt.identity.einPlaceholder)}</p>`,
    `<p style="margin:0 0 4pt"><strong>Receipt ${escapeHtml(receipt.receiptNumber)}</strong></p>`,
    `<p style="margin:0 0 4pt">${escapeHtml(receipt.donorDisplayName)}</p>`,
    `<p style="margin:0 0 14pt">Received ${escapeHtml(receipt.issuedOn)} ·`,
    ` ${escapeHtml(formatCents(receipt.amountCents))}</p>`,
    `<table style="border-collapse:collapse;margin:0 0 14pt">${rows}</table>`,
    receipt.body
      .map((paragraph) => `<p style="margin:0 0 10pt">${escapeHtml(paragraph)}</p>`)
      .join(""),
    renderDisclosureHtml(receipt.disclosure),
    `</div>`,
  ].join("");
}

/** Plain-text alternative. Emphasis becomes a rule above and below. */
export function renderReceiptText(receipt: Receipt): string {
  const lines = [
    receipt.identity.legalName,
    `${receipt.identity.subsection} · ${receipt.identity.einPlaceholder}`,
    "",
    `Receipt ${receipt.receiptNumber}`,
    receipt.donorDisplayName,
    `Received ${receipt.issuedOn} · ${formatCents(receipt.amountCents)}`,
    "",
    ...receipt.allocations.map(
      (line) => `  ${line.fundName} (${line.restriction.toLowerCase()})  ${formatCents(line.amountCents)}`,
    ),
    "",
    ...receipt.body.flatMap((paragraph) => [paragraph, ""]),
    "".padEnd(64, "="),
    receipt.disclosure.text,
    "".padEnd(64, "="),
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * The formatting requirement, as a check rather than a hope
 * ------------------------------------------------------------------ */

export type DisclosureCheck = { ok: true } | { ok: false; problems: string[] };

/**
 * Asserts that rendered output actually carries the disclosure at or above
 * nine points and conspicuously. Tests call this against the real renderer so
 * that a later styling change cannot quietly drop below the statutory floor.
 */
export function checkDisclosureConspicuous(html: string): DisclosureCheck {
  const problems: string[] = [];

  if (!html.includes(escapeHtml(NC_131F_DISCLOSURE))) {
    problems.push("The Chapter 131F disclosure text is missing or has been altered.");
  }

  const sizes = [...html.matchAll(/font-size:\s*([\d.]+)pt/g)].map((m) => Number(m[1]));
  const block = html.match(/data-statute="131F"[^>]*style="([^"]*)"/);
  if (!block) {
    problems.push("The disclosure is not rendered in its own marked block.");
  } else {
    const style = block[1];
    const size = style.match(/font-size:\s*([\d.]+)pt/);
    if (!size || Number(size[1]) < NC_131F_TYPE.minPointSize) {
      problems.push(
        `The disclosure must be set at ${NC_131F_TYPE.minPointSize}pt or larger.`,
      );
    }
    const bold = /font-weight:\s*(700|800|900|bold)/.test(style);
    const bordered = /border(-[a-z]+)?:\s*[^;]*\d/.test(style);
    const underlined = /text-decoration:[^;]*underline/.test(style);
    if (!bold && !bordered && !underlined) {
      problems.push(
        "The disclosure must be made conspicuous by bold, a border, or underlining.",
      );
    }
  }

  if (sizes.length > 0 && Math.min(...sizes) < NC_131F_TYPE.minPointSize) {
    problems.push("Some type on the receipt is set below nine points.");
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

export function assertDisclosureConspicuous(html: string): void {
  const result = checkDisclosureConspicuous(html);
  if (!result.ok) {
    throw new ReceiptError(
      `Receipt formatting fails the Chapter 131F requirement: ${result.problems.join(" ")}`,
      "DISCLOSURE_NOT_CONSPICUOUS",
    );
  }
}

/* ------------------------------------------------------------------ *
 * Handing the receipt to somebody
 *
 * This file used to render a statutory acknowledgment and hand it to nobody.
 * The draft below is what goes to the outbox. It is a pure function so that
 * it can be tested without a database and without a mail provider, and so
 * that the one decision that matters here is visible in four lines.
 * ------------------------------------------------------------------ */

/** The outbox's `kind` for a donation receipt. The module's own name for it. */
export const RECEIPT_MESSAGE_KIND = "DONATION_RECEIPT";

/**
 * The message a receipt becomes.
 *
 * Two things are load-bearing and neither is negotiable.
 *
 * **`entity` comes off the receipt, which came off the gift.** It is never a
 * screen's current entity and never an argument a caller chooses. `enqueue`
 * resolves the sending identity from it, so this single field decides whose
 * envelope a donor finds in their inbox. A 501(c)(19) receipt arriving from
 * the Foundation is the board review's heaviest finding — the two entities
 * blurred — repeated in the one artifact a donor keeps and files. The
 * Association's domain cannot send yet, so an Association receipt queues and
 * waits; borrowing the Foundation's verified domain because that one works is
 * exactly the shortcut being refused.
 *
 * **`stream` is TRANSACTIONAL.** A receipt is a consequence of something the
 * donor did. A donor who unsubscribed from the newsletter still gets it.
 *
 * A null address is passed through rather than guarded: the queue writes an
 * UNDELIVERABLE row for it, which is a recorded outcome and not an error.
 *
 * **What this cannot do, stated rather than hidden.** `outbound_message`
 * carries `body_text` and no HTML column, so what leaves the queue is the
 * plain-text rendering. The statute asks for nine-point type made conspicuous
 * by underlining, a border or bold, and a plain-text body has none of the
 * three: `renderReceiptText` sets the statement between two rules, which is
 * as close as text gets. `renderReceiptHtml` produces the artifact that
 * actually meets the formatting requirement and there is nowhere in the
 * outbox to put it. That is a column this module needs and does not own —
 * reported, not worked around.
 */
export function receiptDraft(receipt: Receipt, donorEmail: string | null): Draft {
  const bodyText = renderReceiptText(receipt);

  // The statutory sentence has to be in the thing that is actually sent, not
  // only in the thing that was rendered for the screen. Checked here because
  // this is the last point before the message is somebody else's problem.
  if (!bodyText.includes(NC_131F_DISCLOSURE)) {
    throw new ReceiptError(
      "The receipt body does not carry the Chapter 131F disclosure verbatim, so " +
        "it cannot be sent. The statement is required on every written " +
        "confirmation or receipt of a contribution.",
      "DISCLOSURE_NOT_CONSPICUOUS",
    );
  }

  const address = donorEmail?.trim() ?? "";

  return {
    stream: "TRANSACTIONAL",
    entity: receipt.entity,
    kind: RECEIPT_MESSAGE_KIND,
    toAddress: address.length > 0 ? address : null,
    toName: receipt.donorDisplayName,
    subject: `${receipt.identity.legalName} · receipt ${receipt.receiptNumber}`,
    bodyText,
  };
}

/** Phrases that must never appear on the other entity's receipt. */
export const TEMPLATE_FINGERPRINTS: Record<ReceiptTemplateId, string[]> = {
  JSOF_CONTRIBUTION_V1: [
    "501(c)(3)",
    "No goods or services were provided",
    "Joint Special Operations Foundation",
  ],
  JSOA_PAYMENT_V1: [
    "501(c)(19)",
    "Membership dues and any payment that carries member benefits are not deductible",
    "Joint Special Operations Association",
  ],
};
