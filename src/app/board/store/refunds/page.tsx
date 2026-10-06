import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { boardRefunds } from "@/lib/store/board";
import { formatCents } from "@/lib/store/cart";
import {
  REFUND_SECOND_APPROVER_THRESHOLD_CENTS,
  REFUND_THRESHOLD_NOTE,
  refundRequiresSecondApprover,
} from "@/lib/store/refunds";

import { approveRefundAction } from "../actions";
import styles from "../board.module.css";
import { personLabel, Refused, StoreHeader, StoreScreen, StoreSodWarning } from "../parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Store refunds — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * Refunds, with the second-approver gate.
 *
 * Above the threshold the approver must differ from the person who raised it.
 * The check is `assertNotSelfApproval` in the shared policy, reached through
 * `approveRefund`; this page only decides what to render. The approve control
 * is shown to the requester as well, with the reason it will refuse, because a
 * missing button teaches nobody anything.
 */
export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const subject = await getCurrentSubject();
  const refused = typeof params.refused === "string" ? params.refused : null;
  const done = typeof params.done === "string" ? params.done : null;
  const held = effectiveLevel(subject, "FINANCIAL", "JSOA");
  const mayWrite = held === "WRITE" && subject.mfaSatisfied;

  let refunds = null;
  try {
    refunds = boardRefunds(subject);
  } catch {
    refunds = null;
  }

  return (
    <StoreScreen>
      <StoreHeader here="/board/store/refunds" title="Refunds" />
        <p className={styles.lede}>
          A refund above {formatCents(REFUND_SECOND_APPROVER_THRESHOLD_CENTS)} needs
          a second approver, and the approver cannot be the person who raised
          it.
        </p>

        <StoreSodWarning subject={subject} />

        {refused ? (
          <div className={styles.refused}>
            <span className={styles.refusedHead}>Refused</span>
            <p className={styles.findingBody}>{refused}</p>
          </div>
        ) : null}
        {done ? (
          <div className={styles.whyNote}>
            <strong>Approved.</strong> {done}
          </div>
        ) : null}

        {refunds === null ? (
          <Refused
            what="The refund list"
            needed="aggregate"
            held={held.toLowerCase()}
            because={
              subject.mfaSatisfied
                ? "The role table gives this role no reach into JSOA financial records."
                : "The TOTP challenge has not been satisfied this session."
            }
          />
        ) : refunds.length === 0 ? (
          <p className={styles.empty}>No refunds have been raised.</p>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Refund</th>
                  <th>Order</th>
                  <th className={styles.num}>Amount</th>
                  <th className={styles.num}>Of which tax</th>
                  <th>Reason</th>
                  <th>Raised by</th>
                  <th>Second approver</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((refund) => {
                  const needsSecond = refundRequiresSecondApprover(refund.amountCents);
                  const wouldSelfApprove = refund.createdById === subject.personId;
                  return (
                    <tr key={refund.id}>
                      <td className="mono">{refund.id}</td>
                      <td className="mono">{refund.orderId}</td>
                      <td className={styles.num}>{formatCents(refund.amountCents)}</td>
                      <td className={styles.num}>{formatCents(refund.taxPortionCents)}</td>
                      <td>{refund.reason}</td>
                      <td>{personLabel(refund.createdById)}</td>
                      <td>
                        {!needsSecond ? (
                          <span className={styles.chip}>not required</span>
                        ) : refund.approvedByPersonId ? (
                          <>
                            <span className={styles.chipHue}>approved</span>
                            <br />
                            <span className="eyebrow">
                              {personLabel(refund.approvedByPersonId)}
                            </span>
                          </>
                        ) : (
                          <span className={styles.chipWarn}>required</span>
                        )}
                      </td>
                      <td>
                        {refund.status !== "REQUESTED" ? (
                          <span className={styles.chip}>{refund.status.toLowerCase()}</span>
                        ) : !mayWrite ? (
                          <span className="eyebrow">this role cannot approve</span>
                        ) : (
                          <form action={approveRefundAction}>
                                                        <input type="hidden" name="refund" value={refund.id} />
                            <button type="submit" className={styles.action}>
                              Approve
                            </button>
                            {needsSecond && wouldSelfApprove ? (
                              <span className="eyebrow">
                                <br />
                                You raised this one, so approval will be refused
                              </span>
                            ) : null}
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.whyNote}>
          <strong>Why the threshold is this low.</strong> {REFUND_THRESHOLD_NOTE}
        </div>

        <p className={styles.note}>
          A refund of a taxable sale reduces the sales tax owed for the period,
          so the tax portion is carried on the refund and shown here. It is not
          a separate decision and it is not optional.
        </p>
    </StoreScreen>
  );
}
