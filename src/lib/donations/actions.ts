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
import {
  assertReleasable,
  authorize,
  can,
  hasCapability,
  AuthzError,
  type Subject,
} from "../authz/policy";
import { enqueue } from "../comms/queue";
import type { OutboundMessage } from "../comms/types";
import { validateAllocations, type AllocationResult } from "./allocation";
import { buildCheckoutHandoff, type CheckoutHandoff } from "./checkout";
import { formatCents } from "./money";
import {
  donationsRepository,
  type DonationsRepository,
  type FundDraft,
  type GiftBehindFund,
  type PlacementDraft,
  type SponsorshipDraft,
} from "./repository";
import {
  assertDisclosureConspicuous,
  buildReceipt,
  receiptDraft,
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
  type Fund,
  type FundBalance,
  type GiftBenefit,
  type PlacementCategory,
  type SponsorPlacement,
  type Sponsorship,
} from "./types";

type Repo = DonationsRepository;

/**
 * The repository, resolved per call.
 *
 * `donationsRepository()` returns the D1 implementation when there is a
 * binding and the seeded in-memory one when there is not, so this is a call
 * rather than a captured instance. Every handler below takes it as a default
 * argument, which is how the test suite injects its own.
 *
 * Every read and write through it is awaited: the interface is async because
 * D1 is, and nothing in this file holds a promise it does not wait for.
 */
const defaultRepo = (): Repo => donationsRepository();

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

