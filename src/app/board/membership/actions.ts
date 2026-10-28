"use server";

import { redirect } from "next/navigation";

import { AuthzError } from "@/lib/authz/policy";
import {
  assignToReviewer,
  correctMemberContact,
  decideChairException,
  recordCohortAudit,
} from "@/lib/membership/board";
import { membershipRepository } from "@/lib/membership/repository";

import { filterFromForm, writeRosterFilter } from "./filter";
import { currentActor } from "./subject";

/**
 * Approve or deny a chair exception.
 *
 * `decideChairException` calls `authorize()` with MEMBER_PII at WRITE before it
 * reads anything, and applies the no-self-approval invariant. A refusal comes
 * back as a message on the page rather than a crash, because a board member
 * being told plainly that their role cannot do this is more useful than a
 * stack trace — and because a refusal that looks like a bug is a refusal
 * someone will try to route around.
 */
export async function decide(form: FormData): Promise<void> {
  const applicationId = String(form.get("applicationId") ?? "");
  const outcome = form.get("outcome") === "APPROVED" ? "APPROVED" : "DENIED";
  const reason = String(form.get("reason") ?? "");
  const { subject } = await currentActor();

  let refusal: string | null = null;
  try {
    await decideChairException(membershipRepository(), subject, {
      applicationId,
      outcome,
      reason,
    });
  } catch (error) {
    refusal = describe(error);
  }

  redirect(
    refusal
      ? `/board/membership/exceptions?refused=${encodeURIComponent(refusal)}`
      : `/board/membership/exceptions?done=${outcome}`,
  );
}

/** Pass the 30-day record audit, or record a held finding. */
export async function audit(form: FormData): Promise<void> {
  const memberId = String(form.get("memberId") ?? "");
  const outcome = form.get("outcome") === "HELD" ? "HELD" : "PASSED";
  const note = String(form.get("note") ?? "");
  const { subject } = await currentActor();

  let refusal: string | null = null;
  try {
    await recordCohortAudit(membershipRepository(), subject, { memberId, outcome, note });
  } catch (error) {
    refusal = describe(error);
  }

  redirect(
    refusal
      ? `/board/membership/audit?refused=${encodeURIComponent(refusal)}`
      : `/board/membership/audit?done=${outcome}`,
  );
}

/**
 * Give a chair-queue item to a named reviewer, or release it. E09.
 *
 * `assignToReviewer` calls `authorize()` with MEMBER_PII at WRITE, so a role
 * that can read the queue and its assignments cannot assign in it, and it
 * refuses to assign an item to its own applicant — at assignment time, not
 * only when somebody tries to decide it.
 *
 * An empty `reviewerPersonId` releases the item. Release is a real action and
 * not an absence: it writes its own audit row, so "who let go of this and
 * when" is answerable.
 */
export async function assign(form: FormData): Promise<void> {
  const applicationId = String(form.get("applicationId") ?? "");
  const submitted = String(form.get("reviewerPersonId") ?? "").trim();
  const { subject } = await currentActor();
  // "me" rather than the id in a hidden field: a person id in a form the
  // browser can edit is a person id somebody can swap.
  const reviewerPersonId =
    submitted === "me" ? subject.personId : submitted === "" ? null : submitted;

  let refusal: string | null = null;
  try {
    await assignToReviewer(membershipRepository(), subject, {
      applicationId,
      reviewerPersonId,
    });
  } catch (error) {
    refusal = describe(error);
  }

  redirect(
    refusal
      ? `/board/membership/exceptions?refused=${encodeURIComponent(refusal)}`
      : `/board/membership/exceptions?done=${reviewerPersonId ? "ASSIGNED" : "RELEASED"}`,
  );
}

/**
 * Correct a member's email or phone, with a reason recorded. E30, chair side.
 *
 * Needed independently of the member-facing version, because the Submittable
 * import will land records with bad addresses in them and because the member
 * who cannot sign in is exactly the member who cannot fix their own address.
 *
 * A refusal comes back as a message. It never says whose address a rejected
 * one belongs to.
 */
export async function correctContact(form: FormData): Promise<void> {
  const memberId = String(form.get("memberId") ?? "");
  const email = String(form.get("email") ?? "");
  const phone = String(form.get("phone") ?? "");
  const reason = String(form.get("reason") ?? "");
  const { subject } = await currentActor();

  let refusal: string | null = null;
  try {
    await correctMemberContact(membershipRepository(), subject, {
      memberId,
      email,
      phone,
      reason,
    });
  } catch (error) {
    refusal = describe(error);
  }

  redirect(
    refusal
      ? `/board/membership/roster?refused=${encodeURIComponent(refusal)}`
      : "/board/membership/roster?done=CONTACT",
  );
}

/**
 * Apply or clear the roster filter. E13.
 *
 * It writes a cookie and redirects to the bare path rather than putting the
 * search term in a query string. See `./filter.ts`: a roster search term is a
 * member's surname and a URL is three logs.
 */
export async function filterRoster(form: FormData): Promise<void> {
  const clear = form.get("clear") === "yes";
  await writeRosterFilter(
    clear ? { q: "", state: null, category: null, sponsorMemberId: null } : filterFromForm(form),
  );
  redirect("/board/membership/roster");
}

function describe(error: unknown): string {
  if (error instanceof AuthzError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "The request was refused.";
}
