"use server";

/**
 * Server actions for the scholarship application.
 *
 * These parse a FormData and call a named function in
 * src/lib/scholarships/intake.ts. No decision is taken here: the routing rule,
 * the age gate, the sponsor check and the guardian requirement all live in the
 * library, so the same answers produce the same outcome from a test as from a
 * browser.
 *
 * `answerRouting` is the one to read. The three questions are answered BEFORE
 * a draft exists, and a routed-away answer redirects without having created
 * one. There is no order of calls here in which a North Carolina resident at a
 * North Carolina school gives us a name.
 */

import { redirect } from "next/navigation";

import {
  ACKNOWLEDGMENT_PATH,
  GuardianConsentMissingError,
  ROUTED_AWAY_PATH,
  RoutedAwayError,
  TOO_YOUNG_PATH,
  TooYoungError,
  recordGuardianConsent,
  saveApplicantDetails,
  saveEnrolment,
  saveMeritSection,
  saveSponsorId,
  saveWoundedPatriotSection,
  startApplication,
  stepNumberFor,
  submitApplication,
  validateApplicant,
  validateEnrolment,
  validateGuardian,
  validateMerit,
  validateSponsor,
  validateWoundedPatriot,
  type FieldErrors,
  type StepKey,
} from "@/lib/scholarships/intake";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import {
  ENROLMENT_LEVELS,
  GUARDIAN_RELATIONSHIPS,
  type EnrolmentLevel,
  type GuardianRelationship,
} from "@/lib/scholarships/types";

import { clearDraftId, readDraftId, writeDraftId, writeReference } from "./draft";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function yes(form: FormData, key: string): boolean {
  return text(form, key) === "yes";
}

function checked(form: FormData, key: string): boolean {
  const value = text(form, key);
  return value === "on" || value === "yes";
}

/** Field names only. Values never reach the URL. */
function failTo(step: number, errors: FieldErrors): never {
  const failed = Object.keys(errors).filter((key) => errors[key]);
  redirect(`/apply/scholarship?step=${step}&err=${encodeURIComponent(failed.join(","))}`);
}

/* ------------------------------------------------------------------ *
 * Step 1: routing. Before anything is collected.
 * ------------------------------------------------------------------ */

export async function answerRouting(form: FormData): Promise<void> {
  const answers = {
    ncResident: yes(form, "ncResident"),
    attendingNcSchool: yes(form, "attendingNcSchool"),
    applyingForWoundedPatriot: yes(form, "applyingForWoundedPatriot"),
  };

  // All three have to be answered before the rule can be applied.
  for (const key of ["ncResident", "attendingNcSchool", "applyingForWoundedPatriot"] as const) {
    if (!["yes", "no"].includes(text(form, key))) {
      redirect("/apply/scholarship?step=1&err=routing");
    }
  }

  try {
    const draft = await startApplication(scholarshipRepository(), answers);
    await writeDraftId(draft.id);
  } catch (error) {
    if (error instanceof RoutedAwayError) redirect(ROUTED_AWAY_PATH);
    throw error;
  }
  redirect("/apply/scholarship?step=2");
}

/* ------------------------------------------------------------------ *
 * The remaining steps
 * ------------------------------------------------------------------ */

