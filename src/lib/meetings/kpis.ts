/**
 * The Secretary's dashboard figures.
 *
 * What this office is for is making the organization's decisions provable
 * afterwards, for two entities that meet the same evening with the same people
 * in the room. So every figure here measures one thing: whether the record is
 * actually complete. An incomplete minute book is only ever discovered when
 * somebody needs it, which is the worst available moment to find out.
 *
 * Four rules this file keeps, and why.
 *
 * 1. Nothing is summed across entities. Every figure is reported as two
 *    figures, one per book, in fixed `ENTITIES` order. A combined number is
 *    exactly the ambiguity two separate minute books exist to prevent, so a
 *    blended total would defeat the control it was meant to measure.
 *
 * 2. An unverified or blocked compliance entry is never counted as a duty. The
 *    calendar holds one entry whose underlying obligation is not confirmed to
 *    exist at all, a reported NC nonprofit annual reporting duty commencing
 *    2027, and two whose applicability to a nonprofit is unresolved: the NC
 *    Secretary of State annual report for each entity. All three are
 *    quarantined. They appear below the figures as work to resolve and never
 *    inside a due-soon or overdue count. `calendar.ts` already separates
 *    verified from unverified; nothing here undoes that. The quarantine does
 *    not depend on the horizon: the unverified entry sat inside the old 90-day
 *    window and sits outside the 60-day one this file now shares with
 *    `calendar.ts`, and it was uncountable under both.
 *
 * 3. The notice period is an assumption and the tile says so. North Carolina
 *    supplies no statutory notice period for a nonprofit board and the bylaws
 *    govern, so the 7-day regular and 48-hour special figures in
 *    `distribution.ts` are this platform's assumption. A compliance percentage
 *    measured against an invented standard that does not admit it is invented
 *    is worse than no percentage.
 *
 * 4. A figure the viewer has no scope for is withheld, not zeroed, the same
 *    distinction as a figure that cannot be computed yet.
 *
 * Authorization: one entry point, `secretaryDashboard`. It resolves nothing
 * itself. It takes a `Subject` and calls through `access.ts` before it touches
 * the repository, per entity, which is the guard pattern the server actions in
 * `actions.ts` use. Reads deliberately do NOT require the office of Secretary:
 * this module adds custody on top of `authorize()` for writes only, and
 * `access.ts` says in as many words that reading is a separate question.
 * Nothing here widens a grant.
 */

import type { Kpi, KpiStatus } from "@/components/dashboard/Kpi";

import { ENTITIES, type Entity } from "../authz/model";
import type { Subject } from "../authz/policy";
import type { TaskUrgency } from "../workspace/types";
import {
  authorizeGovernanceRead,
  authorizeMinuteRead,
  canReadGovernance,
  canReadMinutes,
} from "./access";
import { DUE_SOON_DAYS, daysUntil } from "./calendar";
import { noticeRequiredHours } from "./distribution";
import { MINUTE_FLAGS, checkMinute, minuteBookReady } from "./minutes";
import { meetingsRepository, type MeetingsRepository } from "./repository";
import type { Meeting } from "./types";

/**
 * The horizon a filing counts as due within.
 *
 * This used to be 90 here while `calendar.ts` used 60, so the Secretary's
 * dashboard and the compliance page the dashboard links to disagreed about
 * which filings were due soon. Two numbers for one idea is how a board ends up
 * arguing about a figure instead of filing the thing.
 *
 * Settled at 60, by taking the calendar's own constant rather than restating
 * it. 60 wins for two reasons: the compliance page is where the board actually
 * reads filings and its urgency chip already says "Due within 60 days", so the
 * tile and the page it links to now mean the same thing; and `DUE_SOON_DAYS`
 * is the constant the urgency labels are generated from, so deriving from it
 * makes a future drift impossible rather than merely unlikely.
 *
 * One consequence, stated because it changes a figure: the unverified 2027
 * entry (reported commencement 1 January 2027) falls inside 90 days of this
 * build's date and outside 60. It was quarantined before and is quarantined
 * now — the window never decided that — but the tile no longer gets to say the
 * uncounted entry sits inside the very window being counted.
 */
