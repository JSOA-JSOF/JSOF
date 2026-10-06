/**
 * Secretary module tests.
 *
 * The five the brief requires are grouped first and labelled, because they are
 * the requirements rather than coverage. Everything after them supports one of
 * those five or guards a rule that would be expensive to get wrong later.
 *
 * Nothing here imports `dev-subject.ts` or `actions.ts`: both reach into
 * `next/headers` and `next/cache`, which do not exist in a node test. The
 * authorization those actions call is tested directly against `access.ts`,
 * which is the module that does the deciding.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ENTITIES, type Entity, type Role } from "../src/lib/authz/model";
import { AuthzError, type Subject } from "../src/lib/authz/policy";
import {
  MINUTE_BOOK_CLASS,
  MinuteBookAccessError,
  assertMinuteBookCustody,
  authorizeAgendaWrite,
  authorizeGovernanceRead,
  authorizeMinuteRead,
  authorizeMinuteWrite,
  canReadGovernance,
  canReadMinutes,
  canWriteMinutes,
  readableEntities,
} from "../src/lib/meetings/access";
import {
  AgendaError,
  PROCEDURAL_OVERHEAD_MINUTES,
  agendaSchedule,
  agendaTotals,
} from "../src/lib/meetings/agenda";
import { countsFor, splitVerified, urgencyOf } from "../src/lib/meetings/calendar";
import {
  FormShapeError,
  assertAlignedRows,
  readClosedFromForm,
  readEntityFromForm,
  readMotionFromForm,
  readRecusalsFromForm,
} from "../src/lib/meetings/form";
import {
  buildAgendaDistribution,
  noticeRequiredHours,
  renderAgendaPlainText,
  resendPayload,
} from "../src/lib/meetings/distribution";
import {
  MINUTE_FLAGS,
  MinuteError,
  checkMinute,
  minuteBookReady,
} from "../src/lib/meetings/minutes";
import {
  MINUTE_REF_EXAMPLE,
  MinuteRefError,
  bookRefForMeeting,
  formatMinuteRef,
  isMinuteRef,
  minuteRefForMeeting,
  minuteRefsCrossEntities,
  parseMinuteRef,
} from "../src/lib/meetings/reference";
import {
  RepositoryError,
  createInMemoryMeetingsRepository,
  defaultSeed,
  type MeetingsRepository,
} from "../src/lib/meetings/repository";
import { SAMPLE_TRANSCRIPT, SEED_COMPLIANCE } from "../src/lib/meetings/seed";
import {
  DRAFT_FLAGS,
  DRAFT_MARKER,
  draftFromTranscript,
  draftToMinuteInputs,
  explicitItemCue,
  inferRecusalBasis,
  parseSpeakerTurns,
  readOutcome,
  readTally,
  resolveSpeaker,
  segmentByAgenda,
  stillMarkedDraft,
} from "../src/lib/meetings/transcript";
import type { Motion, Recusal } from "../src/lib/meetings/types";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const JSOA_SEPT = "m-jsoa-2026-09";
const JSOF_SEPT = "m-jsof-2026-09";
const JSOA_OCT = "m-jsoa-2026-10";
const JSOF_OCT = "m-jsof-2026-10";

function subject(assignments: [Role, Entity][], mfaSatisfied = true): Subject {
  return {
    personId: "p-test",
    assignments: assignments.map(([role, entity]) => ({ role, entity })),
    mfaSatisfied,
  };
}

const secretaryBoth = subject([
  ["SECRETARY", "JSOA"],
  ["SECRETARY", "JSOF"],
]);
const secretaryJsoaOnly = subject([["SECRETARY", "JSOA"]]);
const president = subject([
  ["PRESIDENT", "JSOA"],
  ["PRESIDENT", "JSOF"],
]);
const treasurerJsoa = subject([["TREASURER", "JSOA"]]);
const vpOperations = subject([
  ["VP_OPERATIONS", "JSOA"],
  ["VP_OPERATIONS", "JSOF"],
]);
const webmaster = subject([
  ["WEBMASTER", "JSOA"],
  ["WEBMASTER", "JSOF"],
]);
const plainMember = subject([["MEMBER", "JSOA"]]);
const secretaryNoMfa = subject(
  [
    ["SECRETARY", "JSOA"],
    ["SECRETARY", "JSOF"],
  ],
  false,
);

function motion(overrides: Partial<Motion> = {}): Motion {
  return {
    text: "That the board do the thing.",
    movedByPersonId: "p-whitfield",
    movedByName: "Roy Whitfield",
    secondedByPersonId: "p-bell",
    secondedByName: "Trish Bell",
    tally: { for: 6, against: 0, abstain: 1 },
    outcome: "CARRIED",
    ...overrides,
  };
}

function recusal(overrides: Partial<Recusal> = {}): Recusal {
  return {
    personId: "p-ellison",
    displayName: "Marcus Ellison",
    basis: "INTER_ENTITY_TRANSFER",
    reason: "Holds the presidency on both entities and sits on both sides.",
    withdrewFromRoom: true,
    ...overrides,
  };
}

let repo: MeetingsRepository;

beforeEach(() => {
  repo = createInMemoryMeetingsRepository(defaultSeed());
});

/* ================================================================== *
 * THE FIVE REQUIRED TESTS
 * ================================================================== */

