"use server";

/**
 * Server actions for the Secretary module.
 *
 * Every action here resolves the subject, then calls `authorize()` through
 * `access.ts` BEFORE it touches the repository. No action reads or writes
 * anything before the authorization call. The functions return a result object
 * rather than throwing across the boundary, so a refusal renders as a stated
 * reason on the page rather than as an error overlay.
 */

import { revalidatePath } from "next/cache";

import { type Entity, type Role } from "../authz/model";
import type { Subject } from "../authz/policy";
import { getCurrentSubject } from "../authz/session";
import {
  authorizeAgendaWrite,
  authorizeGovernanceRead,
  authorizeMinuteWrite,
  refusalMessage,
} from "./access";
import { agendaTotals } from "./agenda";
import { buildAgendaDistribution, resendPayload, type ResendPayload } from "./distribution";
import {
  readClosedFromForm,
  readEntityFromForm,
  readMotionFromForm,
  readRecusalsFromForm,
} from "./form";
import { draftFromTranscript, draftToMinuteInputs } from "./transcript";
import { minuteRefForMeeting } from "./reference";
import { meetingsRepository, type MeetingsRepository } from "./repository";
import type { AgendaItemType, FilingStatus, MinuteEntryInput } from "./types";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function guardWrite(
  entityOfMeeting: (repo: MeetingsRepository) => Promise<Entity | null>,
  kind: "agenda" | "minutes",
): Promise<{ subject: Subject; entity: Entity }> {
  const repo = await meetingsRepository();
  const entity = await entityOfMeeting(repo);
  if (!entity) throw new Error("That meeting is not in the book.");
  const subject = await getCurrentSubject();
  if (kind === "agenda") authorizeAgendaWrite(subject, entity);
  else authorizeMinuteWrite(subject, entity);
  return { subject, entity };
}

function entityOf(
  meetingId: string,
): (repo: MeetingsRepository) => Promise<Entity | null> {
  return async (repo) => (await repo.getMeeting(meetingId))?.entity ?? null;
}

/* ------------------------------------------------------------------ *
 * Agenda
 * ------------------------------------------------------------------ */

