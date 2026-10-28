/**
 * The member tier: a member sees their own record, and corrects their own
 * phone number. E28, and the half of E30 that can be built today.
 *
 * ## Why this does not call `authorize()` with a level
 *
 * Every other read in this module starts with `authorize()` against a data
 * class and a level. This one cannot, and the reason is in the role table:
 * `MEMBER` holds no grants at all, and the note beside it says member-tier
 * access is "scoped by ownership of the record". There is no level that would
 * express "this one row, because it is yours" — a grant of MEMBER_PII READ
 * would be the whole roster, which is precisely the query the intake is built
 * never to answer, and widening the role to make a page work would be the
 * module deciding it needs more access. `src/lib/authz/**` changes by review,
 * not by a module.
 *
 * So the gate here is ownership, and it is mechanical:
 *
 *   1. the caller must be a signed-in person who has passed the second factor;
 *   2. the record returned is looked up BY that person's id. There is no
 *      member id parameter anywhere in this file, so there is no id to
 *      change in a URL. A member asking for somebody else's record is not
 *      refused — it is not expressible.
 *
 * That is stronger than a check after the fact and it is why the functions
 * take a `Subject` and nothing else.
 *
 * ## What a member is and is not told
 *
 * `PROBATIONARY` and `GOOD_STANDING` produce the same view and the same
 * words. The 30-day audit is a check on the record, not a probation the
 * member serves, and telling somebody they are on probation would be making
 * them wait for something they have already paid for. A held audit finding
 * likewise does not change their standing, because it does not.
 *
 * There is no renewal date, because there are no renewals: the board settled
 * dues as a one-time payment on 27 October 2026. Where a renewal date would
 * be, the page states the basis.
 */

import { type Subject } from "../authz/policy";
import { grantsMemberAccess, type MembershipState } from "./state";
import { enqueue } from "./notify";
import type { MembershipRepository } from "./repository";
import { DUES_AMOUNT_CENTS, MEMBERSHIP_ENTITY, type Member } from "./types";

/**
 * What the member's own page may render.
 *
 * A closed set, not a `Member`. The roster record carries the compliance
 * fields the composition report counts and the derived war-veteran flag that
 * may disagree with what the member attested; a member reading "attestation
 * disagrees" about themselves with no explanation and no way to fix it is a
 * phone call, not information. The fields that are theirs to see and theirs to
 * correct are here; the rest stays chair-side.
 */
export type OwnRecordView = {
  memberId: string;
  displayName: string;
  /** Plain words, not the state name. */
  standing: string;
  /** The state itself, for a caller that needs to branch. Never rendered raw. */
  state: MembershipState;
  joinedAt: string;
  /** When dues cleared. Null for an imported record where nobody knows. */
  duesClearedAt: string | null;
  email: string;
  phone: string;
  /** What is owed, and when. There is no renewal, so this says so. */
  duesBasis: string;
  /** True when the record carries no service dates, so the page can offer a fix. */
  serviceDatesMissing: boolean;
};

/** What the page says where a renewal date would go. */
export const DUES_BASIS =
  "Membership is a one-time payment of $200. It does not renew and nothing " +
  "further is owed. The board settled this on 27 October 2026.";

/**
 * Standing in plain words, for the member.
 *
 * `PROBATIONARY` and `GOOD_STANDING` deliberately return the identical string.
 * They grant identical access and the difference is a check on the record, so
 * a member has nothing to do about it and nothing to be told.
 */
export function standingInWords(state: MembershipState): string {
  if (grantsMemberAccess(state)) return "A member in good standing.";
  switch (state) {
    case "LAPSED":
      return (
        "Lapsed. Telephone the membership chair — there is no way to put this " +
        "right from here yet, and we would rather say so than leave you clicking."
      );
    case "REVOKED":
      return "Not currently a member. The membership chair can explain.";
    case "AWAITING_PAYMENT":
      return "Accepted. The dues payment is the only remaining step.";
    case "DECLINED":
      return "Not a member.";
    default:
      return "Your application is under review.";
  }
}

export class NotAMember extends Error {
  constructor() {
    // The same answer for "you have no record", "the record is somebody
    // else's" and "there is no record linked to your account yet". A caller
    // cannot tell them apart and should not be able to.
    super("There is no membership record for this account.");
    this.name = "NotAMember";
  }
}

/** The second factor is required for every non-public tier, member included. */
function requireSignedIn(subject: Subject): void {
  if (!subject.mfaSatisfied || !subject.personId) throw new NotAMember();
}

/**
 * The signed-in person's own roster record.
 *
 * Reads by `person_id`, which is the join E11 landed and which nothing wrote
 * before it. A member whose record has no `person_id` — every imported record
 * — gets `NotAMember`, which is honest: there is no link from their account to
 * their record, and inventing one by matching on email address would make a
 * shared family mailbox into two people's access to one record.
 *
 * Logged, with the member as the subject of the entry. Their own read of their
 * own record is still a row-level read of MEMBER_PII.
 */
