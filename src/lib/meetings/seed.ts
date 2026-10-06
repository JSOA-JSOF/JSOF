/**
 * Seed data. Fictional throughout: none of these are the real board and none
 * of the figures are attributed to the real organizations. There are no money
 * amounts anywhere in this file, deliberately — the treasury module owns those
 * and the compliance calendar does not need them.
 *
 * Two meetings are seeded per date, one per entity, on the same evening with
 * largely the same people in the room. That is the situation this module
 * exists to survive, so it is what the demo starts from:
 *
 *   2026-09-08   JSOA-2026-09  then  JSOF-2026-09   (minutes adopted)
 *   2026-10-13   JSOA-2026-10  then  JSOF-2026-10   (noticed, in session)
 *
 * The September pair carries the inter-entity transfer that the treasury
 * module's references point at, with the President recused on the receiving
 * side, which is the rule in ARCHITECTURE.md rendered as an actual recusal in
 * an actual minute.
 */

import type { Entity, Role } from "../authz/model";
import type {
  AgendaItem,
  Attendee,
  ComplianceItem,
  Meeting,
  MinuteEntry,
  Motion,
  Recusal,
} from "./types";

/* ------------------------------------------------------------------ *
 * People. Fictional. Present in the room for both meetings where the
 * person holds an office on both entities.
 * ------------------------------------------------------------------ */

export const SEED_PEOPLE: {
  personId: string;
  displayName: string;
  offices: { entity: Entity; role: Role }[];
}[] = [
  {
    personId: "p-ellison",
    displayName: "Marcus Ellison",
    offices: [
      { entity: "JSOA", role: "PRESIDENT" },
      { entity: "JSOF", role: "PRESIDENT" },
    ],
  },
  {
    personId: "p-navarro",
    displayName: "Dana Navarro",
    offices: [
      { entity: "JSOA", role: "SECRETARY" },
      { entity: "JSOF", role: "SECRETARY" },
    ],
  },
  {
    personId: "p-bell",
    displayName: "Trish Bell",
    offices: [
      { entity: "JSOA", role: "VP_OPERATIONS" },
      { entity: "JSOF", role: "VP_OPERATIONS" },
    ],
  },
  {
    personId: "p-whitfield",
    displayName: "Roy Whitfield",
    offices: [{ entity: "JSOA", role: "TREASURER" }],
  },
  {
    personId: "p-okonjo",
    displayName: "Adaeze Okonjo",
    offices: [{ entity: "JSOF", role: "TREASURER" }],
  },
  {
    personId: "p-castellano",
    displayName: "Nick Castellano",
    offices: [{ entity: "JSOA", role: "VP_MEMBERSHIP" }],
  },
  {
    personId: "p-doyle",
    displayName: "Sam Doyle",
    offices: [{ entity: "JSOA", role: "STORE_CHAIR" }],
  },
  {
    personId: "p-lindqvist",
    displayName: "Britt Lindqvist",
    offices: [{ entity: "JSOA", role: "EVENTS_CHAIR" }],
  },
  {
    personId: "p-arceneaux",
    displayName: "Paul Arceneaux",
    offices: [{ entity: "JSOA", role: "MEMORIAL_CHAIR" }],
  },
  {
    personId: "p-hargrove",
    displayName: "Lena Hargrove",
    offices: [{ entity: "JSOF", role: "SCHOLARSHIPS_CHAIR" }],
  },
  {
    personId: "p-reyes",
    displayName: "Gil Reyes",
    offices: [{ entity: "JSOF", role: "FUNDRAISING_CHAIR" }],
  },
  {
    personId: "p-suh",
    displayName: "Grace Suh",
    offices: [{ entity: "JSOF", role: "FAMILY_SUPPORT_CHAIR" }],
  },
  {
    personId: "p-mbeki",
    displayName: "Tomas Mbeki",
    offices: [
      { entity: "JSOA", role: "FINANCE_REVIEW_OFFICER" },
      { entity: "JSOF", role: "FINANCE_REVIEW_OFFICER" },
    ],
  },
  {
    personId: "p-oyelaran",
    displayName: "Femi Oyelaran",
    offices: [{ entity: "JSOA", role: "COMMUNICATIONS_CHAIR" }],
  },
];

function attendeesFor(entity: Entity, absent: string[] = []): Attendee[] {
  return SEED_PEOPLE.flatMap((person) => {
    const office = person.offices.find((o) => o.entity === entity);
    if (!office) return [];
    return [
      {
        personId: person.personId,
        displayName: person.displayName,
        role: office.role,
        present: !absent.includes(person.personId),
        presiding: office.role === "PRESIDENT",
      },
    ];
  });
}

