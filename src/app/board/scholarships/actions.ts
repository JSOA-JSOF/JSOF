"use server";

import { revalidatePath } from "next/cache";

import { getCurrentSubject } from "@/lib/authz/session";
import { recordScore } from "@/lib/scholarships/review";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { CRITERION_KEYS, type CriterionKey } from "@/lib/scholarships/types";

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
