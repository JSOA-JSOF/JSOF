import { PageHead } from "@/app/(public)/blocks";
import { PublicShell } from "@/app/(public)/PublicShell";
import { listPublicFundOptions } from "@/lib/donations/actions";
import styles from "./donate.module.css";
import DonateFlow, { type FundOption } from "./DonateFlow";

export const metadata = {
  title: "Make a gift · JSOA / JSOF",
  description:
    "Give to the Joint Special Operations Foundation or the Joint Special Operations Association.",
};

/**
 * Public tier. Nothing here identifies a member: fund names and purposes are
 * published information, and this page shows no figure belonging to either
 * organization. Balances are FINANCIAL and live behind the board screens.
 *
 * `listPublicFundOptions` is the one read in this module with no `authorize()`
 * call, because it touches no data class. It returns names, restrictions and
 * purposes, and no money at all. See the note at the top of actions.ts.
 */
export default function DonatePage() {
  const funds: FundOption[] = [
    ...listPublicFundOptions("JSOF"),
    ...listPublicFundOptions("JSOA"),
  ];

  return (
    <PublicShell
      entity="JSOF"
      currentPath="/donate"
      crumbs={[{ href: "/donate", label: "Donate" }]}
    >
      <PageHead
        eyebrow="Foundation · 501(c)(3)"
        title="Make a gift"
        lede={
          "Four steps. You choose the amount and which funds the money goes " +
          "to. Card details are entered on the payment provider's own page, " +
          "never here."
        }
      />
      <div className={styles.page}>
        <DonateFlow funds={funds} />
      </div>
    </PublicShell>
  );
}
