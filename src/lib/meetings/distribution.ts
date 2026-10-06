/**
 * Agenda distribution.
 *
 * The send is stubbed. Resend is named in ARCHITECTURE.md as the transactional
 * mail provider but nothing is wired, so this module builds the exact payload
 * that would be handed to it and shows it rather than pretending to send. A
 * fake "sent" confirmation on a board notice is worse than no notice, because
 * the Secretary stops checking.
 *
 * Notice period: the bylaws govern, and the platform does not know them. The
 * constants below are the platform's assumption, labelled as an assumption
 * everywhere they are shown, so that the first person to read the bylaws can
 * correct one file. NC's nonprofit statute does not supply a board-notice
 * period for this, and PRIVACY-AND-PAYMENTS.md is explicit that the 15-day and
 * 5-day figures in circulating templates come from a model act North Carolina
 * declined to adopt. They are not used here.
 */

import type { Entity, Role } from "../authz/model";
import { agendaSchedule, agendaTotals, byPosition } from "./agenda";
import { AGENDA_ITEM_TYPE_LABELS, type AgendaDistribution, type AgendaItem, type Meeting } from "./types";
import { bookRefForMeeting } from "./reference";

/**
 * Assumed, not statutory. Regular meetings get seven days, special meetings
 * forty-eight hours. Confirm against the bylaws before this is relied on.
 */
export const REGULAR_NOTICE_HOURS = 7 * 24;
export const SPECIAL_NOTICE_HOURS = 48;

/**
 * Shown to the board on the agenda and on the Secretary's dashboard, so it
 * carries no instruction to a developer: the sentence naming this file used to
 * reach a board-facing screen. When the bylaws settle the real period, change
 * REGULAR_NOTICE_DAYS and SPECIAL_NOTICE_HOURS below.
 */
export const NOTICE_BASIS_NOTE =
  "Notice period is the platform's assumption, not a statutory figure. NC's " +
  "nonprofit statute supplies no board-notice period for this, and the 15-day " +
  "and 5-day figures in circulating templates come from a model act North " +
  "Carolina did not adopt. Confirm it against the bylaws, which govern.";

export function noticeRequiredHours(meeting: Pick<Meeting, "session">): number {
  return meeting.session > 1 ? SPECIAL_NOTICE_HOURS : REGULAR_NOTICE_HOURS;
}

/** Board roles the agenda goes to. Roles, not addresses: nothing resolves a person here. */
export const NOTICE_ROLES_BY_ENTITY: Record<Entity, Role[]> = {
  JSOA: [
    "PRESIDENT",
    "VP_OPERATIONS",
    "VP_MEMBERSHIP",
    "SECRETARY",
    "TREASURER",
    "STORE_CHAIR",
    "EVENTS_CHAIR",
    "MEMORIAL_CHAIR",
    "COMMUNICATIONS_CHAIR",
    "FINANCE_REVIEW_OFFICER",
  ],
  JSOF: [
    "PRESIDENT",
    "VP_OPERATIONS",
    "SECRETARY",
    "TREASURER",
    "FUNDRAISING_CHAIR",
    "SCHOLARSHIPS_CHAIR",
    "FAMILY_SUPPORT_CHAIR",
    "FINANCE_REVIEW_OFFICER",
  ],
};

export const ENTITY_LONG_NAME: Record<Entity, string> = {
  JSOA: "Joint Special Operations Association",
  JSOF: "Joint Special Operations Foundation",
};

export const ENTITY_SUBSECTION: Record<Entity, string> = {
  JSOA: "501(c)(19)",
  JSOF: "501(c)(3)",
};

const EASTERN = "America/New_York";

