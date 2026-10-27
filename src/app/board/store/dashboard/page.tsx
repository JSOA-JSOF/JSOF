import Link from "next/link";

import { KpiGrid } from "@/components/dashboard/Kpi";
import dash from "@/components/dashboard/dashboard.module.css";
import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { mayReadOrderRows } from "@/lib/store/board";
import { storeKpis, storeMoreFigures, storeSecondTier } from "@/lib/store/kpis";
import { COLLECTION_POSTURE_NOTE } from "@/lib/store/tax";

import styles from "../board.module.css";
import { Refused, StoreHeader, StoreScreen, StoreSodWarning } from "../parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Store dashboard — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The Store and Sales Chair's Dashboard tab: how we know the store is working.
 *
 * Three headline tiles, which is the cap `docs/ROLE-WORKSPACE.md` sets. The
 * reasoning for the three is in `src/lib/store/kpis.ts` at `storeKpis`, and in
 * short:
 *
 *   1. The member and non-member split, as ONE tile. It is a single compliance
 *      artefact — the separate records Pub. 3386 ch. 9 requires of an activity
 *      open to the public — not a segmentation of the customer base. Two tiles
 *      read as marketing; one tile reads as the record it is.
 *   2. The quarterly physical count, because it is the compensating control
 *      for the Treasurer also chairing the store, and because it is the only
 *      figure here that is currently failing.
 *   3. Sales tax collected and held in trust, which has to sit BESIDE the
 *      split and never inside it. It is the state's money, and a figure that
 *      added it to receipts would be wrong.
 *
 * Everything else is behind the disclosure. Gross sales has no tile at all: it
 * tells the chair nothing they can act on and it hides the split.
 *
 * The doing is on the Overview tab, not here. `docs/DASHBOARD-BRIEF.md` rule 6
 * asks for the actions under the figures; the spine moves them one tab left so
 * there is one list rather than two.
 */
export default async function StoreDashboard() {
  const subject = await getCurrentSubject();
  const held = effectiveLevel(subject, "FINANCIAL", "JSOA");

  let kpis = null;
  let more = null;
  let secondTier = null;
  try {
    kpis = await storeKpis(subject);
    more = await storeMoreFigures(subject);
    secondTier = await storeSecondTier(subject);
  } catch {
    kpis = null;
  }

  return (
    <StoreScreen>
      <StoreHeader here="/board/store/dashboard" title="Store dashboard" />

      <p className={dash.lede}>
        Three figures. Two of them are compliance records rather than sales
        statistics: what the store took in from members as against everyone
        else, and what it collected in sales tax and is holding for the state.
        The third is the count that checks the goods against the records.
      </p>

      <StoreSodWarning subject={subject} />

      {kpis === null || more === null || secondTier === null ? (
        <Refused
          what="The store figures"
          needed="aggregate"
          held={held.toLowerCase()}
          because={
            subject.mfaSatisfied
              ? "The role table gives this role no reach into JSOA financial records. That is the role definition, not a missing feature."
              : "The TOTP challenge has not been satisfied this session. Every non-public read requires it."
          }
        />
      ) : (
        <>
          <div className={dash.heading}>
            <h2 className={dash.title}>Where the store stands</h2>
            <span className={dash.asOf}>JSOA · calendar year to date</span>
          </div>

          <KpiGrid kpis={kpis} />

          <div className={styles.whyNote}>
            <strong>Why the member split outranks the sales total.</strong> The
            Association may run a store open to the public, but it has to keep
            separate records of what it takes in from members and from everyone
            else. If the non-member records are not adequate, the consequence is
            not a tax on the non-member share: the whole of the income from the
            public activity can be treated as unrelated business income. So the
            split is a control on the Association&apos;s tax position, and a
            single gross sales figure that hid it would be the wrong headline.
            It is one tile and not two because it is one record.{" "}
            <Link href="/board/store/receipts">
              Open the receipts report
            </Link>
            .
          </div>

          <div className={styles.whyNote}>
            <strong>Why collected tax sits beside the split.</strong> North
            Carolina does not exempt the Association from collecting sales tax on
            merchandise, and what it collects is the state&apos;s money held in
            trust rather than a receipt of the organization. It is reported
            beside the split and never inside it. Any figure that added the two
            would be wrong, so no figure on this platform does.
          </div>

          <details className={styles.more}>
            <summary className={styles.moreSummary}>
              More figures — {more.length + secondTier.length} that would not
              change a decision this quarter
            </summary>

            <KpiGrid kpis={more} />

            <div className={dash.actions}>
              {secondTier.map((note) => (
                <div key={note.key} className={dash.action}>
                  <span className={dash.actionLabel}>{note.label}</span>
                  <span className={dash.actionNote}>{note.detail}</span>
                  <span className={dash.actionCount}>
                    {note.value === null ? "not measured" : note.value}
                  </span>
                </div>
              ))}
            </div>
          </details>

          <p className={styles.note}>
            What to do about any of this is on the{" "}
            <Link href="/board/store">Overview tab</Link>, derived from these
            same figures. It is one list there rather than two lists to keep in
            step.
          </p>

          {!mayReadOrderRows(subject) ? (
            <Refused
              what="The order list, row by row"
              needed="read"
              held={held.toLowerCase()}
              because={
                "The role table gives the Store Chair aggregate on financial records and not read. " +
                "That is deliberate: the person who sets the prices and holds the goods gets the " +
                "totals, not a list of who bought what. Every figure above is built from the same " +
                "orders, counted rather than listed."
              }
            />
          ) : null}

          <p className={styles.note}>{COLLECTION_POSTURE_NOTE}</p>
        </>
      )}
    </StoreScreen>
  );
}
