"use client";

import { useMemo, useState } from "react";

import styles from "./workspace.module.css";
import { formatCents, type AwardBand, type AwardException } from "./types";

/**
 * Banding collapses 119 individual money decisions into a handful of band
 * decisions plus the exceptions worth looking at.
 *
 * The default is always visible beside the amount and always overridable in
 * one field. A default that hides what it decided is a dark pattern; a default
 * that shows its working is just less typing.
 */
export function AwardBands({
  bands,
  exceptions,
  budgetCents,
  onChange,
}: {
  bands: AwardBand[];
  exceptions: AwardException[];
  budgetCents: number | null;
  onChange?: (key: string, amountCents: number) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(bands.map((band) => [band.key, band.defaultAmountCents])),
  );

  const maxCount = useMemo(
    () => Math.max(1, ...bands.map((band) => band.count)),
    [bands],
  );

  const committed = useMemo(
    () =>
      bands.reduce(
        (sum, band) => sum + (amounts[band.key] ?? band.defaultAmountCents) * band.count,
        0,
      ),
    [bands, amounts],
  );

  const recipients = bands.reduce((sum, band) => sum + band.count, 0);
  const over = budgetCents !== null && committed > budgetCents;

  function set(key: string, dollars: string) {
    const cents = Math.round(Number(dollars || 0) * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    setAmounts((prev) => ({ ...prev, [key]: cents }));
    onChange?.(key, cents);
  }

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.applicant}>Award bands</span>
          <span className={styles.position}>{recipients} recipients</span>
        </div>

        <div className={styles.bands}>
          {bands.map((band) => {
            const amount = amounts[band.key] ?? band.defaultAmountCents;
            const changed = amount !== band.defaultAmountCents;
            return (
              <div key={band.key} className={styles.band}>
                <span className={styles.bandRange}>
                  {band.from.toFixed(1)}–{band.to.toFixed(1)}
                </span>
                <span
                  className={styles.bandBar}
                  style={{ width: `${(band.count / maxCount) * 100}%` }}
                  aria-hidden="true"
                />
                <label className={styles.bandAmount}>
                  <span className={styles.srOnly}>{band.label} award amount in dollars</span>
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={Math.round(amount / 100)}
                    onChange={(event) => set(band.key, event.target.value)}
                    className={styles.score}
                    style={{ minWidth: 92, textAlign: "right", padding: "6px 8px" }}
                  />
                </label>
                <span className={styles.bandCount}>
                  {band.count}
                  {changed ? " ·" : ""}
                </span>
              </div>
            );
          })}
        </div>

        <div className={styles.budget}>
          <span>
            Total if sent as shown
            <br />
            <span className={styles.budgetTotal}>{formatCents(committed)}</span>
          </span>
          {budgetCents !== null ? (
            <span style={{ textAlign: "right", color: over ? "var(--warn)" : undefined }}>
              {over ? "Over the fund by " : "Remaining in the fund "}
              <br />
              <span className={styles.budgetTotal}>
                {formatCents(Math.abs(budgetCents - committed))}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {exceptions.length > 0 ? (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.applicant}>Worth your attention</span>
            <span className={styles.position}>{exceptions.length}</span>
          </div>
          <p className={styles.essay} style={{ marginTop: -6 }}>
            Banding handled the rest. These are the ones a rule should not decide
            for you.
          </p>
          <div className={styles.exceptions}>
            {exceptions.map((exception) => (
              <p key={exception.id} className={styles.exception}>
                <strong>{exception.applicantName}</strong>
                <span>{exception.note}</span>
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
