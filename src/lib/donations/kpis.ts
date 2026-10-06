/**
 * The donations dashboard, as one authorized read.
 *
 * Four things here are deliberate and would be wrong if done the obvious way.
 *
 * 1. **There is no "total raised" tile.** It is the classic fundraising vanity
 *    metric: it only ever goes up, and here it would also hide the thing that
 *    actually matters, which is whether each dollar landed in the right entity
 *    with a receipt that can be relied on. Giving appears only split by
 *    entity, as two labelled figures, and the two are never added. The
 *    entities do not share a ledger, a donor record, a receipt template or a
 *    receipt numbering run, so a sum of them is a number with no referent.
 *
 * 2. **The dashboard spans two data classes at two levels, so it degrades
 *    rather than denying.** The sponsor register is split in this module:
 *    payments and benefit valuations are FINANCIAL at row level, the approved
 *    wording is PUBLIC_CONTENT. The Fundraising Chair holds FINANCIAL at
 *    AGGREGATE and PUBLIC_CONTENT at WRITE, which is the whole reason the
 *    split exists. So each figure is gated on its own scope with `can()` and
 *    computed through the module's own authorized action, which calls
 *    `authorize()` again. A figure the viewer lacks scope for comes back as
 *    `value: null` with `needs` naming the missing grant. It is withheld, not
 *    zero, and no grant is widened anywhere to make a tile work.
 *
 *    The wording view carries the whole placement record, valuation included.
 *    Nothing in here reads a money figure off a PUBLIC_CONTENT row: that would
 *    hand the Chair the valuations through the content door and quietly undo
 *    the split. The wording tiles use the string and the publication state
 *    only.
 *
 * 3. **Integer cents, start to finish.** Every figure on this page is a sum of
 *    integer cents through `sumCents`, formatted once at the edge by
 *    `formatCents`. No ratio is ever taken as a float: the 2% safe harbour
 *    test comes from `assessSponsorship`, which compares the exact integer
 *    ratio rather than a floored percentage, and every proportion on a tile is
 *    stated as "n of m" with its denominator visible.
 *
 * 4. **The receipt tile measures the formatting, not the existence.** Chapter
 *    131F is a requirement about size, emphasis and exact wording, so the tile
 *    runs `checkDisclosureConspicuous` over the rendered receipt. A receipt
 *    that exists and carries a paraphrase, or carries the sentence at eight
 *    points, fails the statute and fails this tile.
 */

import type { Kpi } from "@/components/dashboard/Kpi";

import { ENTITIES, type Entity } from "../authz/model";
import { AuthzError, can, type Subject } from "../authz/policy";
import {
  issueReceipt,
  readDonationRegister,
  readFundAggregates,
  readSponsorAcknowledgments,
  readSponsorRegister,
} from "./actions";
import { formatCents, sumCents } from "./money";
import { checkDisclosureConspicuous } from "./receipts";
import { donationsRepository, type DonationsRepository } from "./repository";
import { PLACEMENT_LABEL } from "./types";

type Repo = DonationsRepository;

/** Plain English for an entity, because "JSOF" is not a label for a figure. */
export const ENTITY_LABEL: Record<Entity, string> = {
  JSOF: "Foundation",
  JSOA: "Association",
};

/** What needs doing, with a count and somewhere to go and do it. */
export type DashboardAction = {
  key: string;
  label: string;
  note: string;
  count: number;
  href: string;
  /** Colours the count. Reserved for a count that should not be sitting there. */
  urgent: boolean;
};

/** Second tier, below the actions. Rows, not tiles. */
export type RestrictedFundRow = {
  fundId: string;
  name: string;
  balanceFormatted: string;
  giftCount: number;
};

export type AwaitingValuationRow = {
  donationId: string;
  donorDisplayName: string;
  amountFormatted: string;
  benefitDescription: string;
};

export type FlaggedWordingRow = {
  placementId: string;
  sponsorName: string;
  placementLabel: string;
  publicationState: string;
  text: string;
  categories: string[];
};