export const DUE_HORIZON_DAYS = DUE_SOON_DAYS;

export type DashboardAction = {
  key: string;
  label: string;
  /** How many of the thing the label names are waiting. */
  count: number;
  href: string;
  /** One line: what the count is, and what doing it settles. */
  note: string;
  /** Sorts first and takes colour. Reserved for an incomplete record. */
  urgent: boolean;
  /** Which book. Never a blend of the two. */
  entity?: Entity;
  /**
   * What is held up until this is done. One line, and deliberately narrower
   * than `note`: the Overview's task list renders this as the `because`, and a
   * task that does not say what it blocks is a count with a verb on it.
   */
  blocks?: string;
  /** Derived, like the action itself. Nobody sets an urgency by hand. */
  urgency?: TaskUrgency;
  /** ISO date this is owed by, where the data supplies one. */
  dueOn?: string;
};

export type SecretaryDashboard = {
  kpis: Kpi[];
  actions: DashboardAction[];
  /** Entities whose meeting list and compliance calendar this subject may read. */
  governanceEntities: Entity[];
  /** Entities whose minute book and decision register this subject may read. */
  minuteEntities: Entity[];
  /** Quarantined calendar entries, named so the page can say they were excluded. */
  quarantined: { unverified: number; blocked: number; unverifiedInWindow: number };
  asOf: string;
};

/* ------------------------------------------------------------------ *
 * Per-entity snapshot. One book, never two.
 * ------------------------------------------------------------------ */

type OutstandingBook = {
  meeting: Meeting;
  missingItemNumbers: number[];
  incompleteRefs: string[];
  decisionsWithoutMotion: number;
};

type UnnoticedMeeting = {
  meeting: Meeting;
  requiredHours: number;
  /** True while the assumed period can still be met if notice goes today. */
  stillAchievable: boolean;
};

type BookSnapshot = {
  entity: Entity;
  governance: boolean;
  minutes: boolean;

  /* governance scope */
  noticeObligations: number;
  noticeInsidePeriod: number;
  unnoticed: UnnoticedMeeting[];
  agendaUnadopted: Meeting[];
  filingsDueSoon: number;
  filingsOverdue: number;
  filingsTracked: number;
  blockedFilings: number;
  unverifiedFilings: number;
  unverifiedFilingsInWindow: number;

  /* minute scope */
  booksHeld: number;
  booksReady: number;
  outstanding: OutstandingBook[];
  closedDecisions: number;
  closedDecisionsWithoutMotion: number;
  recusals: number;
  recusalsWithReason: number;
  recusalsBasisOther: number;
  unreviewedDrafts: number;
};

function emptySnapshot(entity: Entity, governance: boolean, minutes: boolean): BookSnapshot {
  return {
    entity,
    governance,
    minutes,
    noticeObligations: 0,
    noticeInsidePeriod: 0,
    unnoticed: [],
    agendaUnadopted: [],
    filingsDueSoon: 0,
    filingsOverdue: 0,
    filingsTracked: 0,
    blockedFilings: 0,
    unverifiedFilings: 0,
    unverifiedFilingsInWindow: 0,
    booksHeld: 0,
    booksReady: 0,
    outstanding: [],
    closedDecisions: 0,
    closedDecisionsWithoutMotion: 0,
    recusals: 0,
    recusalsWithReason: 0,
    recusalsBasisOther: 0,
    unreviewedDrafts: 0,
  };
}

const HOUR_MS = 3_600_000;

function hoursBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / HOUR_MS);
}