export async function listPublicFundOptions(
  entity: Entity,
  repo: Repo = defaultRepo(),
): Promise<PublicFundOption[]> {
  const funds = await repo.listFunds(entity);
  return funds
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

export async function prepareDonationIntent(
  input: PrepareIntentInput,
  repo: Repo = defaultRepo(),
): Promise<PrepareIntentResult> {
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
    funds: await repo.listFunds(input.entity),
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
export async function checkAllocations(
  entity: Entity,
  totalCents: number,
  allocations: Allocation[],
  repo: Repo = defaultRepo(),
): Promise<AllocationResult> {
  return validateAllocations({
    entity,
    totalCents,
    allocations,
    funds: await repo.listFunds(entity),
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
export async function recordClearedDonation(
  subject: Subject,
  intent: DonationIntent,
  meta: { checkoutSessionRef: string; receivedAt: string },
  repo: Repo = defaultRepo(),
): Promise<Donation> {
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

export async function readDonationRegister(
  subject: Subject,
  entity: Entity,
  repo: Repo = defaultRepo(),
): Promise<GiftRow[]> {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "READ",
    rowLevel: true,
  });
  const donations = await repo.listDonations(entity);
  return donations.map((donation) => ({
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
export async function readFundAggregates(
  subject: Subject,
  entity: Entity,
  repo: Repo = defaultRepo(),
): Promise<FundBalance[]> {
  authorize({ subject, dataClass: "FINANCIAL", entity, required: "AGGREGATE" });
  return repo.fundBalances(entity);
}

export type FundRegisterRow = {
  balance: FundBalance;
  purpose: string;
  gifts: GiftBehindFund[];
};

/** Balances and the gifts behind them. Row-level, so READ. */
export async function readFundRegister(
  subject: Subject,
  entity: Entity,
  repo: Repo = defaultRepo(),
): Promise<FundRegisterRow[]> {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "READ",
    rowLevel: true,
  });
  const balances = await repo.fundBalances(entity);
  return Promise.all(
    balances.map(async (balance) => {
      const [fund, gifts] = await Promise.all([
        repo.getFund(balance.fundId),
        repo.giftsBehindFund(balance.fundId),
      ]);
      return {
        balance,
        purpose: fund ? fund.purpose : "",
        gifts,
      };
    }),
  );
}

/* ================================================================== *
 * Reference data: creating a fund
 *
 * `docs/PHASE2-FINDINGS.md` puts this at the top of the file: there was no
 * way to create a fund, so against a real database the donate form offered
 * none and no code path could change it. These are the handlers behind the
 * Fundraising Chair's screen that closes it.
 * ================================================================== */

/**
 * Who may define a fund.
 *
 * Not one data class, because a fund is not one thing. Its name, restriction
 * and purpose are published on the donate form and are read by every donor,
 * which makes them PUBLIC_CONTENT. It is also the bucket a restricted gift is
 * held in, so inventing one is a claim about the ledger.
 *
 * So the gate is either of two standings, and nothing is widened to fit a
 * screen:
 *
 *   - FINANCIAL WRITE on the entity — the Treasurer, who owns the ledger; or
 *   - PUBLIC_CONTENT WRITE **and** at least FINANCIAL AGGREGATE — the
 *     Fundraising Chair, who holds exactly that pair and is the office the
 *     work belongs to.
 *
 * The aggregate floor is what keeps out a role that can publish and has no
 * financial standing at all. The Webmaster holds PUBLIC_CONTENT WRITE and
 * FINANCIAL NONE and is refused here: publishing a page is not the same act
 * as deciding that the Foundation now holds money for a new restricted
 * purpose.
 *
 * It is wider than the Fundraising Chair alone, and that is a finding rather
 * than a design: three other chairs hold the same pair. Narrowing it needs a
 * capability in `src/lib/authz/model.ts`, which is not this module's to add.
 */
export function canDefineFund(subject: Subject, entity: Entity): boolean {
  const asTreasurer = can({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "WRITE",
    rowLevel: true,
  });
  const asChair =
    can({ subject, dataClass: "PUBLIC_CONTENT", entity, required: "WRITE" }) &&
    can({ subject, dataClass: "FINANCIAL", entity, required: "AGGREGATE" });
  return asTreasurer || asChair;
}

function authorizeFundDefinition(subject: Subject, entity: Entity): void {
  if (canDefineFund(subject, entity)) return;

  throw new AuthzError(
    `Denied: ${subject.personId} cannot define a ${entity} fund. A fund needs ` +
      `either write access to ${entity} financial records, or write access to ` +
      `${entity} published content together with at least aggregate financial ` +
      `access. A fund's name and purpose are published on the donate form, and ` +
      `the fund is where restricted money is held.`,
    "DENIED",
  );
}

export type SaveFundResult = {
  fund: Fund;
  /** True when the fund will now appear on the public donate form. */
  offeredPublicly: boolean;
};

/**
 * Creates a fund, or edits one.
 *
 * The entity is taken from the draft and authorized against the draft, never
 * against whatever entity a screen happens to be showing. A fund created on
 * the wrong entity is the board review's finding 1 — the memorial fund under
 * the Association while the Foundation's page promises a deductible gift —
 * manufactured anew.
 */
export async function saveFund(
  subject: Subject,
  draft: FundDraft,
  repo: Repo = defaultRepo(),
): Promise<SaveFundResult> {
  authorizeFundDefinition(subject, draft.entity);
  const fund = await repo.saveFund(draft);
  return { fund, offeredPublicly: fund.openToGifts };
}

/**
 * Closes a fund to new gifts.
 *
 * Nothing is deleted: the fund stays in the register and keeps its balance
 * and its history, and only stops being offered. A closed campaign that
 * vanished would take its reporting with it.
 */
export async function closeFundToGifts(
  subject: Subject,
  entity: Entity,
  fundId: string,
  repo: Repo = defaultRepo(),
): Promise<Fund> {
  authorizeFundDefinition(subject, entity);
  const fund = await repo.getFund(fundId);
  if (!fund) throw new Error(`No fund ${fundId}`);
  if (fund.entity !== entity) {
    throw new AuthzError(
      `Fund ${fundId} belongs to ${fund.entity}, not ${entity}.`,
      "DENIED",
    );
  }
  const { fund: saved } = await saveFund(
    subject,
    {
      id: fund.id,
      entity: fund.entity,
      name: fund.name,
      restriction: fund.restriction,
      purpose: fund.purpose,
      openToGifts: false,
    },
    repo,
  );
  return saved;
}

/* ================================================================== *
 * Reference data: recording a sponsorship
 * ================================================================== */

/**
 * Records a sponsorship payment.
 *
 * FINANCIAL WRITE at row level, which means the Treasurer and not the
 * Fundraising Chair. That is the module's existing split applied rather than
 * routed around: a sponsorship record IS a payment amount, and the Chair
 * holds FINANCIAL at AGGREGATE precisely so the person who negotiates the
 * sponsorship is not the person who records the cash. The Chair writes the
 * wording and the valuations stay out of their reach.
 *
 * It is also the only honest answer available. A handler that let the Chair
 * write `paymentCents` would hand them the money row by row through a door
 * marked published content.
 */
export async function recordSponsorship(
  subject: Subject,
  draft: Omit<SponsorshipDraft, "createdById">,
  repo: Repo = defaultRepo(),
): Promise<Sponsorship> {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity: draft.entity,
    required: "WRITE",
    rowLevel: true,
  });
  return repo.saveSponsorship({ ...draft, createdById: subject.personId });
}

export async function recordBenefitFairMarketValue(
  subject: Subject,
  entity: Entity,
  donationId: string,
  cents: number,
  repo: Repo = defaultRepo(),
): Promise<Donation> {
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

export async function issueReceipt(
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
): Promise<IssuedReceipt> {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "READ",
    rowLevel: true,
  });
  const donation = await repo.getDonation(donationId);
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
  // A preview passes its own sequence, and then no number is allocated at
  // all: `nextReceiptSequence` is only awaited when there is no sequence to
  // use, so refreshing a screen cannot burn a receipt number out of the
  // entity's run.
  const sequence =
    options.sequence !== undefined
      ? options.sequence
      : await repo.nextReceiptSequence(entity);
  const receipt = buildReceipt({
    donation,
    funds: await repo.listFunds(entity),
    sequence,
  });
  return {
    receipt,
    html: renderReceiptHtml(receipt),
    text: renderReceiptText(receipt),
  };
}

/* ================================================================== *
 * Sending the receipt
 * ================================================================== */

export type SentReceipt = IssuedReceipt & {
  /** The outbox row. QUEUED, SUPPRESSED or UNDELIVERABLE — never "sent". */
  message: OutboundMessage;
};

/**
 * Issues a receipt for real and hands it to the outbox.
 *
 * FINANCIAL **WRITE**, not READ, and the difference is the point.
 * `issueReceipt` renders a preview and needs only READ. This consumes a
 * number out of the entity's receipt run and puts a statutory document in
 * front of a donor, which are both acts rather than reads. The Finance Review
 * Officer holds FINANCIAL READ and is mechanically read-only; it must be able
 * to see every receipt and able to send none.
 *
 * The order of the four steps is deliberate:
 *
 *   1. Build a preview at sequence 0 and render it. Every refusal fires here
 *      — a gift that is not PAID, benefits with no fair market value, a
 *      disclosure that a styling change dropped below nine points.
 *   2. Only then allocate the real number. A receipt number burned on a
 *      refusal is a gap in the numbering somebody has to explain later, and
 *      the explanation is "the send failed", which no auditor can verify.
 *   3. Rebuild on the allocated number.
 *   4. Enqueue. `enqueue` writes a row and returns; nothing is sent inside
 *      this request.
 *
 * The entity on the message comes from the gift, through the receipt, and
 * `enqueue` resolves the sending identity from it. A caller cannot choose the
 * envelope. See `receiptDraft`.
 */
export async function sendReceipt(
  subject: Subject,
  entity: Entity,
  donationId: string,
  repo: Repo = defaultRepo(),
): Promise<SentReceipt> {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "WRITE",
    rowLevel: true,
  });

  const donation = await repo.getDonation(donationId);
  if (!donation) {
    throw new ReceiptError(`No gift ${donationId}`, "NOT_PAID");
  }
  if (donation.entity !== entity) {
    throw new ReceiptError(
      `Gift ${donationId} belongs to ${donation.entity}, not ${entity}. Receipt ` +
        "templates are per entity and are never shared.",
      "ALLOCATIONS_DO_NOT_SUM",
    );
  }

  const funds = await repo.listFunds(donation.entity);

  // Step 1. Everything that can refuse, refuses now, before a number moves.
  assertDisclosureConspicuous(
    renderReceiptHtml(buildReceipt({ donation, funds, sequence: 0 })),
  );

  // Steps 2 and 3.
  const sequence = await repo.nextReceiptSequence(donation.entity);
  const receipt = buildReceipt({ donation, funds, sequence });

  // Step 4. The entity travels with the receipt; it is not an argument here.
  const message = await enqueue(receiptDraft(receipt, donation.donorEmail));

  return {
    receipt,
    html: renderReceiptHtml(receipt),
    text: renderReceiptText(receipt),
    message,
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
export async function readSponsorRegister(
  subject: Subject,
  entity: Entity,
  repo: Repo = defaultRepo(),
): Promise<SponsorRegisterRow[]> {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "READ",
    rowLevel: true,
  });
  const sponsorships = await repo.listSponsorships(entity);
  return sponsorships.map((sponsorship) => ({
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
export async function readSponsorAcknowledgments(
  subject: Subject,
  entity: Entity,
  repo: Repo = defaultRepo(),
): Promise<AcknowledgmentRow[]> {
  authorize({ subject, dataClass: "PUBLIC_CONTENT", entity, required: "READ" });
  const sponsorships = await repo.listSponsorships(entity);
  return sponsorships.map((sponsorship) => ({
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
export async function saveAcknowledgmentString(
  subject: Subject,
  entity: Entity,
  sponsorshipId: string,
  draft: Omit<PlacementDraft, "authoredById">,
  repo: Repo = defaultRepo(),
): Promise<SaveAcknowledgmentResult> {
  authorize({ subject, dataClass: "PUBLIC_CONTENT", entity, required: "WRITE" });
  const placement = await repo.savePlacement(sponsorshipId, {
    ...draft,
    authoredById: subject.personId,
  });
  return {
    placement,
    review: reviewAcknowledgment(placement.approvedAcknowledgmentString),
  };
}

/* ------------------------------------------------------------------ *
 * The release gate: send, then a different person approves
 *
 * Two handlers, two different standings, because that is what a gate is. The
 * author asks; somebody else answers. Nothing here writes, rewrites or
 * generates the acknowledgment string: approval is a signature on words that
 * already exist, and one adjective is the difference between an
 * acknowledgment and taxable advertising.
 * ------------------------------------------------------------------ */

/**
 * The author sends the wording for release. PUBLIC_CONTENT WRITE: the
 * Fundraising Chair, the Communications Chair, the Webmaster.
 */
export async function sendPlacementForRelease(
  subject: Subject,
  entity: Entity,
  sponsorshipId: string,
  placementId: string,
  repo: Repo = defaultRepo(),
): Promise<PlacementView> {
  authorize({ subject, dataClass: "PUBLIC_CONTENT", entity, required: "WRITE" });
  await assertPlacementBelongsTo(repo, entity, sponsorshipId);
  const placement = await repo.submitPlacementForRelease(sponsorshipId, placementId);
  return toPlacementView(placement);
}

/**
 * The second reader approves it, and it may publish.
 *
 * PUBLIC_CONTENT at **READ**, plus the `APPROVE_RELEASE` capability, and that
 * combination is chosen rather than convenient. Requiring WRITE would mean
 * only the Memorial Chair could ever approve, because the two standing
 * release approvers the role table names — the President and VP Operations —
 * hold PUBLIC_CONTENT at READ. Requiring the capability is what keeps the
 * Webmaster out: it holds WRITE and PUBLISH and no APPROVE_RELEASE, which is
 * the role table saying in terms that it can publish and cannot approve its
 * own content.
 *
 * `assertReleasable` from the shared policy does both halves of invariant 3:
 * the approver is not the author, and the approver holds the capability. It
 * is called rather than reimplemented, because a second copy of an invariant
 * is a second place for it to drift.
 *
 * `carriesIdentity` is passed true for every sponsor placement. ARCHITECTURE
 * puts sponsor-supplied copy through the release gate unconditionally, and a
 * placement names a party and publishes its words under the organization's
 * banner. Deciding per placement whether a name is identifying enough is
 * exactly the judgment the gate exists to take away from one person.
 */
export async function approvePlacementForPublication(
  subject: Subject,
  entity: Entity,
  sponsorshipId: string,
  placementId: string,
  repo: Repo = defaultRepo(),
): Promise<PlacementView> {
  authorize({ subject, dataClass: "PUBLIC_CONTENT", entity, required: "READ" });
  const sponsorship = await assertPlacementBelongsTo(repo, entity, sponsorshipId);
  const existing = sponsorship.placements.find((p) => p.id === placementId);
  if (!existing) throw new Error(`No placement ${placementId}`);

  assertReleasable(subject, {
    id: existing.id,
    createdById: existing.authoredById,
    entity: sponsorship.entity,
    carriesIdentity: true,
  });

  const placement = await repo.approvePlacement(
    sponsorshipId,
    placementId,
    subject.personId,
  );
  return toPlacementView(placement);
}

/* ------------------------------------------------------------------ *
 * What a screen may offer
 *
 * Board review R10: a control that cannot complete its action does not
 * render as a control. These three predicates are what a screen asks before
 * drawing a form, so a role that cannot submit it is shown an inert note
 * naming the office that can, instead of a button into a refusal.
 *
 * They are the same checks the handlers enforce, read through `can` rather
 * than restated, so a screen cannot offer something the handler then refuses.
 * ------------------------------------------------------------------ */

/** FINANCIAL WRITE: the Treasurer records the money. */
export function canRecordSponsorship(subject: Subject, entity: Entity): boolean {
  return can({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "WRITE",
    rowLevel: true,
  });
}

/**
 * FINANCIAL WRITE, same as `sendReceipt` enforces.
 *
 * The same check as recording a sponsorship, and a separate function anyway:
 * these are two different questions that happen to have one answer today, and
 * a screen asking "may this person send a receipt" should not read as though
 * it were asking about sponsors.
 */
export function canSendReceipt(subject: Subject, entity: Entity): boolean {
  return can({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "WRITE",
    rowLevel: true,
  });
}

/** PUBLIC_CONTENT WRITE: whoever drafts the wording and sends it for release. */
export function canAuthorWording(subject: Subject, entity: Entity): boolean {
  return can({ subject, dataClass: "PUBLIC_CONTENT", entity, required: "WRITE" });
}

/**
 * PUBLIC_CONTENT READ plus APPROVE_RELEASE: the second reader.
 *
 * True for the President, VP Operations and the Memorial Chair, and false for
 * the Webmaster, which holds WRITE and PUBLISH and no APPROVE_RELEASE. It
 * does not say whether this particular person may approve this particular
 * placement — they cannot if they wrote it, and only `assertReleasable`
 * knows that.
 */
export function canApproveRelease(subject: Subject, entity: Entity): boolean {
  return (
    can({ subject, dataClass: "PUBLIC_CONTENT", entity, required: "READ" }) &&
    hasCapability(subject, "APPROVE_RELEASE", entity)
  );
}

/**
 * The sponsorship, confirmed to be on the entity the caller was authorized
 * against. Without this a PUBLIC_CONTENT grant on one entity would reach a
 * placement on the other, which is the entity confusion this module exists
 * to refuse.
 */
async function assertPlacementBelongsTo(
  repo: Repo,
  entity: Entity,
  sponsorshipId: string,
): Promise<Sponsorship> {
  const sponsorship = await repo.getSponsorship(sponsorshipId);
  if (!sponsorship) throw new Error(`No sponsorship ${sponsorshipId}`);
  if (sponsorship.entity !== entity) {
    throw new AuthzError(
      `Sponsorship ${sponsorshipId} belongs to ${sponsorship.entity}, not ` +
        `${entity}. The two organizations never share a sponsor record.`,
      "DENIED",
    );
  }
  return sponsorship;
}

/** Changing a benefit valuation is a FINANCIAL write, not a content edit. */
export async function savePlacementValuation(
  subject: Subject,
  entity: Entity,
  sponsorshipId: string,
  placementId: string,
  benefitFairMarketValueCents: number,
  repo: Repo = defaultRepo(),
): Promise<SponsorRegisterRow> {
  authorize({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "WRITE",
    rowLevel: true,
  });
  const sponsorship = await repo.getSponsorship(sponsorshipId);
  if (!sponsorship) {
    throw new Error(`No sponsorship ${sponsorshipId}`);
  }
  const existing = sponsorship.placements.find((p) => p.id === placementId);
  if (!existing) {
    throw new Error(`No placement ${placementId}`);
  }
  await repo.savePlacement(sponsorshipId, {
    id: placementId,
    kind: existing.kind,
    approvedAcknowledgmentString: existing.approvedAcknowledgmentString,
    benefitFairMarketValueCents,
    publicationState: existing.publicationState,
    authoredById: existing.authoredById,
    notes: existing.notes,
  });
  const rows = await readSponsorRegister(subject, entity, repo);
  const row = rows.find((r) => r.sponsorshipId === sponsorshipId);
  if (!row) throw new Error(`No sponsorship ${sponsorshipId}`);
  return row;
}
