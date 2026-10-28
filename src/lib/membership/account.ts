/**
 * The account a new member gets when their dues clear. E11.
 *
 * This is the join that six of this office's sixteen functions were blocked
 * on. `member.person_id` has existed since migration 0003 with a comment
 * saying it is "the account, once there is one", `invite()` has existed in
 * `src/lib/auth/store.ts` since the identity module landed, and nothing
 * connected them: the column was bound as the literal NULL and `invite()` had
 * no callers. So an approved applicant who paid became a roster row and not a
 * person, and could not sign in without a volunteer doing something by hand.
 *
 * Three decisions here are worth stating, because each one had a worse
 * alternative that would have looked fine.
 *
 * **`invite()` rather than a new write.** It is idempotent and returns the
 * existing person for an address that already has one, which is exactly the
 * case the requirements call out: a board member joining as a member, or
 * somebody invited to the platform for another reason. The member record links
 * to that identity instead of minting a second one.
 *
 * **The MEMBER grant is recorded as granted by the new person themselves.**
 * `role_grant.granted_by` is NOT NULL and references `person(id)`, so it needs
 * a real id, and there is no human in this path: a Stripe webhook cleared a
 * payment. Naming an officer who did not act would be worse than naming the
 * subject, because it would put a decision in somebody's name that they did
 * not make. What actually conferred the role — the application and the
 * payment — is recorded in `membership_audit` by the caller.
 *
 * **No sign-in link is sent from here.** The member gets an account and the
 * dues receipt; the link is issued when they ask for one at `/sign-in`, which
 * is `issueLoginToken`'s job and the auth lane's route. Mailing a live
 * single-use credential unprompted, to an address nobody has verified, is a
 * credential sitting in a mailbox.
 */

import type { Entity, Role } from "../authz/model";
import { assignmentsFor, grantRole, invite } from "../auth/store";
import { database } from "../db";

/** Member tier is an Association role. JSOF has donors, not members. */
const MEMBER_ROLE: Role = "MEMBER";

export type AccountProvisioning =
  | {
      linked: true;
      personId: string;
      /** False when the person already held MEMBER for this entity. */
      roleGranted: boolean;
      /** True when `invite()` found an identity rather than creating one. */
      reusedExistingPerson: boolean;
    }
  | {
      linked: false;
      personId: null;
      /** Plain words, for the audit entry and for the chair's screen. */
      reason: string;
    };

export const NO_IDENTITY_STORE =
  "No identity store was reachable, so the roster record was created without " +
  "an account. The member cannot sign in until one is linked.";

/**
 * Find or create the person behind a new member, and make sure they hold
 * MEMBER for the entity.
 *
 * Returns rather than throws when there is no database, because that is a
 * normal state and not a failure: `next dev` with no Worker behind it has no
 * binding and the test suite has no Worker at all. It would be wrong to fail a
 * cleared payment over it — the money is taken and the roster record is the
 * thing that must exist. The caller records that the account is missing.
 *
 * A failure from the identity store itself is NOT caught. A database that is
 * present and refusing writes is a real failure, and swallowing it would leave
 * a member with no account and nothing saying so.
 */
export async function provisionMemberAccount(input: {
  email: string;
  displayName: string;
  entity: Entity;
}): Promise<AccountProvisioning> {
  if (!database()) {
    return { linked: false, personId: null, reason: NO_IDENTITY_STORE };
  }

  const before = await personIdIfKnown(input.email);
  const person = await invite(input.email, input.displayName);

  // `grantRole` inserts, and 0001 carries a partial unique index for one live
  // grant of a role per person per entity, so a second grant is an error
  // rather than a no-op. Read first.
  const held = await assignmentsFor(person.id);
  const alreadyMember = held.some(
    (a) => a.role === MEMBER_ROLE && a.entity === input.entity,
  );
  if (!alreadyMember) {
    await grantRole(person.id, MEMBER_ROLE, input.entity, person.id);
  }

  return {
    linked: true,
    personId: person.id,
    roleGranted: !alreadyMember,
    reusedExistingPerson: before !== null,
  };
}

/**
 * Whether an address already has an identity, read-only.
 *
 * Used to report whether `invite()` reused a person rather than created one,
 * which is the difference between a re-admission and a new member and is a
 * thing the chair should be able to see on the record.
 */
async function personIdIfKnown(email: string): Promise<string | null> {
  const { personByEmail } = await import("../auth/store");
  const row = await personByEmail(email);
  return row?.id ?? null;
}