function snapshotFor(
  repo: MeetingsRepository,
  subject: Subject,
  entity: Entity,
  now: Date,
): BookSnapshot {
  const governance = canReadGovernance(subject, entity);
  const minutes = canReadMinutes(subject, entity);
  const snapshot = emptySnapshot(entity, governance, minutes);
  if (!governance) return snapshot;

  // The guard, before the first read. Narrower reads get the narrower gate.
  authorizeGovernanceRead(subject, entity);
  const meetings = repo.listMeetings(entity);
  const filings = repo.listComplianceItems(entity);

  for (const meeting of meetings) {
    const required = noticeRequiredHours(meeting);
    snapshot.noticeObligations += 1;
    if (meeting.noticeSentAt) {
      if (hoursBetween(meeting.noticeSentAt, meeting.scheduledStart) >= required) {
        snapshot.noticeInsidePeriod += 1;
      }
    } else if (Date.parse(meeting.scheduledStart) > now.getTime()) {
      snapshot.unnoticed.push({
        meeting,
        requiredHours: required,
        stillAchievable:
          hoursBetween(now.toISOString(), meeting.scheduledStart) >= required,
      });
    }
    if (
      meeting.agendaAdoptedAt === null &&
      Date.parse(meeting.scheduledStart) > now.getTime()
    ) {
      snapshot.agendaUnadopted.push(meeting);
    }
  }

  for (const filing of filings) {
    // Rule 2. The quarantine happens before anything is counted, not after.
    if (!filing.verified) {
      snapshot.unverifiedFilings += 1;
      const days = daysUntil(filing.dueDate, now);
      if (days <= DUE_HORIZON_DAYS) snapshot.unverifiedFilingsInWindow += 1;
      continue;
    }
    if (filing.status === "BLOCKED") {
      snapshot.blockedFilings += 1;
      continue;
    }
    if (filing.status === "FILED") continue;
    snapshot.filingsTracked += 1;
    const days = daysUntil(filing.dueDate, now);
    if (days < 0) snapshot.filingsOverdue += 1;
    else if (days <= DUE_HORIZON_DAYS) snapshot.filingsDueSoon += 1;
  }

  if (!minutes) return snapshot;

  // Row-level gate, separately, because it admits strictly fewer roles.
  authorizeMinuteRead(subject, entity);

  for (const meeting of meetings) {
    const items = repo.listAgendaItems(meeting.id);
    const entries = repo.listMinutes(meeting.id);
    const byItem = new Map(entries.map((entry) => [entry.agendaItemId, entry]));

    for (const item of items) {
      const entry = byItem.get(item.id);
      if (!entry) continue;
      if (entry.draft && entry.source === "TRANSCRIPT_DRAFT") {
        snapshot.unreviewedDrafts += 1;
      }
      for (const recusal of entry.recusals) {
        snapshot.recusals += 1;
        if (recusal.reason.trim().length > 0) snapshot.recusalsWithReason += 1;
        if (recusal.basis === "OTHER") snapshot.recusalsBasisOther += 1;
      }
      if (item.type !== "DECISION" || !entry.closed) continue;
      snapshot.closedDecisions += 1;
      const flags = checkMinute(entry, item, meeting).flags;
      if (flags.includes(MINUTE_FLAGS.DECISION_WITHOUT_MOTION)) {
        snapshot.closedDecisionsWithoutMotion += 1;
      }
    }

    // A book is only outstanding once the meeting has actually been held.
    // Nothing is owed for an evening that has not happened.
    if (Date.parse(meeting.scheduledStart) > now.getTime()) continue;
    snapshot.booksHeld += 1;
    const ready = minuteBookReady(items, entries, meeting);
    if (ready.ready) {
      snapshot.booksReady += 1;
    } else {
      snapshot.outstanding.push({
        meeting,
        missingItemNumbers: ready.missingItemNumbers,
        incompleteRefs: ready.incompleteRefs,
        decisionsWithoutMotion: items.filter((item) => {
          const entry = byItem.get(item.id);
          if (!entry || item.type !== "DECISION" || !entry.closed) return false;
          return checkMinute(entry, item, meeting).flags.includes(
            MINUTE_FLAGS.DECISION_WITHOUT_MOTION,
          );
        }).length,
      });
    }
  }

  return snapshot;
}