export function displayNameFor(personId: string): string {
  return SEED_PEOPLE.find((p) => p.personId === personId)?.displayName ?? personId;
}

/* ------------------------------------------------------------------ *
 * Meetings. Two per evening, one per entity.
 * ------------------------------------------------------------------ */

export const SEED_MEETINGS: Meeting[] = [
  {
    id: "m-jsoa-2026-09",
    entity: "JSOA",
    title: "Regular board meeting, September 2026",
    // 2026-09-08 18:00 America/New_York is 22:00Z (EDT, UTC-4).
    scheduledStart: "2026-09-08T22:00:00.000Z",
    scheduledMinutes: 75,
    location: "Fayetteville office, and by Teams",
    session: 1,
    status: "MINUTES_ADOPTED",
    quorum: 6,
    attendees: attendeesFor("JSOA", ["p-oyelaran"]),
    agendaAdoptedAt: "2026-09-08T22:06:00.000Z",
    noticeSentAt: "2026-08-31T13:00:00.000Z",
  },
  {
    id: "m-jsof-2026-09",
    entity: "JSOF",
    title: "Regular board meeting, September 2026",
    // Same evening, 19:45 ET, after the Association adjourns.
    scheduledStart: "2026-09-08T23:45:00.000Z",
    scheduledMinutes: 60,
    location: "Fayetteville office, and by Teams",
    session: 1,
    status: "MINUTES_ADOPTED",
    quorum: 5,
    attendees: attendeesFor("JSOF"),
    agendaAdoptedAt: "2026-09-08T23:50:00.000Z",
    noticeSentAt: "2026-08-31T13:10:00.000Z",
  },
  {
    id: "m-jsoa-2026-10",
    entity: "JSOA",
    title: "Regular board meeting, October 2026",
    // 2026-10-13 18:00 America/New_York is 22:00Z (EDT, UTC-4).
    scheduledStart: "2026-10-13T22:00:00.000Z",
    scheduledMinutes: 75,
    location: "Fayetteville office, and by Teams",
    session: 1,
    status: "IN_SESSION",
    quorum: 6,
    attendees: attendeesFor("JSOA", ["p-arceneaux"]),
    agendaAdoptedAt: "2026-10-13T22:05:00.000Z",
    noticeSentAt: "2026-10-05T12:00:00.000Z",
  },
  {
    id: "m-jsof-2026-10",
    entity: "JSOF",
    title: "Regular board meeting, October 2026",
    scheduledStart: "2026-10-13T23:45:00.000Z",
    scheduledMinutes: 75,
    location: "Fayetteville office, and by Teams",
    session: 1,
    status: "DRAFT",
    quorum: 5,
    attendees: attendeesFor("JSOF"),
    agendaAdoptedAt: null,
    noticeSentAt: null,
  },
];

/* ------------------------------------------------------------------ *
 * Agendas
 * ------------------------------------------------------------------ */

type SeedItem = Omit<AgendaItem, "id" | "entity" | "position" | "itemNumber"> & {
  id: string;
  n: number;
};

function itemsFor(meeting: Meeting, items: SeedItem[]): AgendaItem[] {
  return items.map((item) => ({
    id: item.id,
    meetingId: meeting.id,
    entity: meeting.entity,
    position: item.n,
    itemNumber: item.n,
    title: item.title,
    ownerRole: item.ownerRole,
    estimatedMinutes: item.estimatedMinutes,
    type: item.type,
    note: item.note,
    keywords: item.keywords,
  }));
}

const JSOA_SEPT: SeedItem[] = [
  {
    id: "i-jsoa-09-1",
    n: 1,
    meetingId: "m-jsoa-2026-09",
    title: "Transfer of the memorial bench fund balance to the Foundation",
    ownerRole: "TREASURER",
    estimatedMinutes: 15,
    type: "DECISION",
    note:
      "An inter-entity transfer cannot be recorded without a minute reference on both sides. " +
      "The Foundation takes the receiving side at its own meeting the same evening.",
    keywords: ["transfer", "bench", "memorial fund", "foundation"],
  },
  {
    id: "i-jsoa-09-2",
    n: 2,
    meetingId: "m-jsoa-2026-09",
    title: "Roster composition against the exemption tests",
    ownerRole: "VP_MEMBERSHIP",
    estimatedMinutes: 15,
    type: "DISCUSSION",
    note: "The non-qualifying class is the one to watch. Above 2.5% the exemption goes.",
    keywords: ["roster", "composition", "exemption", "non-qualifying"],
  },
  {
    id: "i-jsoa-09-3",
    n: 3,
    meetingId: "m-jsoa-2026-09",
    title: "Seasonal price list for the store",
    ownerRole: "STORE_CHAIR",
    estimatedMinutes: 15,
    type: "DECISION",
    keywords: ["store", "price list", "seasonal"],
  },
  {
    id: "i-jsoa-09-4",
    n: 4,
    meetingId: "m-jsoa-2026-09",
    title: "Golf tournament volunteer hours record",
    ownerRole: "EVENTS_CHAIR",
    estimatedMinutes: 10,
    type: "INFORMATION",
    note: "The volunteer-labour exception is a records exception. Hours planning and hours running, separately.",
    keywords: ["golf", "volunteer", "hours", "tournament"],
  },
];

