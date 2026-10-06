import Link from "next/link";

import { listPublicFundOptions } from "@/lib/donations/actions";
import styles from "./donate.module.css";
import DonateFlow, { type FundOption } from "./DonateFlow";

export const metadata = {
  title: "Make a gift — JSOA / JSOF",
  description:
    "Give to the Joint Special Operations Foundation or the Joint Special Operations Association.",
};

/**
 * Public tier. Nothing here identifies a member: fund names and purposes are
 * published information, and this page shows no figure belonging to either
 * organization. Balances are FINANCIAL and live behind the board screens.
 *
 * `listPublicFundOptions` is the one read in this module with no `authorize()`
 * call, because it touches no data class — it returns names, restrictions and
 * purposes, and no money at all. See the note at the top of actions.ts.
 */
export default function DonatePage() {
  const funds: FundOption[] = [
    ...listPublicFundOptions("JSOF"),
    ...listPublicFundOptions("JSOA"),
  ];

  return (
    <div className={styles.page} style={{ ["--hue" as string]: "var(--jsof)" }}>
      <header className={styles.bar}>
        <Link href="/" className={styles.back}>
          ← Both entities
        </Link>
        <span className={styles.status}>Give</span>
      </header>

      <div className={styles.body}>
        <h1 className={styles.title}>Make a gift</h1>
        <p className={styles.lede}>
          Four steps. You choose the organization, the amount, and which funds
          the money goes to. Card details are entered on the payment
          provider&rsquo;s own page, not here.
        </p>

        <DonateFlow funds={funds} />
      </div>
    </div>
  );
}