/* ------------------------------------------------------------------ *
 * Rendering figures. Two books, two numbers, one string.
 * ------------------------------------------------------------------ */

/** `JSOA 1 · JSOF 0`, over the books in scope only. Never a sum. */
function perEntity(
  books: BookSnapshot[],
  inScope: (book: BookSnapshot) => boolean,
  text: (book: BookSnapshot) => string,
): string {
  return books
    .filter(inScope)
    .map((book) => `${book.entity} ${text(book)}`)
    .join("  ·  ");
}

function withheldNote(books: BookSnapshot[], inScope: (book: BookSnapshot) => boolean): string {
  const out = books.filter((book) => !inScope(book)).map((book) => book.entity);
  return out.length === 0 ? "" : ` ${out.join(" and ")} withheld from this role.`;
}

const GOVERNANCE_WITHHELD =
  "a board grant on member data for at least one entity. This role reaches " +
  "neither meeting list, so the figure is withheld rather than shown as zero.";

const MINUTES_WITHHELD =
  "row-level access to the minute book. The book names who moved, who seconded " +
  "and who recused, so it sits behind row-level member access; this role holds " +
  "aggregate only, and the figure is withheld rather than shown as zero.";

function worst(...statuses: KpiStatus[]): KpiStatus {
  if (statuses.includes("problem")) return "problem";
  if (statuses.includes("watch")) return "watch";
  return "good";
}

/* ------------------------------------------------------------------ *
 * The three that go on the wall
 * ------------------------------------------------------------------ */

/**
 * The headline figures, in the order they are shown. Three, not seven.
 *
 * A volunteer looking at seven numbers has none, so the other four move behind
 * a disclosure on the Dashboard tab. The three here are the ones that would
 * change what the Secretary does tonight. Each is already rendered per entity,
 * so a JSOA/JSOF pair is one idea shown twice and not two of the three.
 *
 * 1. `decisions-without-motion` — a decision nobody wrote down is the failure
 *    this office exists to prevent, and it is the only figure here that
 *    records something the board cannot go back and fix from memory.
 * 2. `books-ready` — the first figure counts a defect inside a book; this one
 *    counts whether the book exists at all for an evening already held. Taken
 *    together they answer "is there a record, and does it show how the board
 *    decided", which is the whole job.
 * 3. `filings-due` — the only figure on this screen with an outside deadline
 *    and a consequence the board cannot cure afterwards: the NC charitable
 *    solicitation licence is not self-declaring, nothing announces its lapse,
 *    and soliciting on a lapsed licence is the exposure. It is also the tile
 *    that states the quarantine, so the unverified and blocked entries are
 *    named exactly where someone would otherwise miscount them.
 *
 * Deliberately not headlined: `recusals-with-reason` is held at target by a
 * save-path refusal rather than by diligence, so it cannot move and cannot
 * change a decision; `unreviewed-drafts` is hygiene inside unfinished work the
 * second tile already counts; `notice-inside-period` is measured against this
 * platform's own assumption rather than a statutory period, which earns a
 * caveat, not a headline; and `minutes-circulated-lag` is not measurable yet.
 */
export const HEADLINE_KPI_KEYS = [
  "decisions-without-motion",
  "books-ready",
  "filings-due",
] as const;

/** The three, then the rest, with nothing dropped and nothing duplicated. */
export function splitHeadlineKpis(kpis: Kpi[]): { headline: Kpi[]; more: Kpi[] } {
  const headline = HEADLINE_KPI_KEYS.map((key) =>
    kpis.find((kpi) => kpi.key === key),
  ).filter((kpi): kpi is Kpi => kpi !== undefined);
  const headlineKeys = new Set(headline.map((kpi) => kpi.key));
  return { headline, more: kpis.filter((kpi) => !headlineKeys.has(kpi.key)) };
}

/* ------------------------------------------------------------------ *
 * The one authorized read.
 * ------------------------------------------------------------------ */

