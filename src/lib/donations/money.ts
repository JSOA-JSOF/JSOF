/**
 * Integer cents, start to finish. No float ever holds money in this module.
 *
 * Parsing and formatting live together so that the pair stays reversible:
 * anything `formatCents` prints, `parseDollarsToCents` reads back.
 */

export const CURRENCY = "USD" as const;
export type Currency = typeof CURRENCY;

/** `1234567` -> `"$12,345.67"`. Trunc, never round: rounding money hides bugs. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`;
}

/**
 * Reads a typed dollar amount. Returns null rather than NaN or a guess, so a
 * caller has to decide what to tell the person who typed it.
 *
 * Accepts `10000`, `10,000`, `$10,000.50`. Refuses three decimal places,
 * negative amounts, and anything else.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** True only for a whole, finite, non-negative count of cents. */
export function isCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