const JSOF_SEPT: SeedItem[] = [
  {
    id: "i-jsof-09-1",
    n: 1,
    meetingId: "m-jsof-2026-09",
    title: "Receipt of the memorial bench fund transfer from the Association",
    ownerRole: "TREASURER",
    estimatedMinutes: 15,
    type: "DECISION",
    note: "The President is recused on the receiving side.",
    keywords: ["transfer", "receipt", "bench", "association"],
  },
  {
    id: "i-jsof-09-2",
    n: 2,
    meetingId: "m-jsof-2026-09",
    title: "Scholarship eligibility rule held pending counsel",
    ownerRole: "SCHOLARSHIPS_CHAIR",
    estimatedMinutes: 15,
    type: "DISCUSSION",
    note: "The published rule is not to be encoded. No motion expected while counsel has it.",
    keywords: ["scholarship", "eligibility", "counsel"],
  },
  {
    id: "i-jsof-09-3",
    n: 3,
    meetingId: "m-jsof-2026-09",
    title: "Selection criteria for the memorial scholarship, as recommended by counsel",
    ownerRole: "SCHOLARSHIPS_CHAIR",
    estimatedMinutes: 12,
    type: "DECISION",
    keywords: ["selection", "criteria", "memorial scholarship"],
  },
];

const JSOA_OCT: SeedItem[] = [
  {
    id: "i-jsoa-10-1",
    n: 1,
    meetingId: "m-jsoa-2026-10",
    title: "Roster composition against the 75, 97.5 and 90 percent tests",
    ownerRole: "VP_MEMBERSHIP",
    estimatedMinutes: 15,
    type: "INFORMATION",
    note: "Two separate tests. Exemption and deductibility do not turn on the same number.",
    keywords: ["roster", "composition", "exemption", "war veteran"],
  },
  {
    id: "i-jsoa-10-2",
    n: 2,
    meetingId: "m-jsoa-2026-10",
    title: "Store member gating as a tax control",
    ownerRole: "STORE_CHAIR",
    estimatedMinutes: 10,
    type: "DISCUSSION",
    note:
      "Without adequate records of non-member income, all income from activities open " +
      "to the public is taxed. The gate is the record.",
    keywords: ["store", "gating", "member", "non-member", "unrelated business"],
  },
  {
    id: "i-jsoa-10-3",
    n: 3,
    meetingId: "m-jsoa-2026-10",
    title: "Volunteer hours record for the golf tournament and the ball",
    ownerRole: "EVENTS_CHAIR",
    estimatedMinutes: 20,
    type: "DECISION",
    note: "Adopt a capture form, or the exception is not evidenced.",
    keywords: ["volunteer", "hours", "golf", "ball", "tournament"],
  },
  {
    id: "i-jsoa-10-4",
    n: 4,
    meetingId: "m-jsoa-2026-10",
    title: "Second transfer to the Foundation for the memorial bench fund",
    ownerRole: "TREASURER",
    estimatedMinutes: 15,
    type: "DECISION",
    note: "Needs a minute reference on both sides. The Foundation has not yet adopted its agenda.",
    keywords: ["transfer", "foundation", "bench", "inter-entity"],
  },
  {
    id: "i-jsoa-10-5",
    n: 5,
    meetingId: "m-jsoa-2026-10",
    title: "Charitable solicitation licence renewal, and whether the Association needs one",
    ownerRole: "SECRETARY",
    estimatedMinutes: 10,
    type: "DECISION",
    keywords: ["solicitation", "licence", "license", "renewal", "131F"],
  },
  {
    id: "i-jsoa-10-6",
    n: 6,
    meetingId: "m-jsoa-2026-10",
    title: "Memorial wall release queue and the second approver rule",
    ownerRole: "MEMORIAL_CHAIR",
    estimatedMinutes: 10,
    type: "DISCUSSION",
    keywords: ["memorial wall", "release", "approver"],
  },
];