export function secretaryDashboard(
  subject: Subject,
  now: Date = new Date(),
  repo: MeetingsRepository = meetingsRepository(),
): SecretaryDashboard {
  const books = ENTITIES.map((entity) => snapshotFor(repo, subject, entity, now));
  const governanceEntities = books.filter((b) => b.governance).map((b) => b.entity);
  const minuteEntities = books.filter((b) => b.minutes).map((b) => b.entity);
  const hasGovernance = governanceEntities.length > 0;
  const hasMinutes = minuteEntities.length > 0;
  // A role that reaches nothing at all is not a role holding aggregate, and the
  // withholding note has to say which of the two it is.
  const bookWithheld = hasGovernance ? MINUTES_WITHHELD : GOVERNANCE_WITHHELD;
  const gov = (book: BookSnapshot) => book.governance;
  const min = (book: BookSnapshot) => book.minutes;

  const asOf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(now);

  const quarantined = {
    unverified: books.filter(gov).reduce((n, b) => n + b.unverifiedFilings, 0),
    blocked: books.filter(gov).reduce((n, b) => n + b.blockedFilings, 0),
    unverifiedInWindow: books
      .filter(gov)
      .reduce((n, b) => n + b.unverifiedFilingsInWindow, 0),
  };

  const kpis: Kpi[] = [];

  /* 1. The failure this office exists to prevent. */
  if (!hasMinutes) {
    kpis.push({
      key: "decisions-without-motion",
      label: "Decision items closed with no motion recorded",
      value: null,
      status: "unmeasured",
      from: "Closed minutes against decision items, per book",
      needs: bookWithheld,
    });
  } else {
    const total = books
      .filter(min)
      .reduce((n, b) => n + b.closedDecisionsWithoutMotion, 0);
    kpis.push({
      key: "decisions-without-motion",
      label: "Decision items closed with no motion recorded",
      value: perEntity(
        books,
        min,
        (b) => `${b.closedDecisionsWithoutMotion} of ${b.closedDecisions}`,
      ),
      target: "0 in either book",
      status: total > 0 ? "problem" : "good",
      from:
        "Of the decision items each book has closed, those closed with no motion, " +
        "mover, seconder or vote recorded. A decision nobody wrote down is the " +
        "failure this office exists to prevent." +
        withheldNote(books, min),
    });
  }

  /* 2. Minute books ready against outstanding. Two books, never one number. */
  if (!hasMinutes) {
    kpis.push({
      key: "books-ready",
      label: "Minute books ready, of meetings held",
      value: null,
      status: "unmeasured",
      from: "Every agenda item minuted and no entry incomplete, per book",
      needs: bookWithheld,
    });
  } else {
    const outstanding = books.filter(min).reduce((n, b) => n + b.outstanding.length, 0);
    kpis.push({
      key: "books-ready",
      label: "Minute books ready, of meetings held",
      value: perEntity(books, min, (b) => `${b.booksReady} of ${b.booksHeld}`),
      target: "every book ready",
      status: outstanding > 0 ? "problem" : "good",
      from:
        "Books where every adopted agenda item carries a minute and no entry is " +
        "incomplete, of meetings already held. Nothing is owed for an evening that " +
        "has not happened, and the two books are never added together." +
        withheldNote(books, min),
    });
  }

  /* 3. The lag. Not measurable: nothing records circulation. */
  kpis.push({
    key: "minutes-circulated-lag",
    label: "Days from meeting to minutes circulated, median",
    value: null,
    status: "unmeasured",
    from: "Would be the median per book, stated as a median, never pooled across the two",
    needs:
      "a circulation timestamp on the minute book. The meeting record carries " +
      "when the agenda was adopted and when notice went out, and nothing yet " +
      "records when the minutes went out. Minutes written months later are " +
      "reconstructions, so this is worth recording.",
  });

  /* 4. Recusals. Two other modules' controls rest on these being provable. */
  if (!hasMinutes) {
    kpis.push({
      key: "recusals-with-reason",
      label: "Recusals carrying a stated reason",
      value: null,
      status: "unmeasured",
      from: "Recusals in the decision register, per book",
      needs: bookWithheld,
    });
  } else {
    const recusals = books.filter(min).reduce((n, b) => n + b.recusals, 0);
    const stated = books.filter(min).reduce((n, b) => n + b.recusalsWithReason, 0);
    kpis.push({
      key: "recusals-with-reason",
      label: "Recusals carrying a stated reason",
      value: perEntity(books, min, (b) => `${b.recusalsWithReason} of ${b.recusals}`),
      target: "100% of each book",
      status: recusals > 0 && stated < recusals ? "problem" : "good",
      from:
        "Recusals minuted in each book, on which the scholarship conflict rule and " +
        "the inter-entity transfer rule both depend. The save path refuses a " +
        "reasonless recusal, so this is held at target by a refusal and not by " +
        `diligence; on the catch-all basis, where the wording is the only evidence, ` +
        `${perEntity(books, min, (b) => `${b.recusalsBasisOther}`)}.` +
        withheldNote(books, min),
    });
  }

  /* 5. Filings. The quarantine is the whole point of this tile. */
  if (!hasGovernance) {
    kpis.push({
      key: "filings-due",
      label: `Verified filings due within ${DUE_HORIZON_DAYS} days`,
      value: null,
      status: "unmeasured",
      from: "Compliance calendar, per entity",
      needs: GOVERNANCE_WITHHELD,
    });
  } else {
    const overdue = books.filter(gov).reduce((n, b) => n + b.filingsOverdue, 0);
    kpis.push({
      key: "filings-due",
      label: `Verified filings due within ${DUE_HORIZON_DAYS} days`,
      value: perEntity(books, gov, (b) =>
        b.filingsOverdue > 0
          ? `${b.filingsDueSoon} due, ${b.filingsOverdue} overdue`
          : `${b.filingsDueSoon} of ${b.filingsTracked}`,
      ),
      target: "0 overdue",
      status: overdue > 0 ? "problem" : "good",
      from:
        `Of the verified, unfiled duties each entity tracks, those due by ` +
        `${asOf} plus ${DUE_HORIZON_DAYS} days, which is the same window the ` +
        `compliance page's chip names, from the same constant. Quarantined and counted nowhere ` +
        `above: ${quarantined.unverified} unverified ` +
        `${quarantined.unverified === 1 ? "entry" : "entries"}` +
        `${
          quarantined.unverifiedInWindow > 0 &&
          quarantined.unverifiedInWindow === quarantined.unverified
            ? ", inside this very window"
            : quarantined.unverifiedInWindow > 0
              ? `, ${quarantined.unverifiedInWindow} of them inside this very window`
              : ""
        }, and ${quarantined.blocked} blocked pending confirmation the duty applies ` +
        `to a nonprofit at all.` +
        withheldNote(books, gov),
    });
  }

  /* 6. Transcript drafts. The parser marks everything it writes. */
  if (!hasMinutes) {
    kpis.push({
      key: "unreviewed-drafts",
      label: "Transcript sections still unreviewed draft",
      value: null,
      status: "unmeasured",
      from: "Minute entries written by the parser and not yet cleared, per book",
      needs: bookWithheld,
    });
  } else {
    const drafts = books.filter(min).reduce((n, b) => n + b.unreviewedDrafts, 0);
    kpis.push({
      key: "unreviewed-drafts",
      label: "Transcript sections still unreviewed draft",
      value: perEntity(books, min, (b) => `${b.unreviewedDrafts}`),
      target: "0 in either book",
      status: drafts > 0 ? "watch" : "good",
      from:
        "Minute entries sourced from the transcript parser and still marked draft. " +
        "A draft is not a minute of record, and one reaching the register unedited " +
        "is the risk the mark exists to catch." +
        withheldNote(books, min),
    });
  }

  /* 7. Notice, measured against an assumption that says it is one. */
  if (!hasGovernance) {
    kpis.push({
      key: "notice-inside-period",
      label: "Meetings noticed inside the assumed period",
      value: null,
      status: "unmeasured",
      from: "Notice timestamps against an assumed period, not a statutory one",
      needs: GOVERNANCE_WITHHELD,
    });
  } else {
    const missed = books
      .filter(gov)
      .reduce(
        (n, b) => n + b.unnoticed.filter((u) => !u.stillAchievable).length,
        0,
      );
    const pending = books.filter(gov).reduce((n, b) => n + b.unnoticed.length, 0);
    kpis.push({
      key: "notice-inside-period",
      label: "Meetings noticed inside the assumed period",
      value: perEntity(
        books,
        gov,
        (b) => `${b.noticeInsidePeriod} of ${b.noticeObligations}`,
      ),
      target: "every meeting",
      status: worst(missed > 0 ? "problem" : "good", pending > 0 ? "watch" : "good"),
      from:
        "Notice timestamps against 7 days regular, 48 hours special. That standard " +
        "is this platform's assumption and not law: NC's nonprofit statute supplies " +
        "no board-notice period and the bylaws govern." +
        withheldNote(books, gov),
    });
  }

  /* ---------------------------------------------------------------- *
   * Then say what to do.
   * ---------------------------------------------------------------- */

  const actions: DashboardAction[] = [];

  for (const book of books.filter(min)) {
    for (const out of book.outstanding) {
      const count = out.missingItemNumbers.length + out.incompleteRefs.length;
      const parts: string[] = [];
      if (out.missingItemNumbers.length > 0) {
        parts.push(
          `${out.missingItemNumbers.length} agenda item${
            out.missingItemNumbers.length === 1 ? "" : "s"
          } with no minute (${out.missingItemNumbers.join(", ")})`,
        );
      }
      if (out.incompleteRefs.length > 0) {
        parts.push(`${out.incompleteRefs.join(", ")} incomplete`);
      }
      if (out.decisionsWithoutMotion > 0) {
        parts.push(
          `${out.decisionsWithoutMotion} decision item${
            out.decisionsWithoutMotion === 1 ? "" : "s"
          } closed with no motion recorded`,
        );
      }
      actions.push({
        key: `finish-${out.meeting.id}`,
        label: `Finish the ${book.entity} minute book for ${out.meeting.title}`,
        count,
        href: `/board/meetings/${out.meeting.id}/minutes`,
        note: `${parts.join("; ")}. Until this closes, the ${book.entity} book does not show how the board decided.`,
        urgent: true,
        entity: book.entity,
        urgency: "overdue",
        dueOn: out.meeting.scheduledStart.slice(0, 10),
        blocks:
          `The evening has been held, so the ${book.entity} book is already owed. ` +
          "Nothing can cite a minute that was never written: a treasury transfer, " +
          "an award, or anyone asking next year how the board decided.",
      });
    }
    if (book.unreviewedDrafts > 0) {
      actions.push({
        key: `review-drafts-${book.entity}`,
        label: `Review the ${book.entity} transcript drafts`,
        count: book.unreviewedDrafts,
        href: "/board/meetings/decisions",
        note:
          "Written by the parser and not yet cleared by the Secretary. Edit and clear " +
          "each one, or the register carries a provisional entry as though it were a minute.",
        urgent: false,
        entity: book.entity,
        urgency: "open",
        blocks:
          `Blocks the ${book.entity} decision register being quotable. Every other ` +
          "module reads that register, and until these are cleared it carries a " +
          "machine draft marked provisional where a minute of record should be.",
      });
    }
  }

  for (const book of books.filter(gov)) {
    for (const meeting of book.agendaUnadopted) {
      const daysOut = daysUntil(meeting.scheduledStart.slice(0, 10), now);
      actions.push({
        key: `adopt-${meeting.id}`,
        label: `Adopt the ${book.entity} agenda for ${meeting.title}`,
        count: 1,
        href: `/board/meetings/${meeting.id}/agenda`,
        note:
          "Item numbers are not frozen until the agenda is adopted, so no minute " +
          "reference against this meeting is stable yet, and the treasury module " +
          "cannot record a transfer that points at one.",
        urgent: false,
        entity: book.entity,
        urgency: daysOut <= 14 ? "soon" : "open",
        dueOn: meeting.scheduledStart.slice(0, 10),
        blocks:
          `Blocks every ${book.entity} minute reference for this evening. Item ` +
          "numbers move until the agenda is adopted, so the treasury module cannot " +
          "record a transfer pointing at one, and the other side of an inter-entity " +
          "transfer cannot be written at all.",
      });
    }
    for (const unnoticed of book.unnoticed) {
      const noticeBy = new Date(
        Date.parse(unnoticed.meeting.scheduledStart) - unnoticed.requiredHours * HOUR_MS,
      )
        .toISOString()
        .slice(0, 10);
      actions.push({
        key: `notice-${unnoticed.meeting.id}`,
        label: `Send the ${book.entity} notice and agenda for ${unnoticed.meeting.title}`,
        count: 1,
        href: `/board/meetings/${unnoticed.meeting.id}/distribute`,
        entity: book.entity,
        urgency: unnoticed.stillAchievable ? "soon" : "overdue",
        dueOn: noticeBy,
        blocks:
          `Blocks the ${book.entity} agenda reaching the board at all, and a meeting ` +
          "noticed late is a meeting whose decisions can be questioned afterwards. " +
          `The ${Math.round(unnoticed.requiredHours / 24)}-day period this is measured ` +
          "against is the platform's assumption, not a statutory figure: NC supplies " +
          "no board-notice period and the bylaws govern.",
        note: unnoticed.stillAchievable
          ? `Nothing sent yet. The assumed ${Math.round(
              unnoticed.requiredHours / 24,
            )}-day period can still be met if notice goes out today. The period is the platform's assumption, not a statutory figure.`
          : `Nothing sent, and the assumed ${Math.round(
              unnoticed.requiredHours / 24,
            )}-day period has already closed. Record what notice was given rather than claiming a standard that was not met. The period is an assumption, not law.`,
        urgent: !unnoticed.stillAchievable,
      });
    }
  }

  if (quarantined.blocked > 0) {
    actions.push({
      key: "resolve-blocked-filings",
      label: "Confirm which NC filing the Secretary of State annual report means",
      count: quarantined.blocked,
      href: "/board/meetings/calendar",
      note:
        "Blocked because the duty is not established: the annual report sits in NC's " +
        "business corporation act and may not carry across to nonprofits at all. " +
        `The due ${quarantined.blocked === 1 ? "date is a placeholder" : "dates are placeholders"} ` +
        "and counted in no figure above.",
      urgent: false,
      urgency: "open",
      blocks:
        "Blocks nothing and is owed by nobody, which is the point: it is on the " +
        "calendar as a question, not a duty. No due-soon or overdue count includes " +
        "it, and it stays visible so the question gets answered rather than " +
        "quietly becoming a deadline.",
    });
  }

  if (quarantined.unverified > 0) {
    actions.push({
      key: "resolve-unverified-filings",
      label: "Resolve the unverified NC nonprofit reporting entry",
      count: quarantined.unverified,
      href: "/board/meetings/calendar",
      note:
        "Quarantined and uncountable. Read the 2026 session law and either replace the " +
        "entry with the real duty or delete it. Until then it is not an obligation, is " +
        "not in the due-soon count above, and must not be put to the board as fact.",
      urgent: false,
      urgency: "open",
      blocks:
        "Blocks nothing, because an unconfirmed duty is not a duty. It is here so " +
        "the reading of the session law actually happens; it is counted in no " +
        "figure, has no deadline the board owes, and cannot be marked filed.",
    });
  }

  actions.sort((a, b) => (a.urgent === b.urgent ? 0 : a.urgent ? -1 : 1));

  return { kpis, actions, governanceEntities, minuteEntities, quarantined, asOf };
}

/** The dashboard's figures alone, for a caller that wants only the tiles. */
export function secretaryKpis(subject: Subject, now: Date = new Date()): Kpi[] {
  return secretaryDashboard(subject, now).kpis;
}
