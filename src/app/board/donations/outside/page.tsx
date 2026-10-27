import { OutsideColumns } from "@/components/workspace-shell/RoleTabs";
import { DEV_SWITCHER_PARAM } from "@/lib/donations/devSubject";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import { entitiesInScope, fundraisingOutside } from "@/lib/donations/workspace";
import { ENTITY_LABEL } from "@/lib/donations/kpis";
import Chrome from "../Chrome";
import Denied from "../Denied";
import styles from "../donations.module.css";

export const metadata = {
  title: "Fundraising, from outside — board",
  robots: { index: false, follow: false },
};

/**
 * Outside view: what the world sees of fundraising.
 *
 * This role has the largest external surface on the board, which makes this
 * the tab that matters most here: the donate flow, the partners page, every
 * sponsor acknowledgment as it will publish, and the receipt a donor gets.
 * Every finding anyone has about the live site is the same failure — nobody
 * owned what their function looked like from outside.
 *
 * Two columns, never merged. Public and donor are different audiences and
 * blurring them is how the OPSEC problems start, so the shared
 * `OutsideColumns` renders them side by side and this page never flattens
 * them into one list.
 *
 * The loudest row is deliberate and sorts to the top: an acknowledgment string
 * the validator flagged that is ALSO approved for publication. The validator
 * warns and never blocks, so that string can go out as written, and one
 * qualitative or comparative adjective converts the whole placement from
 * acknowledgment into taxable advertising. A flagged draft is a risk; a flagged
 * approval is a publication.
 *
 * The wording comes from the published-content read, which is why the
 * Fundraising Chair — who holds that at WRITE on both entities — sees more of
 * this tab than the Treasurer of one entity does, while seeing less of the
 * money everywhere else.
 */
export default async function FundraisingOutsidePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { subject, entity, roleLabel, qs } = await resolveScreenViewer(
    params[DEV_SWITCHER_PARAM],
  );

  const { surface, withheld, counts } = await fundraisingOutside(subject);
  const scope = entitiesInScope(subject);

  return (
    <Chrome
      entity={entity}
      roleLabel={roleLabel}
      current="outside"
      qs={qs}
      statusWord="outside view"
      title="What the world sees of this"
      lede={
        <>
          The donate flow, the partners page, every sponsor acknowledgment as it
          will publish, and what a signed-in donor sees of their own giving. Two
          audiences, side by side and never merged:{" "}
          {scope.length === 0
            ? "no entity is in this role's scope"
            : `across ${scope.map((e) => ENTITY_LABEL[e]).join(" and ")}`}
          .
        </>
      }
    >
      {/* A subject holding no assignment on either entity is not a reader of
          a board screen, even one whose rows are all about public pages. */}
      {scope.length === 0 && (
        <Denied
          roleLabel={roleLabel}
          needs="an assignment on the Association or the Foundation"
        />
      )}

      {scope.length > 0 && counts.publicProblems > 0 && (
        <div className={styles.flag}>
          <span className={styles.flagHead}>Read these first</span>
          <p>
            {counts.publicProblems} public{" "}
            {counts.publicProblems === 1 ? "item carries" : "items carry"} a
            problem.{" "}
            {counts.flaggedApproved > 0
              ? `${counts.flaggedApproved} acknowledgment ${
                  counts.flaggedApproved === 1 ? "string is" : "strings are"
                } flagged by the validator and approved for publication, which is ` +
                `the worst state here: they can go out as written, and a message ` +
                `mixing advertising with acknowledgment is advertising in its ` +
                `entirety. They sort to the top of the public column.`
              : counts.flagged > 0
                ? `${counts.flagged} flagged ${
                    counts.flagged === 1 ? "string is" : "strings are"
                  } not approved yet, so none can publish today. They sort to the ` +
                  `top of the public column, because approving one as written is ` +
                  `what would convert the placement into taxable advertising.`
                : "No acknowledgment string is flagged."}
          </p>
        </div>
      )}

      {scope.length > 0 && <OutsideColumns surface={surface} />}

      {withheld.length > 0 && (
        <div className={styles.flag}>
          <span className={styles.flagHead}>Withheld from {roleLabel}</span>
          <ul className={styles.findingList}>
            {withheld.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {scope.length > 0 && (
        <>
          <h2 className={styles.sectionHead}>The Foundation is invisible to donors</h2>
          <p className={styles.sectionNote}>
            The Foundation is the clean charitable entity and the one a donor
            wanting a reliable deduction should reach. On the live site it has
            no public contact path and no named treasurer, so that donor has
            nobody to write to and lands on the Association instead — where
            deductibility rests on a membership composition test that is not
            tracked per year and that the Association may not pass. Contact by
            office exists in this build and has not shipped. Until it does, the
            first column above is the whole answer to &ldquo;how does a donor
            reach the Foundation&rdquo;, and it is a page nobody outside can
            see.
          </p>

          <p className={styles.note}>
            Nothing on this tab reads a benefit valuation off a
            published-content row. The wording and the publication state are
            published content; the money is not, and reaching one through the
            other would undo the split this module runs on.
          </p>
        </>
      )}
    </Chrome>
  );
}