describe("required: a minute without an entity cannot be saved", () => {
  const cases: { label: string; entity: unknown }[] = [
    { label: "undefined", entity: undefined },
    { label: "null", entity: null },
    { label: "an empty string", entity: "" },
  ];

  for (const { label, entity } of cases) {
    it(`refuses a minute whose entity is ${label}`, () => {
      const item = repo.listAgendaItems(JSOA_OCT)[0];
      expect(() =>
        repo.saveMinute({
          meetingId: JSOA_OCT,
          entity: entity as Entity | null | undefined,
          agendaItemId: item.id,
          discussion: "Something was said.",
        }),
      ).toThrowError(MinuteError);
    });
  }

  it("refuses with ENTITY_REQUIRED and says which board was in session", () => {
    const item = repo.listAgendaItems(JSOA_OCT)[0];
    let thrown: unknown;
    try {
      repo.saveMinute({
        meetingId: JSOA_OCT,
        entity: null,
        agendaItemId: item.id,
        discussion: "Something was said.",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MinuteError);
    expect((thrown as MinuteError).code).toBe("ENTITY_REQUIRED");
    expect((thrown as MinuteError).message).toMatch(/which entity's board was in session/i);
  });

  it("refuses a value that is not one of the two entities", () => {
    const item = repo.listAgendaItems(JSOA_OCT)[0];
    expect(() =>
      repo.saveMinute({
        meetingId: JSOA_OCT,
        entity: "JSOC" as Entity,
        agendaItemId: item.id,
        discussion: "Something was said.",
      }),
    ).toThrowError(/not one of JSOA or JSOF/);
  });

  it("refuses a minute filed into the wrong entity's book", () => {
    const item = repo.listAgendaItems(JSOA_OCT)[0];
    let thrown: unknown;
    try {
      repo.saveMinute({
        meetingId: JSOA_OCT,
        entity: "JSOF",
        agendaItemId: item.id,
        discussion: "Something was said.",
      });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as MinuteError).code).toBe("ENTITY_MISMATCH");
  });

  it("writes nothing when the entity is missing", () => {
    const before = repo.listMinutes(JSOA_OCT).length;
    const item = repo.listAgendaItems(JSOA_OCT)[0];
    expect(() =>
      repo.saveMinute({
        meetingId: JSOA_OCT,
        entity: null,
        agendaItemId: item.id,
        discussion: "Something was said.",
      }),
    ).toThrow();
    expect(repo.listMinutes(JSOA_OCT).length).toBe(before);
  });

  it("saves once the entity is named, and stamps it on the record", () => {
    const item = repo.listAgendaItems(JSOA_OCT)[0];
    const saved = repo.saveMinute({
      meetingId: JSOA_OCT,
      entity: "JSOA",
      agendaItemId: item.id,
      discussion: "Something was said.",
    });
    expect(saved.entity).toBe("JSOA");
    expect(saved.ref.startsWith("JSOA-")).toBe(true);
  });

  it("every seeded minute names its entity, and it matches its meeting", () => {
    for (const meetingId of [JSOA_SEPT, JSOF_SEPT]) {
      const meeting = repo.getMeeting(meetingId)!;
      const entries = repo.listMinutes(meetingId);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(ENTITIES).toContain(entry.entity);
        expect(entry.entity).toBe(meeting.entity);
      }
    }
  });
});

describe("required: a DECISION item closing with no motion is flagged", () => {
  it("flags DECISION_WITHOUT_MOTION and marks the minute incomplete", () => {
    const meeting = repo.getMeeting(JSOA_SEPT)!;
    const items = repo.listAgendaItems(JSOA_SEPT);
    const decision = items.find((i) => i.type === "DECISION" && i.itemNumber === 3)!;
    const entry = repo.listMinutes(JSOA_SEPT).find((e) => e.agendaItemId === decision.id)!;

    expect(entry.motion).toBeNull();
    expect(entry.closed).toBe(true);

    const check = checkMinute(entry, decision, meeting);
    expect(check.flags).toContain(MINUTE_FLAGS.DECISION_WITHOUT_MOTION);
    expect(check.incomplete).toBe(true);
  });

  it("does not flag a DISCUSSION item that closes with no motion", () => {
    const meeting = repo.getMeeting(JSOA_SEPT)!;
    const items = repo.listAgendaItems(JSOA_SEPT);
    const discussion = items.find((i) => i.type === "DISCUSSION")!;
    const entry = repo.listMinutes(JSOA_SEPT).find((e) => e.agendaItemId === discussion.id)!;
    const check = checkMinute(entry, discussion, meeting);
    expect(check.flags).not.toContain(MINUTE_FLAGS.DECISION_WITHOUT_MOTION);
    expect(check.incomplete).toBe(false);
  });

  it("does not flag a decision item that is still open", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const decision = repo.listAgendaItems(JSOA_OCT).find((i) => i.type === "DECISION")!;
    const saved = repo.saveMinute({
      meetingId: JSOA_OCT,
      entity: "JSOA",
      agendaItemId: decision.id,
      discussion: "Still being discussed.",
      closed: false,
    });
    expect(checkMinute(saved, decision, meeting).flags).not.toContain(
      MINUTE_FLAGS.DECISION_WITHOUT_MOTION,
    );
  });

  it("clears the flag once a motion is recorded", () => {
    const meeting = repo.getMeeting(JSOA_SEPT)!;
    const decision = repo
      .listAgendaItems(JSOA_SEPT)
      .find((i) => i.type === "DECISION" && i.itemNumber === 3)!;
    const saved = repo.saveMinute({
      meetingId: JSOA_SEPT,
      entity: "JSOA",
      agendaItemId: decision.id,
      discussion: "The price list was taken again.",
      motion: motion({ text: "That the seasonal price list be adopted as circulated." }),
      closed: true,
    });
    const check = checkMinute(saved, decision, meeting);
    expect(check.flags).not.toContain(MINUTE_FLAGS.DECISION_WITHOUT_MOTION);
    expect(check.incomplete).toBe(false);
  });

  it("keeps the whole book out of adoption while one decision is unmotioned", () => {
    const meeting = repo.getMeeting(JSOA_SEPT)!;
    const readiness = minuteBookReady(
      repo.listAgendaItems(JSOA_SEPT),
      repo.listMinutes(JSOA_SEPT),
      meeting,
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.incompleteRefs).toContain("JSOA-2026-09-min-3");
  });

  it("flags a motion recorded with no vote count", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const decision = repo.listAgendaItems(JSOA_OCT).find((i) => i.type === "DECISION")!;
    const saved = repo.saveMinute({
      meetingId: JSOA_OCT,
      entity: "JSOA",
      agendaItemId: decision.id,
      discussion: "Taken by voice vote.",
      motion: motion({ tally: null }),
      closed: true,
    });
    const check = checkMinute(saved, decision, meeting);
    expect(check.flags).toContain(MINUTE_FLAGS.MOTION_WITHOUT_TALLY);
    expect(check.incomplete).toBe(true);
  });
});