const JSOF_OCT: SeedItem[] = [
  {
    id: "i-jsof-10-1",
    n: 1,
    meetingId: "m-jsof-2026-10",
    title: "Scholarship eligibility rule, counsel update",
    ownerRole: "SCHOLARSHIPS_CHAIR",
    estimatedMinutes: 20,
    type: "DISCUSSION",
    keywords: ["scholarship", "eligibility", "counsel", "private benefit"],
  },
  {
    id: "i-jsof-10-2",
    n: 2,
    meetingId: "m-jsof-2026-10",
    title: "Receipt of the second transfer from the Association",
    ownerRole: "TREASURER",
    estimatedMinutes: 10,
    type: "DECISION",
    note: "The President is recused on the receiving side.",
    keywords: ["transfer", "receipt", "association", "inter-entity"],
  },
  {
    id: "i-jsof-10-3",
    n: 3,
    meetingId: "m-jsof-2026-10",
    title: "Sponsor acknowledgment wording for the ball",
    ownerRole: "FUNDRAISING_CHAIR",
    estimatedMinutes: 15,
    type: "DECISION",
    note:
      "One adjective converts an acknowledgment into advertising and the whole placement " +
      "with it. Approve the exact string or approve nothing.",
    keywords: ["sponsor", "acknowledgment", "wording", "ball", "advertising"],
  },
  {
    id: "i-jsof-10-4",
    n: 4,
    meetingId: "m-jsof-2026-10",
    title: "Family support case load, aggregate only",
    ownerRole: "FAMILY_SUPPORT_CHAIR",
    estimatedMinutes: 10,
    type: "INFORMATION",
    note: "Counts and totals. No case is named to this board.",
    keywords: ["family support", "case load", "aggregate"],
  },
];

export const SEED_AGENDA_ITEMS: AgendaItem[] = [
  ...itemsFor(SEED_MEETINGS[0], JSOA_SEPT),
  ...itemsFor(SEED_MEETINGS[1], JSOF_SEPT),
  ...itemsFor(SEED_MEETINGS[2], JSOA_OCT),
  ...itemsFor(SEED_MEETINGS[3], JSOF_OCT),
];

/* ------------------------------------------------------------------ *
 * Minutes. September only: October is the live pair.
 * ------------------------------------------------------------------ */

function motion(args: {
  text: string;
  moved: string;
  seconded: string;
  tally: [number, number, number];
  outcome?: Motion["outcome"];
}): Motion {
  return {
    text: args.text,
    movedByPersonId: args.moved,
    movedByName: displayNameFor(args.moved),
    secondedByPersonId: args.seconded,
    secondedByName: displayNameFor(args.seconded),
    tally: { for: args.tally[0], against: args.tally[1], abstain: args.tally[2] },
    outcome: args.outcome ?? "CARRIED",
  };
}

function recusal(args: {
  personId: string;
  basis: Recusal["basis"];
  reason: string;
  withdrew?: boolean;
}): Recusal {
  return {
    personId: args.personId,
    displayName: displayNameFor(args.personId),
    basis: args.basis,
    reason: args.reason,
    withdrewFromRoom: args.withdrew ?? false,
  };
}

