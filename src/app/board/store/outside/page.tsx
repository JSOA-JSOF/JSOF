import Link from "next/link";

import { OutsideColumns } from "@/components/workspace-shell/RoleTabs";
import { effectiveLevel } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { storeOutsideSummary, storeOutsideSurface } from "@/lib/store/workspace";
import type { StoreOutsideSummary } from "@/lib/store/workspace";
import type { OutsideSurface } from "@/lib/workspace/types";

import styles from "../board.module.css";
import { Refused, StoreHeader, StoreScreen, StoreSodWarning } from "../parts";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Store outside view — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * What the world sees of the store, in two columns that are never merged.
 *
 * This tab is unusually load-bearing for this role, because the member and
 * public distinction is not a presentation choice here. It is the product, and
 * it is the same control as the tax record: what a visitor can see decides
 * what the Association has disclosed, and what a member can buy decides which
 * record the receipt lands in.
 *
 * The rule the columns enforce: a member-restricted line is ABSENT from the
 * public column, not present in it and marked locked. There is no greyed row,
 * no "members only" badge and no count of hidden items anywhere on the public
 * side, because a label saying a thing exists tells a visitor what the members
 * have. `catalogue.ts:toPublicProduct` throws on a restricted product rather
 * than redacting one for the same reason, and `tests/store.test.ts` asserts
 * both ends of it.
 */
export default async function StoreOutside() {
  const subject = await getCurrentSubject();
  const held = effectiveLevel(subject, "PUBLIC_CONTENT", "JSOA");

  let surface: OutsideSurface | null = null;
  let summary: StoreOutsideSummary | null = null;
  try {
    surface = await storeOutsideSurface(subject);
    summary = await storeOutsideSummary(subject);
  } catch {
    surface = null;
  }

  return (
    <StoreScreen>
      <StoreHeader here="/board/store/outside" title="Store, from outside" />

      <p className={styles.lede}>
        Two audiences, side by side, never blurred into one &ldquo;outside&rdquo;.
        For this seat that separation is the product rather than a layout
        decision: the public catalogue and the member catalogue are different
        lists on purpose, and which one a sale came from is what decides the
        record it lands in.
      </p>

      <StoreSodWarning subject={subject} />

      {surface === null || summary === null ? (
        <Refused
          what="The store&rsquo;s external surface"
          needed="read"
          held={held.toLowerCase()}
          onClass="public content"
          because={
            subject.mfaSatisfied
              ? "This tab reads what the site publishes, which is public content and not a financial record. A role with no reach into public content is not shown what the organization is publishing under its own name."
              : "The TOTP challenge has not been satisfied this session. Every non-public read requires it."
          }
        />
      ) : (
        <>
          <OutsideColumns surface={surface} />

          <h2 className={styles.sectionHead}>What is in each column</h2>
          <ul className={styles.plainList}>
            <li>
              <strong>Public.</strong> {summary.publicLines} lines, of which{" "}
              {summary.publicStockLines} are held as stock and{" "}
              {summary.publicPodLines} are printed to order. Prices exclude
              North Carolina sales tax, which is shown at checkout. A
              member-restricted SKU typed into an item URL answers not found
              rather than forbidden, because a 403 on a specific SKU would
              confirm the SKU exists.
            </li>
            <li>
              <strong>Members.</strong> All {summary.activeLines} active lines,
              of which {summary.memberOnlyLines} exist only here, in{" "}
              {summary.collections.length}{" "}
              {summary.collections.length === 1 ? "collection" : "collections"} (
              {summary.collections.join(", ")}). That count is stated here and
              on the member column, never on the public one.
            </li>
          </ul>

          <div className={styles.whyNote}>
            <strong>How the two columns differ, and why it is not a filter.</strong>{" "}
            The public column is everything a visitor with no account can reach.
            The member column is the full catalogue, including the lines that
            exist only there. The difference is not that the member column shows
            more of the same list: a member-restricted line is absent from the
            public side entirely, and it is named nowhere public, not even to
            say it is unavailable. There is no &ldquo;4 more for members&rdquo;
            row, no greyed-out tile and no count of what is hidden, because each
            of those tells a visitor exactly what the members have. The public
            catalogue is built by a projection that refuses to run on a
            restricted product rather than one that redacts it, so a forgotten
            field cannot leak one into a public response.
          </div>

          <div className={styles.whyNote}>
            <strong>The seasonal collections are a member feature on purpose.</strong>{" "}
            A seasonal grouping published publicly would advertise a calendar of
            things the public cannot buy, which is the same disclosure as
            listing the items. So the collections live in the member column and
            the public catalogue has no notion of a season.
          </div>

          <div className={styles.finding}>
            <span className={styles.findingHead}>
              Live site · store · placeholder published
            </span>
            <p className={styles.findingBody}>
              The live site&rsquo;s main navigation has a Store link and it
              lands on a page saying the store is under construction. The
              navigation promises a shop that does not open, which is worse than
              having no link at all: a visitor who follows it once does not
              follow it again, and a donor shown a construction page learns
              something about the organization that is not true of it.
            </p>
            <p className={styles.findingMitigation}>
              This catalogue is what the link should reach.{" "}
              <Link href="/store">The public catalogue</Link> is complete enough
              to be linked today. Changing the live site&rsquo;s navigation is
              the Webmaster&rsquo;s act, not this seat&rsquo;s, which is the
              finding the Outside view exists to surface: nobody owned what this
              function looks like from outside.
            </p>
          </div>

          <p className={styles.note}>
            Nothing of the store&rsquo;s is queued for release behind a second
            approver. The store publishes a catalogue rather than copy about
            people, so the OPSEC release gate has nothing of this seat&rsquo;s
            in it. A product name, a price and a blurb carry no member&rsquo;s
            name, unit, rank or face, and the public tier is built so they
            cannot.
          </p>
        </>
      )}
    </StoreScreen>
  );
}