describe("required: a recusal is recorded with a reason and surfaces in the register", () => {
  it("refuses a recusal with no reason", () => {
    const item = repo.listAgendaItems(JSOA_OCT)[0];
    let thrown: unknown;
    try {
      repo.saveMinute({
        meetingId: JSOA_OCT,
        entity: "JSOA",
        agendaItemId: item.id,
        discussion: "Discussed.",
        recusals: [recusal({ reason: "" })],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MinuteError);
    expect((thrown as MinuteError).code).toBe("RECUSAL_REASON_REQUIRED");
  });

  it("refuses a recusal whose reason is only whitespace", () => {
    const item = repo.listAgendaItems(JSOA_OCT)[0];
    expect(() =>
      repo.saveMinute({
        meetingId: JSOA_OCT,
        entity: "JSOA",
        agendaItemId: item.id,
        discussion: "Discussed.",
        recusals: [recusal({ reason: "   \n  " })],
      }),
    ).toThrowError(MinuteError);
  });

  it("refuses a recusal that names nobody", () => {
    const item = repo.listAgendaItems(JSOA_OCT)[0];
    expect(() =>
      repo.saveMinute({
        meetingId: JSOA_OCT,
        entity: "JSOA",
        agendaItemId: item.id,
        discussion: "Discussed.",
        recusals: [recusal({ personId: "" })],
      }),
    ).toThrowError(MinuteError);
  });

  it("surfaces the seeded inter-entity recusal in the register, with its reason", () => {
    const records = repo.listDecisions("JSOF");
    const transfer = records.find((r) => r.ref === "JSOF-2026-09-min-1")!;
    expect(transfer.recusals).toHaveLength(1);
    expect(transfer.recusals[0].displayName).toBe("Marcus Ellison");
    expect(transfer.recusals[0].basis).toBe("INTER_ENTITY_TRANSFER");
    expect(transfer.recusals[0].reason.length).toBeGreaterThan(20);
    expect(transfer.recusals[0].withdrewFromRoom).toBe(true);
  });

  it("surfaces the seeded scholarship conflict recusal in the register", () => {
    const records = repo.listDecisions("JSOF");
    const criteria = records.find((r) => r.ref === "JSOF-2026-09-min-3")!;
    expect(criteria.recusals[0].basis).toBe("SCHOLARSHIP_CONFLICT");
    expect(criteria.recusals[0].reason).toMatch(/took no part/i);
  });

  it("carries a newly recorded recusal through to the register with its reason intact", () => {
    const decision = repo.listAgendaItems(JSOA_OCT).find((i) => i.type === "DECISION")!;
    const reason =
      "Her firm supplies the printing for this event, so she stood out of the vote.";
    const saved = repo.saveMinute({
      meetingId: JSOA_OCT,
      entity: "JSOA",
      agendaItemId: decision.id,
      discussion: "Discussed and moved.",
      motion: motion(),
      recusals: [
        recusal({
          personId: "p-lindqvist",
          displayName: "Britt Lindqvist",
          basis: "FINANCIAL_INTEREST",
          reason,
          withdrewFromRoom: false,
        }),
      ],
      closed: true,
    });

    const record = repo.listDecisions("JSOA").find((r) => r.ref === saved.ref)!;
    expect(record.recusals).toHaveLength(1);
    expect(record.recusals[0].reason).toBe(reason);
    expect(record.recusals[0].basis).toBe("FINANCIAL_INTEREST");
    expect(record.recusals[0].withdrewFromRoom).toBe(false);
  });

  it("flags a recused person who also appears as mover or seconder", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const decision = repo.listAgendaItems(JSOA_OCT).find((i) => i.type === "DECISION")!;
    const saved = repo.saveMinute({
      meetingId: JSOA_OCT,
      entity: "JSOA",
      agendaItemId: decision.id,
      discussion: "Discussed.",
      motion: motion({ movedByPersonId: "p-ellison", movedByName: "Marcus Ellison" }),
      recusals: [recusal()],
      closed: true,
    });
    const check = checkMinute(saved, decision, meeting);
    expect(check.flags).toContain(MINUTE_FLAGS.RECUSED_PERSON_VOTED);
    expect(check.incomplete).toBe(true);
  });

  it("only counts votes against those present and not recused", () => {
    const meeting = repo.getMeeting(JSOF_SEPT)!;
    const item = repo.listAgendaItems(JSOF_SEPT)[0];
    const present = meeting.attendees.filter((a) => a.present).length;
    const saved = repo.saveMinute({
      meetingId: JSOF_SEPT,
      entity: "JSOF",
      agendaItemId: item.id,
      discussion: "Discussed.",
      motion: motion({
        movedByPersonId: "p-okonjo",
        secondedByPersonId: "p-reyes",
        tally: { for: present, against: 0, abstain: 0 },
      }),
      recusals: [recusal()],
      closed: true,
    });
    expect(checkMinute(saved, item, meeting).flags).toContain(
      MINUTE_FLAGS.TALLY_EXCEEDS_PRESENT,
    );
  });
});

describe("required: two same-evening meetings produce two separate minute records", () => {
  it("seeds two meetings on the same date, one per entity", () => {
    const pairs = repo.listSameDayPairs();
    const septembers = pairs.find((p) => p.date === "2026-09-08")!;
    expect(septembers.meetings).toHaveLength(2);
    expect(septembers.meetings.map((m) => m.entity).sort()).toEqual(["JSOA", "JSOF"]);

    const octobers = pairs.find((p) => p.date === "2026-10-13")!;
    expect(octobers.meetings).toHaveLength(2);
    expect(octobers.meetings.map((m) => m.entity).sort()).toEqual(["JSOA", "JSOF"]);
  });

  it("keeps the two books separate and the references distinct", () => {
    const jsoa = repo.listMinutes(JSOA_SEPT);
    const jsof = repo.listMinutes(JSOF_SEPT);

    expect(jsoa.length).toBeGreaterThan(0);
    expect(jsof.length).toBeGreaterThan(0);
    expect(jsoa.every((e) => e.entity === "JSOA")).toBe(true);
    expect(jsof.every((e) => e.entity === "JSOF")).toBe(true);

    const refs = [...jsoa, ...jsof].map((e) => e.ref);
    expect(new Set(refs).size).toBe(refs.length);
    expect(jsoa.map((e) => e.ref)).toContain("JSOA-2026-09-min-1");
    expect(jsof.map((e) => e.ref)).toContain("JSOF-2026-09-min-1");
  });

  it("the same item number on the same date resolves to two different minutes", () => {
    const a = repo.getMinuteByRef("JSOA-2026-09-min-1")!;
    const b = repo.getMinuteByRef("JSOF-2026-09-min-1")!;
    expect(a.id).not.toBe(b.id);
    expect(a.entity).toBe("JSOA");
    expect(b.entity).toBe("JSOF");
    expect(a.discussion).not.toBe(b.discussion);
  });

  it("writing the same evening's business into both books touches two records", () => {
    const jsoaItem = repo.listAgendaItems(JSOA_OCT).find((i) => i.itemNumber === 4)!;
    const jsofItem = repo.listAgendaItems(JSOF_OCT).find((i) => i.itemNumber === 2)!;

    const sending = repo.saveMinute({
      meetingId: JSOA_OCT,
      entity: "JSOA",
      agendaItemId: jsoaItem.id,
      discussion: "The sending side of the transfer.",
      motion: motion(),
      closed: true,
    });
    const receiving = repo.saveMinute({
      meetingId: JSOF_OCT,
      entity: "JSOF",
      agendaItemId: jsofItem.id,
      discussion: "The receiving side of the transfer.",
      motion: motion({
        movedByPersonId: "p-okonjo",
        movedByName: "Adaeze Okonjo",
        secondedByPersonId: "p-reyes",
        secondedByName: "Gil Reyes",
      }),
      recusals: [recusal()],
      closed: true,
    });

    expect(sending.id).not.toBe(receiving.id);
    expect(sending.ref).not.toBe(receiving.ref);
    expect(minuteRefsCrossEntities(sending.ref, receiving.ref)).toBe(true);
  });

  it("never combines the two entities in the decision register", () => {
    const all = repo.listDecisions();
    const jsoaOnly = repo.listDecisions("JSOA");
    const jsofOnly = repo.listDecisions("JSOF");

    expect(jsoaOnly.every((r) => r.entity === "JSOA")).toBe(true);
    expect(jsofOnly.every((r) => r.entity === "JSOF")).toBe(true);
    expect(jsoaOnly.length + jsofOnly.length).toBe(all.length);
    expect(jsoaOnly.length).toBeGreaterThan(0);
    expect(jsofOnly.length).toBeGreaterThan(0);
  });

  it("names the entity on the face of each agenda notice", () => {
    const jsoa = repo.getMeeting(JSOA_OCT)!;
    const jsof = repo.getMeeting(JSOF_OCT)!;
    const jsoaText = renderAgendaPlainText(jsoa, repo.listAgendaItems(JSOA_OCT));
    const jsofText = renderAgendaPlainText(jsof, repo.listAgendaItems(JSOF_OCT));

    expect(jsoaText).toContain("Joint Special Operations Association");
    expect(jsoaText).toContain("JSOA-2026-10");
    expect(jsoaText).not.toContain("JSOF-2026-10");
    expect(jsofText).toContain("Joint Special Operations Foundation");
    expect(jsofText).toContain("JSOF-2026-10");
    expect(jsofText).not.toContain("JSOA-2026-10");
  });
});

describe("required: a wrong-role request to minutes fails", () => {
  it("refuses a Webmaster, who holds NONE on member data", () => {
    expect(() => authorizeMinuteRead(webmaster, "JSOA")).toThrowError(AuthzError);
    expect(() => authorizeGovernanceRead(webmaster, "JSOA")).toThrowError(AuthzError);
    expect(canReadMinutes(webmaster, "JSOA")).toBe(false);
  });

  it("refuses a plain member", () => {
    expect(() => authorizeMinuteRead(plainMember, "JSOA")).toThrowError(AuthzError);
    expect(readableEntities(plainMember, ENTITIES)).toEqual([]);
  });

  it("refuses the Treasurer the minute book, because AGGREGATE is not row level", () => {
    let thrown: unknown;
    try {
      authorizeMinuteRead(treasurerJsoa, "JSOA");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AuthzError);
    expect((thrown as AuthzError).code).toBe("DENIED");
    // But the agenda and calendar, which name only roles, are within reach.
    expect(() => authorizeGovernanceRead(treasurerJsoa, "JSOA")).not.toThrow();
    expect(canReadGovernance(treasurerJsoa, "JSOA")).toBe(true);
    expect(canReadMinutes(treasurerJsoa, "JSOA")).toBe(false);
  });

  it("refuses VP Operations the minute book for the same reason", () => {
    expect(() => authorizeMinuteRead(vpOperations, "JSOF")).toThrowError(AuthzError);
    expect(canReadGovernance(vpOperations, "JSOF")).toBe(true);
  });

  it("refuses the President the WRITE, because custody is an office not a level", () => {
    // The President reads both books.
    expect(() => authorizeMinuteRead(president, "JSOA")).not.toThrow();
    expect(() => authorizeMinuteRead(president, "JSOF")).not.toThrow();
    // And keeps neither.
    let thrown: unknown;
    try {
      authorizeMinuteWrite(president, "JSOA");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MinuteBookAccessError);
    expect((thrown as MinuteBookAccessError).code).toBe("NOT_THE_CUSTODIAN");
    expect(canWriteMinutes(president, "JSOA")).toBe(false);
  });

  it("refuses the wrong entity's Secretary, which is the whole point of two books", () => {
    expect(() => authorizeMinuteWrite(secretaryJsoaOnly, "JSOA")).not.toThrow();
    expect(() => authorizeMinuteWrite(secretaryJsoaOnly, "JSOF")).toThrowError(AuthzError);
    expect(canWriteMinutes(secretaryJsoaOnly, "JSOF")).toBe(false);
    expect(canWriteMinutes(secretaryJsoaOnly, "JSOA")).toBe(true);
    expect(() => assertMinuteBookCustody(secretaryJsoaOnly, "JSOF")).toThrowError(
      MinuteBookAccessError,
    );
  });

  it("refuses an otherwise-correct Secretary who has not cleared TOTP", () => {
    expect(() => authorizeMinuteRead(secretaryNoMfa, "JSOA")).toThrowError(AuthzError);
    expect(() => authorizeMinuteWrite(secretaryNoMfa, "JSOA")).toThrowError(AuthzError);
    expect(() => authorizeGovernanceRead(secretaryNoMfa, "JSOA")).toThrowError(AuthzError);
    expect(canWriteMinutes(secretaryNoMfa, "JSOA")).toBe(false);
  });

  it("refuses agenda writes to everyone but the Secretary of that entity", () => {
    expect(() => authorizeAgendaWrite(secretaryBoth, "JSOA")).not.toThrow();
    expect(() => authorizeAgendaWrite(secretaryBoth, "JSOF")).not.toThrow();
    for (const wrong of [president, treasurerJsoa, vpOperations, webmaster, plainMember]) {
      expect(() => authorizeAgendaWrite(wrong, "JSOA")).toThrow();
    }
  });

  it("lets the Secretary of both entities read and write both books", () => {
    for (const entity of ENTITIES) {
      expect(() => authorizeMinuteRead(secretaryBoth, entity)).not.toThrow();
      expect(() => authorizeMinuteWrite(secretaryBoth, entity)).not.toThrow();
    }
    expect(readableEntities(secretaryBoth, ENTITIES)).toEqual(["JSOA", "JSOF"]);
  });

  it("files the minute book under MEMBER_PII, which is what it contains", () => {
    expect(MINUTE_BOOK_CLASS).toBe("MEMBER_PII");
  });
});

/* ================================================================== *
 * SUPPORTING TESTS
 * ================================================================== */

describe("minute references", () => {
  it("formats the documented shape", () => {
    expect(
      formatMinuteRef({ entity: "JSOA", year: 2026, month: 10, itemNumber: 4 }),
    ).toBe(MINUTE_REF_EXAMPLE);
  });

  it("adds a session suffix only from the second meeting of a month", () => {
    expect(
      formatMinuteRef({ entity: "JSOF", year: 2026, month: 10, session: 1, itemNumber: 2 }),
    ).toBe("JSOF-2026-10-min-2");
    expect(
      formatMinuteRef({ entity: "JSOF", year: 2026, month: 10, session: 2, itemNumber: 2 }),
    ).toBe("JSOF-2026-10-S2-min-2");
  });

  it("round-trips through the parser", () => {
    const parsed = parseMinuteRef("JSOF-2026-10-S2-min-12")!;
    expect(parsed).toMatchObject({
      entity: "JSOF",
      year: 2026,
      month: 10,
      session: 2,
      itemNumber: 12,
      bookRef: "JSOF-2026-10-S2",
    });
  });

  it("rejects references that are not references", () => {
    for (const bad of [
      "min-4",
      "JSOA-min-4",
      "JSOC-2026-10-min-4",
      "JSOA-2026-13-min-4",
      "JSOA-2026-00-min-4",
      "JSOA-26-10-min-4",
      "JSOA-2026-10-min-0",
      "JSOA-2026-10-S1-min-4",
      "jsoa-2026-10-min-4",
      "",
    ]) {
      expect(isMinuteRef(bad)).toBe(false);
    }
  });

  it("refuses to format an out-of-range month, year or item", () => {
    expect(() =>
      formatMinuteRef({ entity: "JSOA", year: 2026, month: 13, itemNumber: 1 }),
    ).toThrowError(MinuteRefError);
    expect(() =>
      formatMinuteRef({ entity: "JSOA", year: 26, month: 1, itemNumber: 1 }),
    ).toThrowError(MinuteRefError);
    expect(() =>
      formatMinuteRef({ entity: "JSOA", year: 2026, month: 1, itemNumber: 0 }),
    ).toThrowError(MinuteRefError);
  });

  it("derives the reference from the meeting, so the entity cannot disagree", () => {
    const meeting = repo.getMeeting(JSOF_OCT)!;
    expect(minuteRefForMeeting(meeting, 3)).toBe("JSOF-2026-10-min-3");
    expect(bookRefForMeeting(meeting)).toBe("JSOF-2026-10");
  });

  it("tells the treasury module when a reference pair does not cross entities", () => {
    expect(minuteRefsCrossEntities("JSOA-2026-09-min-1", "JSOF-2026-09-min-1")).toBe(true);
    expect(minuteRefsCrossEntities("JSOA-2026-09-min-1", "JSOA-2026-09-min-2")).toBe(false);
    expect(minuteRefsCrossEntities("JSOA-2026-09-min-1", "not-a-ref")).toBe(false);
  });
});

describe("agenda", () => {
  it("totals the estimates and adds the procedural overhead", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const items = repo.listAgendaItems(JSOA_OCT);
    const totals = agendaTotals(meeting, items);
    const sum = items.reduce((acc, i) => acc + i.estimatedMinutes, 0);
    expect(totals.estimatedMinutes).toBe(sum);
    expect(totals.committedMinutes).toBe(sum + PROCEDURAL_OVERHEAD_MINUTES);
  });

  it("flags the seeded October Association agenda as overrunning", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const totals = agendaTotals(meeting, repo.listAgendaItems(JSOA_OCT));
    expect(totals.overruns).toBe(true);
    expect(totals.overrunMinutes).toBeGreaterThan(0);
    expect(totals.slackMinutes).toBe(0);
  });

  it("does not flag an agenda that fits, and reports the slack", () => {
    const meeting = repo.getMeeting(JSOF_OCT)!;
    const totals = agendaTotals(meeting, repo.listAgendaItems(JSOF_OCT));
    expect(totals.overruns).toBe(false);
    expect(totals.overrunMinutes).toBe(0);
    expect(totals.slackMinutes).toBeGreaterThan(0);
  });

  it("marks the items that begin after the scheduled close", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const schedule = agendaSchedule(meeting, repo.listAgendaItems(JSOA_OCT));
    expect(schedule.some((row) => row.pastScheduledClose)).toBe(true);
    // And it is the tail of the agenda, not the head.
    expect(schedule[0].pastScheduledClose).toBe(false);
  });

  it("reorders a draft agenda and renumbers item numbers only on adoption", () => {
    const before = repo.listAgendaItems(JSOF_OCT);
    const reversed = [...before].reverse().map((i) => i.id);
    const after = repo.reorderAgenda(JSOF_OCT, reversed);
    expect(after.map((i) => i.id)).toEqual(reversed);
    // Item numbers have not moved yet.
    expect(after.map((i) => i.itemNumber).sort((a, b) => a - b)).toEqual(
      before.map((i) => i.itemNumber).sort((a, b) => a - b),
    );
    repo.adoptAgenda(JSOF_OCT, "2026-10-13T23:50:00.000Z");
    const adopted = repo.listAgendaItems(JSOF_OCT);
    expect(adopted.map((i) => i.itemNumber)).toEqual(
      adopted.map((_, index) => index + 1),
    );
  });

  it("refuses to reorder or add to an adopted agenda", () => {
    const items = repo.listAgendaItems(JSOA_OCT);
    expect(() =>
      repo.reorderAgenda(JSOA_OCT, [...items].reverse().map((i) => i.id)),
    ).toThrowError(AgendaError);
    expect(() =>
      repo.saveAgendaItem({
        meetingId: JSOA_OCT,
        title: "Late new business",
        ownerRole: "SECRETARY",
        estimatedMinutes: 5,
        type: "DISCUSSION",
      }),
    ).toThrowError(AgendaError);
  });

  it("still allows a wording or estimate correction on an adopted agenda", () => {
    const item = repo.listAgendaItems(JSOA_OCT)[0];
    const fixed = repo.saveAgendaItem({
      id: item.id,
      meetingId: JSOA_OCT,
      title: "Roster composition against the statutory tests",
      ownerRole: item.ownerRole,
      estimatedMinutes: 12,
      type: item.type,
    });
    expect(fixed.itemNumber).toBe(item.itemNumber);
    expect(fixed.position).toBe(item.position);
    expect(fixed.estimatedMinutes).toBe(12);
  });

  it("refuses a nonsense estimate or an empty title", () => {
    expect(() =>
      repo.saveAgendaItem({
        meetingId: JSOF_OCT,
        title: "   ",
        ownerRole: "SECRETARY",
        estimatedMinutes: 10,
        type: "DISCUSSION",
      }),
    ).toThrowError(AgendaError);
    expect(() =>
      repo.saveAgendaItem({
        meetingId: JSOF_OCT,
        title: "Something",
        ownerRole: "SECRETARY",
        estimatedMinutes: 0,
        type: "DISCUSSION",
      }),
    ).toThrowError(AgendaError);
  });

  it("refuses to remove an item that already has a minute against it", () => {
    const item = repo.listAgendaItems(JSOF_OCT)[0];
    repo.saveMinute({
      meetingId: JSOF_OCT,
      entity: "JSOF",
      agendaItemId: item.id,
      discussion: "Discussed.",
    });
    expect(() => repo.removeAgendaItem(JSOF_OCT, item.id)).toThrowError(RepositoryError);
  });

  it("refuses a minute against an item on the other board's agenda", () => {
    const jsofItem = repo.listAgendaItems(JSOF_OCT)[0];
    expect(() =>
      repo.saveMinute({
        meetingId: JSOA_OCT,
        entity: "JSOA",
        agendaItemId: jsofItem.id,
        discussion: "Wrong board.",
      }),
    ).toThrowError(RepositoryError);
  });
});

