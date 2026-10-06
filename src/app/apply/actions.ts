"use server";

/**
 * Server actions for the application form.
 *
 * `submitDraft` is the one to read carefully. It has a single redirect target
 * and no branch after the call into `submitApplication`: no alternate
 * destination, no status code that varies, no message that varies. The reason
 * is in src/lib/membership/intake.ts, and it is the whole security property of
 * this route.
 */

import { redirect } from "next/navigation";

import { ACKNOWLEDGMENT_PATH, submitApplication, validateStep } from "@/lib/membership/intake";
import { membershipRepository } from "@/lib/membership/repository";
import {
  MEMBERSHIP_CATEGORIES,
  QUALIFYING_RELATIONSHIPS,
  type ApplicationFields,
  type MembershipCategory,
  type QualifyingRelationship,
} from "@/lib/membership/types";

import { clearDraftId, readDraftId, writeDraftId, writeReference } from "./draft";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function checkbox(form: FormData, key: string): boolean {
  return form.get(key) === "on" || form.get(key) === "yes";
}

function category(form: FormData): MembershipCategory | null {
  const value = text(form, "membershipCategory");
  return MEMBERSHIP_CATEGORIES.includes(value as MembershipCategory)
    ? (value as MembershipCategory)
    : null;
}

function relationship(form: FormData): QualifyingRelationship | null {
  const value = text(form, "qualifyingRelationship");
  return QUALIFYING_RELATIONSHIPS.includes(value as QualifyingRelationship)
    ? (value as QualifyingRelationship)
    : null;
}

function fieldsForStep(step: number, form: FormData): Partial<ApplicationFields> {
  switch (step) {
    case 1:
      return {
        applicantName: text(form, "applicantName"),
        email: text(form, "email"),
        phone: text(form, "phone"),
      };
    case 2: {
      const chosen = category(form);
      return {
        membershipCategory: chosen,
        qualifyingRelationship: chosen === "QUALIFYING_RELATIVE" ? relationship(form) : null,
        serviceFrom: chosen === "VETERAN" ? text(form, "serviceFrom") || null : null,
        serviceTo: chosen === "VETERAN" ? text(form, "serviceTo") || null : null,
        attestedWarVeteran: chosen === "VETERAN" ? checkbox(form, "attestedWarVeteran") : false,
      };
    }
    case 3:
      return {
        isAugmentee: checkbox(form, "isAugmentee"),
        sponsorMemberId: text(form, "sponsorMemberId"),
      };
    default:
      return {};
  }
}

/** Save a step and move on, or come back with the field names that failed. */
export async function saveStep(form: FormData): Promise<void> {
  const step = Number(form.get("step") ?? 1);
  const repo = membershipRepository();
  const patch = fieldsForStep(step, form);

  let draftId = await readDraftId();
  if (draftId && !(await repo.getApplication(draftId))) draftId = null;

  if (!draftId) {
    const draft = await repo.createDraft(patch);
    draftId = draft.id;
    await writeDraftId(draftId);
  }

  // Persisted whether or not it validates, so the applicant does not retype a
  // form because one box was wrong.
  const draft = await repo.updateDraft(draftId, { ...patch, step });

  const errors = validateStep(step, draft);
  const failed = Object.keys(errors);
  if (failed.length > 0) {
    redirect(`/apply?step=${step}&err=${encodeURIComponent(failed.join(","))}`);
  }

  redirect(`/apply?step=${Math.min(step + 1, 4)}`);
}

export async function goBack(form: FormData): Promise<void> {
  const step = Number(form.get("step") ?? 1);
  redirect(`/apply?step=${Math.max(step - 1, 1)}`);
}

/**
 * Submit.
 *
 * One destination. Every submission — valid sponsor, unknown sponsor,
 * malformed ID, duplicate email, replayed submit, draft that no longer
 * exists — ends at ACKNOWLEDGMENT_PATH with the same acknowledgment. Do not
 * add a second redirect here, do not add a query parameter that varies, and do
 * not add an error state. A difference is an answer, and the question this
 * form must not answer is whether a given person is a member.
 */
export async function submitDraft(): Promise<void> {
  const repo = membershipRepository();
  const draftId = (await readDraftId()) ?? "";
  const result = await submitApplication(repo, draftId);
  await writeReference(result.acknowledgment.reference);
  await clearDraftId();
  redirect(ACKNOWLEDGMENT_PATH);
}

export async function abandonDraft(): Promise<void> {
  await clearDraftId();
  redirect("/apply");
}
