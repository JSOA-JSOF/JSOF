"use client";

/**
 * The donate flow. Four steps, in this order and no other:
 *
 *   1. Entity. Forced. There is no default selection, no "either is fine", and
 *      no inference from which page the donor arrived on. Every inbound dollar
 *      belongs to one of two organizations with separate books, so the donor
 *      says which.
 *   2. Amount.
 *   3. Allocation across funds, splittable, summing exactly.
 *   4. Review, then a redirect to hosted checkout.
 *
 * All of the arithmetic is integer cents. The dollar strings are parsed once,
 * on entry, and never re-derived from a float.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import { remainingCents } from "@/lib/donations/allocation";
import {
  NC_131F_DISCLOSURE,
  NC_131F_STATUTE_LABEL,
} from "@/lib/donations/disclosure";
import { formatCents, parseDollarsToCents } from "@/lib/donations/money";
import type { Allocation } from "@/lib/donations/types";
import styles from "./donate.module.css";

type Entity = "JSOA" | "JSOF";

export type FundOption = {
  id: string;
  entity: Entity;
  name: string;
  restriction: string;
  purpose: string;
};

type AllocationRefusal = { code: string; message: string } | null;

const ENTITY_CARDS: {
  entity: Entity;
  name: string;
  meta: string;
  note: string;
  hue: string;
  tint: string;
}[] = [
  {
    entity: "JSOF",
    name: "Joint Special Operations Foundation",
    meta: "501(c)(3) · charitable",
    note:
      "Scholarships, family support and charitable giving. A gift here is " +
      "generally deductible as a charitable contribution.",
    hue: "var(--jsof)",
    tint: "var(--jsof-tint)",
  },
  {
    entity: "JSOA",
    name: "Joint Special Operations Association",
    meta: "501(c)(19) · veterans' organization",
    note:
      "Membership, events and the memorial. A payment here may carry member " +
      "benefits, and dues are not deductible as a charitable contribution.",
    hue: "var(--jsoa)",
    tint: "var(--jsoa-tint)",
  },
];

const PRESETS_CENTS = [5_000, 25_000, 100_000, 500_000, 1_000_000];

export default function DonateFlow({ funds }: { funds: FundOption[] }) {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [amountText, setAmountText] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [rows, setRows] = useState<Allocation[]>([]);
  const [refusal, setRefusal] = useState<AllocationRefusal>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const entityFunds = useMemo(
    () => (entity ? funds.filter((f) => f.entity === entity) : []),
    [entity, funds],
  );

  const remaining = amountCents === null ? 0 : remainingCents(amountCents, rows);
  const allocated = amountCents === null ? 0 : amountCents - remaining;

  function chooseEntity(next: Entity) {
    // Changing entity clears the allocation: the two never share a fund.
    setEntity(next);
    setRows([]);
    setRefusal(null);
    setStep(2);
  }

  function commitAmount() {
    const cents = parseDollarsToCents(amountText);
    if (cents === null) {
      setAmountError(
        "Enter an amount in dollars and cents, like 250 or 1,500.00.",
      );
      return;
    }
    if (cents === 0) {
      setAmountError("Enter an amount above zero.");
      return;
    }
    setAmountError(null);
    setAmountCents(cents);
    // Seed the allocation with the whole gift against the first open fund, so
    // a donor who does not want to split is one click from done.
    const first = entityFunds[0];
    setRows(first ? [{ fundId: first.id, amountCents: cents }] : []);
    setRefusal(null);
    setStep(3);
  }

  function setRowAmount(fundId: string, text: string) {
    const cents = text.trim() === "" ? 0 : parseDollarsToCents(text);
    if (cents === null) return;
    setRows((current) =>
      current.map((row) => (row.fundId === fundId ? { ...row, amountCents: cents } : row)),
    );
    setRefusal(null);
  }

  function addRow(fundId: string) {
    if (!fundId || rows.some((r) => r.fundId === fundId)) return;
    setRows((current) => [
      ...current,
      { fundId, amountCents: Math.max(0, remaining) },
    ]);
    setRefusal(null);
  }

  function removeRow(fundId: string) {
    setRows((current) => current.filter((r) => r.fundId !== fundId));
    setRefusal(null);
  }

  /**
   * The refusal. The client repeats the check so the donor gets the message
   * immediately; the same check runs again server-side in
   * `prepareDonationIntent`, which is the one that decides.
   */
  function reviewAllocation() {
    if (amountCents === null) return;
    if (rows.length === 0) {
      setRefusal({
        code: "NO_ALLOCATIONS",
        message: "Every gift needs at least one fund. Choose where this money should go.",
      });
      return;
    }
    if (rows.some((r) => r.amountCents === 0)) {
      setRefusal({
        code: "NON_POSITIVE_ALLOCATION",
        message:
          "A fund allocated zero is not an allocation. Remove the fund or give it an amount.",
      });
      return;
    }
    if (allocated < amountCents) {
      const shortfall = amountCents - allocated;
      setRefusal({
        code: "SHORTFALL",
        message:
          `Allocations come to ${formatCents(allocated)} of a ${formatCents(amountCents)} ` +
          `gift. ${formatCents(shortfall)} is unallocated. Add ${formatCents(shortfall)} ` +
          `to a fund, or lower the gift to ${formatCents(allocated)}.`,
      });
      return;
    }
    if (allocated > amountCents) {
      const overage = allocated - amountCents;
      setRefusal({
        code: "OVERAGE",
        message:
          `Allocations come to ${formatCents(allocated)}, which is ${formatCents(overage)} ` +
          `more than the ${formatCents(amountCents)} gift. Take ${formatCents(overage)} off ` +
          `a fund, or raise the gift to ${formatCents(allocated)}.`,
      });
      return;
    }
    setRefusal(null);
    setStep(4);
  }

  const unusedFunds = entityFunds.filter((f) => !rows.some((r) => r.fundId === f.id));
  const hue = entity === "JSOA" ? "var(--jsoa)" : "var(--jsof)";

  /**
   * The handoff link. Entity, total and the fund split only. No name, no email,
   * no anything else in the query string. See the privacy rules on putting
   * personal data in a URL.
   */
  const checkoutHref =
    entity && amountCents !== null
      ? `/donate/checkout?entity=${entity}&total=${amountCents}&alloc=${rows
          .map((r) => `${r.fundId}:${r.amountCents}`)
          .join(",")}`
      : "#";

  return (
    <div style={{ ["--hue" as string]: hue }}>
      <ol className={styles.steps}>
        {["Organization", "Amount", "Funds", "Review"].map((name, index) => {
          const n = index + 1;
          return (
            <li
              key={name}
              className={
                step === n ? styles.stepCurrent : step > n ? styles.stepDone : ""
              }
            >
              {n}. {name}
            </li>
          );
        })}
      </ol>

      {/* Step 1 ------------------------------------------------------ */}
      <section className={styles.section}>
        <h2 className={styles.sectionHead}>1. Which organization is this gift for?</h2>
        <p className={styles.hint}>
          There are two. They keep separate books, send separate receipts, and
          spend on different things. Choose one before anything else, because
          this is not something the platform can decide for you.
        </p>
        <div className={styles.entityChoice}>
          {ENTITY_CARDS.map((card) => (
            <button
              key={card.entity}
              type="button"
              onClick={() => chooseEntity(card.entity)}
              aria-pressed={entity === card.entity}
              className={`${styles.entityCard} ${
                entity === card.entity ? styles.entityCardActive : ""
              }`}
              style={{
                ["--cardHue" as string]: card.hue,
                ["--cardTint" as string]: card.tint,
              }}
            >
              <span className={styles.entityName}>{card.name}</span>
              <span className={styles.entityMeta}>{card.meta}</span>
              <span className={styles.entityNote}>{card.note}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Step 2 ------------------------------------------------------ */}
      {entity && step >= 2 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHead}>2. How much?</h2>
          <label className={styles.label} htmlFor="amount">
            Gift amount, US dollars
          </label>
          <input
            id="amount"
            className={styles.input}
            inputMode="decimal"
            value={amountText}
            placeholder="15,000.00"
            onChange={(event) => setAmountText(event.target.value)}
            onBlur={commitAmount}
          />
          <div className={styles.amountRow}>
            {PRESETS_CENTS.map((cents) => (
              <button
                key={cents}
                type="button"
                className={styles.preset}
                onClick={() => setAmountText(formatCents(cents).replace("$", ""))}
              >
                {formatCents(cents)}
              </button>
            ))}
          </div>
          {amountError && (
            <div className={styles.refusal} role="alert">
              <span className={styles.refusalHead}>Amount</span>
              {amountError}
            </div>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={commitAmount}>
              Choose funds
            </button>
          </div>
        </section>
      )}

      {/* Step 3 ------------------------------------------------------ */}
      {entity && amountCents !== null && step >= 3 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHead}>3. Where should it go?</h2>

          {/*
           * No fund, no gift, and the page says so instead of inviting one.
           *
           * Every gift needs at least one fund and the two organizations never
           * share one, so an organization with no open fund cannot take a gift
           * at all. The old behaviour was an empty table, a live "Review this
           * gift" button and a refusal at the end naming a rule the donor had
           * no way to satisfy. A control that cannot complete its action does
           * not render as a control.
           */}
          {entityFunds.length === 0 ? (
            <div className={styles.refusal} role="alert">
              <span className={styles.refusalHead}>
                No fund is open for this organization
              </span>
              There is nowhere for this gift to go yet, so it cannot be taken
              here today. Nothing has been charged and nothing has been
              recorded. Please write to the organization before giving, or
              choose the other one above.
            </div>
          ) : (
            <>
          <p className={styles.hint}>
            One gift can be split across as many funds as you like. The split
            has to add up to {formatCents(amountCents)} exactly.
          </p>

          <table className={styles.allocTable}>
            <thead>
              <tr>
                <th>Fund</th>
                <th />
                <th className={styles.numeric}>Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const fund = entityFunds.find((f) => f.id === row.fundId);
                return (
                  <tr key={row.fundId}>
                    <td>
                      <span className={styles.fundName}>{fund ? fund.name : row.fundId}</span>
                      <span className={styles.fundPurpose}>{fund ? fund.purpose : ""}</span>
                    </td>
                    <td>
                      <span
                        className={`${styles.pill} ${
                          fund && fund.restriction === "RESTRICTED"
                            ? styles.pillRestricted
                            : ""
                        }`}
                      >
                        {fund ? fund.restriction.toLowerCase() : ""}
                      </span>
                    </td>
                    <td className={styles.numeric}>
                      <input
                        className={styles.amountInput}
                        inputMode="decimal"
                        aria-label={`Amount to ${fund ? fund.name : row.fundId}`}
                        defaultValue={(row.amountCents / 100).toFixed(2)}
                        onBlur={(event) => setRowAmount(row.fundId, event.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.remove}
                        onClick={() => removeRow(row.fundId)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {unusedFunds.length > 0 && (
            <>
              <label className={styles.label} htmlFor="addFund">
                Add another fund
              </label>
              <select
                id="addFund"
                className={styles.select}
                value=""
                onChange={(event) => addRow(event.target.value)}
              >
                <option value="">Choose a fund</option>
                {unusedFunds.map((fund) => (
                  <option key={fund.id} value={fund.id}>
                    {fund.name} ({fund.restriction.toLowerCase()})
                  </option>
                ))}
              </select>
            </>
          )}

          <div className={styles.tally}>
            <span>
              <span className={styles.tallyLabel}>Allocated </span>
              <span className={styles.tallyFigure}>{formatCents(allocated)}</span>
            </span>
            <span>
              <span className={styles.tallyLabel}>Gift </span>
              <span className={styles.tallyFigure}>{formatCents(amountCents)}</span>
            </span>
            <span>
              <span className={styles.tallyLabel}>
                {remaining === 0 ? "Balanced " : remaining > 0 ? "Unallocated " : "Over "}
              </span>
              <span
                className={`${styles.tallyFigure} ${
                  remaining === 0 ? styles.tallyEven : styles.tallyShort
                }`}
              >
                {formatCents(Math.abs(remaining))}
              </span>
            </span>
          </div>

          {refusal && (
            <div className={styles.refusal} role="alert">
              <span className={styles.refusalHead}>Gift refused · {refusal.code}</span>
              {refusal.message}
            </div>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={reviewAllocation}>
              Review this gift
            </button>
            <button type="button" className={styles.secondary} onClick={() => setStep(2)}>
              Change the amount
            </button>
          </div>
            </>
          )}
        </section>
      )}

      {/* Step 4 ------------------------------------------------------ */}
      {entity && amountCents !== null && step === 4 && (
        <section className={styles.section}>
          <h2 className={styles.sectionHead}>4. Review, then pay</h2>
          <ul className={styles.reviewList}>
            <li>
              <span className={styles.reviewKey}>Organization</span>
              <span className={styles.reviewValue}>{entity}</span>
            </li>
            {rows.map((row) => {
              const fund = entityFunds.find((f) => f.id === row.fundId);
              return (
                <li key={row.fundId}>
                  <span className={styles.reviewKey}>{fund ? fund.name : row.fundId}</span>
                  <span className={styles.reviewValue}>{formatCents(row.amountCents)}</span>
                </li>
              );
            })}
            <li>
              <span className={styles.reviewKey}>Total</span>
              <span className={styles.reviewValue}>{formatCents(amountCents)}</span>
            </li>
          </ul>

          <p className={styles.note}>
            The next page is the payment provider&rsquo;s own. Card details are
            entered there and never reach this site. Nothing on the payment page
            comes from us, which is deliberate.
          </p>

          <div className={styles.actions}>
            <Link href={checkoutHref} className={styles.primary}>
              Continue to payment
            </Link>
            <button type="button" className={styles.secondary} onClick={() => setStep(3)}>
              Change the funds
            </button>
          </div>

          <div className={styles.disclosure}>
            <span className={styles.disclosureStatute}>
              North Carolina · {NC_131F_STATUTE_LABEL}
            </span>
            {NC_131F_DISCLOSURE}
          </div>
        </section>
      )}
    </div>
  );
}