describe("agenda distribution", () => {
  it("states the notice period and whether it is satisfied", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const early = buildAgendaDistribution(
      meeting,
      repo.listAgendaItems(JSOA_OCT),
      new Date("2026-10-01T12:00:00.000Z"),
    );
    expect(early.noticeRequiredHours).toBe(noticeRequiredHours(meeting));
    expect(early.noticeSatisfied).toBe(true);

    const late = buildAgendaDistribution(
      meeting,
      repo.listAgendaItems(JSOA_OCT),
      new Date("2026-10-12T12:00:00.000Z"),
    );
    expect(late.noticeSatisfied).toBe(false);
  });

  it("requires shorter notice for a special meeting than a regular one", () => {
    expect(noticeRequiredHours({ session: 1 })).toBeGreaterThan(
      noticeRequiredHours({ session: 2 }),
    );
  });

  it("builds a payload with no recipient addresses in it", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const distribution = buildAgendaDistribution(meeting, repo.listAgendaItems(JSOA_OCT));
    const payload = resendPayload(meeting, distribution);
    expect(payload.to).toEqual([]);
    expect(distribution.stubbed).toBe(true);
    expect(distribution.recipientRoles.length).toBeGreaterThan(0);
  });

  it("stamps the entity and the minute book on the payload headers", () => {
    const meeting = repo.getMeeting(JSOF_OCT)!;
    const payload = resendPayload(
      meeting,
      buildAgendaDistribution(meeting, repo.listAgendaItems(JSOF_OCT)),
    );
    expect(payload.headers["X-Entity"]).toBe("JSOF");
    expect(payload.headers["X-Minute-Book"]).toBe("JSOF-2026-10");
    expect(payload.subject).toContain("JSOF");
  });

  it("says in the notice that the agenda overruns, when it does", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const text = renderAgendaPlainText(meeting, repo.listAgendaItems(JSOA_OCT));
    expect(text).toContain("OVERRUN");
  });

  it("renders email HTML with no external script, stylesheet or image", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const { html } = buildAgendaDistribution(meeting, repo.listAgendaItems(JSOA_OCT));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).toContain("JSOA-2026-10");
  });

  it("escapes item titles into the HTML rather than interpolating them raw", () => {
    repo.saveAgendaItem({
      meetingId: JSOF_OCT,
      title: 'Policy on <script>alert("x")</script> wording',
      ownerRole: "SECRETARY",
      estimatedMinutes: 5,
      type: "DISCUSSION",
    });
    const meeting = repo.getMeeting(JSOF_OCT)!;
    const { html } = buildAgendaDistribution(meeting, repo.listAgendaItems(JSOF_OCT));
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("transcript parser", () => {
  it("parses Teams timecoded lines into speaker turns", () => {
    const turns = parseSpeakerTurns(SAMPLE_TRANSCRIPT, []);
    expect(turns.length).toBeGreaterThan(10);
    expect(turns[0].speakerLabel).toBe("Marcus Ellison");
    expect(turns[0].timecode).not.toBeNull();
  });

  it("parses plain `Name: text` lines and merges consecutive turns", () => {
    const turns = parseSpeakerTurns(
      ["Ann Lee: first part.", "Ann Lee: second part.", "Bo Chen: something else."].join("\n"),
    );
    expect(turns).toHaveLength(2);
    expect(turns[0].text).toBe("first part. second part.");
  });

  it("parses WebVTT with voice spans", () => {
    const turns = parseSpeakerTurns(
      [
        "WEBVTT",
        "",
        "1",
        "00:00:01.000 --> 00:00:04.000",
        "<v Ann Lee>I move that we adjourn.</v>",
      ].join("\n"),
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].speakerLabel).toBe("Ann Lee");
    expect(turns[0].text).toBe("I move that we adjourn.");
  });

  it("drops platform noise rather than minuting it", () => {
    const turns = parseSpeakerTurns(
      [
        "WEBVTT",
        "Ann Lee joined the meeting",
        "Bo Chen started transcription",
        "Ann Lee: right, let us begin.",
      ].join("\n"),
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("right, let us begin.");
  });

  it("does not treat a label like `Motion:` as a speaker", () => {
    const turns = parseSpeakerTurns("Motion: that we adjourn.\nAnn Lee: second.");
    expect(turns.map((t) => t.speakerLabel)).not.toContain("Motion");
  });

  it("resolves a speaker by full name or a unique surname, and refuses to guess", () => {
    const attendees = [
      { personId: "p-1", displayName: "Ann Lee" },
      { personId: "p-2", displayName: "Bo Chen" },
      { personId: "p-3", displayName: "Cass Chen" },
    ];
    expect(resolveSpeaker("Ann Lee", attendees)).toBe("p-1");
    expect(resolveSpeaker("Lee", attendees)).toBe("p-1");
    // Two Chens, so neither.
    expect(resolveSpeaker("Chen", attendees)).toBeNull();
    expect(resolveSpeaker("Someone Else", attendees)).toBeNull();
  });

  it("reads an explicit agenda cue, in digits or words", () => {
    expect(explicitItemCue("that brings us to item four")).toBe(4);
    expect(explicitItemCue("agenda item 2, Roy")).toBe(2);
    expect(explicitItemCue("item number 11")).toBe(11);
    expect(explicitItemCue("nothing about items here")).toBeNull();
  });

  it("reads a vote tally only when the transcript states one", () => {
    expect(readTally("that is six in favour, none opposed, one abstaining")).toEqual({
      for: 6,
      against: 0,
      abstain: 1,
    });
    expect(readTally("5 in favor, 2 against, 0 abstentions")).toEqual({
      for: 5,
      against: 2,
      abstain: 0,
    });
    expect(readTally("carried unanimously")).toBeNull();
    expect(readTally("any objection? none. carried.")).toBeNull();
  });

  it("reads an outcome, preferring withdrawal and tabling over carrying", () => {
    expect(readOutcome("the motion carries")).toBe("CARRIED");
    expect(readOutcome("the motion fails")).toBe("FAILED");
    expect(readOutcome("I withdraw the motion")).toBe("WITHDRAWN");
    expect(readOutcome("let us table it")).toBe("TABLED");
    expect(readOutcome("we talked about it")).toBeNull();
  });

  it("infers a recusal basis from the stated words", () => {
    expect(inferRecusalBasis("my daughter is an applicant")).toBe("SCHOLARSHIP_CONFLICT");
    expect(inferRecusalBasis("I sit on both sides of this transfer")).toBe(
      "INTER_ENTITY_TRANSFER",
    );
    expect(inferRecusalBasis("my nephew would benefit")).toBe("RELATED_PARTY");
    expect(inferRecusalBasis("my employer bids for this")).toBe("EMPLOYMENT");
    expect(inferRecusalBasis("I would rather not say why")).toBe("OTHER");
  });

  it("assigns turns to agenda items and leaves the opening turn unassigned", () => {
    const turns = parseSpeakerTurns(SAMPLE_TRANSCRIPT, repo.getMeeting(JSOA_OCT)!.attendees);
    const { segments, unassigned } = segmentByAgenda(turns, repo.listAgendaItems(JSOA_OCT));
    expect(segments.filter((s) => s.turns.length > 0).length).toBeGreaterThan(3);
    // The call to order matches no item, and is not forced into one.
    expect(unassigned.length).toBeGreaterThan(0);
  });

  it("produces a draft that is marked as a draft in every field it wrote", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOA_OCT),
      transcript: SAMPLE_TRANSCRIPT,
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });

    expect(draft.sections.length).toBe(repo.listAgendaItems(JSOA_OCT).length);
    for (const section of draft.sections) {
      expect(section.discussion).toContain(DRAFT_MARKER);
      if (section.motion) expect(section.motion.text).toContain(DRAFT_MARKER);
      for (const r of section.recusals) expect(r.reason).toContain(DRAFT_MARKER);
    }
  });

  it("says it is an extract and not a summary, in the text itself", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOA_OCT),
      transcript: SAMPLE_TRANSCRIPT,
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });
    const withContent = draft.sections.find((s) => s.provenance.turnCount > 0)!;
    expect(withContent.discussion).toMatch(/not a summary/i);
    expect(withContent.discussion).toMatch(/verbatim/i);
  });

  it("finds the motion, the mover, the seconder and the stated tally", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOA_OCT),
      transcript: SAMPLE_TRANSCRIPT,
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });
    const volunteerHours = draft.sections.find((s) => s.itemNumber === 3)!;
    expect(volunteerHours.motion).not.toBeNull();
    expect(volunteerHours.motion!.movedByName).toBe("Britt Lindqvist");
    expect(volunteerHours.motion!.secondedByName).toBe("Trish Bell");
    expect(volunteerHours.motion!.tally).toEqual({ for: 6, against: 0, abstain: 1 });
    expect(volunteerHours.motion!.outcome).toBe("CARRIED");
  });

  it("finds the recusal and keeps the verbatim sentence as the reason", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOA_OCT),
      transcript: SAMPLE_TRANSCRIPT,
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });
    const transfer = draft.sections.find((s) => s.itemNumber === 4)!;
    expect(transfer.recusals.length).toBeGreaterThan(0);
    const found = transfer.recusals[0];
    expect(found.displayName).toBe("Marcus Ellison");
    expect(found.basis).toBe("INTER_ENTITY_TRANSFER");
    expect(found.reason).toMatch(/recusing/i);
    expect(found.withdrewFromRoom).toBe(true);
    expect(transfer.flags).toContain(DRAFT_FLAGS.RECUSAL_NEEDS_WORDING);
  });

  it("flags an item nothing was assigned to rather than inventing content", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOA_OCT),
      transcript: "Ann Lee: entirely unrelated conversation about nothing at all.",
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });
    for (const section of draft.sections) {
      expect(section.flags).toContain(DRAFT_FLAGS.NOTHING_MATCHED);
      expect(section.motion).toBeNull();
      expect(section.discussion).toMatch(/from your notes/i);
    }
    expect(draft.itemsWithNothing.length).toBe(draft.sections.length);
  });

  it("flags a missing tally on a decision that was carried by voice", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOA_OCT),
      transcript: SAMPLE_TRANSCRIPT,
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });
    const licence = draft.sections.find((s) => s.itemNumber === 5)!;
    expect(licence.flags).toContain(DRAFT_FLAGS.NO_TALLY_IN_TEXT);
    expect(licence.motion?.tally).toBeNull();
  });

  it("warns rather than silently failing when nothing parses", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOA_OCT),
      transcript: "just a wall of prose with no speaker labels anywhere in it",
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });
    expect(draft.warnings.length).toBeGreaterThan(0);
  });

  it("takes the entity from the meeting and never from the transcript", () => {
    const meeting = repo.getMeeting(JSOF_OCT)!;
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOF_OCT),
      // The transcript claims to be the other entity's meeting. It is ignored.
      transcript: "Ann Lee: this is the JSOA board meeting, item one, the transfer.",
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });
    expect(draft.entity).toBe("JSOF");
    for (const input of draftToMinuteInputs(draft, meeting)) {
      expect(input.entity).toBe("JSOF");
      expect(input.draft).toBe(true);
      expect(input.source).toBe("TRANSCRIPT_DRAFT");
    }
  });

  it("writes drafts into the book as drafts, flagged and incomplete", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOA_OCT),
      transcript: SAMPLE_TRANSCRIPT,
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });
    const written = repo.replaceTranscriptDrafts(
      JSOA_OCT,
      draftToMinuteInputs(draft, meeting),
    );
    expect(written.length).toBeGreaterThan(0);

    const items = repo.listAgendaItems(JSOA_OCT);
    for (const entry of written) {
      expect(entry.draft).toBe(true);
      expect(entry.entity).toBe("JSOA");
      const item = items.find((i) => i.id === entry.agendaItemId)!;
      const check = checkMinute(entry, item, meeting);
      expect(check.flags).toContain(MINUTE_FLAGS.UNREVIEWED_TRANSCRIPT_DRAFT);
      expect(check.incomplete).toBe(true);
    }
    expect(
      minuteBookReady(items, repo.listMinutes(JSOA_OCT), meeting).ready,
    ).toBe(false);
  });

  it("running the parser twice replaces the drafts rather than doubling them", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const build = () =>
      draftToMinuteInputs(
        draftFromTranscript({
          meeting,
          items: repo.listAgendaItems(JSOA_OCT),
          transcript: SAMPLE_TRANSCRIPT,
          refFor: (n) => minuteRefForMeeting(meeting, n),
        }),
        meeting,
      );
    const first = repo.replaceTranscriptDrafts(JSOA_OCT, build());
    const second = repo.replaceTranscriptDrafts(JSOA_OCT, build());
    expect(second.length).toBe(first.length);
    expect(repo.listMinutes(JSOA_OCT).filter((e) => e.draft).length).toBe(first.length);
  });

  it("leaves the book untouched when one draft section is refused", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const items = repo.listAgendaItems(JSOA_OCT);
    const good = draftToMinuteInputs(
      draftFromTranscript({
        meeting,
        items,
        transcript: SAMPLE_TRANSCRIPT,
        refFor: (n) => minuteRefForMeeting(meeting, n),
      }),
      meeting,
    );
    const first = repo.replaceTranscriptDrafts(JSOA_OCT, good);
    expect(first.length).toBeGreaterThan(0);
    const before = repo.listMinutes(JSOA_OCT);

    // One section carries a recusal with no reason, which is a hard refusal.
    const poisoned = good.map((input, index) =>
      index === good.length - 1
        ? { ...input, recusals: [recusal({ reason: "" })] }
        : input,
    );
    expect(() => repo.replaceTranscriptDrafts(JSOA_OCT, poisoned)).toThrowError(
      MinuteError,
    );

    const after = repo.listMinutes(JSOA_OCT);
    expect(after.map((e) => e.ref)).toEqual(before.map((e) => e.ref));
    expect(after.map((e) => e.discussion)).toEqual(before.map((e) => e.discussion));
  });

  it("never overwrites a minute the Secretary wrote", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const item = repo.listAgendaItems(JSOA_OCT)[0];
    repo.saveMinute({
      meetingId: JSOA_OCT,
      entity: "JSOA",
      agendaItemId: item.id,
      discussion: "Written by the Secretary from her own notes.",
      source: "SECRETARY",
    });
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOA_OCT),
      transcript: SAMPLE_TRANSCRIPT,
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });
    repo.replaceTranscriptDrafts(JSOA_OCT, draftToMinuteInputs(draft, meeting));
    const kept = repo.listMinutes(JSOA_OCT).find((e) => e.agendaItemId === item.id)!;
    expect(kept.source).toBe("SECRETARY");
    expect(kept.discussion).toContain("her own notes");
  });

  it("knows whether a draft marker survives an edit", () => {
    expect(
      stillMarkedDraft({
        discussion: `${DRAFT_MARKER} something`,
        motion: null,
        recusals: [],
      }),
    ).toBe(true);
    expect(
      stillMarkedDraft({
        discussion: "Rewritten by hand.",
        motion: null,
        recusals: [recusal({ reason: `${DRAFT_MARKER} verbatim: "..."` })],
      }),
    ).toBe(true);
    expect(
      stillMarkedDraft({
        discussion: "Rewritten by hand.",
        motion: motion(),
        recusals: [recusal()],
      }),
    ).toBe(false);
  });
});