export const SEED_MINUTES: MinuteEntry[] = [
  {
    id: "min-jsoa-09-1",
    meetingId: "m-jsoa-2026-09",
    entity: "JSOA",
    agendaItemId: "i-jsoa-09-1",
    itemNumber: 1,
    ref: "JSOA-2026-09-min-1",
    discussion:
      "The Treasurer set out the history of the memorial bench fund: it was raised " +
      "as a restricted gift for a charitable purpose and has sat on the Association's " +
      "books since. The Finance Review Officer noted that the fund belongs on the " +
      "Foundation's books because the purpose is charitable, not membership. The " +
      "Association's Treasurer confirmed the Foundation's board takes the receiving " +
      "side at its own meeting this evening and that neither side is recorded until " +
      "both minutes carry a reference.",
    motion: motion({
      text:
        "That the Association transfer the whole balance of the memorial bench fund " +
        "to the Foundation, the transfer to take effect only once the Foundation's " +
        "board has recorded its acceptance under its own minute, and the Treasurer to " +
        "record the Foundation's minute reference against the transaction.",
      moved: "p-whitfield",
      seconded: "p-bell",
      tally: [6, 0, 1],
    }),
    recusals: [
      recusal({
        personId: "p-ellison",
        basis: "INTER_ENTITY_TRANSFER",
        reason:
          "Holds the office of President on both the Association and the Foundation " +
          "and so sits on both sides of this transfer. Took no part in the discussion " +
          "and did not vote. The chair was taken by the Vice President, Operations for " +
          "this item.",
        withdrew: false,
      }),
    ],
    closed: true,
    draft: false,
    source: "SECRETARY",
    flags: [],
  },
  {
    id: "min-jsoa-09-2",
    meetingId: "m-jsoa-2026-09",
    entity: "JSOA",
    agendaItemId: "i-jsoa-09-2",
    itemNumber: 2,
    ref: "JSOA-2026-09-min-2",
    discussion:
      "The Vice President, Membership reported the roster composition against the two " +
      "exemption tests and the separate deductibility test, in counts only. The " +
      "non-qualifying class is the exposure: the board was reminded that above two and " +
      "a half percent the exemption goes, and that the figure is a control rather than " +
      "a report. No motion was taken. The chair asked for the composition report to be " +
      "standing business from the December meeting on.",
    motion: null,
    recusals: [],
    closed: true,
    draft: false,
    source: "SECRETARY",
    flags: [],
  },
  {
    // Seeded deliberately incomplete: a DECISION item closed with no motion.
    // This is what the minutes page and the register must flag rather than
    // quietly file.
    id: "min-jsoa-09-3",
    meetingId: "m-jsoa-2026-09",
    entity: "JSOA",
    agendaItemId: "i-jsoa-09-3",
    itemNumber: 3,
    ref: "JSOA-2026-09-min-3",
    discussion:
      "The Store Chair took the board through the seasonal price list line by line. " +
      "The discussion ran into the question of whether the banquet shirt should be " +
      "priced separately from the tournament entry, which the Chair undertook to " +
      "check. The item was left there and the board moved on.",
    motion: null,
    recusals: [],
    closed: true,
    draft: false,
    source: "SECRETARY",
    flags: [],
  },
  {
    id: "min-jsoa-09-4",
    meetingId: "m-jsoa-2026-09",
    entity: "JSOA",
    agendaItemId: "i-jsoa-09-4",
    itemNumber: 4,
    ref: "JSOA-2026-09-min-4",
    discussion:
      "The Events Chair reported on the volunteer hours captured for the golf " +
      "tournament: hours spent planning and hours spent running are now recorded " +
      "separately, and any paid help is recorded as paid help. The board asked for the " +
      "same capture at the ball.",
    motion: null,
    recusals: [],
    closed: true,
    draft: false,
    source: "SECRETARY",
    flags: [],
  },
  {
    id: "min-jsof-09-1",
    meetingId: "m-jsof-2026-09",
    entity: "JSOF",
    agendaItemId: "i-jsof-09-1",
    itemNumber: 1,
    ref: "JSOF-2026-09-min-1",
    discussion:
      "The Treasurer reported the Association's resolution earlier this evening under " +
      "JSOA-2026-09-min-1 and asked the board to record the receiving side. The " +
      "Finance Review Officer confirmed the restricted purpose travels with the fund " +
      "and that the Foundation's receipt template applies, not the Association's. The " +
      "President withdrew before the item was taken.",
    motion: motion({
      text:
        "That the Foundation accept the memorial bench fund from the Association on the " +
        "restricted purpose for which it was raised, the Treasurer to record " +
        "JSOA-2026-09-min-1 as the sending reference against the transaction.",
      moved: "p-okonjo",
      seconded: "p-reyes",
      tally: [5, 0, 0],
    }),
    recusals: [
      recusal({
        personId: "p-ellison",
        basis: "INTER_ENTITY_TRANSFER",
        reason:
          "Holds the office of President on both entities. ARCHITECTURE.md requires the " +
          "President to be recused on the receiving side of an inter-entity transfer. " +
          "Left the room before the item was taken and returned after the vote was recorded.",
        withdrew: true,
      }),
    ],
    closed: true,
    draft: false,
    source: "SECRETARY",
    flags: [],
  },
  {
    id: "min-jsof-09-2",
    meetingId: "m-jsof-2026-09",
    entity: "JSOF",
    agendaItemId: "i-jsof-09-2",
    itemNumber: 2,
    ref: "JSOF-2026-09-min-2",
    discussion:
      "The Scholarships Chair reported that counsel has the published eligibility rule " +
      "and has advised against building it as written, because dues collected from " +
      "members and awards paid to members' children is the fact pattern used to deny " +
      "exemption. The board noted that the platform is not to encode the current rule " +
      "and that the scholarship module stays out of the current build for that reason. " +
      "No motion taken while counsel has it.",
    motion: null,
    recusals: [],
    closed: true,
    draft: false,
    source: "SECRETARY",
    flags: [],
  },
  {
    id: "min-jsof-09-3",
    meetingId: "m-jsof-2026-09",
    entity: "JSOF",
    agendaItemId: "i-jsof-09-3",
    itemNumber: 3,
    ref: "JSOF-2026-09-min-3",
    discussion:
      "The board considered the selection criteria counsel has recommended: a class " +
      "defined by service connection and community rather than by membership, objective " +
      "criteria published in advance, and a committee from which anyone related to an " +
      "applicant is excluded from the file entirely rather than merely from the vote. " +
      "The Scholarships Chair disclosed a relation in the class and recused before the " +
      "criteria were taken.",
    motion: motion({
      text:
        "That the Foundation adopt the selection criteria as recommended by counsel, " +
        "with the committee conflict rule stated as a block on opening an applicant's " +
        "file and not as a recusal from the vote, and that selection records be retained " +
        "five years.",
      moved: "p-suh",
      seconded: "p-bell",
      tally: [5, 0, 0],
    }),
    recusals: [
      recusal({
        personId: "p-hargrove",
        basis: "SCHOLARSHIP_CONFLICT",
        reason:
          "A dependent in her immediate family falls within the class the criteria would " +
          "cover. Disclosed before the item was taken, left the call, and took no part in " +
          "drafting or adopting the criteria.",
        withdrew: true,
      }),
    ],
    closed: true,
    draft: false,
    source: "SECRETARY",
    flags: [],
  },
];