export async function loadOwnRecord(
  repo: MembershipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<OwnRecordView> {
  requireSignedIn(subject);
  const member = await repo.getMemberByPersonId(subject.personId);
  if (!member || member.entity !== MEMBERSHIP_ENTITY) {
    await repo.appendAudit({
      at: now.toISOString(),
      personId: subject.personId,
      action: "READ_OWN_MEMBER_RECORD:DENIED",
      dataClass: "MEMBER_PII",
      entity: MEMBERSHIP_ENTITY,
      rowLevel: true,
      subjectRef: null,
    });
    throw new NotAMember();
  }

  await repo.appendAudit({
    at: now.toISOString(),
    personId: subject.personId,
    action: "READ_OWN_MEMBER_RECORD",
    dataClass: "MEMBER_PII",
    entity: MEMBERSHIP_ENTITY,
    rowLevel: true,
    subjectRef: member.memberId,
  });

  return viewOf(member);
}

function viewOf(member: Member): OwnRecordView {
  return {
    memberId: member.memberId,
    displayName: member.displayName,
    standing: standingInWords(member.state),
    state: member.state,
    joinedAt: member.joinedAt,
    duesClearedAt: member.paymentClearedAt,
    email: member.email,
    phone: member.phone,
    duesBasis: DUES_BASIS,
    serviceDatesMissing: member.serviceFrom === null,
  };
}

/* ------------------------------------------------------------------ *
 * E30, member side
 * ------------------------------------------------------------------ */

/**
 * Why a member cannot change their own email address here.
 *
 * Not an oversight and not a stub. The flow the acceptance criteria describe
 * is: send a confirmation link to the NEW address, keep the OLD one working
 * until that link is used, and notify the old address that it happened. Built
 * in that order or not at all — if the link goes to the new address and the
 * new address was typed wrong, the member has locked themselves out with no
 * way to tell us.
 *
 * Keeping the old address working until the new one is confirmed needs a
 * pending-change record with a hashed single-use token, and there is no table
 * for one. So the member-facing form changes the phone number, says plainly
 * why it does not change the address, and points at the chair — who can do it,
 * after a phone call, with a notice to the old address and the change logged.
 */
export const EMAIL_CHANGE_NOT_BUILT =
  "To change the email address we hold, telephone the membership chair. We do " +
  "not change it from this page yet: it has to be confirmed from the new " +
  "address while the old one keeps working, so that a mistyped address cannot " +
  "lock you out of your own account. Until that is built, a person does it.";

export const PHONE_REQUIRED = "Enter a phone number, including the area code.";

export class OwnContactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnContactError";
  }
}

/**
 * A member changes their own phone number.
 *
 * Same ownership gate: the record is found by the caller's own person id, so
 * there is no id to tamper with. The change is in the audit log with the
 * member as both actor and subject, which is criterion 1.
 *
 * A notice goes to the address on file. Not because a phone number is
 * sensitive, but because a change somebody else made to a member's record
 * should be visible to the member, and the spouse-at-the-keyboard case is
 * common enough here to design for.
 */
export async function updateOwnPhone(
  repo: MembershipRepository,
  subject: Subject,
  phone: string,
  now: Date = new Date(),
): Promise<OwnRecordView> {
  requireSignedIn(subject);
  const digits = phone.match(/\d/g)?.length ?? 0;
  if (digits < 10) throw new OwnContactError(PHONE_REQUIRED);

  const member = await repo.getMemberByPersonId(subject.personId);
  if (!member || member.entity !== MEMBERSHIP_ENTITY) throw new NotAMember();

  const updated = await repo.updateMemberContact(member.id, { phone: phone.trim() });

  await repo.appendAudit({
    at: now.toISOString(),
    personId: subject.personId,
    action: "OWN_PHONE_UPDATED",
    dataClass: "MEMBER_PII",
    entity: MEMBERSHIP_ENTITY,
    rowLevel: true,
    subjectRef: member.memberId,
  });

  await enqueue({
    kind: "CONTACT_CHANGE_NOTICE",
    to: member.email || null,
    toName: member.displayName,
    subject: "The phone number on your JSOA membership has been changed",
    stream: "TRANSACTIONAL",
    body:
      `The telephone number held for your membership, ${member.memberId}, has ` +
      `been changed from your own account.\n\n` +
      `If that was not you, telephone the membership chair.`,
  });

  return viewOf(updated);
}

/** The one money figure a member sees on their own page, in cents. */
export const OWN_DUES_AMOUNT_CENTS = DUES_AMOUNT_CENTS;