export type DonationsDashboard = {
  entity: Entity;
  kpis: Kpi[];
  actions: DashboardAction[];
  /** Null when the viewer holds no aggregate on this entity's finances. */
  restrictedFunds: RestrictedFundRow[] | null;
  /** Null when the viewer cannot read gifts row by row. */
  awaitingValuation: AwaitingValuationRow[] | null;
  /** Null when the viewer cannot read published content. */
  flaggedWording: FlaggedWordingRow[] | null;
  /** One line per figure withheld from this viewer, for the page to say so. */
  withheld: string[];
};

const NEEDS_FINANCIAL_ROW = "financial read at row level, which this role does not hold";
const NEEDS_FINANCIAL_AGGREGATE = "financial aggregate on this entity";
const NEEDS_PUBLIC_CONTENT = "read on published content for this entity";

/**
 * Everything the donations overview shows, for one viewer and one entity.
 *
 * Throws `AuthzError` only when the viewer can see nothing at all. A viewer
 * who holds one scope and not the other gets the figures they are entitled to
 * and an explicit withholding for the rest, because a screen that refuses
 * wholesale teaches the Fundraising Chair that the module is not for them.
 */
export function readDonationsDashboard(
  subject: Subject,
  entity: Entity,
  repo: Repo = donationsRepository,
): DonationsDashboard {
  const financialRow = can({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "READ",
    rowLevel: true,
  });
  const financialAggregate = can({
    subject,
    dataClass: "FINANCIAL",
    entity,
    required: "AGGREGATE",
  });
  const publicContent = can({
    subject,
    dataClass: "PUBLIC_CONTENT",
    entity,
    required: "READ",
  });

  if (!financialRow && !financialAggregate && !publicContent) {
    throw new AuthzError(
      `Denied: ${subject.personId} holds no financial or published-content scope ` +
        `on ${entity}, so there is no figure on this dashboard they may see. ` +
        `Nothing about the data behind this wall is reported, including its size.`,
      "DENIED",
    );
  }

  const kpis: Kpi[] = [];
  const actions: DashboardAction[] = [];
  const withheld: string[] = [];

  /* ---------------------------------------------------------------- *
   * 1. Gifts that cannot be receipted.
   *
   * A gift carrying benefits with no fair market value recorded cannot
   * produce a receipt at all: the receipt has to state the value of what the
   * donor received and that only the excess is deductible, so there is
   * nothing honest to print. Every gift sitting here is a donor who cannot
   * claim the deduction they were promised, and the fix is a valuation, not
   * a reissue.
   * ---------------------------------------------------------------- */

  let awaitingValuation: AwaitingValuationRow[] | null = null;

  if (financialRow) {
    const register = readDonationRegister(subject, entity, repo);
    const blocked = register.filter(
      ({ donation }) =>
        donation.benefits.length > 0 && donation.benefitFairMarketValueCents === null,
    );
    const strandedCents = sumCents(blocked.map(({ donation }) => donation.amountCents));

    awaitingValuation = blocked.map(({ donation }) => ({
      donationId: donation.id,
      donorDisplayName: donation.donorDisplayName,
      amountFormatted: formatCents(donation.amountCents),
      benefitDescription: donation.benefits.map((b) => b.description).join("; "),
    }));

    kpis.push({
      key: "gifts-unreceiptable",
      label: "Gifts that cannot be receipted",
      value: `${blocked.length} of ${register.length}`,
      target: `0 of ${register.length}`,
      status: blocked.length > 0 ? "problem" : "good",
      from:
        `Gifts to the ${ENTITY_LABEL[entity]} carrying benefits with no fair market ` +
        `value recorded, against all ${register.length} gifts in the register. ` +
        (blocked.length > 0
          ? `${formatCents(strandedCents)} of giving is held here, and the donor ` +
            `behind each one cannot claim until the benefits are valued.`
          : "Every gift carrying benefits has a valuation, so none of these donors " +
            "is waiting on one."),
    });

    if (blocked.length > 0) {
      actions.push({
        key: "value-benefits",
        label: "Record a fair market value on each gift that cannot be receipted",
        note:
          "Value what the donor received. Only the excess over that value is " +
          "deductible, so the receipt cannot be written until the value exists.",
        count: blocked.length,
        href: "#awaiting-valuation",
        urgent: true,
      });
    }
  } else {
    withheld.push(
      "Gifts that cannot be receipted, and the gifts behind it: this is a gift-by-gift " +
        "read of the ledger.",
    );
    kpis.push({
      key: "gifts-unreceiptable",
      label: "Gifts that cannot be receipted",
      value: null,
      status: "unmeasured",
      from:
        "Gifts carrying benefits with no fair market value recorded, which is a read " +
        "of the gift register row by row.",
      needs: NEEDS_FINANCIAL_ROW,
    });
  }

  /* ---------------------------------------------------------------- *
   * 2. Sponsorships breaching the 2% safe harbour.
   *
   * All or nothing. At or below 2% the benefits are disregarded entirely;
   * one cent above it the WHOLE benefit value is carved out, not the excess.
   * So the count alone is not the figure, and the excess over the ceiling is
   * not the figure either. The money affected is the carve-out.
   * ---------------------------------------------------------------- */

  if (financialRow) {
    const sponsorships = readSponsorRegister(subject, entity, repo);
    const breaching = sponsorships.filter((row) => !row.assessment.withinSafeHarbour);
    const carvedOutCents = sumCents(breaching.map((row) => row.assessment.carvedOutCents));
    const excessOnlyCents = sumCents(
      breaching.map((row) => row.assessment.excessOverThresholdCents),
    );

    kpis.push({
      key: "safe-harbour",
      label: "Sponsorships over the 2% ceiling",
      value:
        breaching.length > 0
          ? `${breaching.length} of ${sponsorships.length} · ${formatCents(carvedOutCents)}`
          : `0 of ${sponsorships.length}`,
      target: `0 of ${sponsorships.length}`,
      status: breaching.length > 0 ? "problem" : "good",
      from:
        `Benefit value against payment, on all ${sponsorships.length} ` +
        `${ENTITY_LABEL[entity]} ` +
        `${sponsorships.length === 1 ? "sponsorship" : "sponsorships"}, tested as an ` +
        `exact integer ratio rather than a floored percentage. ` +
        (breaching.length > 0
          ? `The harbour is all or nothing, so the whole ` +
            `${formatCents(carvedOutCents)} of benefit value is carved out, not the ` +
            `${formatCents(excessOnlyCents)} that sits above the ceiling.`
          : "Each sits at or below the 2% ceiling, so the benefits are disregarded " +
            "and the payment is qualified sponsorship in full."),
    });

    if (breaching.length > 0) {
      actions.push({
        key: "safe-harbour-review",
        label: "Re-examine the sponsorships above the 2% ceiling",
        note:
          "Either the valuations are wrong or the benefit package is too rich for " +
          "the payment. Counsel before the next placement contract is signed.",
        count: breaching.length,
        href: `/board/donations/sponsors`,
        urgent: true,
      });
    }
  } else {
    withheld.push(
      "Sponsorships over the 2% ceiling: the test needs the payment and the benefit " +
        "valuations, both of which are financial rows.",
    );
    kpis.push({
      key: "safe-harbour",
      label: "Sponsorships over the 2% ceiling",
      value: null,
      status: "unmeasured",
      from:
        "Benefit valuation against payment, sponsorship by sponsorship. Both figures " +
        "are financial rows, not totals.",
      needs: NEEDS_FINANCIAL_ROW,
    });
  }

  /* ---------------------------------------------------------------- *
   * 3. Acknowledgment wording the validator flagged.
   *
   * One qualitative or comparative adjective turns a whole placement from
   * acknowledgment into advertising, and advertising revenue is unrelated
   * business income. The validator warns rather than blocking, on purpose, so
   * what matters is not that it fired but that a flagged string is still
   * sitting there. A flagged string already APPROVED can publish today, which
   * is a different and worse state from a flagged draft.
   *
   * PUBLIC_CONTENT only. Nothing below reads a valuation off these rows.
   * ---------------------------------------------------------------- */

  let flaggedWording: FlaggedWordingRow[] | null = null;

  if (publicContent) {
    const wording = readSponsorAcknowledgments(subject, entity, repo);
    const placements = wording.flatMap((row) =>
      row.placements.map((view) => ({ sponsorName: row.sponsorName, view })),
    );
    const flagged = placements.filter(({ view }) => !view.review.clean);
    const flaggedApproved = flagged.filter(
      ({ view }) => view.placement.publicationState === "APPROVED",
    );

    flaggedWording = flagged.map(({ sponsorName, view }) => ({
      placementId: view.placement.id,
      sponsorName,
      placementLabel: PLACEMENT_LABEL[view.placement.kind],
      publicationState: view.placement.publicationState,
      text: view.placement.approvedAcknowledgmentString,
      categories: [...new Set(view.review.findings.map((f) => f.category))],
    }));

    kpis.push({
      key: "wording-flagged",
      label: "Acknowledgment wording the validator flagged",
      value: `${flagged.length} of ${placements.length}`,
      target: `0 of ${placements.length}`,
      status:
        flaggedApproved.length > 0 ? "problem" : flagged.length > 0 ? "watch" : "good",
      from:
        `Approved acknowledgment strings on all ${placements.length} ` +
        `${ENTITY_LABEL[entity]} placements, run through the advertising-signal ` +
        `validator. ` +
        (flaggedApproved.length > 0
          ? `${flaggedApproved.length} of the flagged ` +
            `${flaggedApproved.length === 1 ? "string is" : "strings are"} already ` +
            `approved for publication and can go out as written. `
          : flagged.length > 0
            ? "None of the flagged strings is approved for publication yet. "
            : "") +
        `The validator warns and never blocks, so a flagged string stays flagged ` +
        `until somebody rewrites it.`,
    });

    if (flagged.length > 0) {
      actions.push({
        key: "rewrite-wording",
        label: "Rewrite the acknowledgment wording the validator flagged",
        note:
          "Keep it to identity: name, address, telephone, logo, neutral product " +
          "line. A message that mixes advertising with acknowledgment is advertising " +
          "in its entirety.",
        count: flagged.length,
        href: `/board/donations/sponsors`,
        urgent: flaggedApproved.length > 0,
      });
    }

    /* -------------------------------------------------------------- *
     * 4. Placements awaiting release approval.
     *
     * Sponsor copy does not publish on the strength of the approval of
     * different words, and it does not publish on its author's own approval.
     * -------------------------------------------------------------- */

    const awaitingRelease = placements.filter(
      ({ view }) => view.placement.publicationState === "AWAITING_RELEASE",
    );
    const drafts = placements.filter(
      ({ view }) => view.placement.publicationState === "DRAFT",
    );

    kpis.push({
      key: "awaiting-release",
      label: "Placements awaiting release approval",
      value: `${awaitingRelease.length} of ${placements.length}`,
      status: awaitingRelease.length > 0 ? "watch" : "good",
      from:
        `Placements at awaiting-release, against all ${placements.length} ` +
        `${ENTITY_LABEL[entity]} placements. None of them can publish without a ` +
        `second approver who did not author the words. A further ` +
        `${drafts.length} ${drafts.length === 1 ? "placement sits" : "placements sit"} ` +
        `in draft, not yet sent for release.`,
    });

    if (awaitingRelease.length > 0) {
      actions.push({
        key: "send-for-release",
        label: "Put the placements awaiting release in front of a second approver",
        note:
          "The approver cannot be the person who wrote the wording. Changed wording " +
          "returns here automatically, because the previous approval was of different words.",
        count: awaitingRelease.length,
        href: `/board/donations/sponsors`,
        urgent: false,
      });
    }
  } else {
    withheld.push(
      "The wording tiles: the approved acknowledgment strings are published content.",
    );
    for (const stub of [
      {
        key: "wording-flagged",
        label: "Acknowledgment wording the validator flagged",
        from:
          "Approved acknowledgment strings run through the advertising-signal " +
          "validator. The strings are published content, not financial rows.",
      },
      {
        key: "awaiting-release",
        label: "Placements awaiting release approval",
        from: "Publication state on each sponsor placement, which is published content.",
      },
    ]) {
      kpis.push({ ...stub, value: null, status: "unmeasured", needs: NEEDS_PUBLIC_CONTENT });
    }
  }

  /* ---------------------------------------------------------------- *
   * 5. Restricted funds: committed against available.
   *
   * This is the figure that matters most in this module and it is the one
   * that cannot be computed. A restricted gift spent on the wrong thing is
   * the worst thing here could allow, and knowing whether that has happened
   * needs what the fund has committed or disbursed. This module records money
   * in and nothing out: `fundBalances` is the sum of paid gift allocations
   * and there is no outflow, commitment or encumbrance record anywhere in
   * `src/lib/donations/`. So the tile says it is not measured and says what
   * it needs. Zero here would read as "nothing is committed", which is a
   * claim, and a false one.
   *
   * What IS computable at aggregate is the balance per restricted fund, and
   * that goes in the rows below the actions rather than into this tile.
   * ---------------------------------------------------------------- */

  let restrictedFunds: RestrictedFundRow[] | null = null;
  let restrictedHeldCents = 0;
  let restrictedWithMoney = 0;

  if (financialAggregate) {
    const balances = readFundAggregates(subject, entity, repo);
    const restricted = balances.filter((b) => b.restriction === "RESTRICTED");
    restrictedHeldCents = sumCents(restricted.map((b) => b.balanceCents));
    restrictedWithMoney = restricted.filter((b) => b.balanceCents > 0).length;

    restrictedFunds = restricted.map((b) => ({
      fundId: b.fundId,
      name: b.name,
      balanceFormatted: formatCents(b.balanceCents),
      giftCount: b.giftCount,
    }));

    kpis.push({
      key: "restricted-committed",
      label: "Restricted funds: committed against available",
      value: null,
      status: "unmeasured",
      from:
        `${formatCents(restrictedHeldCents)} is held across ${restricted.length} ` +
        `restricted ${ENTITY_LABEL[entity]} ${restricted.length === 1 ? "fund" : "funds"}, ` +
        `summed from paid gift allocations. What each fund has committed against that ` +
        `balance is not recorded here.`,
      needs:
        "a commitment or disbursement record. This module records gifts in and " +
        "nothing out, so a restricted balance cannot yet be checked against what " +
        "has been promised from it",
    });

    if (restrictedWithMoney > 0) {
      actions.push({
        key: "restricted-check",
        label: "Check each restricted fund's balance against its stated purpose",
        note:
          "A restriction the board cannot state is one it cannot honour. Read the " +
          "purpose on each fund holding money and confirm nothing has been drawn " +
          "against it for something else.",
        count: restrictedWithMoney,
        href: `/board/donations/funds`,
        urgent: false,
      });
    }
  } else {
    withheld.push(
      "Restricted fund balances: even the totals need financial aggregate on this entity.",
    );
    kpis.push({
      key: "restricted-committed",
      label: "Restricted funds: committed against available",
      value: null,
      status: "unmeasured",
      from: "Balance per restricted fund, against what that fund has committed.",
      needs: NEEDS_FINANCIAL_AGGREGATE,
    });
  }

  /* ---------------------------------------------------------------- *
   * 6. Giving by entity. Two labelled figures, never one total.
   *
   * The entities keep separate books, separate receipts and separate donor
   * records, and only one of them is the clean charitable entity. A sum of
   * the two would be a number that answers no question anyone has. The split
   * answers a real one: whether inbound giving is reaching the Foundation, or
   * whether it is landing in the Association, where deductibility rests on a
   * membership composition test the Association may not pass in a given year.
   *
   * Scope is per entity, so a Treasurer of one entity sees their own figure
   * and the other one withheld. The Fundraising Chair, holding aggregate on
   * both, sees both.
   * ---------------------------------------------------------------- */

  const perEntity: string[] = [];
  let anyEntityVisible = false;
  // The entity being viewed reads first; the other follows. Neither is ever
  // added to the other, and the order is presentation, not precedence.
  const entityOrder: Entity[] = [entity, ...ENTITIES.filter((e) => e !== entity)];
  for (const candidate of entityOrder) {
    const allowed = can({
      subject,
      dataClass: "FINANCIAL",
      entity: candidate,
      required: "AGGREGATE",
    });
    if (!allowed) {
      perEntity.push(`${ENTITY_LABEL[candidate]} withheld`);
      continue;
    }
    anyEntityVisible = true;
    const total = sumCents(
      readFundAggregates(subject, candidate, repo).map((b) => b.balanceCents),
    );
    perEntity.push(`${ENTITY_LABEL[candidate]} ${formatCents(total)}`);
  }

  if (anyEntityVisible) {
    kpis.push({
      key: "giving-by-entity",
      label: "Giving received, by entity",
      value: perEntity.join(" · "),
      status: "good",
      from:
        "Paid gift allocations summed within each entity's own ledger, and never " +
        "across them. The two are not added: different exempt status, different " +
        "receipt template, separate numbering, no shared donor record. A gift to " +
        "the Association is deductible only if the Association meets the " +
        "war-veteran membership test in the year of the gift.",
    });
  } else {
    withheld.push("Giving by entity: no entity on this dashboard is in scope for totals.");
    kpis.push({
      key: "giving-by-entity",
      label: "Giving received, by entity",
      value: null,
      status: "unmeasured",
      from: "Paid gift allocations summed within each entity's own ledger.",
      needs: NEEDS_FINANCIAL_AGGREGATE,
    });
  }

  /* ---------------------------------------------------------------- *
   * 7. Receipts carrying the Chapter 131F disclosure correctly.
   *
   * Not "does a receipt exist". The statute is about size, emphasis and exact
   * wording, so this renders each receipt that can be issued and runs the
   * checker over the output: the sentence present verbatim including the word
   * "license", in its own marked block, at or above nine points, made
   * conspicuous by bold, a border or underlining, and no type anywhere on the
   * receipt below the floor. A paraphrase fails. Nine-point text set at eight
   * fails. Previews are rendered at sequence 0 so refreshing a dashboard does
   * not burn receipt numbers out of the entity's sequence.
   * ---------------------------------------------------------------- */

  if (financialRow) {
    const register = readDonationRegister(subject, entity, repo);
    const issuable = register.filter((row) => row.receiptBlockedBecause === null);
    let passing = 0;
    const failures: string[] = [];
    for (const { donation } of issuable) {
      try {
        const { html } = issueReceipt(subject, entity, donation.id, repo, { sequence: 0 });
        const check = checkDisclosureConspicuous(html);
        if (check.ok) passing += 1;
        else failures.push(`${donation.id}: ${check.problems.join(" ")}`);
      } catch (error) {
        failures.push(`${donation.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    kpis.push({
      key: "disclosure-conspicuous",
      label: "Receipts carrying the 131F disclosure correctly",
      value: issuable.length === 0 ? null : `${passing} of ${issuable.length}`,
      target: issuable.length === 0 ? undefined : `${issuable.length} of ${issuable.length}`,
      status:
        issuable.length === 0 ? "unmeasured" : passing === issuable.length ? "good" : "problem",
      from:
        `Each of the ${issuable.length} issuable ${ENTITY_LABEL[entity]} ` +
        `${issuable.length === 1 ? "receipt" : "receipts"} rendered and checked: the ` +
        `sentence verbatim including the statutory spelling "license", in its own ` +
        `marked block, at or above nine points, made conspicuous by bold or a border, ` +
        `and no type on the receipt below the floor. ` +
        (failures.length > 0 ? failures.join(" ") : "Not a check that a receipt exists."),
      needs:
        issuable.length === 0
          ? "at least one paid gift that can be receipted; there is none on this entity yet"
          : undefined,
    });

    if (failures.length > 0) {
      actions.push({
        key: "fix-disclosure",
        label: "Fix the receipts whose 131F disclosure fails the formatting requirement",
        note:
          "The size and the emphasis are part of the requirement, not presentation. " +
          "A receipt that fails this has gone out non-compliant.",
        count: failures.length,
        href: `/board/donations/funds`,
        urgent: true,
      });
    }
  } else {
    withheld.push(
      "Receipt formatting compliance: rendering a receipt is a row-level read of the " +
        "gift behind it.",
    );
    kpis.push({
      key: "disclosure-conspicuous",
      label: "Receipts carrying the 131F disclosure correctly",
      value: null,
      status: "unmeasured",
      from:
        "Each issuable receipt rendered and checked for the statutory size, emphasis " +
        "and exact wording. Rendering one is a row-level read of the gift.",
      needs: NEEDS_FINANCIAL_ROW,
    });
  }

  return {
    entity,
    kpis,
    actions,
    restrictedFunds,
    awaitingValuation,
    flaggedWording,
    withheld,
  };
}
