"use server";

import { redirect } from "next/navigation";

import { AuthzError } from "@/lib/authz/policy";
import { decideChairException, recordCohortAudit } from "@/lib/membership/board";
import { membershipRepository } from "@/lib/membership/repository";

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

function describe(error: unknown): string {
  if (error instanceof AuthzError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "The request was refused.";
}