/* ------------------------------------------------------------------ *
 * Compliance calendar
 *
 * No money figures here. Dates and owners only. Every entry says where
 * the confirmation is filed, because an unfiled confirmation is an
 * unmet duty that looks met.
 * ------------------------------------------------------------------ */

export const SEED_COMPLIANCE: ComplianceItem[] = [
  {
    id: "c-990-jsoa",
    entity: "JSOA",
    kind: "IRS",
    title: "IRS Form 990, Association return",
    dueDate: "2027-05-17",
    ownerRole: "TREASURER",
    confirmationStore:
      "Board drive, JSOA, Filings, FY2026, IRS. File the acknowledgment, not the return alone.",
    status: "OPEN",
    cadence: "Annual. Due the 15th day of the 5th month after the fiscal year ends.",
    selfDeclaring: false,
    verified: true,
    sourceNote:
      "Fiscal year ends 31 December, so the 2026 return falls due 15 May 2027, which " +
      "is a Saturday, moving to Monday 17 May. Nobody sends a reminder for this.",
  },
  {
    id: "c-990-jsof",
    entity: "JSOF",
    kind: "IRS",
    title: "IRS Form 990, Foundation return",
    dueDate: "2027-05-17",
    ownerRole: "TREASURER",
    confirmationStore: "Board drive, JSOF, Filings, FY2026, IRS.",
    status: "OPEN",
    cadence: "Annual. Due the 15th day of the 5th month after the fiscal year ends.",
    selfDeclaring: false,
    verified: true,
    sourceNote:
      "Filed separately from the Association's return and never consolidated with it. " +
      "Two entities, two returns, two acknowledgments.",
  },
  {
    id: "c-sos-jsoa",
    entity: "JSOA",
    kind: "STATE_CORPORATE",
    title: "NC Secretary of State annual report, Association",
    dueDate: "2027-04-15",
    ownerRole: "SECRETARY",
    confirmationStore: "Board drive, JSOA, Filings, FY2026, NC SoS.",
    status: "BLOCKED",
    cadence: "Annual, if it applies at all. See the note.",
    selfDeclaring: false,
    verified: true,
    sourceNote:
      "On the calendar because the board asked for it, and blocked because the duty is " +
      "not established. The annual report requirement sits in NC's business " +
      "corporation act, and NC's nonprofit corporation act does not carry the same " +
      "filing across. Confirm with the Secretary of State which filing is meant before " +
      "this date is relied on or a late fee is assumed. The due date here is a " +
      "placeholder, not a deadline.",
  },
  {
    id: "c-sos-jsof",
    entity: "JSOF",
    kind: "STATE_CORPORATE",
    title: "NC Secretary of State annual report, Foundation",
    dueDate: "2027-04-15",
    ownerRole: "SECRETARY",
    confirmationStore: "Board drive, JSOF, Filings, FY2026, NC SoS.",
    status: "BLOCKED",
    cadence: "Annual, if it applies at all. See the note.",
    selfDeclaring: false,
    verified: true,
    sourceNote:
      "Same question as the Association's entry. Blocked pending confirmation of which " +
      "filing is meant. The due date is a placeholder.",
  },
  {
    id: "c-131f-jsof",
    entity: "JSOF",
    kind: "STATE_CHARITABLE",
    title: "NC charitable solicitation licence renewal, Foundation",
    dueDate: "2027-05-15",
    ownerRole: "SECRETARY",
    confirmationStore:
      "Board drive, JSOF, Filings, FY2026, NC charitable solicitation. Keep the licence " +
      "itself and the renewal acknowledgment, both.",
    status: "OPEN",
    cadence: "ANNUAL. Every year, without exception.",
    selfDeclaring: false,
    verified: true,
    sourceNote:
      "This is the one that gets missed. The licence expires annually and must be " +
      "RE-FILED every year: it is not self-declaring, nothing renews automatically, and " +
      "no notice arrives to tell you it has lapsed. Soliciting on a lapsed licence is " +
      "the exposure. Chapter 131F also drives the disclosure statement that must appear " +
      "on every printed solicitation, written confirmation, receipt and reminder of a " +
      "contribution, at a minimum of nine-point type, made conspicuous by underlining, " +
      "a border or bold.",
  },
  {
    id: "c-131f-jsoa",
    entity: "JSOA",
    kind: "STATE_CHARITABLE",
    title: "NC charitable solicitation licence renewal, Association",
    dueDate: "2027-05-15",
    ownerRole: "SECRETARY",
    confirmationStore: "Board drive, JSOA, Filings, FY2026, NC charitable solicitation.",
    status: "OPEN",
    cadence: "ANNUAL. Every year, without exception.",
    selfDeclaring: false,
    verified: true,
    sourceNote:
      "The Association solicits contributions as well as collecting dues, so it is on " +
      "the calendar on the same annual, re-filed, not-self-declaring basis as the " +
      "Foundation's. Whether the Association's own solicitation reaches the threshold " +
      "or an exemption is a question for counsel, and the answer is to be recorded " +
      "against this entry rather than assumed.",
  },
  {
    id: "c-ins-jsoa",
    entity: "JSOA",
    kind: "INSURANCE",
    title: "General liability and directors and officers cover, Association",
    dueDate: "2027-02-01",
    ownerRole: "VP_OPERATIONS",
    confirmationStore:
      "Board drive, JSOA, Insurance, 2027. File the binder and the certificate, not the quote.",
    status: "OPEN",
    cadence: "Annual, on the policy anniversary.",
    selfDeclaring: true,
    verified: true,
    sourceNote:
      "The carrier sends a renewal notice, so this one announces itself. Check that the " +
      "event schedule on the policy still matches the events actually being run.",
  },
  {
    id: "c-ins-jsof",
    entity: "JSOF",
    kind: "INSURANCE",
    title: "Directors and officers cover, Foundation",
    dueDate: "2027-02-01",
    ownerRole: "VP_OPERATIONS",
    confirmationStore: "Board drive, JSOF, Insurance, 2027.",
    status: "OPEN",
    cadence: "Annual, on the policy anniversary.",
    selfDeclaring: true,
    verified: true,
    sourceNote:
      "A separate policy in the Foundation's own name. Shared cover across two entities " +
      "is one of the things that makes the separation look like a formality.",
  },
  {
    id: "c-domain",
    entity: "JSOA",
    kind: "INFRASTRUCTURE",
    title: "Domain registration renewal",
    dueDate: "2027-03-09",
    ownerRole: "WEBMASTER",
    confirmationStore:
      "Board drive, Shared, Infrastructure, Domains. Registrar receipt and the WHOIS " +
      "record showing the Association as registrant.",
    status: "OPEN",
    cadence: "Annual, with auto-renew enabled.",
    selfDeclaring: true,
    verified: true,
    sharedInfrastructure: true,
    sourceNote:
      "Registered to the Association, relied on by both entities. The two boards share " +
      "infrastructure and never share a ledger, so if the Foundation is ever billed a " +
      "share of this it is an inter-entity transaction and needs a minute reference on " +
      "both sides. Keep the card on file in the Association's name, and keep the " +
      "registrar account out of one volunteer's personal login.",
  },
  {
    // The one unverified entry. Rendered as unverified everywhere and never
    // counted as a duty. PRIVACY-AND-PAYMENTS.md is explicit that this is
    // not confirmed.
    id: "c-unverified-2027",
    entity: "JSOA",
    kind: "STATE_CORPORATE",
    title: "Possible new NC nonprofit annual reporting duty",
    dueDate: "2027-01-01",
    ownerRole: "SECRETARY",
    confirmationStore: "Nothing filed. There is nothing to file until this is confirmed.",
    status: "BLOCKED",
    cadence: "Unknown.",
    selfDeclaring: false,
    verified: false,
    sourceNote:
      "UNVERIFIED. A new annual reporting duty for NC nonprofits is reported to begin " +
      "1 January 2027 under a 2026 session law. This has NOT been confirmed and must " +
      "not be presented to the board as fact, put in a filing plan, or used to justify " +
      "work. The date shown is the reported commencement, not a deadline the board " +
      "owes. Someone needs to read the session law and either replace this entry with " +
      "the real duty or delete it. Related and separate: ignore any source claiming a " +
      "comprehensive NC privacy act took effect in January 2026, which is a proposed " +
      "date in a bill that did not pass.",
  },
];