describe("reading a minute out of the posted form", () => {
  /**
   * Built to mirror what `MinuteEditor.tsx` actually posts. A select, a
   * textarea and a hidden input always post, even when empty. A checkbox posts
   * only when checked, which is why `closed` and `tallyGiven` are added
   * conditionally here and why no recusal row field is a checkbox.
   */
  function postedForm(options: {
    entity?: string | null;
    discussion?: string;
    closed?: boolean;
    motionText?: string;
    movedByPersonId?: string;
    secondedByPersonId?: string;
    outcome?: string;
    tally?: { for: number; against: number; abstain: number } | null;
    recusals?: {
      personId: string;
      displayName?: string;
      basis?: string;
      reason?: string;
      withdrew?: boolean;
    }[];
  }): FormData {
    const form = new FormData();
    form.set("meetingId", JSOA_OCT);
    form.set("agendaItemId", "i-jsoa-10-3");
    if (options.entity !== undefined) form.set("entity", options.entity ?? "");
    form.set("discussion", options.discussion ?? "");
    if (options.closed) form.set("closed", "on");

    form.set("motionText", options.motionText ?? "");
    form.set("movedByPersonId", options.movedByPersonId ?? "");
    form.set("movedByName", "");
    form.set("secondedByPersonId", options.secondedByPersonId ?? "");
    form.set("secondedByName", "");
    form.set("outcome", options.outcome ?? "CARRIED");
    if (options.tally) {
      form.set("tallyGiven", "on");
      form.set("voteFor", String(options.tally.for));
      form.set("voteAgainst", String(options.tally.against));
      form.set("voteAbstain", String(options.tally.abstain));
    }

    for (const row of options.recusals ?? []) {
      form.append("recusalPersonId", row.personId);
      form.append("recusalDisplayName", row.displayName ?? "");
      form.append("recusalBasis", row.basis ?? "OTHER");
      form.append("recusalReason", row.reason ?? "");
      form.append("recusalWithdrew", row.withdrew ? "yes" : "no");
    }
    return form;
  }

  it("reads no motion when the motion text is empty", () => {
    expect(readMotionFromForm(postedForm({}))).toBeNull();
  });

  it("reads the motion, the parties and the outcome", () => {
    const parsed = readMotionFromForm(
      postedForm({
        motionText: "That the capture form be adopted.",
        movedByPersonId: "p-lindqvist",
        secondedByPersonId: "p-bell",
        outcome: "TABLED",
      }),
    )!;
    expect(parsed.text).toBe("That the capture form be adopted.");
    expect(parsed.movedByPersonId).toBe("p-lindqvist");
    expect(parsed.secondedByPersonId).toBe("p-bell");
    expect(parsed.outcome).toBe("TABLED");
  });

  it("reads no tally when the count box is unchecked, and the count when it is", () => {
    expect(
      readMotionFromForm(postedForm({ motionText: "A motion." }))!.tally,
    ).toBeNull();
    expect(
      readMotionFromForm(
        postedForm({ motionText: "A motion.", tally: { for: 6, against: 0, abstain: 1 } }),
      )!.tally,
    ).toEqual({ for: 6, against: 0, abstain: 1 });
  });

  it("falls back to a safe outcome and basis rather than trusting the post", () => {
    expect(
      readMotionFromForm(postedForm({ motionText: "A motion.", outcome: "WHATEVER" }))!
        .outcome,
    ).toBe("CARRIED");
    expect(
      readRecusalsFromForm(
        postedForm({ recusals: [{ personId: "p-x", basis: "NONSENSE", reason: "r" }] }),
      )[0].basis,
    ).toBe("OTHER");
  });

  it("refuses a negative or non-numeric vote count rather than storing one", () => {
    const form = postedForm({ motionText: "A motion.", tally: { for: 1, against: 0, abstain: 0 } });
    form.set("voteFor", "-4");
    form.set("voteAgainst", "not a number");
    const tally = readMotionFromForm(form)!.tally!;
    expect(tally.for).toBe(0);
    expect(tally.against).toBe(0);
  });

  it("reads several recusals and keeps each reason with the right person", () => {
    const parsed = readRecusalsFromForm(
      postedForm({
        recusals: [
          {
            personId: "p-ellison",
            displayName: "Marcus Ellison",
            basis: "INTER_ENTITY_TRANSFER",
            reason: "Sits on both sides.",
            withdrew: true,
          },
          {
            personId: "p-hargrove",
            displayName: "Lena Hargrove",
            basis: "SCHOLARSHIP_CONFLICT",
            reason: "Relation in the applicant class.",
            withdrew: false,
          },
        ],
      }),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      personId: "p-ellison",
      reason: "Sits on both sides.",
      basis: "INTER_ENTITY_TRANSFER",
      withdrewFromRoom: true,
    });
    expect(parsed[1]).toMatchObject({
      personId: "p-hargrove",
      reason: "Relation in the applicant class.",
      basis: "SCHOLARSHIP_CONFLICT",
      withdrewFromRoom: false,
    });
  });

  it("skips a blank row without shifting the rows after it", () => {
    const parsed = readRecusalsFromForm(
      postedForm({
        recusals: [
          { personId: "", reason: "nobody chosen yet" },
          { personId: "p-hargrove", displayName: "Lena Hargrove", reason: "The real one." },
        ],
      }),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].personId).toBe("p-hargrove");
    expect(parsed[0].reason).toBe("The real one.");
  });

  it("lets an empty reason through so the repository can refuse it by name", () => {
    const parsed = readRecusalsFromForm(
      postedForm({ recusals: [{ personId: "p-ellison", reason: "" }] }),
    );
    expect(parsed[0].reason).toBe("");
    expect(() =>
      repo.saveMinute({
        meetingId: JSOA_OCT,
        entity: "JSOA",
        agendaItemId: "i-jsoa-10-3",
        discussion: "Discussed.",
        recusals: parsed,
      }),
    ).toThrowError(MinuteError);
  });

  it("refuses the parse outright if the recusal rows ever stop lining up", () => {
    const form = postedForm({
      recusals: [
        { personId: "p-ellison", reason: "First reason." },
        { personId: "p-hargrove", reason: "Second reason." },
      ],
    });
    // What a checkbox would do to the row alignment.
    form.delete("recusalWithdrew");
    form.append("recusalWithdrew", "yes");
    expect(() => readRecusalsFromForm(form)).toThrowError(FormShapeError);
    expect(() => assertAlignedRows(form)).toThrowError(/wrong person/);
  });

  it("distinguishes a form with no entity field from one with an empty entity", () => {
    expect(readEntityFromForm(postedForm({}))).toBeUndefined();
    expect(readEntityFromForm(postedForm({ entity: null }))).toBeNull();
    expect(readEntityFromForm(postedForm({ entity: "JSOA" }))).toBe("JSOA");
  });

  it("reads the closed box only when it was checked", () => {
    expect(readClosedFromForm(postedForm({}))).toBe(false);
    expect(readClosedFromForm(postedForm({ closed: true }))).toBe(true);
  });

  it("round-trips a posted form into a saved minute", () => {
    const form = postedForm({
      entity: "JSOA",
      discussion: "The capture form was discussed and moved.",
      closed: true,
      motionText: "That the volunteer hours capture form be adopted.",
      movedByPersonId: "p-lindqvist",
      secondedByPersonId: "p-bell",
      tally: { for: 6, against: 0, abstain: 1 },
      recusals: [
        {
          personId: "p-doyle",
          displayName: "Sam Doyle",
          basis: "FINANCIAL_INTEREST",
          reason: "His firm would supply the shirts.",
        },
      ],
    });

    const saved = repo.saveMinute({
      meetingId: String(form.get("meetingId")),
      entity: readEntityFromForm(form) as Entity,
      agendaItemId: String(form.get("agendaItemId")),
      discussion: String(form.get("discussion")),
      motion: readMotionFromForm(form),
      recusals: readRecusalsFromForm(form),
      closed: readClosedFromForm(form),
    });

    expect(saved.ref).toBe("JSOA-2026-10-min-3");
    expect(saved.entity).toBe("JSOA");
    expect(saved.motion!.tally).toEqual({ for: 6, against: 0, abstain: 1 });
    expect(saved.recusals[0].reason).toBe("His firm would supply the shirts.");

    const record = repo.listDecisions("JSOA").find((r) => r.ref === saved.ref)!;
    expect(record.recusals[0].displayName).toBe("Sam Doyle");
  });

  it("refuses the round trip when the form posted an empty entity", () => {
    const form = postedForm({
      entity: null,
      discussion: "Something.",
      motionText: "A motion.",
    });
    expect(() =>
      repo.saveMinute({
        meetingId: String(form.get("meetingId")),
        entity: readEntityFromForm(form) as Entity | null,
        agendaItemId: String(form.get("agendaItemId")),
        discussion: String(form.get("discussion")),
        motion: readMotionFromForm(form),
        recusals: readRecusalsFromForm(form),
      }),
    ).toThrowError(MinuteError);
  });
});

