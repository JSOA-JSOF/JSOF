"use server";

import { redirect } from "next/navigation";

import { membershipRepository } from "@/lib/membership/repository";
import { VOUCH_OUTCOMES, type VouchOutcome } from "@/lib/membership/types";
import { answerVouch } from "@/lib/membership/vouch";

/**
 * Record the sponsor's answer.
 *
 * The outcome goes back in the URL as a word, not as an application id or a
 * name, and the token stays in the path where it already was. A refused answer
 * lands on the same page, which then renders the dead end rather than an error.
 */
export async function recordVouch(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const raw = String(form.get("outcome") ?? "");
  if (!VOUCH_OUTCOMES.includes(raw as VouchOutcome)) {
    redirect(`/apply/vouch/${encodeURIComponent(token)}`);
  }

  const result = await answerVouch(membershipRepository(), token, raw as VouchOutcome);
  if (!result.ok) {
    redirect(`/apply/vouch/${encodeURIComponent(token)}`);
  }
  redirect(`/apply/vouch/${encodeURIComponent(token)}?done=${result.outcome}`);
}
