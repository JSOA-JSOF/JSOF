"use server";

import { redirect } from "next/navigation";

import { AuthzError, type Subject } from "@/lib/authz/policy";
import type { Entity } from "@/lib/authz/model";
import {
  approvePlacementForPublication,
  closeFundToGifts,
  recordSponsorship,
  saveAcknowledgmentString,
  saveFund,
  sendPlacementForRelease,
  sendReceipt,
} from "@/lib/donations/actions";
import { parseDollarsToCents } from "@/lib/donations/money";
import { RepositoryError } from "@/lib/donations/repository";
import { ReceiptError } from "@/lib/donations/receipts";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import { PLACEMENT_KINDS } from "@/lib/donations/types";
import type { FundRestriction, PlacementKind } from "@/lib/donations/types";

/**
 * The board donations server actions.
 *
 * None of them carries permission logic. Every one calls into
 * `src/lib/donations/actions.ts`, which calls `authorize()` before it reads
 * or writes anything. This file does two other jobs:
 *
 *   1. It turns a form into typed values, and refuses a malformed one here
 *      rather than passing a NaN down. Money arrives as a typed string and
 *      goes through `parseDollarsToCents`, which returns null rather than a
 *      guess, so nothing here can produce a float or a cent rounded on its
 *      way in.
 *   2. It turns a refusal into a sentence on the screen. A board member told
 *      plainly that their office cannot do this is better served than one
 *      shown a stack trace, and a refusal that looks like a bug is a refusal
 *      somebody tries to route around.
 *
 * Two mechanical notes.
 *
 * `redirect()` works by throwing, so it is never called inside a `try`.
 * Every handler does its work, records an outcome, and redirects afterwards.
 * Calling it in the `try` would hand the redirect to the `catch`, which would
 * then describe it to the reader as a failure.
 *
 * `entity` and `as` travel on every form. `entity` is the entity the record
 * belongs to and is authorized against, so claiming one in the form buys
 * nothing: asserting JSOA means needing JSOA grants. `as` is the dev role
 * override, carried so a refusal can be linked to; outside development
 * `subjectFromParam` resolves it to nobody.
 */

type Outcome = { refused: string | null; done: string | null };

const FUNDS = "/board/donations/funds";
const SPONSORS = "/board/donations/sponsors";
const GIFTS = "/board/donations/gifts";

async function actor(as: string | null): Promise<Subject> {
  const { subject } = await resolveScreenViewer(as ?? undefined);
  return subject;
}

function asOf(form: FormData): string | null {
  const as = form.get("as");
  return typeof as === "string" && as.length > 0 ? as : null;
}

function entityOf(form: FormData): Entity {
  return form.get("entity") === "JSOA" ? "JSOA" : "JSOF";
}

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function kindOf(form: FormData): PlacementKind {
  const value = str(form, "kind");
  return (PLACEMENT_KINDS as readonly string[]).includes(value)
    ? (value as PlacementKind)
    : "WEBSITE_FOOTER";
}

/** Every refusal this module can produce, as a sentence. */
function describe(error: unknown): string {
  if (error instanceof AuthzError) return error.message;
  if (error instanceof RepositoryError) return error.message;
  if (error instanceof ReceiptError) return error.message;
  if (error instanceof Error) return error.message;
  return "The request was refused and nothing was changed.";
}

function back(path: string, as: string | null, outcome: Outcome): never {
  const query = new URLSearchParams();
  if (outcome.refused) query.set("refused", outcome.refused);
  if (outcome.done) query.set("done", outcome.done);
  if (as) query.set("as", as);
  const suffix = query.toString();
  redirect(suffix.length > 0 ? `${path}?${suffix}` : path);
}

/* ================================================================== *
 * Funds
 *
 * There was no way to create a fund at all, so against a real database the
 * donate form offered none. This is the screen's half of closing that.
 * ================================================================== */

export async function saveFundAction(form: FormData): Promise<void> {
  const as = asOf(form);
  const entity = entityOf(form);
  const subject = await actor(as);
  const restriction: FundRestriction =
    form.get("restriction") === "RESTRICTED" ? "RESTRICTED" : "UNRESTRICTED";

  let outcome: Outcome = { refused: null, done: null };
  try {
    const { fund, offeredPublicly } = await saveFund(subject, {
      id: str(form, "fundId") || undefined,
      entity,
      name: str(form, "name"),
      restriction,
      purpose: str(form, "purpose"),
      openToGifts: form.get("openToGifts") === "on",
    });
    outcome = {
      refused: null,
      done: offeredPublicly
        ? `${fund.name} is open to gifts and now appears on the donate form for ${entity}.`
        : `${fund.name} is recorded and is not offered on the donate form.`,
    };
  } catch (error) {
    outcome = { refused: describe(error), done: null };
  }
  back(FUNDS, as, outcome);
}

export async function closeFundAction(form: FormData): Promise<void> {
  const as = asOf(form);
  const entity = entityOf(form);
  const subject = await actor(as);

  let outcome: Outcome = { refused: null, done: null };
  try {
    const fund = await closeFundToGifts(subject, entity, str(form, "fundId"));
    outcome = {
      refused: null,
      done:
        `${fund.name} is closed to new gifts. It keeps its balance and its ` +
        `history and is no longer offered on the donate form.`,
    };
  } catch (error) {
    outcome = { refused: describe(error), done: null };
  }
  back(FUNDS, as, outcome);
}

/* ================================================================== *
 * Sponsorships
 * ================================================================== */

