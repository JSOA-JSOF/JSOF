import { OutsideColumns } from "@/components/workspace-shell/RoleTabs";
import { AuthzError } from "@/lib/authz/policy";
import { membershipRepository } from "@/lib/membership/repository";
import {
  guardWorkspaceRead,
  membershipOutside,
  MEMBER_DIRECTORY_QUESTION,
  RELEASE_QUEUE_NOTE,
  type MembershipOutside,
} from "@/lib/membership/workspace";

import styles from "../board.module.css";
import { MembershipShell, Refused } from "../shell";
import { currentActor } from "../subject";

export const metadata = {
  title: "Membership, from outside — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * What the world sees of the membership function.
 *
 * Two audiences, side by side, never merged. The public column and the
 * member column are different readerships and blurring them into one
 * "outside" is how the OPSEC problems start: the whole architecture separates
 * them, and a tab that showed one list would quietly undo that.
 *
 * Every finding we have about the live site is the same failure — nobody owns
 * what their function looks like from outside. This function has the clearest
 * example of it: the published membership URL returns 404 while still being
 * linked, and the office that owns membership holds no scope on public content
 * and so cannot fix a word of it.
 */
export default async function MembershipOutsidePage() {
  const { persona, subject } = await currentActor();

  let outside: MembershipOutside | null = null;
  let refusal: string | null = null;
  try {
    await guardWorkspaceRead(membershipRepository(), subject, "READ_MEMBERSHIP_OUTSIDE_VIEW");
    outside = membershipOutside(subject);
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  return (
    <MembershipShell current="outside">
      <h1 className={styles.title}>From outside</h1>
      <p className={styles.lede}>
        The membership function has two audiences and they are not the same people. Anyone can
        read the first column. The second is what someone who has already joined, or who is
        halfway through joining, sees of their own business. Nothing from one column belongs in
        the other.
      </p>

      {refusal || !outside ? (
        <Refused persona={persona} what="this role's external surface" detail={refusal ?? undefined} />
      ) : (
        <>
          <OutsideColumns surface={outside.surface} />

          <h2 className={styles.sectionHead}>What a member sees of their own record</h2>
          <p className={styles.sectionNote}>{MEMBER_DIRECTORY_QUESTION}</p>

          <h2 className={styles.sectionHead}>Queued for release</h2>
          <p className={styles.sectionNote}>{RELEASE_QUEUE_NOTE}</p>
          <p className={styles.sectionNote}>
            You are reading this as a role that holds{" "}
            <strong>{outside.publicContentLevel.toLowerCase()}</strong> on public content for the
            Association, read from the role table rather than assumed.
          </p>

          <p className={styles.note}>
            Never a member&rsquo;s name, unit, rank or face on a public-tier page. That is why
            the public column is about what the pages claim and the member column is about what
            a person is shown of themselves, and why neither column lists anybody.
          </p>
        </>
      )}
    </MembershipShell>
  );
}
