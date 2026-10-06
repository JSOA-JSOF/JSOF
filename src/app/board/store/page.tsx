import Link from "next/link";

import { KpiGrid } from "@/components/dashboard/Kpi";
import dash from "@/components/dashboard/dashboard.module.css";
import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { mayReadOrderRows } from "@/lib/store/board";
import { storeActions, storeKpis, storeSecondTier } from "@/lib/store/kpis";
import { COLLECTION_POSTURE_NOTE } from "@/lib/store/tax";

import styles from "./board.module.css";
import { Refused, StoreHeader, StoreScreen, StoreSodWarning } from "./parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Store — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The Store and Sales Chair's dashboard.
 *
 * Every figure comes from `src/lib/store/kpis.ts`, which calls `authorize()`
 * before it reads anything and demands AGGREGATE on FINANCIAL for JSOA. That
 * is what STORE_CHAIR holds, so the chair sees the whole dashboard: the
 * member versus non-member split, the tax figures, the counts. The row-level
 * order list needs READ, which the chair does not hold, and the panel at the
 * foot says so rather than showing an empty table or quietly dropping the
 * link.
 *
 * What is deliberately absent: a gross sales headline. It tells the chair
 * nothing they can act on and it buries the member split, which is the figure
 * with legal weight. The split's total appears only as the denominator of the
 * non-member share, where it belongs.
 */
export default async function BoardStoreDashboard() {
  const subject = await getCurrentSubject();
  const held = effectiveLevel(subject, "FINANCIAL", "JSOA");

  let kpis = null;
  let actions = null;
  let secondTier = null;
  try {
    kpis = storeKpis(subject);
    actions = storeActions(subject);
    secondTier = storeSecondTier(subject);
  } catch {
    kpis = null;
  }

  return (
    <StoreScreen>
      <StoreHeader here="/board/store" title="Store" />

      <p className={dash.lede}>
        The two figures that matter here are compliance records rather than
        sales statistics: what the store took in from members as against
        everyone else, and what it collected in sales tax and is holding for
        the state. Everything else on this page exists to keep those two
        defensible.
      </p>

      <StoreSodWarning subject={subject} />

      {kpis === null || actions === null || secondTier === null ? (
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

          <h2 className={styles.sectionHead}>What needs doing</h2>

          <div className={dash.actions}>
            {actions.map((action) => (
              <Link
                key={action.key}
                href={action.href}
                className={`${dash.action} ${action.urgent ? dash.actionUrgent : ""}`}
              >
                <span className={dash.actionLabel}>{action.label}</span>
                <span className={dash.actionNote}>{action.note}</span>
                <span className={dash.actionCount}>{action.count}</span>
              </Link>
            ))}
          </div>

          <h2 className={styles.sectionHead}>Also on the record</h2>

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

          <div className={styles.whyNote}>
            <strong>Why the member split outranks the sales total.</strong> The
            Association may run a store open to the public, but it has to keep
            separate records of what it takes in from members and from everyone
            else. If the non-member records are not adequate, the whole of the
            income from the public activity can be treated as unrelated
            business income, not only the non-member share. So the split is a
            control on the Association&apos;s tax position, and a single gross
            sales figure that hides it would be the wrong headline.{" "}
            <Link href="/board/store/receipts" className={styles.back}>
              Open the receipts report
            </Link>
            .
          </div>

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