describe("decision register", () => {
  it("lists only items that carry a motion", () => {
    const records = repo.listDecisions();
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.motion).not.toBeNull();
      expect(record.ref).toBeTruthy();
      expect(isMinuteRef(record.ref)).toBe(true);
    }
    // The unmotioned decision item is absent, which is why the minutes page
    // flags it rather than relying on the register to surface it.
    expect(records.map((r) => r.ref)).not.toContain("JSOA-2026-09-min-3");
  });

  it("carries date, motion, vote and the minute reference on every entry", () => {
    const record = repo.listDecisions("JSOA").find((r) => r.ref === "JSOA-2026-09-min-1")!;
    expect(record.date).toBe("2026-09-08T22:00:00.000Z");
    expect(record.motion.text).toMatch(/transfer/i);
    expect(record.motion.tally).toEqual({ for: 6, against: 0, abstain: 1 });
    expect(record.itemNumber).toBe(1);
    expect(record.itemTitle).toBeTruthy();
  });

  it("marks a decision drawn from an unreviewed draft as provisional", () => {
    const meeting = repo.getMeeting(JSOA_OCT)!;
    const draft = draftFromTranscript({
      meeting,
      items: repo.listAgendaItems(JSOA_OCT),
      transcript: SAMPLE_TRANSCRIPT,
      refFor: (n) => minuteRefForMeeting(meeting, n),
    });
    repo.replaceTranscriptDrafts(JSOA_OCT, draftToMinuteInputs(draft, meeting));
    const provisional = repo.listDecisions("JSOA").filter((r) => r.provisional);
    expect(provisional.length).toBeGreaterThan(0);
  });
});

