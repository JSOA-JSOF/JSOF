import Link from "next/link";

import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import {
  boardInventory,
  boardOrderSummary,
  boardReceiptsReport,
  mayReadOrderRows,
} from "@/lib/store/board";
import { formatCents } from "@/lib/store/cart";
import { yearPeriod } from "@/lib/store/reports";
import { COLLECTION_POSTURE_NOTE } from "@/lib/store/tax";

import styles from "./board.module.css";
import { personLabel, Refused, StoreHeader, StoreScreen, StoreSodWarning } from "./parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Store — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The board store overview.
 *
 * Everything on this page comes from `src/lib/store/board.ts`, which calls
 * `authorize()` before it reads anything. The figures here need AGGREGATE, so
 * the store chair sees them. The order rows need READ, which the store chair
 * does not hold; the panel says so instead of showing an empty table.
 */
export default async function BoardStoreOverview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const subject = await getCurrentSubject();
  const held = effectiveLevel(subject, "FINANCIAL", "JSOA");

  let summary = null;
  let report = null;
  let inventoryCount: number | null = null;
  let missingCounts: string[] = [];
  try {
    summary = boardOrderSummary(subject);
    report = boardReceiptsReport(subject, yearPeriod(2026));
    const inventory = boardInventory(subject);
    inventoryCount = inventory.rows.length;
    missingCounts = inventory.skusMissingThisQuarter;
  } catch {
    summary = null;
  }

  return (
    <StoreScreen>
      <StoreHeader here="/board/store" title="Store" />
        <p className={styles.lede}>
          Orders, the member versus non-member receipts split, sales tax
          collected, inventory and refunds. All JSOA; the Foundation does not
          sell goods.
        </p>

        <StoreSodWarning subject={subject} />

        {summary === null || report === null ? (
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
            <h2 className={styles.sectionHead}>2026 to date</h2>
            <div className={styles.figures}>
              <div className={styles.figure}>
                <span className={styles.figureKey}>Gross receipts</span>
                <div className={styles.figureValue}>
                  {formatCents(report.totalGrossReceiptsCents)}
                </div>
                <p className={styles.figureNote}>Before tax, before refunds</p>
              </div>
              <div className={styles.figure}>
                <span className={styles.figureKey}>From members</span>
                <div className={styles.figureValue}>
                  {formatCents(
                    report.rows.find((r) => r.buyerType === "MEMBER")?.grossReceiptsCents ?? 0,
                  )}
                </div>
                <p className={styles.figureNote}>
                  {report.rows.find((r) => r.buyerType === "MEMBER")?.orderCount ?? 0} orders
                </p>
              </div>
              <div className={styles.figure}>
                <span className={styles.figureKey}>From non-members</span>
                <div className={styles.figureValue}>
                  {formatCents(
                    report.rows.find((r) => r.buyerType === "NON_MEMBER")?.grossReceiptsCents ?? 0,
                  )}
                </div>
                <p className={styles.figureNote}>
                  {(report.nonMemberShareBasisPoints / 100).toFixed(1)}% of gross receipts
                </p>
              </div>
              <div className={styles.figure}>
                <span className={styles.figureKey}>Sales tax collected</span>
                <div className={styles.figureValue}>
                  {formatCents(report.totalSalesTaxCollectedCents)}
                </div>
                <p className={styles.figureNote}>Held for the state, not a receipt</p>
              </div>
              <div className={styles.figure}>
                <span className={styles.figureKey}>Orders awaiting payment</span>
                <div className={styles.figureValue}>{summary.awaitingPaymentCount}</div>
                <p className={styles.figureNote}>Not counted as receipts</p>
              </div>
              <div className={styles.figure}>
                <span className={styles.figureKey}>Catalogue lines</span>
                <div className={styles.figureValue}>{inventoryCount ?? 0}</div>
                <p className={styles.figureNote}>
                  {missingCounts.length} awaiting this quarter&apos;s count
                </p>
              </div>
            </div>

            <div className={styles.whyNote}>
              <strong>Why the member split is the first figure on this page.</strong>{" "}
              The Association may run a store open to the public, but it has to
              keep separate records of what it takes in from members and from
              everyone else. If the non-member records are not adequate, the
              whole of the income from the public activity can be treated as
              unrelated business income, not just the non-member share. So the
              split is a control on the Association&apos;s tax position rather
              than a sales statistic.{" "}
              <Link href={`/board/store/receipts`} className={styles.back}>
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
                  "totals, not a list of who bought what. The totals above are the same figures the " +
                  "receipts report is built from."
                }
              />
            ) : null}

            <p className={styles.note}>{COLLECTION_POSTURE_NOTE}</p>
          </>
        )}
    </StoreScreen>
  );
}
