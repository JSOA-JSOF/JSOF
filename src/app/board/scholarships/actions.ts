"use server";

import { revalidatePath } from "next/cache";

import { getCurrentSubject } from "@/lib/authz/session";
import { sendAwardNotification } from "@/lib/scholarships/awards";
import { recordScore } from "@/lib/scholarships/review";
import { recordDisabilityVerification } from "@/lib/scholarships/verification";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import {
  CRITERION_KEYS,
  type CriterionKey,
  type VerificationMethod,
} from "@/lib/scholarships/types";

/**
 * Server actions for the chair's workspace.
 *
 * Every one resolves the subject from the session and hands it to the library,
 * which is where authorization lives. Nothing here decides who may do what.
 */

export type ScoreResult = { ok: true } | { ok: false; message: string };

export async function submitScoreSheet(
  _previous: ScoreResult | null,
  form: FormData,
): Promise<ScoreResult> {
  const applicationId = String(form.get("applicationId") ?? "");
  if (!applicationId) return { ok: false, message: "No application was named." };

  const points = {} as Record<CriterionKey, number>;
  for (const key of CRITERION_KEYS) {
    const raw = form.get(`points.${key}`);
    const value = Number(raw);
    if (raw === null || raw === "" || !Number.isFinite(value)) {
      return { ok: false, message: `Every criterion needs a score before this can be saved.` };
    }
    points[key] = value;
  }

  try {
    await recordScore(scholarshipRepository(), await getCurrentSubject(), {
      applicationId,
      points,
      comment: String(form.get("comment") ?? ""),
    });
  } catch (error) {
    // The library's refusals already say what is wrong and why, so they are
    // surfaced rather than replaced with a generic failure.
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  revalidatePath("/board/scholarships/review");
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Wounded Patriot verification
 * ------------------------------------------------------------------ */

export type VerifyResult = { ok: true } | { ok: false; message: string };

/**
 * Records what a person decided after speaking to someone. It does not decide.
 * `actorPersonId` comes from the session, never from the form, so a claim
 * cannot be verified on behalf of somebody else.
 */
export async function submitVerification(
  _previous: VerifyResult | null,
  form: FormData,
): Promise<VerifyResult> {
  const applicationId = String(form.get("applicationId") ?? "");
  const outcome = String(form.get("outcome") ?? "");
  const method = String(form.get("method") ?? "");
  const note = String(form.get("note") ?? "").trim();

  if (!applicationId) return { ok: false, message: "No application was named." };
  if (outcome !== "VERIFIED" && outcome !== "NOT_VERIFIED") {
    return { ok: false, message: "Choose whether the claim is verified." };
  }
  if (!method) return { ok: false, message: "Say how you checked it." };
  if (!note) {
    return {
      ok: false,
      message:
        "Write down what you were told. In two years this note is the only " +
        "thing that explains the decision.",
    };
  }

  const subject = await getCurrentSubject();
  try {
    await recordDisabilityVerification(scholarshipRepository(), subject, {
      applicationId,
      outcome,
      method: method as VerificationMethod,
      note,
      actorPersonId: subject.personId,
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  revalidatePath("/board/scholarships/verify");
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Award notification
 * ------------------------------------------------------------------ */

export type SendResult = { ok: true; sent: number } | { ok: false; message: string };

/**
 * Sends one award notification. The library builds the recipients, including
 * the sponsoring member as a recipient rather than a bcc, and merges the
 * amount from the record so the figure in the message cannot drift from the
 * one the board approved.
 */
export async function sendOneNotification(
  _previous: SendResult | null,
  form: FormData,
): Promise<SendResult> {
  const awardId = String(form.get("awardId") ?? "");
  if (!awardId) return { ok: false, message: "No award was named." };
  try {
    await sendAwardNotification(scholarshipRepository(), await getCurrentSubject(), awardId);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath("/board/scholarships/notify");
  return { ok: true, sent: 1 };
}