export async function recordSponsorshipAction(form: FormData): Promise<void> {
  const as = asOf(form);
  const entity = entityOf(form);
  const subject = await actor(as);

  const paymentCents = parseDollarsToCents(str(form, "payment"));
  const receivedAt = str(form, "receivedAt");

  let outcome: Outcome = { refused: null, done: null };
  if (paymentCents === null) {
    outcome = {
      refused:
        "The payment has to be a dollar amount, like 2500 or 2,500.00. Nothing " +
        "was recorded.",
      done: null,
    };
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) {
    outcome = {
      refused: "The date received has to be a calendar date. Nothing was recorded.",
      done: null,
    };
  } else {
    try {
      const sponsorship = await recordSponsorship(subject, {
        entity,
        sponsorName: str(form, "sponsorName"),
        eventName: str(form, "eventName"),
        tier: str(form, "tier"),
        paymentCents,
        exclusivity:
          form.get("exclusivity") === "EXCLUSIVE_SPONSOR" ? "EXCLUSIVE_SPONSOR" : "NONE",
        // Midday UTC, so the stored instant renders on the intended date in
        // America/New_York rather than the evening before.
        receivedAt: `${receivedAt}T12:00:00Z`,
        // Typed `false`, and there is no form control for it. A fee tied to
        // attendance or impressions is not a sponsorship payment at all, so
        // the record has no shape that could hold one.
        contingentOnAttendanceOrImpressions: false,
      });
      outcome = {
        refused: null,
        done:
          `${sponsorship.sponsorName} recorded for ${sponsorship.eventName}. Add ` +
          `the wording that may be published, then send it for release.`,
      };
    } catch (error) {
      outcome = { refused: describe(error), done: null };
    }
  }
  back(SPONSORS, as, outcome);
}

/* ================================================================== *
 * The wording, and the release gate around it
 * ================================================================== */

export async function saveWordingAction(form: FormData): Promise<void> {
  const as = asOf(form);
  const entity = entityOf(form);
  const subject = await actor(as);

  const valuation = parseDollarsToCents(str(form, "benefitValue") || "0");

  let outcome: Outcome = { refused: null, done: null };
  if (valuation === null) {
    outcome = {
      refused:
        "The fair market value of what the sponsor receives has to be a dollar " +
        "amount, or 0 if they receive nothing. Nothing was saved.",
      done: null,
    };
  } else {
    try {
      const { placement, review } = await saveAcknowledgmentString(
        subject,
        entity,
        str(form, "sponsorshipId"),
        {
          id: str(form, "placementId") || undefined,
          kind: kindOf(form),
          approvedAcknowledgmentString: str(form, "wording"),
          benefitFairMarketValueCents: valuation,
          notes: str(form, "notes"),
        },
      );
      outcome = {
        refused: null,
        done:
          `Wording saved at ${placement.publicationState
            .toLowerCase()
            .replace(/_/g, " ")}. ` +
          (review.clean
            ? "Nothing was flagged. It still needs a second reader before it publishes."
            : `${review.findings.length} ${
                review.findings.length === 1 ? "warning" : "warnings"
              } on the screen below — warnings, not a block.`),
      };
    } catch (error) {
      outcome = { refused: describe(error), done: null };
    }
  }
  back(SPONSORS, as, outcome);
}

export async function sendForReleaseAction(form: FormData): Promise<void> {
  const as = asOf(form);
  const entity = entityOf(form);
  const subject = await actor(as);

  let outcome: Outcome = { refused: null, done: null };
  try {
    await sendPlacementForRelease(
      subject,
      entity,
      str(form, "sponsorshipId"),
      str(form, "placementId"),
    );
    outcome = {
      refused: null,
      done:
        "Sent for release. It publishes once somebody other than the person who " +
        "wrote the wording has read it and approved it.",
    };
  } catch (error) {
    outcome = { refused: describe(error), done: null };
  }
  back(SPONSORS, as, outcome);
}

export async function approveForPublicationAction(form: FormData): Promise<void> {
  const as = asOf(form);
  const entity = entityOf(form);
  const subject = await actor(as);

  let outcome: Outcome = { refused: null, done: null };
  try {
    const view = await approvePlacementForPublication(
      subject,
      entity,
      str(form, "sponsorshipId"),
      str(form, "placementId"),
    );
    outcome = {
      refused: null,
      done: view.review.clean
        ? "Approved. This wording publishes as written."
        : "Approved, and it publishes as written. The validator had flagged it: a " +
          "message mixing advertising with acknowledgment is advertising in its " +
          "entirety, so this placement may now be taxable advertising rather than " +
          "qualified sponsorship.",
    };
  } catch (error) {
    outcome = { refused: describe(error), done: null };
  }
  back(SPONSORS, as, outcome);
}

/* ================================================================== *
 * Receipts
 * ================================================================== */

export async function sendReceiptAction(form: FormData): Promise<void> {
  const as = asOf(form);
  const entity = entityOf(form);
  const subject = await actor(as);

  let outcome: Outcome = { refused: null, done: null };
  try {
    const { receipt, message } = await sendReceipt(
      subject,
      entity,
      str(form, "donationId"),
    );

    // The outbox never reports a send, because it never sends. Each branch is
    // the honest state of the row it just wrote.
    const outboxState =
      message.state === "QUEUED"
        ? message.stateReason
          ? `queued as ${receipt.identity.legalName}, held because it is ${message.stateReason}`
          : `queued to ${message.toAddress}`
        : message.state === "UNDELIVERABLE"
          ? "queued to nobody: there is no address on this gift"
          : message.state === "SUPPRESSED"
            ? `not queued: ${message.toAddress} is ${message.stateReason}`
            : `recorded as ${message.state.toLowerCase()}`;

    outcome = {
      refused: null,
      done:
        `Receipt ${receipt.receiptNumber} issued and ${outboxState}. Nothing is ` +
        `sent from inside this request; a worker drains the outbox.`,
    };
  } catch (error) {
    outcome = { refused: describe(error), done: null };
  }
  back(GIFTS, as, outcome);
}