export async function saveStep(form: FormData): Promise<void> {
  const key = text(form, "key") as StepKey;
  const step = Number(text(form, "step") || 1);
  const repo = scholarshipRepository();
  const draftId = await readDraftId();
  if (!draftId) redirect("/apply/scholarship?step=1");

  const draft = await repo.getApplication(draftId);
  if (!draft) {
    await clearDraftId();
    redirect("/apply/scholarship?step=1");
  }

  switch (key) {
    case "applicant": {
      const details = {
        fullName: text(form, "fullName"),
        email: text(form, "email"),
        phone: text(form, "phone"),
        dateOfBirth: text(form, "dateOfBirth"),
        residenceState: text(form, "residenceState").toUpperCase(),
      };
      const errors = validateApplicant(details);
      if (Object.keys(errors).length > 0) failTo(step, errors);
      try {
        await saveApplicantDetails(repo, draftId, details);
      } catch (error) {
        if (error instanceof TooYoungError) {
          // The draft is already gone. Clear the cookie and say so.
          await clearDraftId();
          redirect(TOO_YOUNG_PATH);
        }
        throw error;
      }
      break;
    }

    case "enrolment": {
      const level = text(form, "level");
      const enrolment = {
        schoolId: text(form, "schoolId"),
        level: (ENROLMENT_LEVELS.includes(level as EnrolmentLevel)
          ? level
          : "UNDERGRADUATE") as EnrolmentLevel,
        accreditedInstitution: checked(form, "accreditedInstitution"),
        academicYear: text(form, "academicYear"),
        expectedCompletion: text(form, "expectedCompletion"),
        studentNumber: text(form, "studentNumber"),
      };
      const errors = validateEnrolment(enrolment);
      if (Object.keys(errors).length > 0) failTo(step, errors);
      await saveEnrolment(repo, draftId, enrolment);
      break;
    }

    case "sponsor": {
      const sponsorMemberId = text(form, "sponsorMemberId");
      const updated = await saveSponsorId(repo, draftId, sponsorMemberId);
      const errors = validateSponsor(updated.sponsor);
      if (Object.keys(errors).length > 0) failTo(step, errors);
      break;
    }

    case "merit": {
      const gpa = Number(text(form, "gpa") || "0");
      const merit = {
        gpaHundredths: Math.round(gpa * 100),
        transcriptSummary: text(form, "transcriptSummary"),
        essay: text(form, "essay"),
        activities: text(form, "activities")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        recommendationFrom: text(form, "recommendationFrom"),
      };
      const errors = validateMerit(merit);
      if (Object.keys(errors).length > 0) failTo(step, errors);
      await saveMeritSection(repo, draftId, merit);
      break;
    }

    case "wounded-patriot": {
      const section = {
        serviceMemberRelationship: text(form, "serviceMemberRelationship"),
        disabilityEvidence: {
          narrative: text(form, "narrative"),
          claimedServiceConnection: text(form, "claimedServiceConnection"),
          verificationContact: text(form, "verificationContact"),
        },
      };
      const errors = validateWoundedPatriot(section);
      if (Object.keys(errors).length > 0) failTo(step, errors);
      await saveWoundedPatriotSection(repo, draftId, section);
      break;
    }

    case "guardian": {
      const relationship = text(form, "relationship");
      const input = {
        guardianName: text(form, "guardianName"),
        guardianEmail: text(form, "guardianEmail"),
        guardianPhone: text(form, "guardianPhone"),
        relationship: (GUARDIAN_RELATIONSHIPS.includes(relationship as GuardianRelationship)
          ? relationship
          : "PARENT") as GuardianRelationship,
        affirmed: checked(form, "affirmed"),
      };
      const errors = validateGuardian({ ...input, relationship: relationship as GuardianRelationship });
      if (Object.keys(errors).length > 0) failTo(step, errors);
      await recordGuardianConsent(repo, draftId, input);
      break;
    }

    default:
      break;
  }

  redirect(`/apply/scholarship?step=${step + 1}`);
}

export async function goBack(form: FormData): Promise<void> {
  const step = Number(text(form, "step") || 1);
  redirect(`/apply/scholarship?step=${Math.max(step - 1, 1)}`);
}

/**
 * Submit.
 *
 * The sponsor check runs inside `submitApplication` and the acknowledgment is
 * the same whatever it found. The only visible refusal is the missing guardian
 * consent, which is about the applicant's own household and reveals nothing
 * about the roster.
 */
export async function submitDraft(): Promise<void> {
  const repo = scholarshipRepository();
  const draftId = (await readDraftId()) ?? "";
  const draft = draftId ? await repo.getApplication(draftId) : null;

  try {
    const acknowledgment = await submitApplication(repo, draftId);
    await writeReference(acknowledgment.reference);
  } catch (error) {
    if (error instanceof GuardianConsentMissingError) {
      const step = stepNumberFor(draft, "guardian");
      redirect(`/apply/scholarship?step=${step}&err=guardianConsent`);
    }
    throw error;
  }
  await clearDraftId();
  redirect(ACKNOWLEDGMENT_PATH);
}

export async function abandonDraft(): Promise<void> {
  await clearDraftId();
  redirect("/apply/scholarship");
}