/* ------------------------------------------------------------------ *
 * A sample transcript, so the parser can be tried without anyone
 * pasting real board audio into a demo. Written in Teams' shape.
 * ------------------------------------------------------------------ */

export const SAMPLE_TRANSCRIPT = `0:00:04.0 --> 0:00:11.0
Marcus Ellison: Right, we have quorum, six present, one apology from Paul. Dana has the agenda. Let's take it as circulated.

0:00:12.0 --> 0:00:31.0
Dana Navarro: Item one is the roster composition against the exemption tests, Nick has the numbers, and that is information only.

0:00:33.0 --> 0:01:02.0
Nick Castellano: On the roster composition, the war veteran share is comfortably over ninety percent, which is the deductibility test, and the non-qualifying class is at one point eight percent against a two and a half percent ceiling. I want to flag that the ceiling is the exemption test, not the same number as the ninety.

0:01:05.0 --> 0:01:20.0
Trish Bell: And we are attesting service dates, not collecting any paperwork for them.

0:01:21.0 --> 0:01:26.0
Nick Castellano: Correct. No discharge documents come near the platform.

0:01:30.0 --> 0:01:52.0
Dana Navarro: Item two, store member gating. Sam.

0:01:53.0 --> 0:02:40.0
Sam Doyle: The store gating question is really a records question. If we cannot show which sales were to non-members then all the income from anything open to the public is treated as unrelated business income, so the gate is the record. I would rather over-record than argue about it later.

0:02:44.0 --> 0:02:58.0
Roy Whitfield: That matches what the review officer said about the seasonal price list last month.

0:03:02.0 --> 0:03:30.0
Dana Navarro: Item three, volunteer hours for the golf tournament and the ball. This one is a decision, Britt.

0:03:31.0 --> 0:04:20.0
Britt Lindqvist: The volunteer labour exception is a records exception and we do not currently capture hours planning separately from hours running the event, and we do not record paid help at all. I move that the board adopt the volunteer hours capture form as drafted, to be used at every event from the ball onwards, with hours planning, hours running and any paid help recorded separately.

0:04:22.0 --> 0:04:26.0
Trish Bell: Second.

0:04:28.0 --> 0:04:44.0
Marcus Ellison: Any discussion. No. All those in favour. That is six in favour, none opposed, one abstaining. The motion carries.

0:04:50.0 --> 0:05:30.0
Dana Navarro: Item four is the second transfer to the Foundation for the memorial bench fund, and Marcus, this is the one you sit on both sides of.

0:05:31.0 --> 0:05:52.0
Marcus Ellison: Yes. I hold the presidency on both entities so I am recusing myself from this transfer and I will step out for the item. Trish, take the chair.

0:05:55.0 --> 0:06:40.0
Roy Whitfield: I move that the Association transfer the remaining memorial bench fund balance to the Foundation on the same restricted purpose, the transfer to take effect only once the Foundation records its acceptance under its own minute, and that I record the Foundation's minute reference against the transaction.

0:06:42.0 --> 0:06:46.0
Adaeze Okonjo: I second that.

0:06:48.0 --> 0:07:10.0
Trish Bell: Five in favour, none opposed, none abstaining. Carried.

0:07:20.0 --> 0:08:05.0
Dana Navarro: Item five, the charitable solicitation licence renewal, and whether the Association needs a licence of its own. This is annual, it does not renew itself, and nothing tells you when it has lapsed.

0:08:10.0 --> 0:08:40.0
Femi Oyelaran: Sorry, joining late. Is this the one where the disclosure has to be on every receipt.

0:08:42.0 --> 0:09:15.0
Dana Navarro: Yes, nine point type minimum, made conspicuous. I move that the Secretary calendar the renewal annually and put the question of the Association's own licence to counsel.

0:09:17.0 --> 0:09:20.0
Sam Doyle: Second.

0:09:22.0 --> 0:09:35.0
Marcus Ellison: Carried unanimously.

0:09:40.0 --> 0:10:20.0
Dana Navarro: Item six, the memorial wall release queue and the second approver rule. Paul is not here so I suggest we hold it.
`;