describe("compliance calendar", () => {
  it("seeds a 990 per entity and never one combined return", () => {
    const irs = repo.listComplianceItems().filter((i) => i.kind === "IRS");
    expect(irs.map((i) => i.entity).sort()).toEqual(["JSOA", "JSOF"]);
  });

  it("seeds the NC charitable solicitation renewal as annual and not self-declaring", () => {
    const licences = repo
      .listComplianceItems()
      .filter((i) => i.kind === "STATE_CHARITABLE");
    expect(licences.length).toBeGreaterThan(0);
    for (const licence of licences) {
      expect(licence.selfDeclaring).toBe(false);
      expect(licence.cadence).toMatch(/ANNUAL/);
      expect(licence.sourceNote).toMatch(/re-filed/i);
      expect(licence.confirmationStore.length).toBeGreaterThan(0);
    }
  });

  it("seeds insurance and the domain, and names a role owner for every entry", () => {
    const items = repo.listComplianceItems();
    expect(items.some((i) => i.kind === "INSURANCE")).toBe(true);
    expect(items.some((i) => i.kind === "INFRASTRUCTURE")).toBe(true);
    for (const item of items) {
      expect(item.ownerRole).toBeTruthy();
      expect(item.confirmationStore.length).toBeGreaterThan(0);
      expect(item.entity === "JSOA" || item.entity === "JSOF").toBe(true);
    }
  });

  it("carries exactly one unverified entry, and it is the 2027 report", () => {
    const { duties, unverified } = splitVerified(SEED_COMPLIANCE);
    expect(unverified).toHaveLength(1);
    expect(unverified[0].dueDate).toBe("2027-01-01");
    expect(unverified[0].title).toMatch(/possible/i);
    expect(unverified[0].sourceNote).toMatch(/UNVERIFIED/);
    expect(unverified[0].sourceNote).toMatch(/not.*confirmed/i);
    expect(duties.every((d) => d.verified)).toBe(true);
  });

  it("never counts the unverified entry as a duty", () => {
    const today = new Date("2026-12-01T00:00:00.000Z");
    for (const entity of ENTITIES) {
      const items = repo.listComplianceItems(entity);
      const counts = countsFor(items, today);
      const total =
        counts.overdue + counts.dueSoon + counts.blocked + counts.scheduled + counts.filed;
      expect(total).toBe(items.filter((i) => i.verified).length);
    }
  });

  it("reports the unverified entry as unverified whatever the date", () => {
    const item = SEED_COMPLIANCE.find((i) => !i.verified)!;
    expect(urgencyOf(item, new Date("2026-01-01T00:00:00.000Z"))).toBe("UNVERIFIED");
    expect(urgencyOf(item, new Date("2028-01-01T00:00:00.000Z"))).toBe("UNVERIFIED");
  });

  it("refuses to mark an unverified obligation as filed", () => {
    const item = repo.listComplianceItems().find((i) => !i.verified)!;
    expect(() => repo.setComplianceStatus(item.id, "FILED")).toThrowError(RepositoryError);
    expect(() => repo.setComplianceStatus(item.id, "BLOCKED")).not.toThrow();
  });

  it("marks a verified filing as filed", () => {
    const item = repo.listComplianceItems().find((i) => i.verified)!;
    expect(repo.setComplianceStatus(item.id, "FILED").status).toBe("FILED");
  });
});

