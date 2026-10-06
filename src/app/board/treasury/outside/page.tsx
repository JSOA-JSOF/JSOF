import { OutsideColumns } from "@/components/workspace-shell/RoleTabs";
import { getCurrentSubject } from "@/lib/authz/session";
import { treasurySubject } from "@/lib/treasury/repository";
import {
  DEDUCTIBILITY_FLAG,
  FICTIONAL_DATA_NOTE,
  NC_131F_DISCLOSURE,
  NC_131F_STATUTORY_SPELLING,
  NC_131F_TYPE_SIZE_POINTS,
  treasurerOutside,
} from "@/lib/treasury/workspace";

import { ENTITY_LABELS, TreasuryHeader } from "../_components/chrome";
import styles from "../treasury.module.css";

export const metadata = {
  title: "Outside view — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

/**
 * What the world sees of the treasury function.
 *
 * This role has a smaller external surface than most, and saying so is better
 * than padding it. Four kinds of thing leave the building with the
 * Treasurer's name on them: a donation receipt, a 990, a cheque to a school,
 * and one sentence on the live site that should not be there. That is the list.
 * Inventing a fifth to make the tab look busy would be the failure this tab
 * exists to catch.
 *
 * Two audiences, side by side, never merged. The architecture already
 * separates the public tier from the member-or-donor tier and conflating them
 * is how OPSEC problems start, so the columns are rendered by the shared
 * `OutsideColumns` and there is no combined "outside" anywhere on the screen.
 *
 * The entity rule holds here as well. Every item names its entity in its own
 * title because the Association's return and the Foundation's return are
 * different documents filed by different boards, and a receipt from one is not
 * a receipt from the other. No figure appears on this tab at all, so there is
 * nothing to sum.
 */
export default async function TreasuryOutsidePage() {
  const subject = treasurySubject(await getCurrentSubject());
  const outside = treasurerOutside(subject);

  return (
    <div>
      <TreasuryHeader
        current="outside"
        title="What the world sees of the money"
        lede={
          "A small surface, honestly small. A receipt, two returns, a cheque run " +
          "and one published claim. Every finding we hold about the live site is " +
          "the same failure, which is that nobody owned what their function looked " +
          "like from outside, so this tab names an owner for each line even when " +
          "the line is fine."
        }
      />

      <h2 className={styles.sectionHead}>Two audiences, side by side</h2>
      <p className={styles.note}>
        Anyone, and a named donor or member. They are different audiences and this
        screen never blurs them into one. A receipt and a cheque go to one named
        party and belong in the right-hand column however public the organization is;
        a 990 is public by law and belongs in the left.
      </p>

      <OutsideColumns surface={outside.surface} />

      {outside.withheldCount > 0 ? (
        <p className={styles.note}>
          <strong>
            {outside.withheldCount}{" "}
            {outside.withheldCount === 1 ? "item is" : "items are"} withheld
          </strong>
          {outside.withheldEntities.length > 0 ? (
            <>
              {" "}
              ·{" "}
              {outside.withheldEntities
                .map((entity) => ENTITY_LABELS[entity].short)
                .join(" and ")}
            </>
          ) : null}
          . Those pages and documents exist and are outward-facing; you hold no
          financial scope on the entity that issues them. Withheld is not none.
        </p>
      ) : null}

      <p className={styles.note}>
        One item is shown to every reader whatever scope they hold: the flagged
        claim below. It is a sentence already published on a public page, so a
        stranger reads it without any grant at all and withholding it from a board
        member would be theatre. It would also mean the Foundation&rsquo;s
        Treasurer, whose entity is the one gifts actually are deductible to, never
        learned that the Association&rsquo;s pages were saying otherwise.
      </p>

      <h2 className={styles.sectionHead}>Queued for release</h2>
      <p className={styles.note}>{outside.releaseQueueNote}</p>

      <h2 className={styles.sectionHead}>
        The Chapter 131F disclosure, at {NC_131F_TYPE_SIZE_POINTS}-point type
      </h2>
      <p className={styles.note}>
        North Carolina requires this on every printed solicitation, written
        confirmation, receipt and reminder of a contribution, at a minimum of{" "}
        {NC_131F_TYPE_SIZE_POINTS}-point type, made conspicuous by underlining, a
        border or bold. It is not a footer that can shrink to fit. The statute spells
        it &ldquo;{NC_131F_STATUTORY_SPELLING}&rdquo; and the sentence is reproduced
        as the statute writes it, so the spelling below is deliberate and is not to
        be corrected to this platform&rsquo;s own usage.
      </p>

      <blockquote className={styles.disclosure131f}>{NC_131F_DISCLOSURE}</blockquote>

      <h2 className={styles.sectionHead}>
        Flagged: the live site says gifts to the Association are tax-deductible
      </h2>
      <div className={styles.panelPlain}>
        <dl className={styles.kv}>
          <dt>What is published</dt>
          <dd>{DEDUCTIBILITY_FLAG.claim}</dd>
          <dt>Why that may be wrong</dt>
          <dd>{DEDUCTIBILITY_FLAG.why}</dd>
          <dt>Who carries it</dt>
          <dd>{DEDUCTIBILITY_FLAG.exposure}</dd>
          <dt>What to do</dt>
          <dd>{DEDUCTIBILITY_FLAG.remedy}</dd>
        </dl>
      </div>

      <h2 className={styles.sectionHead}>A third audience these columns do not have</h2>
      <p className={styles.note}>
        A school&rsquo;s financial aid office, the IRS and the State Solicitation
        Licensing Branch are none of them the public and none of them donors, and the
        two columns above have nowhere to put them. The cheque run sits in the
        named-recipient column with its recipient stated in its own title, which is
        the honest placement available rather than the right one. Reported as a gap
        in the shared shape rather than papered over here.
      </p>

      <p className={styles.note}>{FICTIONAL_DATA_NOTE}</p>
    </div>
  );
}
