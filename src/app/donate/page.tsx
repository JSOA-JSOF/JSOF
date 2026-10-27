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
 * Rendered per request, not at build time.
 *
 * The funds now come from D1, and there is no binding during a build:
 * `database()` is null outside a request context, so prerendering this page
 * would bake the seed fund list into the public donate form for the life of
 * the deployment. A donor would then be offered a fund the database does not
 * have, pick it, and be refused at the payment step with "there is no fund
 * with the reference ...". Which fund a gift may go to is a live fact about
 * the ledger, so the page asks the ledger.
 *
 * It stays indexable: dynamic means server-rendered on demand, not private.
 */
export const dynamic = "force-dynamic";

/**
 * Public tier. Nothing here identifies a member: fund names and purposes are
 * published information, and this page shows no figure belonging to either
 * organization. Balances are FINANCIAL and live behind the board screens.
 *
 * `listPublicFundOptions` is the one read in this module with no `authorize()`
 * call, because it touches no data class. It returns names, restrictions and
 * purposes, and no money at all. See the note at the top of actions.ts.
 */
export default async function DonatePage() {
  // Two reads, one per entity, and never one merged list: the fund belongs to
  // one organization and the donor picks the organization first.
  const [foundation, association] = await Promise.all([
    listPublicFundOptions("JSOF"),
    listPublicFundOptions("JSOA"),
  ]);
  const funds: FundOption[] = [...foundation, ...association];

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