export async function saveAgendaItemAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const meetingId = String(formData.get("meetingId") ?? "");
  try {
    await guardWrite(entityOf(meetingId), "agenda");
    const repo = await meetingsRepository();
    await repo.saveAgendaItem({
      id: (formData.get("itemId") as string) || undefined,
      meetingId,
      title: String(formData.get("title") ?? ""),
      ownerRole: String(formData.get("ownerRole") ?? "SECRETARY") as Role,
      estimatedMinutes: Number(formData.get("estimatedMinutes") ?? 0),
      type: String(formData.get("type") ?? "DISCUSSION") as AgendaItemType,
      note: (formData.get("note") as string) || undefined,
      keywords: String(formData.get("keywords") ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    });
    revalidatePath(`/board/meetings/${meetingId}/agenda`);
    return { ok: true, message: "The agenda item is saved." };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

export async function removeAgendaItemAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const meetingId = String(formData.get("meetingId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  try {
    await guardWrite(entityOf(meetingId), "agenda");
    await (await meetingsRepository()).removeAgendaItem(meetingId, itemId);
    revalidatePath(`/board/meetings/${meetingId}/agenda`);
    return { ok: true, message: "The item is off the agenda." };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

export async function moveAgendaItemAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const meetingId = String(formData.get("meetingId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const direction = String(formData.get("direction") ?? "up") === "up" ? -1 : 1;
  try {
    await guardWrite(entityOf(meetingId), "agenda");
    const repo = await meetingsRepository();
    const ordered = (await repo.listAgendaItems(meetingId)).map((i) => i.id);
    const index = ordered.indexOf(itemId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ordered.length) {
      return { ok: false, error: "That item is already at the end of the agenda." };
    }
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await repo.reorderAgenda(meetingId, ordered);
    revalidatePath(`/board/meetings/${meetingId}/agenda`);
    return { ok: true, message: "The agenda order is changed." };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

export async function reorderAgendaAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const meetingId = String(formData.get("meetingId") ?? "");
  const order = String(formData.get("order") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  try {
    await guardWrite(entityOf(meetingId), "agenda");
    await (await meetingsRepository()).reorderAgenda(meetingId, order);
    revalidatePath(`/board/meetings/${meetingId}/agenda`);
    return { ok: true, message: "The agenda order is saved." };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

export async function adoptAgendaAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const meetingId = String(formData.get("meetingId") ?? "");
  try {
    await guardWrite(entityOf(meetingId), "agenda");
    const repo = await meetingsRepository();
    const meeting = await repo.adoptAgenda(meetingId, new Date().toISOString());
    const items = await repo.listAgendaItems(meetingId);
    const totals = agendaTotals(meeting, items);
    revalidatePath(`/board/meetings/${meetingId}/agenda`);
    return {
      ok: true,
      message:
        `The agenda is adopted and the item numbers are frozen. The minute ` +
        `references for this meeting run from ${minuteRefForMeeting(meeting, 1)} to ` +
        `${minuteRefForMeeting(meeting, Math.max(1, items.length))}.` +
        (totals.overruns
          ? ` It was adopted overrunning by ${totals.overrunMinutes} minutes.`
          : ""),
    };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Distribution. The send is stubbed; the payload is real.
 * ------------------------------------------------------------------ */

export type DistributionResult =
  | { ok: true; payload: ResendPayload; notice: string; stubNote: string }
  | { ok: false; error: string };

export async function buildAgendaNoticeAction(
  meetingId: string,
): Promise<DistributionResult> {
  try {
    const repo = await meetingsRepository();
    const meeting = await repo.getMeeting(meetingId);
    if (!meeting) return { ok: false, error: "That meeting is not in the book." };
    const subject = await getCurrentSubject();
    authorizeGovernanceRead(subject, meeting.entity);
    const distribution = buildAgendaDistribution(
      meeting,
      await repo.listAgendaItems(meetingId),
    );
    return {
      ok: true,
      payload: resendPayload(meeting, distribution),
      notice: distribution.noticeSatisfied
        ? `Notice period satisfied: ${distribution.noticeHours} hours before the meeting, ` +
          `against ${distribution.noticeRequiredHours} required.`
        : `Notice period NOT satisfied: ${distribution.noticeHours} hours before the ` +
          `meeting, against ${distribution.noticeRequiredHours} required. Sending now ` +
          `produces short notice, which is a defect in the meeting and not only in the email.`,
      stubNote:
        "Nothing was sent. Resend is not wired. This is the exact payload that " +
        "would be handed to it, with `to` empty because this module resolves " +
        "roles and never reaches into member data for an address.",
    };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

export async function recordNoticeSentAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const meetingId = String(formData.get("meetingId") ?? "");
  try {
    await guardWrite(entityOf(meetingId), "agenda");
    await (await meetingsRepository()).markNoticeSent(
      meetingId,
      new Date().toISOString(),
    );
    revalidatePath(`/board/meetings/${meetingId}/distribute`);
    revalidatePath(`/board/meetings/${meetingId}/agenda`);
    return {
      ok: true,
      message:
        "Recorded that the notice went out, by hand. Nothing was emailed: this " +
        "records what the Secretary did outside the platform.",
    };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Minutes
 * ------------------------------------------------------------------ */

export async function saveMinuteAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const meetingId = String(formData.get("meetingId") ?? "");
  try {
    const { entity } = await guardWrite(entityOf(meetingId), "minutes");
    const repo = await meetingsRepository();

    // The entity comes from the form so the refusal is reachable from the UI
    // rather than only from a test. A blank value is the case the brief
    // requires to fail, and it fails in the repository, not here. `undefined`
    // means the form carried no entity field, in which case the meeting's own
    // entity stands.
    const declaredByForm = readEntityFromForm(formData);
    const declared =
      declaredByForm === undefined ? entity : (declaredByForm as Entity | null);

    const input: MinuteEntryInput = {
      id: (formData.get("minuteId") as string) || undefined,
      meetingId,
      entity: declared,
      agendaItemId: String(formData.get("agendaItemId") ?? ""),
      discussion: String(formData.get("discussion") ?? ""),
      motion: readMotionFromForm(formData),
      recusals: readRecusalsFromForm(formData),
      closed: readClosedFromForm(formData),
      draft: false,
      source: "SECRETARY",
      flags: [],
    };
    const saved = await repo.saveMinute(input);
    revalidatePath(`/board/meetings/${meetingId}/minutes`);
    revalidatePath("/board/meetings/decisions");
    return { ok: true, message: `Minute ${saved.ref} is saved.` };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

export async function setAttendanceAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const meetingId = String(formData.get("meetingId") ?? "");
  try {
    await guardWrite(entityOf(meetingId), "minutes");
    await (await meetingsRepository()).setAttendance(
      meetingId,
      String(formData.get("personId") ?? ""),
      String(formData.get("present") ?? "") === "yes",
    );
    revalidatePath(`/board/meetings/${meetingId}/minutes`);
    return { ok: true, message: "The roll is updated." };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Transcript intake
 * ------------------------------------------------------------------ */

export type TranscriptResult =
  | {
      ok: true;
      message: string;
      written: number;
      coverage: number;
      turnCount: number;
      warnings: string[];
    }
  | { ok: false; error: string };

export async function ingestTranscriptAction(
  _previous: TranscriptResult | null,
  formData: FormData,
): Promise<TranscriptResult> {
  const meetingId = String(formData.get("meetingId") ?? "");
  const transcript = String(formData.get("transcript") ?? "");
  try {
    await guardWrite(entityOf(meetingId), "minutes");
    const repo = await meetingsRepository();
    const meeting = (await repo.getMeeting(meetingId))!;
    const items = await repo.listAgendaItems(meetingId);
    if (items.length === 0) {
      return {
        ok: false,
        error:
          "There is no agenda for this meeting, so there is nothing to map the " +
          "transcript onto. Build the agenda first.",
      };
    }
    if (transcript.trim().length === 0) {
      return { ok: false, error: "Paste the transcript before running the parser." };
    }
    const draft = draftFromTranscript({
      meeting,
      items,
      transcript,
      refFor: (itemNumber) => minuteRefForMeeting(meeting, itemNumber),
    });
    const written = await repo.replaceTranscriptDrafts(
      meetingId,
      draftToMinuteInputs(draft, meeting),
    );
    revalidatePath(`/board/meetings/${meetingId}/transcript`);
    revalidatePath(`/board/meetings/${meetingId}/minutes`);
    return {
      ok: true,
      message:
        `${written.length} draft sections were written from ${draft.turnCount} speaker ` +
        `turns. Every one of them is an unreviewed draft and none of them is a minute ` +
        `of record. Open the minutes and edit each one.`,
      written: written.length,
      coverage: draft.coverage,
      turnCount: draft.turnCount,
      warnings: draft.warnings,
    };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Compliance calendar
 * ------------------------------------------------------------------ */

export async function setFilingStatusAction(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const itemId = String(formData.get("itemId") ?? "");
  const status = String(formData.get("status") ?? "OPEN") as FilingStatus;
  try {
    const repo = await meetingsRepository();
    const item = (await repo.listComplianceItems()).find((c) => c.id === itemId);
    if (!item) return { ok: false, error: "That filing is not on the calendar." };
    const subject = await getCurrentSubject();
    authorizeAgendaWrite(subject, item.entity);
    await repo.setComplianceStatus(itemId, status);
    revalidatePath("/board/meetings/calendar");
    return { ok: true, message: `${item.title} is marked ${status.toLowerCase()}.` };
  } catch (error) {
    return { ok: false, error: refusalMessage(error) };
  }
}