describe("repository hygiene", () => {
  it("hands out copies, so a caller cannot mutate the book by accident", () => {
    const first = repo.getMeeting(JSOA_SEPT)!;
    first.entity = "JSOF";
    first.attendees[0].present = !first.attendees[0].present;
    const second = repo.getMeeting(JSOA_SEPT)!;
    expect(second.entity).toBe("JSOA");

    const entries = repo.listMinutes(JSOA_SEPT);
    entries[0].discussion = "tampered";
    expect(repo.listMinutes(JSOA_SEPT)[0].discussion).not.toBe("tampered");
  });

  it("starts each test from the same seed", () => {
    expect(repo.listMeetings()).toHaveLength(4);
    expect(repo.listMinutes(JSOA_SEPT)).toHaveLength(4);
    expect(repo.listMinutes(JSOF_SEPT)).toHaveLength(3);
    expect(repo.listMinutes(JSOA_OCT)).toHaveLength(0);
  });

  it("refuses an attendance change for someone not on that board", () => {
    expect(() => repo.setAttendance(JSOA_SEPT, "p-okonjo", true)).toThrowError(
      RepositoryError,
    );
    expect(() => repo.setAttendance(JSOA_SEPT, "p-whitfield", false)).not.toThrow();
  });

  it("refuses a minute against a meeting that does not exist", () => {
    expect(() =>
      repo.saveMinute({
        meetingId: "m-not-real",
        entity: "JSOA",
        agendaItemId: "i-not-real",
        discussion: "Nothing.",
      }),
    ).toThrowError(RepositoryError);
  });

  it("carries no money figure anywhere in the seed", () => {
    const serialised = JSON.stringify({
      meetings: repo.listMeetings(),
      minutes: [JSOA_SEPT, JSOF_SEPT].flatMap((id) => repo.listMinutes(id)),
      compliance: repo.listComplianceItems(),
    });
    expect(serialised).not.toMatch(/amountCents/);
    expect(serialised).not.toMatch(/\$[0-9]/);
  });
});
