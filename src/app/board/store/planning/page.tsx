import Link from "next/link";

import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { storePlanningItems } from "@/lib/store/workspace";
import type { PlanningItem } from "@/lib/workspace/types";

import styles from "../board.module.css";
import { Refused, StoreHeader, StoreScreen, StoreSodWarning } from "../parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Store planning — JSOA board",
  robots: { index: false, follow: false },
};

const TYPE_LABEL: Record<PlanningItem["type"], string> = {
  DECISION: "decision",
  DISCUSSION: "discussion",
  INFORMATION: "information",
};

/**
 * What the Store and Sales Chair wants on the next board agenda.
 *
 * Three items, each one a board decision rather than a chair decision, which
 * is the test for being here. The reasons are built from live state in
 * `storePlanningItems` rather than stored as prose, so the fulfilment question
 * counts the flag as it actually stands today and the separation-of-duties item
 * carries the finding raised against whoever is in the seats.
 *
 * These flow into the Secretary's agenda builder rather than being retyped
 * there. `acceptedForMeetingId` is null on all three until the Secretary takes
 * one onto an agenda; this module never sets it and holds no local store of
 * agendas or meetings.
 */
export default async function StorePlanning() {
  const subject = await getCurrentSubject();
  const held = effectiveLevel(subject, "FINANCIAL", "JSOA");

  let items: PlanningItem[] | null = null;
  try {
    items = await storePlanningItems(subject);
  } catch {
    items = null;
  }

  const totalMinutes = (items ?? []).reduce((sum, item) => sum + item.estimateMinutes, 0);

  return (
    <StoreScreen>
      <StoreHeader here="/board/store/planning" title="Store planning" />

      <p className={styles.lede}>
        What this seat needs the board for, with the type, an estimate and the
        reason. Three items, and none of them is a sales question: two of them
        decide whether the store&rsquo;s controls can work at all, and the third
        decides what the store physically is.
      </p>

      <StoreSodWarning subject={subject} />

      {items === null ? (
        <Refused
          what="The store&rsquo;s planning items"
          needed="aggregate"
          held={held.toLowerCase()}
          because={
            subject.mfaSatisfied
              ? "Each reason here is built from the store's own figures, so a role that cannot read them in aggregate cannot be shown the reasons. That is the role definition, not a missing feature."
              : "The TOTP challenge has not been satisfied this session. Every non-public read requires it."
          }
        />
      ) : (
        <>
          <ul className={styles.plan}>
            {items.map((item) => (
              <li key={item.id} className={styles.planItem}>
                <div className={styles.planHead}>
                  <h2 className={styles.planTitle}>{item.title}</h2>
                  <span className={styles.planMeta}>
                    <span className={`${styles.chip} ${styles.chipHue}`}>
                      {TYPE_LABEL[item.type]}
                    </span>
                    <span className={styles.chip}>{item.estimateMinutes} min</span>
                    <span className={styles.chip}>{item.entity}</span>
                  </span>
                </div>
                <p className={styles.planReason}>{item.reason}</p>
                <p className={styles.planStatus}>
                  {item.acceptedForMeetingId === null
                    ? "Not yet taken onto an agenda. The Secretary's agenda builder reads this; it is not retyped there."
                    : `Accepted for meeting ${item.acceptedForMeetingId}.`}
                </p>
              </li>
            ))}
          </ul>

          <p className={styles.note}>
            {totalMinutes} minutes in all, which the agenda builder sums against
            the meeting length. The estimates are the chair&rsquo;s own and the
            Secretary may cut them.
          </p>

          <div className={styles.whyNote}>
            <strong>Why these three and nothing else.</strong> The store has
            plenty of operational questions and none of them belong on a board
            agenda. These three do because the chair cannot settle any of them
            alone: the fulfilment model decides whether a quarterly physical
            count has to exist at all, the seat question is the only real fix
            for the separation-of-duties finding rather than a control the board
            has to staff every quarter, and the registration question decides
            whether money the store is already holding in trust can be remitted.
            The second one is visible as a live finding on every store screen
            when the person reading holds both seats.{" "}
            <Link href="/board/store">See the Overview</Link> for the work that
            follows from them.
          </div>
        </>
      )}
    </StoreScreen>
  );
}