export function formatMeetingDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatMeetingTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function formatClockOffset(startIso: string, offsetMinutes: number): string {
  const at = new Date(new Date(startIso).getTime() + offsetMinutes * 60_000);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

function roleLabel(role: Role): string {
  return role
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ")
    .replace(/^Vp /, "VP ");
}

export { roleLabel };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function agendaSubject(meeting: Meeting): string {
  return `${meeting.entity} board agenda, ${formatMeetingDate(meeting.scheduledStart)} (${bookRefForMeeting(meeting)})`;
}

export function renderAgendaPlainText(meeting: Meeting, items: AgendaItem[]): string {
  const totals = agendaTotals(meeting, items);
  const schedule = agendaSchedule(meeting, items);
  const lines: string[] = [];

  lines.push(`${ENTITY_LONG_NAME[meeting.entity]} (${meeting.entity})`);
  lines.push(`${ENTITY_SUBSECTION[meeting.entity]} — board of directors`);
  lines.push("");
  lines.push(meeting.title.toUpperCase());
  lines.push(`Minute book: ${bookRefForMeeting(meeting)}`);
  lines.push(`Date: ${formatMeetingDate(meeting.scheduledStart)}`);
  lines.push(`Time: ${formatMeetingTime(meeting.scheduledStart)}, ${meeting.scheduledMinutes} minutes scheduled`);
  lines.push(`Place: ${meeting.location}`);
  lines.push(`Quorum: ${meeting.quorum} voting directors`);
  lines.push("");
  lines.push(
    `This is a meeting of the ${ENTITY_LONG_NAME[meeting.entity]} board only. ` +
      `Business of the other entity is not before this board and is not taken up ` +
      `under this agenda, whatever else is on the calendar for this evening.`,
  );
  lines.push("");
  lines.push("AGENDA");
  lines.push("");
  lines.push(`     Call to order, roll, quorum and adoption of this agenda (${0} min allocated within overhead)`);
  for (const row of schedule) {
    const item = row.item;
    lines.push(
      `${String(item.position).padStart(3, " ")}. [item ${item.itemNumber}] ${item.title}`,
    );
    lines.push(
      `     ${AGENDA_ITEM_TYPE_LABELS[item.type].toUpperCase()} · ${roleLabel(item.ownerRole)} · ` +
        `${item.estimatedMinutes} min · from ${formatClockOffset(meeting.scheduledStart, row.startsAtMinute)}` +
        (row.pastScheduledClose ? " · BEGINS AFTER THE SCHEDULED CLOSE" : ""),
    );
    if (item.type === "DECISION") {
      lines.push("     A motion, a mover, a seconder and a recorded vote are expected on this item.");
    }
    if (item.note) lines.push(`     ${item.note}`);
    lines.push(`     Minute reference: ${bookRefForMeeting(meeting)}-min-${item.itemNumber}`);
    lines.push("");
  }

  lines.push("TIME");
  lines.push(`  Scheduled length      ${meeting.scheduledMinutes} min`);
  lines.push(`  Items                 ${totals.estimatedMinutes} min across ${totals.itemCount} items`);
  lines.push(`  Procedural overhead   ${totals.committedMinutes - totals.estimatedMinutes} min`);
  lines.push(`  Committed             ${totals.committedMinutes} min`);
  if (totals.overruns) {
    lines.push(
      `  OVERRUN               ${totals.overrunMinutes} min over. The agenda as circulated ` +
        `does not fit the scheduled meeting. Either the meeting runs long or ` +
        `business at the foot of the agenda will not be reached.`,
    );
  } else {
    lines.push(`  Unallocated           ${totals.slackMinutes} min`);
  }
  lines.push("");
  lines.push(
    `Notice: ${noticeRequiredHours(meeting) / 24 >= 1 ? `${noticeRequiredHours(meeting) / 24} days` : `${noticeRequiredHours(meeting)} hours`} ` +
      `required for a ${meeting.session > 1 ? "special" : "regular"} meeting. ${NOTICE_BASIS_NOTE}`,
  );
  lines.push("");
  lines.push(
    "Members who have a conflict on any item above should say so before the item " +
      "is reached. A recusal is recorded in the minutes with its reason.",
  );
  lines.push("");
  lines.push(`Issued by the Secretary. Minute book ${bookRefForMeeting(meeting)}.`);

  return lines.join("\n");
}

export function renderAgendaHtml(meeting: Meeting, items: AgendaItem[]): string {
  const totals = agendaTotals(meeting, items);
  const schedule = agendaSchedule(meeting, items);
  // Email cannot read custom properties, so the brand values are inlined here.
  // Association gold, Foundation ink, matching globals.css.
  const hue = meeting.entity === "JSOA" ? "#8A6A12" : "#2B2A24";

  const rows = schedule
    .map((row) => {
      const item = row.item;
      return `        <tr>
          <td style="padding:10px 8px 10px 0;border-bottom:1px solid #EDE8DB;vertical-align:top;font-family:'IBM Plex Mono',Menlo,monospace;font-size:12px;color:#7B7667;white-space:nowrap;">${item.position}.</td>
          <td style="padding:10px 8px;border-bottom:1px solid #EDE8DB;vertical-align:top;">
            <div style="font-weight:600;color:#141310;">${escapeHtml(item.title)}</div>
            <div style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${hue};padding-top:3px;">${escapeHtml(AGENDA_ITEM_TYPE_LABELS[item.type])} &middot; ${escapeHtml(roleLabel(item.ownerRole))}</div>
            ${item.note ? `<div style="font-size:13px;color:#4A463C;padding-top:5px;">${escapeHtml(item.note)}</div>` : ""}
            ${item.type === "DECISION" ? `<div style="font-size:13px;color:#4A463C;padding-top:5px;">A motion, a mover, a seconder and a recorded vote are expected on this item.</div>` : ""}
            <div style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:11px;color:#7B7667;padding-top:5px;">${escapeHtml(bookRefForMeeting(meeting))}-min-${item.itemNumber}</div>
          </td>
          <td style="padding:10px 0 10px 8px;border-bottom:1px solid #EDE8DB;vertical-align:top;text-align:right;font-family:'IBM Plex Mono',Menlo,monospace;font-size:12px;font-variant-numeric:tabular-nums;color:#4A463C;white-space:nowrap;">
            ${item.estimatedMinutes} min<br />
            <span style="color:${row.pastScheduledClose ? "#855415" : "#7B7667"};">${escapeHtml(formatClockOffset(meeting.scheduledStart, row.startsAtMinute))}</span>
          </td>
        </tr>`;
    })
    .join("\n");

  const overrun = totals.overruns
    ? `      <p style="margin:0 0 16px;padding:12px 14px;background:#F6EBD8;border-left:3px solid #855415;color:#141310;font-size:14px;">
        <strong>The agenda overruns by ${totals.overrunMinutes} minutes.</strong>
        ${totals.committedMinutes} minutes of business are scheduled into a ${meeting.scheduledMinutes} minute meeting.
        Either the meeting runs long or business at the foot of the agenda will not be reached.
      </p>`
    : `      <p style="margin:0 0 16px;font-size:14px;color:#4A463C;">
        ${totals.committedMinutes} minutes committed of ${meeting.scheduledMinutes} scheduled, ${totals.slackMinutes} minutes unallocated.
      </p>`;

  const noticeText =
    noticeRequiredHours(meeting) >= 24
      ? `${noticeRequiredHours(meeting) / 24} days`
      : `${noticeRequiredHours(meeting)} hours`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(agendaSubject(meeting))}</title>
  </head>
  <body style="margin:0;padding:0;background:#F4F3EE;">
    <div style="max-width:640px;margin:0 auto;padding:24px 16px 48px;font-family:'Source Sans 3',Helvetica,Arial,sans-serif;color:#141310;font-size:16px;line-height:1.5;">
      <div style="border-top:4px solid ${hue};padding-top:14px;">
        <div style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${hue};">
          ${escapeHtml(meeting.entity)} &middot; ${escapeHtml(ENTITY_SUBSECTION[meeting.entity])} &middot; board of directors
        </div>
        <h1 style="margin:6px 0 4px;font-family:'Barlow Semi Condensed',Helvetica,Arial,sans-serif;font-size:26px;line-height:1.1;font-weight:700;">
          ${escapeHtml(meeting.title)}
        </h1>
        <div style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:12px;color:#7B7667;">
          Minute book ${escapeHtml(bookRefForMeeting(meeting))}
        </div>
      </div>

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0;font-size:14px;">
        <tr><td style="padding:3px 12px 3px 0;color:#7B7667;">Date</td><td style="padding:3px 0;">${escapeHtml(formatMeetingDate(meeting.scheduledStart))}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#7B7667;">Time</td><td style="padding:3px 0;">${escapeHtml(formatMeetingTime(meeting.scheduledStart))}, ${meeting.scheduledMinutes} minutes scheduled</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#7B7667;">Place</td><td style="padding:3px 0;">${escapeHtml(meeting.location)}</td></tr>
        <tr><td style="padding:3px 12px 3px 0;color:#7B7667;">Quorum</td><td style="padding:3px 0;">${meeting.quorum} voting directors</td></tr>
      </table>

      <p style="margin:0 0 18px;padding:12px 14px;background:${meeting.entity === "JSOA" ? "#E5EBF3" : "#E2EDE7"};border-left:3px solid ${hue};font-size:14px;">
        This is a meeting of the <strong>${escapeHtml(ENTITY_LONG_NAME[meeting.entity])}</strong> board only.
        Business of the other entity is not before this board and is not taken up under this agenda,
        whatever else is on the calendar for this evening.
      </p>

      <h2 style="margin:24px 0 8px;font-family:'Barlow Semi Condensed',Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;">Agenda</h2>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td colspan="3" style="padding:10px 0;border-bottom:1px solid #EDE8DB;font-size:14px;color:#4A463C;">
            Call to order, roll, quorum and adoption of this agenda
          </td>
        </tr>
${rows}
      </table>

      <h2 style="margin:24px 0 8px;font-family:'Barlow Semi Condensed',Helvetica,Arial,sans-serif;font-size:18px;font-weight:600;">Time</h2>
${overrun}

      <p style="margin:0 0 12px;font-size:13px;color:#4A463C;">
        <strong>Notice.</strong> ${escapeHtml(noticeText)} required for a
        ${meeting.session > 1 ? "special" : "regular"} meeting.
        ${escapeHtml(NOTICE_BASIS_NOTE)}
      </p>
      <p style="margin:0 0 12px;font-size:13px;color:#4A463C;">
        Members who have a conflict on any item above should say so before the item is reached.
        A recusal is recorded in the minutes with its reason.
      </p>
      <p style="margin:0;font-size:13px;color:#7B7667;">
        Issued by the Secretary. Minute book ${escapeHtml(bookRefForMeeting(meeting))}.
      </p>
    </div>
  </body>
</html>`;
}

export function buildAgendaDistribution(
  meeting: Meeting,
  items: AgendaItem[],
  now: Date = new Date(),
): AgendaDistribution {
  const ordered = byPosition(items);
  const required = noticeRequiredHours(meeting);
  const hours = (new Date(meeting.scheduledStart).getTime() - now.getTime()) / 3_600_000;
  const noticeHours = Math.floor(hours);
  return {
    meetingId: meeting.id,
    entity: meeting.entity,
    subject: agendaSubject(meeting),
    recipientRoles: NOTICE_ROLES_BY_ENTITY[meeting.entity],
    plainText: renderAgendaPlainText(meeting, ordered),
    html: renderAgendaHtml(meeting, ordered),
    noticeHours,
    noticeRequiredHours: required,
    noticeSatisfied: noticeHours >= required,
    stubbed: true,
  };
}

/**
 * The exact object that would be handed to Resend. Kept as a plain value so it
 * can be shown on screen and diffed against what actually goes out later.
 *
 * `to` is deliberately empty: this module resolves roles, not addresses, and
 * nothing here reaches into MEMBER_PII to look an address up. Whatever wires
 * Resend resolves `recipientRoles` against the role grants at send time.
 */
export type ResendPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  tags: { name: string; value: string }[];
};

export function resendPayload(
  meeting: Meeting,
  distribution: AgendaDistribution,
): ResendPayload {
  return {
    from: `${meeting.entity} Secretary <secretary@${meeting.entity.toLowerCase()}.example>`,
    to: [],
    subject: distribution.subject,
    text: distribution.plainText,
    html: distribution.html,
    headers: {
      // So a reply thread cannot drift between the two entities' books.
      "X-Entity": meeting.entity,
      "X-Minute-Book": bookRefForMeeting(meeting),
      "X-Notice-Class": meeting.session > 1 ? "special" : "regular",
    },
    tags: [
      { name: "entity", value: meeting.entity },
      { name: "kind", value: "board-agenda" },
    ],
  };
}
