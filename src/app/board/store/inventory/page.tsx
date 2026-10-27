import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { boardInventory, recordedStoreChairPersonId, storeSodBanner } from "@/lib/store/board";
import { currentQuarter, SECOND_COUNTER_NOTE } from "@/lib/store/inventory";

import { recordCountAction } from "../actions";
import styles from "../board.module.css";
import { personLabel, Refused, StoreHeader, StoreScreen, StoreSodWarning } from "../parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Store inventory — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * Inventory: units in, units out, units on hand, and the quarterly physical
 * count entered by somebody other than the store chair.
 *
 * Two things this screen has to get right.
 *
 * A print-on-demand line has no stock figures at all. It shows "not stocked"
 * rather than zero, because zero reads as "we are out of them" and because a
 * zero would make every print-on-demand line look like a variance at the next
 * count. The units the printer shipped are still shown, since that figure is
 * real and useful.
 *
 * The count form refuses the store chair. The refusal is in
 * `buildPhysicalCount` through `assertNotSelfApproval`, not in this page, and
 * the form is still rendered for the store chair with the reason stated, so the
 * control is visible rather than hidden behind a missing button.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const subject = await getCurrentSubject();
  const refused = typeof params.refused === "string" ? params.refused : null;
  const done = typeof params.done === "string" ? params.done : null;
  const held = effectiveLevel(subject, "FINANCIAL", "JSOA");

  let inventory = null;
  try {
    inventory = await boardInventory(subject);
  } catch {
    inventory = null;
  }

  const chairId = await recordedStoreChairPersonId();
  const banner = storeSodBanner(subject);
  const isStoreChair = banner.rolesHeld.includes("STORE_CHAIR");
  const mayWrite = held === "WRITE" && subject.mfaSatisfied;

  return (
    <StoreScreen>
      <StoreHeader here="/board/store/inventory" title="Inventory" />
        <p className={styles.lede}>
          Units in, units out and units on hand for the lines the store holds,
          with the quarterly physical count beside the book figure. Lines that
          are printed to order hold no stock and show no stock figures.
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
            <strong>Recorded.</strong> {done}
          </div>
        ) : null}

        {inventory === null ? (
          <Refused
            what="The inventory figures"
            needed="aggregate"
            held={held.toLowerCase()}
            because={
              subject.mfaSatisfied
                ? "The role table gives this role no reach into JSOA financial records."
                : "The TOTP challenge has not been satisfied this session."
            }
          />
        ) : (
          <>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Fulfilment</th>
                    <th className={styles.num}>Units in</th>
                    <th className={styles.num}>Units out</th>
                    <th className={styles.num}>On hand, book</th>
                    <th>Last count</th>
                    <th className={styles.num}>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.rows.map((row) => (
                    <tr key={row.sku}>
                      <td>
                        {row.name}
                        <br />
                        <span className="eyebrow">{row.sku}</span>
                      </td>
                      <td>
                        <span
                          className={
                            row.fulfilment === "print_on_demand" ? styles.chip : styles.chipHue
                          }
                        >
                          {row.fulfilment === "print_on_demand" ? "printed to order" : "stock"}
                        </span>
                      </td>
                      <td className={styles.num}>
                        {row.unitsIn === null ? "not stocked" : row.unitsIn}
                      </td>
                      <td className={styles.num}>{row.unitsOut}</td>
                      <td className={styles.num}>
                        {row.unitsOnHand === null ? "not stocked" : row.unitsOnHand}
                      </td>
                      <td>
                        {row.lastCount === null ? (
                          row.fulfilment === "print_on_demand" ? (
                            <span className="eyebrow">nothing to count</span>
                          ) : (
                            <span className={styles.chipWarn}>never counted</span>
                          )
                        ) : (
                          <>
                            {row.lastCount.countedUnits} units, {row.lastCount.quarter}
                            <br />
                            <span className="eyebrow">
                              counted by{" "}
                              {personLabel(row.lastCount.countedByPersonId)}
                            </span>
                          </>
                        )}
                      </td>
                      <td className={styles.num}>
                        {row.varianceUnits === null ? (
                          "n/a"
                        ) : row.varianceUnits === 0 ? (
                          "0"
                        ) : (
                          <span className={styles.chipWarn}>{row.varianceUnits}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className={styles.note}>
              {inventory.printOnDemandSkus.length} of the {inventory.rows.length} lines
              are printed to order and hold no stock. The board has not decided
              between holding stock and printing to order, so the choice is a
              field on each product and this screen reads either.
            </p>

            <h2 className={styles.sectionHead}>Quarterly physical count</h2>
            <div className={styles.whyNote}>
              <strong>Who may enter it.</strong> {SECOND_COUNTER_NOTE} The store
              chair on this entity is{" "}
              {personLabel(chairId)}, so a count entered by that
              person is refused.
            </div>

            {inventory.skusMissingThisQuarter.length > 0 ? (
              <p className={styles.note}>
                Not yet counted in {inventory.quarter}:{" "}
                {inventory.skusMissingThisQuarter.join(", ")}.
              </p>
            ) : (
              <p className={styles.note}>
                Every stocked line has a count for {inventory.quarter}.
              </p>
            )}

            {mayWrite ? (
              <form action={recordCountAction} className={styles.actionRow}>
                                <label className={styles.field}>
                  <span className="eyebrow">Line</span>
                  <select name="sku" defaultValue="">
                    <option value="" disabled>
                      Pick a stocked line
                    </option>
                    {inventory.rows
                      .filter((r) => r.fulfilment === "stock")
                      .map((r) => (
                        <option key={r.sku} value={r.sku}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className="eyebrow">Quarter</span>
                  <input
                    type="text"
                    name="quarter"
                    defaultValue={currentQuarter()}
                    size={8}
                  />
                </label>
                <label className={styles.field}>
                  <span className="eyebrow">Units counted</span>
                  <input type="number" name="countedUnits" min={0} step={1} size={6} />
                </label>
                <button type="submit" className={styles.action}>
                  Record the count
                </button>
              </form>
            ) : (
              <Refused
                what="Recording a count"
                needed="write"
                held={held.toLowerCase()}
                because={
                  subject.mfaSatisfied
                    ? "Recording a count writes a financial record. Reading the figures does not."
                    : "The TOTP challenge has not been satisfied this session."
                }
              />
            )}

            {isStoreChair && mayWrite ? (
              <div className={styles.finding}>
                <span className={styles.findingHead}>
                  This form will refuse you
                </span>
                <p className={styles.findingBody}>
                  You hold the store chair on this entity, so a count entered
                  here will be refused. The form is shown rather than hidden so
                  the control is visible: somebody else has to do the counting.
                </p>
              </div>
            ) : null}
          </>
        )}
    </StoreScreen>
  );
}
